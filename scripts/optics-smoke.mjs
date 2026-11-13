// Node 22+: node scripts/optics-smoke.mjs [http://127.0.0.1:8093]
// Fresh local server: joins two temporary humans, buys a red dot / akimbo
// pistols, aims, walks briefly, and checks a dropped pistol. No shots or chat.
// Fully funded ACOG/Titan purchase and damage cases belong to native tests.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8093');
assert.ok(['http:', 'https:'].includes(base.protocol));
const B = { FORWARD: 1, RIGHT_TRIGGER: 1024 };
const clients = [];
let wasm;

async function until(check, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const failed = clients.find(client => client.error);
    if (failed) throw failed.error;
    if (check()) return;
    await delay(20);
  }
  throw new Error(`Timed out: ${description}`);
}

async function connect(name) {
  const url = new URL('/ws', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const client = { name, socket, id: null, sequence: 0 };
  clients.push(client);
  socket.addEventListener('error', () => {
    if (!client.closing) client.error = new Error(`${name}: WebSocket failed`);
  });
  socket.addEventListener('close', () => {
    client.closed = true;
    if (!client.closing) client.error = new Error(`${name}: unexpected WebSocket close`);
  });
  socket.addEventListener('message', ({ data }) => {
    try {
      const message = JSON.parse(data);
      if (message.t === 'hello') client.hello = message;
      if (message.t === 'settings') client.settings = message;
      if (message.t === 'joined') client.id = message.id;
      if (message.t === 's') client.snapshot = message;
      if (message.t === 'full') throw new Error('Server full; use a fresh development server');
    } catch (error) { client.error = error; }
  });
  await until(() => client.hello && client.settings, `${name}: handshake`);
  return client;
}

function send(client, message) {
  assert.equal(client.socket.readyState, WebSocket.OPEN);
  client.socket.send(JSON.stringify(message));
}
function me(client) {
  assert.ok(client.snapshot?.me, `${client.name}: player snapshot`);
  assert.ok(client.snapshot.me.hp > 0, `${client.name}: player remains alive`);
  return client.snapshot.me;
}
function playerRow(client, id) { return client.snapshot?.pl.find(row => row[0] === id); }

async function input(client, buttons = 0, predict = false, yaw) {
  const before = me(client);
  const weapon = client.hello.weapons[before.w];
  yaw ??= playerRow(client, client.id)[6];
  const dt = 1 / 60;
  let expected;
  if (predict) {
    const aiming = !!(buttons & B.RIGHT_TRIGGER) && weapon.ads && !weapon.dual && before.rl <= 0;
    const speed = weapon.speed * (aiming && before.zoom > 0 ? 0.6 : 1);
    const state = new Float32Array(wasm.memory.buffer, wasm.state_ptr(), 9);
    state.set(before.st);
    const movement = client.snapshot.ph === 0 || client.snapshot.ph === 3 ? buttons & ~31 : buttons;
    wasm.sim_step(movement, yaw, dt, speed);
    expected = [...new Float32Array(wasm.memory.buffer, wasm.state_ptr(), 9)];
  }
  const sequence = ++client.sequence;
  send(client, { t: 'in', map: client.hello.map.id, s: sequence, b: buttons, y: yaw, p: 0, d: dt });
  await until(() => me(client).ack === sequence, `${client.name}: input acknowledged`);
  if (expected) {
    for (let i = 0; i < expected.length; i++) {
      assert.ok(Math.abs(me(client).st[i] - expected[i]) < 0.0003,
        `native/WASM state[${i}]: ${me(client).st[i]} vs ${expected[i]}`);
    }
  }
}

async function select(client, slot) {
  send(client, { t: 'sel', slot });
  await until(() => me(client).sl === slot, `${client.name}: slot ${slot}`);
}
async function rejectedPurchase(client, item) {
  const keys = ['mo', 'optic', 'prOptic', 'seOptic', 'w', 'am', 'rs'];
  const before = keys.map(key => me(client)[key]);
  send(client, { t: 'buy', item });
  // Ordered input acknowledgement proves the preceding purchase was handled.
  await input(client);
  assert.deepEqual(keys.map(key => me(client)[key]), before, `${item}: rejection cannot spend money or change equipment`);
}

try {
  const response = await fetch(new URL('/predict.wasm', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  wasm = (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance.exports;
  const observer = await connect('OpticObserver');
  assert.equal(observer.settings.host, null, 'use a fresh server without other humans');
  const player = await connect('OpticPlayer');
  const dual = await connect('OpticDual');
  send(player, { t: 'join', name: player.name, team: 1, difficulty: 'easy', map: 'sirocco' });
  await until(() => player.id !== null && player.snapshot?.me, 'pistol player joins');
  send(dual, { t: 'join', name: dual.name, team: 2 });
  await until(() => dual.id !== null && dual.snapshot?.me, 'akimbo player joins');
  assert.equal(wasm.select_map(player.hello.map.index), 1);
  const { optics, weapons } = player.hello;
  for (const [id, index, price, zoom] of [['red_dot', 1, 500, 1.5], ['acog', 2, 1200, 4]]) {
    const optic = optics.find(entry => entry.id === id);
    assert.ok(optic, `${id}: optic catalog entry`);
    assert.equal(optic.index, index); assert.equal(optic.price, price); assert.equal(optic.zoom, zoom);
  }
  const titan = weapons.find(weapon => weapon.id === 'titan');
  assert.equal(weapons.indexOf(titan), 31, 'Titan appends to stable weapon indices');
  assert.equal(titan.cls, 5); assert.equal(titan.price, 6200);
  assert.equal(titan.mag, 5); assert.equal(titan.zoom, 12);
  assert.ok(Math.abs(titan.interval - 2.3) < 0.000001);
  assert.ok(Math.abs(titan.reload - 4.8) < 0.000001);
  assert.equal(titan.auto, false); assert.equal(titan.slot, 0);
  for (const weapon of weapons.filter(weapon => weapon.dual)) assert.deepEqual(weapon.optics, []);
  console.log('PASS: optic compatibility/catalog and Titan rifle metadata');

  await select(player, 1);
  const pistol = me(player).w;
  assert.ok(weapons[pistol].optics.includes(1));
  assert.ok(!weapons[pistol].optics.includes(2), 'pistol does not accept ACOG');
  assert.equal(me(player).mo, 800);
  assert.equal(me(player).optic, 0); assert.equal(me(player).seOptic, 0);
  await rejectedPurchase(player, 'acog');
  await rejectedPurchase(player, 'titan');
  send(player, { t: 'buy', item: 'red_dot' });
  await until(() => me(player).optic === 1 && me(player).mo === 300, 'red dot purchased with starting money');
  assert.equal(me(player).seOptic, 1); assert.equal(me(player).prOptic, 0);
  assert.equal(me(player).zoom, 1.5);
  await until(() => playerRow(observer, player.id)?.[11] === 1, 'observer sees equipped optic');
  await rejectedPurchase(player, 'red_dot');
  console.log('PASS: red dot mounts on active pistol, costs $500, and replicates to spectators');

  await select(dual, 2);
  await rejectedPurchase(dual, 'red_dot'); // Enough money: equipment compatibility prevents purchase.
  send(dual, { t: 'buy', item: 'twin_kestrel' });
  await until(() => weapons[me(dual).w].id === 'twin_kestrel', 'second player buys akimbo pistols');
  await rejectedPurchase(dual, 'red_dot');
  await rejectedPurchase(dual, 'acog');
  assert.equal(me(dual).optic, 0); assert.equal(me(dual).seOptic, 0);
  assert.equal(me(dual).zoom, 0);
  console.log('PASS: incompatible/underfunded optic requests leave money and inventory unchanged');

  const ammunition = me(player).am;
  await input(player, B.RIGHT_TRIGGER, true);
  assert.equal(me(player).sc, 1); assert.equal(me(player).zoom, 1.5);
  await until(() => playerRow(observer, player.id)?.[10] & 4, 'observer sees aiming stance');
  await until(() => player.snapshot.ph === 1, 'freeze phase ends', 10000);
  const start = me(player).st.slice(0, 3);
  for (let i = 0; i < 12; i++) await input(player, B.FORWARD | B.RIGHT_TRIGGER, true);
  assert.ok(Math.hypot(me(player).st[0] - start[0], me(player).st[2] - start[2]) > 0.1,
    'player walks while aiming');
  assert.ok(Math.hypot(me(player).st[3], me(player).st[5]) <= weapons[pistol].speed * 0.6 + 0.001);
  await input(player, 0, true);
  assert.equal(me(player).sc, 0); assert.equal(me(player).am, ammunition, 'aiming never fires');
  await select(player, 2);
  assert.equal(me(player).optic, 0); assert.equal(me(player).seOptic, 1);
  await select(player, 1);
  assert.equal(me(player).optic, 1); assert.equal(me(player).zoom, 1.5);
  console.log('PASS: red-dot ADS press/release, native/WASM aiming speed, and optic retained across slots');

  await input(player);
  const previousItems = new Set(player.snapshot.it.map(item => item[0]));
  send(player, { t: 'drop' });
  await until(() => me(player).se === -1 && player.snapshot.it.some(item => !previousItems.has(item[0]) && item[1] === pistol),
    'pistol dropped');
  const dropped = player.snapshot.it.find(item => !previousItems.has(item[0]) && item[1] === pistol);
  assert.equal(dropped[5], 1, 'dropped item retains optic');
  assert.equal(me(player).seOptic, 0);
  await until(() => observer.snapshot.it.some(item => item[0] === dropped[0] && item[5] === 1),
    'observer receives dropped optic');
  await delay(1600); // Normal self-pickup lockout is 1.5 seconds.
  for (let i = 0; i < 60 && me(player).se !== pistol; i++) {
    const [x, , z] = me(player).st;
    const yaw = Math.atan2(-(dropped[2] - x), -(dropped[4] - z));
    await input(player, B.FORWARD, true, yaw);
  }
  assert.equal(me(player).se, pistol, 'walking to the dropped pistol picks it up');
  assert.equal(me(player).seOptic, 1);
  await select(player, 1);
  assert.equal(me(player).optic, 1); assert.equal(me(player).zoom, 1.5);
  assert.equal(me(player).am, ammunition);
  await until(() => !observer.snapshot.it.some(item => item[0] === dropped[0]) &&
    playerRow(observer, player.id)?.[11] === 1, 'pickup removes item and restores held optic for observers');
  console.log('PASS: dropped/picked-up pistol preserves optic, zoom and ammunition on both clients');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    client.closing = true;
    if (client.socket.readyState < WebSocket.CLOSING) client.socket.close();
  }
}
