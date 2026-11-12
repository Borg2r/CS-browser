// Node 22+: node scripts/maps-smoke.mjs [http://127.0.0.1:8088]
// Use a fresh development server. This joins two humans, buys armor and changes
// maps, then leaves. It uses public guest messages and never fires or chats.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8088');
assert.ok(['http:', 'https:'].includes(base.protocol));
const ids = ['sirocco', 'dockyard', 'norheim', 'meridian'];
const clients = [];
let wasm;

async function until(check, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const failed = clients.find(client => client.error);
    if (failed) throw failed.error;
    if (check()) return;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}

function validateHello(hello) {
  assert.deepEqual(hello.maps.map(map => map.id), ids, 'complete map catalog in stable index order');
  for (const [index, map] of hello.maps.entries()) {
    assert.equal(map.index, index);
    for (const key of ['name', 'theme', 'description']) assert.ok(map[key]?.trim(), `${map.id}: ${key}`);
  }
  const map = hello.map;
  const metadata = hello.maps.find(entry => entry.id === map.id);
  assert.ok(metadata, 'active map belongs to catalog');
  for (const key of ['id', 'index', 'name', 'theme', 'description']) assert.equal(map[key], metadata[key]);
  assert.ok(map.w > 10 && map.h > 10 && map.boxes.length > 10, 'playable collision geometry');
  assert.ok(map.boxes.every(box => box.length === 8 && box.every(Number.isFinite)));
  assert.equal(map.sites.length, 2);
}

async function connect(name) {
  const url = new URL('/ws', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const client = { name, socket, id: null, sequence: 0, serial: 0, hellos: [], settings: [], rejections: [] };
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
      const serial = ++client.serial;
      if (message.t === 'hello') {
        validateHello(message);
        client.hellos.push(message);
        client.helloSerial = serial;
      }
      if (message.t === 'joined') client.id = message.id;
      if (message.t === 'settings') {
        assert.equal(message.map, client.hellos.at(-1)?.map.id, 'map hello precedes matching settings');
        client.settings.push(message);
        client.settingsSerial = serial;
      }
      if (message.t === 's') {
        assert.equal(message.map, client.hellos.at(-1)?.map.id, 'snapshot uses current collision map');
        assert.ok(client.settingsSerial > client.helloSerial, 'new hello and settings precede snapshots');
        client.snapshot = message;
        client.snapshotSerial = serial;
      }
      if (message.t === 'r') client.roster = message.pl;
      if (message.t === 'settings_error') client.rejections.push(message);
      if (message.t === 'full') throw new Error('Server is full; use a fresh development server');
    } catch (error) { client.error = error; }
  });
  await until(() => client.hellos.length && client.settings.length, `${name}: initial map/settings`);
  return client;
}

function send(client, message) {
  assert.equal(client.socket.readyState, WebSocket.OPEN);
  client.socket.send(JSON.stringify(message));
}
function active() { return clients.filter(client => !client.closing); }
function mark() {
  return new Map(active().map(client => [client, { hello: client.hellos.length, settings: client.settings.length }]));
}
function checkSettings(client, map, host) {
  const settings = client.settings.at(-1);
  assert.equal(settings.map, map);
  assert.equal(settings.difficulty, 'hard', 'map switch retains difficulty');
  assert.equal(settings.host, host?.id ?? null);
  assert.equal(settings.hostName, host?.name ?? null);
  assert.equal(settings.canChange, client === host);
}
async function updated(before, map, host, changed) {
  await until(() => active().every(client =>
    client.settings.length > before.get(client).settings &&
    (!changed || (client.hellos.length > before.get(client).hello && client.snapshot?.map === map &&
      client.snapshotSerial > client.helloSerial))), `all clients switch to ${map}`);
  for (const client of active()) checkSettings(client, map, host);
}

function checkFreshMatch(host, guest) {
  for (const client of [host, guest]) {
    const snapshot = client.snapshot;
    assert.equal(snapshot.ph, 0, 'map switch starts a fresh freeze phase');
    assert.equal(snapshot.rd, 1);
    assert.deepEqual(snapshot.sc, [0, 0]);
    assert.equal(snapshot.me.hp, 100);
    assert.equal(snapshot.me.mo, 800, 'spent money resets for the new match');
    assert.equal(snapshot.me.ar, 0, 'purchased armor resets for the new match');
    assert.ok(snapshot.pl.some(player => player[0] === host.id && player[2]));
    assert.ok(snapshot.pl.some(player => player[0] === guest.id && player[2]));
  }
  const players = host.snapshot.pl;
  assert.equal(players.length, 10);
  for (let i = 0; i < players.length; i++) {
    assert.equal(players[i][2], 1);
    for (const other of players.slice(i + 1)) {
      assert.ok(Math.abs(players[i][3] - other[3]) >= 0.8 || Math.abs(players[i][5] - other[5]) >= 0.8,
        'fresh player/bot spawns do not overlap');
    }
  }
}

function state() { return new Float32Array(wasm.memory.buffer, wasm.state_ptr(), 9); }
function checkPredictionGeometry(map) {
  assert.equal(wasm.select_map(map.index), 1, `${map.id}: select prediction map`);
  assert.deepEqual([...state()], Array(9).fill(0), 'selection clears prediction state');
  state().set([1, 2, 3, 4, 5, 6, 1, 0, 1]);
  assert.equal(wasm.select_map(999), 0, 'invalid map index rejected');
  assert.deepEqual([...state()], [1, 2, 3, 4, 5, 6, 1, 0, 1], 'invalid selection preserves state');
  assert.equal(wasm.select_map(map.index), 1);
  // Drop the player onto surfaces described by the native server. Their varied
  // positions/heights distinguish each map's compiled collision from Sirocco.
  const surfaces = map.boxes.filter(box => box[4] > 1 && box[3] - box[0] >= 1 && box[5] - box[2] >= 1);
  for (let i = 0; i < surfaces.length; i += Math.max(1, Math.floor(surfaces.length / 8))) {
    const box = surfaces[i];
    const x = (box[0] + box[3]) / 2;
    const z = (box[2] + box[5]) / 2;
    const top = Math.max(...map.boxes.filter(other =>
      x + 0.4 > other[0] && x - 0.4 < other[3] && z + 0.4 > other[2] && z - 0.4 < other[5])
      .map(other => other[4]));
    state().set([x, top + 0.05, z, 0, -1, 0, 0, 0, 0]);
    for (let step = 0; step < 30; step++) wasm.sim_step(0, 0, 1 / 60, 6);
    assert.ok(Math.abs(state()[1] - (top + 0.001)) < 0.003,
      `${map.id}: WASM collision matches native surface at ${x}, ${z}`);
    assert.equal(state()[6], 1, 'prediction settles on solid geometry');
  }
}

async function predictInput(client, buttons, map) {
  const me = client.snapshot.me;
  const speed = client.hellos.at(-1).weapons[me.w].speed;
  const yaw = client.snapshot.pl.find(player => player[0] === client.id)[6];
  state().set(me.st);
  wasm.sim_step(buttons, yaw, 1 / 30, speed);
  const expected = [...state()];
  const sequence = ++client.sequence;
  send(client, { t: 'in', s: sequence, b: buttons, y: yaw, p: 0, d: 1 / 30, map });
  await until(() => client.snapshot.me.ack === sequence, `${map}: movement acknowledgement`);
  for (let axis = 0; axis < 9; axis++) {
    assert.ok(Math.abs(client.snapshot.me.st[axis] - expected[axis]) < 0.0002,
      `${map}: native/WASM state[${axis}] differs: ${client.snapshot.me.st[axis]} vs ${expected[axis]}`);
  }
}

async function rejected(client, requested, current, host) {
  const errors = client.rejections.length;
  const before = mark();
  send(client, { t: 'set_map', map: requested });
  await until(() => client.rejections.length > errors &&
    client.settings.length > before.get(client).settings, 'unauthorized map change rejected');
  assert.ok(client.rejections.at(-1).m?.trim());
  for (const peer of active()) {
    checkSettings(peer, current, host);
    assert.equal(peer.hellos.length, before.get(peer).hello, 'denied request does not reload geometry');
  }
}
async function close(client) {
  client.closing = true;
  client.socket.close();
  await until(() => client.closed, `${client.name}: closes`, 5000);
}

try {
  const response = await fetch(new URL('/predict.wasm', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  wasm = (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance.exports;
  assert.equal(typeof wasm.select_map, 'function', 'deployed prediction supports multiple maps');
  const observer = await connect('MapSpectator');
  assert.equal(observer.settings.at(-1).host, null, 'use a fresh server without existing humans');
  assert.equal(observer.settings.at(-1).map, 'sirocco', 'fresh server defaults to Sirocco');
  const host = await connect('MapHost');
  const guest = await connect('MapGuest');
  let before = mark();
  send(host, { t: 'join', name: host.name, team: 1, map: 'norheim', difficulty: 'hard' });
  await until(() => host.id !== null, 'first human joins');
  await updated(before, 'norheim', host, true);
  before = mark();
  send(guest, { t: 'join', name: guest.name, team: 2, map: 'meridian', difficulty: 'easy' });
  await until(() => guest.id !== null && guest.snapshot?.me, 'second human joins');
  await updated(before, 'norheim', host, false);
  for (const client of active()) assert.equal(client.hellos.length, before.get(client).hello);
  await rejected(guest, 'dockyard', 'norheim', host);
  await rejected(observer, 'sirocco', 'norheim', host);
  console.log('PASS: map catalog, first human preference, late preference ignored, and host-only selection');

  const geometry = new Set();
  for (const map of ids) {
    for (const client of [host, guest]) send(client, { t: 'buy', item: 'vest' });
    await until(() => [host, guest].every(client => client.snapshot.me.mo === 150 && client.snapshot.me.ar === 100),
      'both humans spend money before changing map');
    before = mark();
    send(host, { t: 'set_map', map });
    await updated(before, map, host, true);
    checkFreshMatch(host, guest);
    const metadata = host.hellos.at(-1).map;
    geometry.add(JSON.stringify(metadata.boxes));
    checkPredictionGeometry(metadata);
    for (let step = 0; step < 4; step++) await predictInput(host, 0, map);
    assert.ok(Math.abs(host.snapshot.me.st[1] - 0.001) < 0.003, 'native player settles on spawn floor');
    await until(() => host.snapshot.ph === 1, `${map}: freeze ends`, 10000);
    const start = host.snapshot.me.st.slice(0, 3);
    for (let step = 0; step < 4; step++) await predictInput(host, 1, map);
    assert.ok(Math.hypot(host.snapshot.me.st[0] - start[0], host.snapshot.me.st[2] - start[2]) > 0.1,
      'player can walk away from the spawn');
    console.log(`PASS: ${metadata.name} resets match, retains humans/difficulty, and matches native/WASM collision and movement`);
  }
  assert.equal(geometry.size, 4, 'all four maps have distinct geometry');

  before = mark();
  send(host, { t: 'set_map', map: 'missing-map' });
  send(host, { t: 'set_difficulty', difficulty: 'hard' }); // Ordered processing barrier.
  await updated(before, 'meridian', host, false);
  for (const client of active()) assert.equal(client.hellos.length, before.get(client).hello);
  before = mark();
  await close(host);
  await updated(before, 'meridian', guest, false);
  before = mark();
  send(guest, { t: 'set_map', map: 'dockyard' });
  await updated(before, 'dockyard', guest, true);
  before = mark();
  await close(guest);
  await updated(before, 'dockyard', null, false);
  console.log('PASS: invalid map ignored, host transfer preserves map, and new host can select a map');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    client.closing = true;
    if (client.socket.readyState < WebSocket.CLOSING) client.socket.close();
  }
}
