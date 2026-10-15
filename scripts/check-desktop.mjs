import assert from 'node:assert/strict';
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { validateData } from '../apps/server/dist/services/maintenance.js';
const executable = resolve(process.argv[2] || 'output/windows/win-unpacked/Limited Library.exe');
assert.ok(existsSync(executable), 'Run npm run desktop:pack first.');
const payload = join(dirname(executable), 'resources/backend');
const payloadManifest = JSON.parse(readFileSync(join(payload, 'payload-manifest.json'), 'utf8'));
// electron-builder intentionally omits empty-directory placeholders and Finder metadata.
const bundledResources = Object.entries(payloadManifest).filter(
  ([path]) => !['.gitkeep', '.DS_Store'].includes(basename(path)),
);
for (const [path, hash] of bundledResources) {
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(payload, path)))
      .digest('hex'),
    hash,
    `Missing or changed packaged resource: ${path}`,
  );
}
const sandbox = mkdtempSync(join(tmpdir(), 'limited-library-desktop-'));
const local = join(sandbox, 'local');
const roaming = join(sandbox, 'roaming');
const ignored = join(sandbox, 'ignored-data-override');
const backupRoot = join(sandbox, 'backups');
for (const directory of [local, roaming, ignored, backupRoot]) mkdirSync(directory);
writeFileSync(join(ignored, 'sentinel.txt'), 'must stay unchanged');
const dataDir = join(local, 'LimitedLibrary');
const output = resolve('output/desktop-check');
mkdirSync(output, { recursive: true });
const fixture = join(sandbox, 'cover.png');
await sharp({ create: { width: 120, height: 180, channels: 3, background: '#627551' } })
  .png()
  .toFile(fixture);
const env = {
  ...process.env,
  LOCALAPPDATA: local,
  APPDATA: roaming,
  LL_DATA_DIR: ignored,
  LL_DESKTOP_TEST: '1',
  PATH: join(process.env.SystemRoot, 'System32'),
  ELECTRON_RUN_AS_NODE: undefined,
};
let instance;
const checks = [];
const check = (description) => {
  checks.push(description);
  console.log('PASS', description);
};
async function launch() {
  instance = await electron.launch({ executablePath: executable, args: [], env, timeout: 30000 });
  const page = await instance.firstWindow({ timeout: 30000 });
  await page.locator('.sidebar').waitFor();
  return page;
}
async function close() {
  if (!instance) return;
  await instance.evaluate(({ app }) => app.quit());
  await instance.waitForEvent('close', { timeout: 15000 }).catch(() => {});
  instance = undefined;
  assert.equal(existsSync(join(dataDir, '.data.lock')), false, 'Close must release database lock.');
}
try {
  check(`Every bundled resource matches its SHA-256 manifest (${bundledResources.length} files)`);
  let page = await launch();
  check('Packaged exe starts with only Windows System32 on PATH; no installed Node/npm needed');
  assert.equal(existsSync(join(ignored, 'library.sqlite')), false);
  assert.equal(readFileSync(join(ignored, 'sentinel.txt'), 'utf8'), 'must stay unchanged');
  const origin = new URL(page.url()).origin;
  assert.ok(origin.startsWith('http://127.0.0.1:'));
  const prefs = await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com');
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page.evaluate(() => window.open('https://example.com'));
  assert.equal((await instance.windows()).length, 1);
  check('Renderer is sandboxed; Node access, remote requests and new windows are blocked');
  const lock = JSON.parse(readFileSync(join(dataDir, '.data.lock'), 'utf8'));
  const duplicate = spawn(executable, [], { env, stdio: 'ignore', windowsHide: true });
  const [duplicateCode] = await once(duplicate, 'exit');
  assert.equal(duplicateCode, 0);
  assert.equal(JSON.parse(readFileSync(join(dataDir, '.data.lock'), 'utf8')).pid, lock.pid);
  check('A second launch focuses the original instance without starting another database writer');
  await page.getByRole('link', { name: /已看/ }).click();
  await page.getByRole('button', { name: '补录已看 / 已读' }).click();
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill('桌面验收 · 已看收藏');
  await page.getByRole('checkbox', { name: '标记收藏' }).check();
  await page.locator('input[type=file]').setInputFiles(fixture);
  await page.locator('dialog .cover img').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  const summary = await page.evaluate(async () => (await fetch('/api/summary')).json());
  assert.equal(summary.retained, 0);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.favoriteCount, 1);
  check(
    'Actual desktop UI saves a watched favorite and uploaded cover without using cabinet capacity',
  );
  await page.screenshot({ path: join(output, 'windows-desktop.png') });
  await instance.evaluate(async ({ Menu, dialog, shell }, directory) => {
    dialog.showMessageBox = async (_window, options) => ({
      response: options.type === 'question' ? 1 : 0,
    });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    shell.openPath = async () => '';
    const item = Menu.getApplicationMenu().items[0].submenu.items.find((item) =>
      item.label.startsWith('备份'),
    );
    await item.click();
  }, backupRoot);
  await page.waitForFunction(async () => {
    try {
      return (await fetch('/api/health')).ok;
    } catch {
      return false;
    }
  });
  const backup = join(backupRoot, readdirSync(backupRoot)[0]);
  assert.ok(existsSync(join(backup, 'backup-manifest.json')));
  assert.equal(validateData(backup).items, 1);
  assert.equal(validateData(backup).covers, 1);
  check(
    'Native backup menu checkpoints SQLite, validates a separate backup and restarts the service',
  );
  // A fresh CSRF session must work after backup restarted the backend.
  await page.getByRole('button', { name: '补录已看 / 已读' }).click();
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill('桌面验收 · 备份后保存');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  check('Saving still works with the renewed session after backup');
  await close();
  assert.equal(validateData(dataDir).items, 2);
  try {
    process.kill(lock.pid, 0);
    assert.fail('Backend child survived normal quit');
  } catch (error) {
    assert.equal(error.code, 'ESRCH');
  }
  check('Quit checkpoints and closes SQLite, releases its lock and leaves no backend process');
  page = await launch();
  const restored = await page.evaluate(async () =>
    (await fetch('/api/items?scope=history')).json(),
  );
  assert.equal(restored.total, 2);
  const item = restored.items.find((item) => item.title === '桌面验收 · 已看收藏');
  assert.ok(item.favorite && item.cover);
  const response = await page.request.get(`${new URL(page.url()).origin}/api/assets/${item.cover}`);
  assert.equal(response.status(), 200);
  check('Restart retains both histories, the favorite flag and the original cover');
  await close();
  // A missing DB in a nonempty folder must be refused rather than silently rebuilt.
  const brokenLocal = join(sandbox, 'broken-local');
  mkdirSync(join(brokenLocal, 'LimitedLibrary'), { recursive: true });
  writeFileSync(join(brokenLocal, 'LimitedLibrary', 'personal.txt'), 'preserve');
  const child = spawn(
    join(resolve(executable, '../resources/backend/runtime'), 'node.exe'),
    [resolve(executable, '../resources/backend/apps/server/dist/desktop.js')],
    {
      env: {
        ...process.env,
        LL_MODE: 'production',
        LL_DATA_DIR: join(brokenLocal, 'LimitedLibrary'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  const [failure] = await once(child, 'message');
  assert.equal(failure.kind, 'fatal');
  await once(child, 'exit');
  assert.equal(existsSync(join(brokenLocal, 'LimitedLibrary/library.sqlite')), false);
  check('Existing nonempty folders with missing databases are refused and preserved');
  writeFileSync(
    join(output, 'results.json'),
    JSON.stringify({ executable, checks, passed: checks.length }, null, 2) + '\n',
  );
  console.log(`Desktop acceptance passed: ${checks.length} checks.`);
} finally {
  await close();
  rmSync(sandbox, { recursive: true, force: true });
}
