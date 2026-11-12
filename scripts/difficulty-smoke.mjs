// Node 22+: node scripts/difficulty-smoke.mjs [http://127.0.0.1:8086]
// Run against a freshly started development server: this joins two humans,
// changes shared bot difficulty, and leaves. It never fires or sends chat.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8086');
assert.ok(['http:', 'https:'].includes(base.protocol), 'Use an HTTP(S) server URL');
const levels = ['easy', 'medium', 'hard', 'expert'];
const clients = [];

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
  const client = { socket, name, id: null, settings: [], rejections: [], closing: false };
  clients.push(client);
  socket.addEventListener('error', () => {
    // The server ends its writer immediately after receiving a close frame.
    // Node may report that missing close acknowledgement as an error; the
    // disconnected host and transferred authority are verified separately.
    if (!client.closing) client.error = new Error(`${name}: WebSocket failed`);
  });
  socket.addEventListener('close', () => {
    client.closed = true;
    if (!client.closing) client.error = new Error(`${name}: WebSocket closed unexpectedly`);
  });
  socket.addEventListener('message', ({ data }) => {
    try {
      const message = JSON.parse(data);
      if (message.t === 'hello') client.hello = message;
      if (message.t === 'joined') client.id = message.id;
      if (message.t === 'settings') {
        assert.ok(client.hello, `${name}: hello arrives before the separate settings message`);
        assert.ok(levels.includes(message.difficulty), `${name}: valid difficulty`);
        assert.equal(typeof message.canChange, 'boolean');
        client.settings.push(message);
      }
      if (message.t === 'settings_error') client.rejections.push(message);
      if (message.t === 'full') throw new Error('Server is full; use a fresh development server');
    } catch (error) { client.error = error; }
  });
  await until(() => client.hello && client.settings.length, `${name} hello and settings`);
  return client;
}

function send(client, message) {
  assert.equal(client.socket.readyState, WebSocket.OPEN, `${client.name} remains connected`);
  client.socket.send(JSON.stringify(message));
}

function active() {
  return clients.filter(client => !client.closing);
}

function mark() {
  return new Map(active().map(client => [client, client.settings.length]));
}

function assertSettings(client, difficulty, host) {
  const settings = client.settings.at(-1);
  assert.equal(settings.difficulty, difficulty, `${client.name}: shared difficulty`);
  assert.equal(settings.host, host?.id ?? null, `${client.name}: host player ID`);
  assert.equal(settings.hostName, host?.name ?? null, `${client.name}: host name`);
  assert.equal(settings.canChange, client === host, `${client.name}: permission is connection-specific`);
}

async function broadcastSince(before, difficulty, host) {
  await until(() => active().every(client => client.settings.length > before.get(client)),
    `all clients receive ${difficulty} settings`);
  for (const client of active()) assertSettings(client, difficulty, host);
}

async function rejected(client, requested, current, host) {
  const errors = client.rejections.length;
  const updates = client.settings.length;
  send(client, { t: 'set_difficulty', difficulty: requested });
  await until(() => client.rejections.length > errors && client.settings.length > updates,
    `${client.name} receives denial and current settings`);
  assert.ok(client.rejections.at(-1).m?.trim(), 'denial has a readable message');
  for (const peer of active()) assertSettings(peer, current, host);
}

async function close(client) {
  client.closing = true;
  client.socket.close();
  await until(() => client.closed, `${client.name} disconnects`, 5000);
}

try {
  const health = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const observer = await connect('Spectator');
  assert.equal(observer.settings.at(-1).host, null,
    'Use a fresh server with no other humans; this test changes shared match settings');
  assertSettings(observer, 'medium', null);
  const host = await connect('DifficultyHost');
  const guest = await connect('DifficultyGuest');
  for (const client of clients) assertSettings(client, 'medium', null);
  console.log('PASS: separate settings handshake, Medium default, and no host before joining');

  let before = mark();
  send(host, { t: 'join', name: host.name, team: 1, difficulty: 'easy' });
  await until(() => host.id !== null, 'first human joins');
  await broadcastSince(before, 'easy', host);
  before = mark();
  send(guest, { t: 'join', name: guest.name, team: 2, difficulty: 'expert' });
  await until(() => guest.id !== null, 'second human joins');
  assert.notEqual(host.id, guest.id);
  await broadcastSince(before, 'easy', host);
  console.log('PASS: first human selects Easy; later join preference cannot overwrite it');

  await rejected(guest, 'hard', 'easy', host);
  await rejected(observer, 'expert', 'easy', host);
  console.log('PASS: guest and spectator receive permission errors plus unchanged settings');

  for (const difficulty of levels) {
    before = mark();
    send(host, { t: 'set_difficulty', difficulty });
    await broadcastSince(before, difficulty, host);
  }
  console.log('PASS: host can select all four levels; both teams and spectator receive each update');

  before = mark();
  send(host, { t: 'set_difficulty', difficulty: 'impossible' });
  // An ordered, valid command is a processing barrier for an ignored enum.
  send(host, { t: 'set_difficulty', difficulty: 'expert' });
  await broadcastSince(before, 'expert', host);
  for (const client of active()) {
    assert.ok(client.settings.slice(before.get(client)).every(message => message.difficulty === 'expert'),
      'invalid difficulty must never become shared state');
  }
  console.log('PASS: invalid enum leaves difficulty unchanged and the host socket usable');

  before = mark();
  await close(host);
  await broadcastSince(before, 'expert', guest);
  before = mark();
  send(guest, { t: 'set_difficulty', difficulty: 'medium' });
  await broadcastSince(before, 'medium', guest);
  console.log('PASS: host transfers to the remaining human, who can change difficulty');

  before = mark();
  await close(guest);
  await broadcastSince(before, 'medium', null);
  await rejected(observer, 'easy', 'medium', null);
  console.log('PASS: last human leaving clears host; spectator never gains control');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    client.closing = true;
    if (client.socket.readyState < WebSocket.CLOSING) client.socket.close();
  }
}
