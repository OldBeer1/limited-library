import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'limited-library-smoke-'));
async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const port = await freePort();
const env = {
  ...process.env,
  LL_MODE: 'production',
  LL_DATA_DIR: join(directory, 'data'),
  LL_PORT: String(port),
};
const url = `http://127.0.0.1:${port}`;
let child;
function start(args = []) {
  const process = spawn(globalThis.process.execPath, ['apps/server/dist/index.js', ...args], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  process.stdout.on('data', (data) => console.log(data.toString().trim()));
  process.stderr.on('data', (data) => console.error(data.toString().trim()));
  return process;
}
async function ready(target = url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(target + '/api/health');
      if (response.ok) return;
    } catch {
      /* Startup is bounded below. */
    }
    if (child.exitCode !== null) throw new Error('Server exited before ready');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.send('shutdown');
  await exited;
}
try {
  const init = start(['--init']);
  assert.equal((await once(init, 'exit'))[0], 0);
  child = start();
  await ready();
  const page = await fetch(url + '/', { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Limited Library/);
  const deepLink = await fetch(url + '/history/comic', { headers: { accept: 'text/html' } });
  assert.equal(deepLink.status, 200);
  const token = (await (await fetch(url + '/api/session')).json()).token;
  const body = {
    requestId: randomUUID(),
    placement: 'history',
    item: { title: 'Production smoke synthetic', category: 'comic', favorite: true },
  };
  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, 'x-csrf-token': token },
    body: JSON.stringify(body),
  };
  const created = await fetch(url + '/api/items', options);
  assert.equal(created.status, 201);
  const item = await created.json();
  const blocked = await fetch(url + '/api/items', {
    ...options,
    headers: { ...options.headers, origin: 'https://untrusted.example' },
  });
  assert.equal(blocked.status, 403);
  await stop();
  child = start();
  await ready();
  const recovered = await (await fetch(url + `/api/items/${item.id}`)).json();
  assert.equal(recovered.title, item.title);
  assert.equal(recovered.favorite, true);
  assert.equal(recovered.hasCompleted, true);
  const summary = await (await fetch(url + '/api/summary')).json();
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.retained, 0);
  await stop();
  console.log(
    'PASS: Windows production HTML / deep link / protected API / shutdown / reopen / persisted history',
  );
  const webPort = await freePort();
  const webUrl = `http://127.0.0.1:${webPort}`;
  child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: root,
    env: { ...env, LL_WEB_PORT: String(webPort) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stderr.on('data', (data) => console.error(data.toString().trim()));
  await ready(url);
  await ready(webUrl);
  const webPage = await fetch(webUrl);
  assert.equal(webPage.status, 200);
  assert.match(await webPage.text(), /@vite\/client/);
  const devToken = (await (await fetch(webUrl + '/api/session')).json()).token;
  const devCreated = await fetch(webUrl + '/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: webUrl, 'x-csrf-token': devToken },
    body: JSON.stringify({
      ...body,
      requestId: randomUUID(),
      item: { title: 'Development proxy synthetic', category: 'movie' },
    }),
  });
  assert.equal(devCreated.status, 201);
  await stop();
  console.log('PASS: Windows development Vite / proxy / Origin + token / graceful shutdown');
} finally {
  await stop();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(directory.split(/[\\/]/).at(-1).startsWith('limited-library-smoke-'));
  rmSync(directory, { recursive: true, force: true });
}
