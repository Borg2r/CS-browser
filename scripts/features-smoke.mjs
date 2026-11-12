// Node 22+: node scripts/features-smoke.mjs [http://127.0.0.1:8082]
// Uses the normal guest protocol. Run on a development server when possible:
// it joins one player, buys pistols, and fires into the sky for roughly 15 s.
// On an occupied server it can wait up to three minutes for a fresh round.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8082');
assert.ok(['http:', 'https:'].includes(base.protocol), 'Use an HTTP(S) server URL');
const B = { LEFT: 128, RIGHT: 1024, RELOAD: 256 };
const clients = [];
let inputTimer;
let inputButtons = 0;
let sequence = 0;
let player;

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

async function connect() {
  const url = new URL('/ws', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const client = { socket, events: [], snapshot: null, hello: null, id: null, closing: false };
  clients.push(client);
  socket.addEventListener('error', () => { client.error = new Error('WebSocket connection failed'); });
  socket.addEventListener('close', () => {
    if (!client.closing) client.error = new Error('WebSocket closed before the test completed');
  });
  socket.addEventListener('message', ({ data }) => {
    try {
      const message = JSON.parse(data);
      if (message.t === 'hello') client.hello = message;
      if (message.t === 'joined') client.id = message.id;
      if (message.t === 's') client.snapshot = message;
      if (message.t === 'e') client.events.push(...message.ev);
      if (message.t === 'full') client.error = new Error('Server is full; run the test when a player slot is available');
    } catch (error) { client.error = error; }
  });
  await until(() => client.hello, 'guest handshake');
  return client;
}

function send(message) {
  assert.equal(player.socket.readyState, WebSocket.OPEN, 'player remains connected');
  player.socket.send(JSON.stringify(message));
}

function me() {
  assert.ok(player.snapshot?.me, 'player snapshot available');
  return player.snapshot.me;
}

function requireAlive() {
  assert.ok(me().hp > 0 && player.snapshot.pl.some(p => p[0] === player.id && p[2]),
    'The test player was killed; rerun on an idle development server');
}

async function hold(buttons) {
  inputButtons = buttons;
  const nextSequence = sequence + 1;
  await until(() => me().ack >= nextSequence, `input ${buttons} acknowledgement`);
}

function ownShots(client, from) {
  return client.events.slice(from).filter(event => event.t === 'shot' && event.id === player.id);
}

async function assertBurst(observer, buttons, hands, label) {
  requireAlive();
  await hold(0);
  await delay(220); // Explicit release edge and enough time for either hand's cooldown.
  const before = { left: me().amL, right: me().amR };
  const eventStart = observer.events.length;
  const expectedLeft = before.left - Number(hands.includes(0));
  const expectedRight = before.right - Number(hands.includes(1));
  await hold(buttons);
  await until(() => me().amL === expectedLeft && me().amR === expectedRight, `${label} magazine change`);
  await until(() => ownShots(observer, eventStart).length >= hands.length, `${label} observed shot events`);
  await delay(500); // Longer than several firing intervals: semi-auto must not repeat.
  requireAlive();
  assert.equal(me().amL, expectedLeft, `${label}: left magazine`);
  assert.equal(me().amR, expectedRight, `${label}: right magazine`);
  assert.equal(me().am, expectedLeft + expectedRight, `${label}: total magazine`);
  assert.equal(me().sc, 0, `${label}: akimbo cannot aim`);
  assert.deepEqual(ownShots(observer, eventStart).map(event => event.hand).sort(), [...hands].sort(),
    `${label}: one shot per pressed hand, visible to another client`);
  await hold(0);
}

try {
  const health = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(20000) });
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const observer = await connect(); // Spectator receives the same public combat events.
  player = await connect();
  const { map, weapons } = player.hello;
  assert.equal(map.name, 'Sirocco');
  assert.equal(map.theme, 'desert');
  assert.equal(map.sites.length, 2);
  assert.ok(map.boxes.length > 20 && map.w >= 30 && map.h >= 30, 'complete playable map geometry');
  assert.ok(map.sites.every(site => site.length === 4 && site.every(Number.isFinite)), 'valid objective bounds');
  const dualIndex = weapons.findIndex(weapon => weapon.id === 'twin_kestrel');
  for (const id of ['twin_kestrel', 'twin_mammoth']) {
    const weapon = weapons.find(weapon => weapon.id === id);
    assert.ok(weapon?.dual && !weapon.ads && weapon.zoom === 0, `${id}: dual, never ADS`);
    assert.ok(weapon.mag > 0 && weapon.mag % 2 === 0, `${id}: paired magazines`);
  }
  assert.ok(weapons.some(weapon => weapon.ads && !weapon.dual && weapon.zoom >= 4), 'scoped firearms remain available');
  console.log('PASS: Sirocco map and both akimbo weapon definitions');

  send({ t: 'join', name: `Feature-${Date.now().toString(36)}`, team: 1 });
  await until(() => player.id && player.snapshot?.me, 'player joins');
  let lastInputAt = performance.now();
  inputTimer = setInterval(() => {
    if (player.socket.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastInputAt) / 1000);
    lastInputAt = now;
    send({ t: 'in', s: ++sequence, b: inputButtons, y: 0, p: 1.5, d: dt });
  }, 1000 / 60);
  await until(() => me().hp > 0 && me().cb && player.snapshot.ph === 0,
    'a live player in the next buy phase', 180000);
  send({ t: 'sel', slot: 1 });
  await until(() => me().sl === 1 && weapons[me().w].ads && !weapons[me().w].dual, 'default single pistol');
  const singleAmmo = me().am;
  await hold(B.RIGHT);
  await until(() => me().sc === 1, 'hold RMB aims during the buy phase');
  await until(() => observer.snapshot?.pl.some(p => p[0] === player.id && (p[10] & 4)), 'observer sees aimed stance');
  await delay(200);
  assert.equal(me().am, singleAmmo, 'RMB with a single pistol does not fire');
  await hold(0);
  await until(() => me().sc === 0, 'releasing RMB stops aiming');
  console.log('PASS: ordinary pistol ADS press/release and replicated aimed stance');

  const moneyBefore = me().mo;
  assert.ok(moneyBefore >= weapons[dualIndex].price, 'enough starting money for Twin Kestrels');
  send({ t: 'buy', item: 'twin_kestrel' });
  await until(() => me().w === dualIndex, 'buy Twin Kestrels from the normal shop');
  const capacity = weapons[dualIndex].mag;
  assert.equal(me().amL, capacity / 2);
  assert.equal(me().amR, capacity / 2);
  assert.equal(me().mo, moneyBefore - weapons[dualIndex].price);
  await until(() => player.snapshot.ph === 1, 'live round', 20000);
  await delay(450); // The normal equip delay must expire after the freeze phase.
  await assertBurst(observer, B.LEFT, [0], 'left trigger');
  await assertBurst(observer, B.RIGHT, [1], 'right trigger');
  await assertBurst(observer, B.LEFT | B.RIGHT, [0, 1], 'simultaneous triggers');
  console.log('PASS: separate left/right magazines, simultaneous shots, semi-auto hold, no akimbo ADS');

  const reserveBefore = me().rs;
  const missingRounds = capacity - me().am;
  assert.equal(missingRounds, 4, 'only the four expected bullets were fired');
  await hold(B.RELOAD);
  await until(() => me().rl > 0, 'reload begins');
  const ammoDuringReload = me().am;
  await hold(B.LEFT | B.RIGHT);
  await delay(200);
  assert.equal(me().am, ammoDuringReload, 'neither gun fires during reload');
  assert.equal(me().sc, 0, 'reload does not enter ADS');
  await hold(0);
  await until(() => me().rl === 0 && me().am === capacity, 'both magazines reload', 8000);
  requireAlive();
  assert.equal(me().amL, capacity / 2);
  assert.equal(me().amR, capacity / 2);
  assert.equal(me().rs, reserveBefore - missingRounds, 'reload consumes exactly the missing rounds');
  console.log('PASS: paired reload, exact reserve consumption, and reload fire lockout');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearInterval(inputTimer);
  for (const client of clients) {
    client.closing = true;
    client.socket.close();
  }
}
