// Node 22+: node scripts/smoke.mjs https://your-game.example
// Joins two temporary guest players and checks that they share one live match.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8080');
const clients = [];
async function until(check, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}
async function guest(name, team) {
  const url = new URL('/ws', base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const client = { socket, messages: [], name };
  clients.push(client);
  socket.addEventListener('message', ({ data }) => {
    try { client.messages.push(JSON.parse(data)); }
    catch (error) { client.error = error; }
  });
  socket.addEventListener('error', () => { client.error = new Error('WebSocket connection failed'); });
  await until(() => client.error || client.messages.some(m => m.t === 'hello'), 'guest handshake');
  if (client.error) throw client.error;
  socket.send(JSON.stringify({ t: 'join', name, team }));
  await until(() => client.messages.some(m => m.t === 'joined'), 'guest joins');
  client.id = client.messages.find(m => m.t === 'joined').id;
  return client;
}

try {
  const health = await fetch(new URL('/healthz', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  for (const path of ['/', '/js/main.js', '/vendor/three.module.min.js', '/predict.wasm']) {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  const tag = Date.now().toString(36);
  const a = await guest(`GuestA-${tag}`, 1);
  const b = await guest(`GuestB-${tag}`, 2);
  assert.notEqual(a.id, b.id);
  for (const client of clients) {
    await until(() => client.messages.some(m => m.t === 'r' &&
      m.pl.some(p => p.id === a.id && !p.bot) &&
      m.pl.some(p => p.id === b.id && !p.bot)), 'both guests in the same roster');
    client.socket.send(JSON.stringify({ t: 'in', s: 1, b: 0, y: 0, p: 0, d: 1 / 60 }));
    await until(() => client.messages.some(m => m.t === 's' && m.me?.ack >= 1), 'input acknowledgement');
    assert.ok(client.messages.some(m => m.t === 's' && m.pl.length === 10), 'ten player/bot slots');
  }
  const text = `Multiplayer check ${tag}`;
  a.socket.send(JSON.stringify({ t: 'chat', m: text }));
  await until(() => b.messages.some(m => m.t === 'e' && m.ev.some(e => e.t === 'chat' && e.m === text)), 'chat reaches the other guest');
  console.log('PASS: health, assets, two guests without login, shared match, input acknowledgements, and cross-player chat');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) client.socket.close();
}
