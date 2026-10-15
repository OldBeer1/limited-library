// Repeatable browser acceptance through the installed Playwright CLI skill.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'output/playwright');
mkdirSync(output, { recursive: true });
const cliPath = join(root, 'node_modules/@playwright/cli/playwright-cli.js');
const session = `limited-library-check-${process.pid}`;
function cli(...args) {
  const result = spawnSync(process.execPath, [cliPath, `-s=${session}`, '--json', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Browser CLI failed');
  const data = JSON.parse(result.stdout);
  if (data.error) throw new Error(JSON.stringify(data));
  return data;
}
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/preview.ts'], {
  cwd: root,
  env: { ...process.env, LL_PREVIEW_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
child.stderr.on('data', (data) => console.error(data.toString().trim()));
let dataDir;
async function browserFlow(page) {
  const outputPath = '__OUTPUT_DIRECTORY__';
  const fixturePath = '__FIXTURE_PATH__';
  const origin = new URL(page.url()).origin;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const check = (condition, description) => {
    if (!condition) throw new Error(description);
  };
  const summary = () => page.evaluate(async () => (await fetch('/api/summary')).json());
  const matching = (title) =>
    page.evaluate(
      async (title) =>
        (await fetch('/api/items?scope=history&q=' + encodeURIComponent(title))).json(),
      title,
    );
  const before = await summary();
  await page.getByRole('link', { name: /已看/ }).click();
  await page.getByRole('button', { name: '补录已看 / 已读' }).click();
  const title = `演示 · 自动历史验收 ${Date.now()}`;
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill(title);
  await page.getByRole('checkbox', { name: '标记收藏' }).check();
  await page.locator('input[type=file]').setInputFiles(fixturePath);
  await page.locator('dialog .cover img').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  const history = await matching(title);
  check(
    history.total === 1 &&
      history.items[0].favorite &&
      history.items[0].cover &&
      history.items[0].dateCompleted === null,
    'History, favorite, uploaded cover, or unknown date failed',
  );
  check((await summary()).retained === before.retained, 'History occupied cabinet capacity');
  await page.getByRole('button', { name: '补录已看 / 已读' }).click();
  const offlineTitle = `演示 · 离线验收 ${Date.now()}`;
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill(offlineTitle);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.locator('dialog [role=alert]').waitFor({ state: 'visible' });
  check(
    (await page.getByRole('textbox', { name: '作品标题', exact: true }).inputValue()) ===
      offlineTitle,
    'Offline save discarded draft',
  );
  await page.context().setOffline(false);
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  check((await matching(offlineTitle)).total === 1, 'Offline retry duplicated item');
  await page.goto(origin + '/cabinet/movie');
  await page.getByRole('heading', { name: '柜中的作品 2' }).waitFor();
  const count = (await summary()).retained;
  await page.getByRole('button', { name: '添加作品', exact: true }).click();
  await page.getByRole('textbox', { name: '作品标题', exact: true }).fill('演示 · 自动替换验收');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  const replace = page.getByRole('dialog', { name: '为新作品，腾一个位置' });
  await replace.waitFor();
  await replace.getByRole('button', { name: '取消，保留草稿' }).click();
  check(
    (await page.getByRole('textbox', { name: '作品标题', exact: true }).inputValue()) ===
      '演示 · 自动替换验收',
    'Cancel lost replacement draft',
  );
  check((await summary()).retained === count, 'Cancel mutated database');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await replace.waitFor();
  await replace.getByRole('radio').nth(0).waitFor();
  await replace.getByRole('radio').nth(0).check();
  const competing = await page.evaluate(async () => {
    const items = await (await fetch('/api/items?scope=retained&category=movie&pageSize=8')).json();
    const item = items.items[0];
    const token = (await (await fetch('/api/session')).json()).token;
    return (
      await fetch('/api/items/' + item.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({
          requestId: window.crypto.randomUUID(),
          expectedVersion: item.version,
          changes: { notes: '演示：另一页面已修改候选' },
        }),
      })
    ).status;
  });
  check(competing === 200, 'Competing candidate update failed');
  await replace.getByRole('checkbox', { name: '我确认这次替换' }).check();
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes('/api/items?scope=retained&category=movie&pageSize=8') &&
      response.status() === 200,
    { timeout: 3000 },
  );
  await replace.getByRole('button', { name: '确认替换', exact: true }).click();
  await replace.getByRole('alert').waitFor();
  await refreshed;
  check((await summary()).retained === count, 'Stale candidate mutated slot count');
  await replace.getByRole('radio').nth(0).waitFor();
  await replace.getByRole('button', { name: '关闭弹窗' }).focus();
  await page.setViewportSize({ width: 375, height: 812 });
  await replace.getByRole('radio').nth(0).waitFor();
  // Native dialog starts at its close button. Complete the entire selection with keyboard.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  check(await replace.getByRole('radio').nth(0).isChecked(), 'Keyboard candidate selection failed');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  check(
    await replace.getByRole('checkbox', { name: '我确认这次替换' }).isChecked(),
    'Keyboard confirmation failed',
  );
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    page: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll('dialog[open]')].map(
      (d) => d.scrollWidth <= d.clientWidth,
    ),
  }));
  check(
    dimensions.width === dimensions.page && dimensions.dialogs.every(Boolean),
    '375px form overflow',
  );
  await page.screenshot({ path: outputPath + '/replace-375.png' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  const movie = (await summary()).categories.find((c) => c.id === 'movie');
  check(movie.retained === 2 && movie.remaining === 0, 'Replacement changed slot count');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '/history/comic');
    await page.getByRole('heading', { name: /已读清单/ }).waitFor();
    const sizes = await page.evaluate(() => ({
      width: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    check(sizes.width === sizes.page, `History overflow at ${width}`);
    await page.screenshot({ path: outputPath + `/history-${width}.png`, fullPage: true });
  }
  await page.goto(origin + '/settings');
  const capacity = page.getByRole('spinbutton', { name: '电影容量上限' });
  await capacity.fill('3');
  await page
    .locator('form')
    .filter({ has: capacity })
    .getByRole('button', { name: '保存容量' })
    .click();
  await page.getByRole('status').filter({ hasText: '容量已更新' }).waitFor();
  check(
    (await summary()).categories.find((c) => c.id === 'movie').capacity === 3,
    'Settings save failed',
  );
  await page.goto(origin + '/history');
  await page.getByRole('searchbox', { name: '搜索作品' }).fill(title);
  await page.getByRole('button', { name: `查看 ${title}`, exact: true }).click();
  await page.getByRole('textbox', { name: '留一点感想 可选' }).fill('演示：浏览器编辑后的备注');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  check((await matching(title)).items[0].notes === '演示：浏览器编辑后的备注', 'Editing failed');
  await page.getByRole('button', { name: `取消收藏 ${title}`, exact: true }).click();
  await page.getByRole('button', { name: `收藏 ${title}`, exact: true }).waitFor();
  check(!(await matching(title)).items[0].favorite, 'Favorite toggle failed');
  await page.getByRole('button', { name: `查看 ${title}`, exact: true }).click();
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '永久删除这条记录？' });
  await deletion.getByRole('button', { name: '取消，保留记录' }).click();
  check((await matching(title)).total === 1, 'Deletion cancel removed item');
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  await deletion.getByRole('button', { name: '确认永久删除' }).click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
  check((await matching(title)).total === 0, 'Permanent deletion failed');
  await page.goto(origin + '/');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('heading', { name: /柜中的作品/ }).waitFor();
  await page.screenshot({ path: outputPath + '/cabinet-1440.png', fullPage: true });
  check(errors.length === 0, 'Unexpected browser exception: ' + errors.join('; '));
  return {
    pass: true,
    checks: [
      'history/favorite/cover/unknown-date',
      'offline draft + retry',
      'cancel replacement',
      'stale candidate reload',
      '375px keyboard replacement',
      '375/768/1440 layout',
      'capacity settings',
      'search/edit/favorite toggle',
      'delete confirmation/cancel',
      'no browser exceptions',
    ],
  };
}
try {
  const info = await Promise.race([
    once(child, 'message').then(([info]) => info),
    once(child, 'exit').then(() => {
      throw new Error('Preview failed to start');
    }),
  ]);
  dataDir = info.dataDir;
  const fixture = join(output, 'synthetic-cover.png');
  await sharp({ create: { width: 120, height: 180, channels: 3, background: '#77866a' } })
    .png()
    .toFile(fixture);
  cli('open', `http://127.0.0.1:${port}`, '--browser', 'msedge');
  cli('snapshot');
  const source =
    '(' +
    browserFlow
      .toString()
      .replace("'__OUTPUT_DIRECTORY__'", JSON.stringify(output))
      .replace("'__FIXTURE_PATH__'", JSON.stringify(fixture)) +
    ')';
  const codePath = join(output, 'ui-flow.js');
  writeFileSync(codePath, source);
  const response = cli('run-code', '--filename', codePath);
  writeFileSync(join(output, 'ui-result.json'), JSON.stringify(response, null, 2));
  const result = JSON.parse(response.result ?? '{}');
  assert.equal(result.pass, true, JSON.stringify(response));
  console.log(JSON.stringify(result, null, 2));
} finally {
  try {
    cli('close');
  } catch {
    /* Preserve original test failure. */
  }
  if (child.exitCode === null) {
    const exit = once(child, 'exit');
    child.send('shutdown');
    await exit;
  }
  if (dataDir) {
    assert.equal(dirname(resolve(dataDir)), resolve(tmpdir()));
    assert.ok(dataDir.split(/[\\/]/).at(-1).startsWith('limited-library-browser-'));
    rmSync(dataDir, { recursive: true, force: true });
  }
}
