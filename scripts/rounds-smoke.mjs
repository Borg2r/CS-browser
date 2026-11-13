// Node 22+: node scripts/rounds-smoke.mjs [http://127.0.0.1:8098]
// Fresh local development server only. Joins two humans, tests restarts, then
// uses at most two grenades per life to test skipping an actual bots-only round.
// Uses public protocol only; do not run against an occupied public match.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8098');
assert.ok(['http:', 'https:'].includes(base.protocol));
const clients = [];
const map = 'dockyard', difficulty = 'easy';
const inventoryKeys = ['mo', 'pr', 'se', 'prOptic', 'seOptic', 'ar', 'he', 'kit', 'nd'];

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

async function connect(name) {
  const url = new URL('/ws', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const client = { name, socket, id: null, sequence: 0, serial: 0, errors: [], events: [], skippedRounds: new Set() };
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
      const message = JSON.parse(data), serial = ++client.serial;
      if (message.t === 'hello') client.hello = message;
      if (message.t === 'joined') client.id = message.id;
      if (message.t === 'settings') { client.settings = message; client.settingsSerial = serial; }
      if (message.t === 'r') client.roster = message.pl;
      if (message.t === 'round_error') client.errors.push(message);
      if (message.t === 'e') client.events.push(...message.ev);
      if (message.t === 's') {
        assert.ok(Number.isSafeInteger(message.roundId) && message.roundId > 0, 'valid round token');
        for (const key of ['canRestart', 'canSkip', 'skipping']) assert.equal(typeof message[key], 'boolean', key);
        client.snapshot = message; client.snapshotSerial = serial;
        if (message.skipping) client.skippedRounds.add(message.roundId);
      }
      if (message.t === 'full') throw new Error('Server is full; use a fresh development server');
    } catch (error) { client.error = error; }
  });
  await until(() => client.hello && client.settings && client.snapshot, `${name}: handshake`);
  return client;
}

function active() { return clients.filter(client => !client.closing); }
function send(client, message) {
  assert.equal(client.socket.readyState, WebSocket.OPEN);
  client.socket.send(JSON.stringify(message));
}
function me(client) {
  assert.ok(client.snapshot?.me, `${client.name}: joined player snapshot`);
  return client.snapshot.me;
}
function stats(client) {
  const row = client.roster?.find(player => player.id === client.id);
  assert.ok(row, `${client.name}: roster entry`);
  return [row.k, row.d];
}
function inventory(client) {
  return JSON.parse(JSON.stringify(inventoryKeys.map(key => me(client)[key])));
}
async function input(client, buttons = 0, pitch = 0) {
  const sequence = ++client.sequence;
  const own = client.snapshot.pl.find(row => row[0] === client.id);
  send(client, { t: 'in', map, roundId: client.snapshot.roundId,
    s: sequence, b: buttons, y: own[6], p: pitch, d: 1 / 60 });
  await until(() => me(client).ack === sequence, `${client.name}: current-round input acknowledged`);
}
async function select(client, slot) {
  send(client, { t: 'sel', slot });
  await until(() => me(client).sl === slot, `${client.name}: equip slot ${slot}`);
}
async function denied(client, action, roundId = client.snapshot.roundId) {
  const count = client.errors.length, current = client.snapshot.roundId;
  send(client, { t: action, roundId });
  await until(() => client.errors.length > count, `${client.name}: ${action} denied`);
  assert.ok(client.errors.at(-1).m?.trim(), 'round denial has a readable explanation');
  for (const peer of active()) assert.equal(peer.snapshot.roundId, current, 'denial cannot change the round');
}

async function restart(host, humans, baseline) {
  const previous = host.snapshot;
  send(host, { t: 'restart_round', roundId: previous.roundId });
  await until(() => active().every(client => client.snapshot.roundId > previous.roundId), 'restart reaches every client');
  for (const client of active()) {
    const snapshot = client.snapshot;
    assert.equal(snapshot.roundId, host.snapshot.roundId);
    assert.equal(snapshot.rd, previous.rd, 'restart keeps round number');
    assert.deepEqual(snapshot.sc, previous.sc, 'restart keeps match score');
    assert.equal(snapshot.ph, 0); assert.equal(snapshot.skipping, false);
    assert.equal(snapshot.canRestart, client === host);
    assert.equal(snapshot.canSkip, false);
    assert.equal(snapshot.map, map); assert.equal(client.settings.difficulty, difficulty);
    assert.equal(client.settings.host, host.id);
    assert.equal(snapshot.bomb, null);
    for (const key of ['it', 'nd', 'sm']) assert.deepEqual(snapshot[key], [], 'old world effects cleared');
  }
  for (const client of humans) {
    assert.equal(me(client).hp, 100);
    assert.equal(me(client).rl, 0); assert.equal(me(client).sc, 0);
    assert.deepEqual(inventory(client), baseline.get(client).inventory, 'round-start purchases/loadout restored');
    assert.deepEqual(stats(client), baseline.get(client).stats, 'round-start kills/deaths restored');
  }
  return previous.roundId;
}

async function staleInputIgnored(host, oldRoundId) {
  const ack = me(host).ack, position = me(host).st.slice(0, 3);
  send(host, { t: 'in', map, roundId: oldRoundId, s: ++host.sequence,
    b: 1025, y: 1.2, p: 0.5, d: 0.05 });
  const settingsSerial = host.settingsSerial;
  send(host, { t: 'set_difficulty', difficulty });
  await until(() => host.settingsSerial > settingsSerial, 'ordered control-message barrier');
  const barrier = host.settingsSerial;
  await until(() => host.snapshotSerial > barrier, 'a simulation snapshot after the stale input');
  assert.equal(me(host).ack, ack, 'stale input cannot advance acknowledgement');
  assert.equal(me(host).sc, 0, 'stale RMB cannot aim the restored weapon');
  assert.deepEqual(me(host).st.slice(0, 3), position, 'stale movement cannot alter the restored position');
  await input(host);
}

async function selfGrenades(client) {
  assert.equal(client.snapshot.ph, 1);
  for (let attempt = 0; attempt < 2 && me(client).hp > 0; attempt++) {
    assert.ok(me(client).cb && me(client).mo >= 300, 'still in the buy zone with grenade funds');
    send(client, { t: 'buy', item: 'frag' });
    await until(() => me(client).nd[0] === 1, 'buy self-test grenade');
    await select(client, 3);
    await input(client, 0, -1.55);
    await delay(400); // Normal equip delay, with both triggers released.
    const health = me(client).hp;
    send(client, { t: 'in', map, roundId: client.snapshot.roundId, s: ++client.sequence,
      b: 128, y: 0, p: -1.55, d: 1 / 60 });
    await until(() => me(client).nd[0] === 0, 'grenade thrown almost vertically down');
    await input(client, 0, -1.55);
    await until(() => me(client).hp < health, 'self-grenade causes real damage', 4500);
  }
  assert.equal(me(client).hp, 0, 'two affordable grenades should kill the unarmored test player');
}

async function close(client) {
  client.closing = true;
  client.socket.close();
  await until(() => client.closed, `${client.name}: disconnect`, 5000);
}

try {
  const health = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(health.status, 200);
  const observer = await connect('RoundObserver');
  assert.equal(observer.settings.host, null, 'use a fresh development server without other humans');
  const host = await connect('RoundHost');
  const guest = await connect('RoundGuest');
  send(host, { t: 'join', name: host.name, team: 1, map, difficulty });
  await until(() => host.id !== null && host.snapshot?.me, 'host joins');
  send(guest, { t: 'join', name: guest.name, team: 2 });
  await until(() => guest.id !== null && guest.snapshot?.me && guest.roster?.some(p => p.id === guest.id), 'guest joins');
  await until(() => active().every(client => client.snapshot.roundId === host.snapshot.roundId), 'shared starting round');
  const baseline = new Map([host, guest].map(client => [client, { inventory: inventory(client), stats: stats(client) }]));
  assert.equal(host.snapshot.canRestart, true);
  assert.equal(guest.snapshot.canRestart, false); assert.equal(observer.snapshot.canRestart, false);
  assert.ok(active().every(client => !client.snapshot.canSkip && !client.snapshot.skipping));
  await denied(guest, 'restart_round');
  await denied(observer, 'restart_round');
  await denied(host, 'skip_round');

  await select(host, 1);
  send(host, { t: 'buy', item: 'red_dot' });
  send(guest, { t: 'buy', item: 'twin_kestrel' });
  await until(() => me(host).optic === 1 && me(host).mo === 300 && me(guest).mo === 300,
    'both humans change inventory and spend money');
  const staleRoundId = await restart(host, [host, guest], baseline);
  await denied(host, 'restart_round', staleRoundId);
  await denied(host, 'skip_round', staleRoundId);
  await staleInputIgnored(host, staleRoundId);
  console.log('PASS: host-only restart restores both inventories/cash, retains match settings, and rejects stale requests/inputs');

  await until(() => host.snapshot.ph === 1, 'restart freeze ends', 10000);
  for (let i = 0; i < 5; i++) await input(host, 1);
  await input(host);
  await selfGrenades(host);
  assert.ok(me(guest).hp > 0, 'the other human remains alive');
  assert.equal(host.snapshot.canSkip, false, 'cannot skip while another human lives');
  await denied(host, 'skip_round');
  assert.equal(stats(host)[1], baseline.get(host).stats[1] + 1, 'real death recorded before restart');
  await restart(host, [host, guest], baseline);
  console.log('PASS: dead host can restart Live; health, purchases and death count roll back; live humans block skipping');

  await close(guest);
  await until(() => host.snapshot.ph === 1, 'second restart freeze ends', 10000);
  await selfGrenades(host);
  await until(() => host.snapshot.canSkip, 'last human dead with bots still fighting');
  assert.equal(observer.snapshot.canSkip, false, 'unjoined spectators cannot skip');
  await denied(observer, 'skip_round');
  const previous = host.snapshot;
  send(host, { t: 'skip_round', roundId: previous.roundId });
  await until(() => active().every(client => client.skippedRounds.has(previous.roundId)), 'skip progress announced to all clients');
  await until(() => active().every(client => client.snapshot.roundId > previous.roundId), 'bots finish one accelerated round', 20000);
  const current = host.snapshot;
  assert.equal(current.rd, previous.rd + 1);
  assert.equal(current.sc[0] + current.sc[1], previous.sc[0] + previous.sc[1] + 1, 'normal rules award one score');
  for (const client of active()) {
    assert.equal(client.snapshot.roundId, current.roundId);
    assert.deepEqual(client.snapshot.sc, current.sc);
    assert.equal(client.snapshot.ph, 0); assert.equal(client.snapshot.skipping, false);
    assert.equal(client.snapshot.canSkip, false);
    assert.equal(client.snapshot.map, map); assert.equal(client.settings.difficulty, difficulty);
  }
  assert.equal(me(host).hp, 100);
  assert.ok(me(host).mo > 200, 'normal round economy awards funds after skipped resolution');
  assert.equal(stats(host)[1], baseline.get(host).stats[1] + 1, 'skip preserves completed-round death statistics');
  await denied(host, 'skip_round', previous.roundId);
  console.log('PASS: bots-only skip reports progress, follows normal scoring/economy, and respawns everyone exactly once');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    client.closing = true;
    if (client.socket.readyState < WebSocket.CLOSING) client.socket.close();
  }
}
