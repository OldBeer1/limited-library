import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import type {
  CategoryId,
  CreateRequest,
  MediaInput,
  MediaItem,
  ReplacementRequest,
} from '@limited-library/contracts';
import { createApp } from '../apps/server/src/app.js';
import { configuration } from '../apps/server/src/config.js';
import { openDatabase, closeDatabase } from '../apps/server/src/db/database.js';
import { importCover } from '../apps/server/src/services/assets.js';
import { calendarDate } from '../apps/server/src/services/library.js';
import { backupData, restoreData, validateData } from '../scripts/maintenance.js';
function temp(t: TestContext, beforeRemove: () => void | Promise<void> = () => {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'limited-library-mvp-'));
  t.after(async () => {
    await beforeRemove();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)?.startsWith('limited-library-mvp-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
async function fixture(t: TestContext) {
  const lifecycle = { close: async () => {} };
  const directory = temp(t, () => lifecycle.close()),
    dataDir = join(directory, 'data');
  const instance = await createApp({ mode: 'test', dataDir, port: 3210, allowCreate: true });
  lifecycle.close = () => instance.app.close();
  const host = '127.0.0.1:3210';
  const session = await instance.app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { host },
  });
  assert.equal(session.statusCode, 200);
  const token = session.json<{ token: string }>().token;
  async function request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: object,
    extra: Record<string, string> = {},
  ) {
    return instance.app.inject({
      method,
      url,
      headers: {
        host,
        origin: `http://${host}`,
        'x-csrf-token': token,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...extra,
      },
      ...(body ? { payload: JSON.stringify(body) } : {}),
    });
  }
  const create = (
    item: MediaInput,
    placement: 'cabinet' | 'history' = 'cabinet',
    requestId = randomUUID(),
  ) => request('POST', '/api/items', { requestId, placement, item });
  function seed(category: CategoryId = 'movie', count = 10): MediaItem[] {
    return Array.from({ length: count }, (_, index) =>
      instance.service.create({
        requestId: randomUUID(),
        placement: 'cabinet',
        item: { title: `Synthetic ${index}`, category },
      }),
    );
  }
  return { ...instance, directory, dataDir, request, create, seed, token, host };
}
test('pure calendar rules accept leap days and reject impossible dates', () => {
  assert.equal(calendarDate('2024-02-29'), true);
  for (const day of ['2025-02-29', '2026-02-30', '0000-01-01', '2026-13-01', 'garbage'])
    assert.equal(calendarDate(day), false);
});
test('test configuration never falls back to production data', () => {
  assert.throws(() => configuration({ LL_MODE: 'test' }), /LL_DATA_DIR/);
  assert.throws(
    () => configuration({ LL_MODE: 'production', LL_DATA_DIR: 'relative' }),
    /绝对路径/,
  );
  const dev = configuration({ LL_MODE: 'development' });
  assert.match(dev.dataDir, /\.local-data[\\/]development$/);
});
test('Windows native driver initializes six categories and migration checksum', async (t) => {
  const f = await fixture(t),
    response = await f.request('GET', '/api/summary');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json().categories.map((c: { capacity: number }) => c.capacity),
    [10, 10, 10, 6, 10, 5],
  );
  assert.equal(response.json().capacity, 51);
  assert.equal(f.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(f.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM schema_migrations').get() &&
      f.db.pragma('integrity_check', { simple: true }),
    'ok',
  );
});
test('9/10 becomes 10/10; API and direct SQL reject overflow', async (t) => {
  const f = await fixture(t);
  f.seed('movie', 9);
  assert.equal((await f.create({ title: 'Tenth', category: 'movie' })).statusCode, 201);
  const overflow = await f.create({ title: 'Eleventh', category: 'movie' });
  assert.equal(overflow.statusCode, 409);
  assert.equal(overflow.json().code, 'CATEGORY_FULL');
  assert.throws(
    () =>
      f.db
        .prepare(
          "INSERT INTO media_items(id,title,category_id,status,date_added) VALUES (?,?,'movie','planned','2026-10-15')",
        )
        .run(randomUUID(), 'Direct SQL'),
    /CATEGORY_FULL/,
  );
  assert.equal(f.service.repo.category('movie').retained, 10);
});
test('completed and dropped still occupy; null rating differs from zero', async (t) => {
  const f = await fixture(t);
  const completed = await f.create({
    title: 'Completed',
    category: 'movie',
    status: 'completed',
    rating: 0,
  });
  const dropped = await f.create({ title: 'Dropped', category: 'movie', status: 'dropped' });
  assert.equal(completed.json().hasCompleted, true);
  assert.equal(completed.json().rating, 0);
  assert.equal(dropped.json().rating, null);
  assert.equal(f.service.repo.category('movie').retained, 2);
});
test('zero-capacity category accepts history and favorites but refuses cabinet', async (t) => {
  const f = await fixture(t);
  const settings = await f.request('PATCH', '/api/categories/movie', {
    requestId: randomUUID(),
    expectedVersion: 1,
    capacity: 0,
  });
  assert.equal(settings.statusCode, 200);
  const history = await f.create(
    { title: 'Watched long ago', category: 'movie', favorite: true },
    'history',
  );
  assert.equal(history.statusCode, 201);
  assert.equal(history.json().status, 'archived');
  assert.equal(history.json().hasCompleted, true);
  assert.equal(history.json().dateCompleted, null);
  const full = await f.create({ title: 'Cabinet', category: 'movie' });
  assert.equal(full.json().code, 'CATEGORY_DISABLED');
  assert.equal(f.service.repo.category('movie').retained, 0);
  assert.equal((await f.request('GET', '/api/items?scope=history&favorite=true')).json().total, 1);
});
test('all six history lists combine cabinet and archive without duplicate copies', async (t) => {
  const f = await fixture(t);
  for (const category of [
    'tv',
    'movie',
    'anime',
    'documentary',
    'theatre',
    'comic',
  ] as CategoryId[]) {
    await f.create({ title: 'Cabinet completed', category, status: 'completed' });
    await f.create({ title: 'Historical completed', category }, 'history');
    const page = (await f.request('GET', `/api/items?scope=history&category=${category}`)).json();
    assert.equal(page.total, 2);
    assert.equal(new Set(page.items.map((i: MediaItem) => i.id)).size, 2);
  }
  assert.equal(f.service.repo.summary().retained, 6);
  assert.equal(f.service.repo.summary().completedCount, 12);
});
test('archive and rewatch preserve history, favorites, notes, unknown date', async (t) => {
  const f = await fixture(t);
  const item = (
    await f.create({
      title: 'Keep this memory',
      category: 'movie',
      status: 'completed',
      favorite: true,
      notes: 'A synthetic private note',
    })
  ).json<MediaItem>();
  const archived = (
    await f.request('PATCH', `/api/items/${item.id}`, {
      requestId: randomUUID(),
      expectedVersion: 1,
      changes: { status: 'archived' },
    })
  ).json<MediaItem>();
  assert.equal(archived.archivedFromStatus, 'completed');
  assert.equal(archived.favorite, true);
  assert.equal(archived.notes, item.notes);
  const watching = (
    await f.request('PATCH', `/api/items/${item.id}`, {
      requestId: randomUUID(),
      expectedVersion: 2,
      changes: { status: 'watching' },
    })
  ).json<MediaItem>();
  assert.equal(watching.hasCompleted, true);
  assert.equal(watching.dateCompleted, null);
  assert.equal((await f.request('GET', '/api/items?scope=history')).json().total, 1);
});
test('version conflict preserves previous successful update', async (t) => {
  const f = await fixture(t),
    item = f.seed('movie', 1)[0];
  const first = await f.request('PATCH', `/api/items/${item.id}`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    changes: { title: 'First edit' },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().version, 2);
  const stale = await f.request('PATCH', `/api/items/${item.id}`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    changes: { title: 'Stale edit' },
  });
  assert.equal(stale.json().code, 'VERSION_CONFLICT');
  assert.equal(f.service.get(item.id).title, 'First edit');
});
test('direct restore and cross-category edits cannot bypass full capacity', async (t) => {
  const f = await fixture(t);
  f.seed();
  const history = (
    await f.create({ title: 'Restore', category: 'movie' }, 'history')
  ).json<MediaItem>();
  const restore = await f.request('PATCH', `/api/items/${history.id}`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    changes: { status: 'completed' },
  });
  assert.equal(restore.json().code, 'CATEGORY_FULL');
  const other = f.seed('tv', 1)[0];
  const move = await f.request('PATCH', `/api/items/${other.id}`, {
    requestId: randomUUID(),
    expectedVersion: 1,
    changes: { category: 'movie' },
  });
  assert.equal(move.json().code, 'CATEGORY_FULL');
  assert.equal(f.service.repo.category('tv').retained, 1);
});
test('capacity shrink guarded in API and SQL, settings version checked', async (t) => {
  const f = await fixture(t);
  f.seed('movie', 9);
  const response = await f.request('PATCH', '/api/categories/movie', {
    requestId: randomUUID(),
    expectedVersion: 1,
    capacity: 8,
  });
  assert.equal(response.json().code, 'CAPACITY_TOO_SMALL');
  assert.throws(
    () => f.db.prepare("UPDATE categories SET capacity=8 WHERE id='movie'").run(),
    /CAPACITY_TOO_SMALL/,
  );
  await f.request('PATCH', '/api/categories/movie', {
    requestId: randomUUID(),
    expectedVersion: 1,
    capacity: 9,
  });
  assert.equal(
    (
      await f.request('PATCH', '/api/categories/movie', {
        requestId: randomUUID(),
        expectedVersion: 1,
        capacity: 10,
      })
    ).json().code,
    'VERSION_CONFLICT',
  );
});
test('archive replacement atomic and identical request replays original DTO', async (t) => {
  const f = await fixture(t),
    candidate = f.seed()[0];
  const body: ReplacementRequest = {
    requestId: randomUUID(),
    targetCategory: 'movie',
    candidate: { id: candidate.id, expectedVersion: 1 },
    disposition: 'archive',
    incoming: {
      kind: 'create',
      item: { title: 'Incoming', category: 'movie', status: 'completed' },
    },
  };
  const first = await f.request('POST', '/api/replacements', body);
  assert.equal(first.statusCode, 200);
  assert.equal(f.service.get(candidate.id).status, 'archived');
  assert.equal(f.service.repo.category('movie').retained, 10);
  const retry = await f.request('POST', '/api/replacements', body);
  assert.deepEqual(retry.json(), first.json());
  assert.equal(f.service.repo.list({ scope: 'archive' }).total, 1);
  const conflict = await f.request('POST', '/api/replacements', { ...body, disposition: 'delete' });
  assert.equal(conflict.json().code, 'REQUEST_ID_CONFLICT');
});
test('delete candidate then incoming FK failure rolls back candidate and dedup record', async (t) => {
  const f = await fixture(t),
    candidate = f.seed()[0],
    requestId = randomUUID();
  const body = {
    requestId,
    targetCategory: 'movie',
    candidate: { id: candidate.id, expectedVersion: 1 },
    disposition: 'delete',
    incoming: {
      kind: 'create',
      item: { title: 'Bad cover FK', category: 'movie', cover: randomUUID() },
    },
  };
  const result = await f.request('POST', '/api/replacements', body);
  assert.equal(result.statusCode, 400);
  assert.equal(f.service.get(candidate.id).status, 'planned');
  assert.equal(f.service.repo.category('movie').retained, 10);
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM mutation_requests WHERE request_id=?').get(requestId) &&
      (
        f.db
          .prepare('SELECT count(*) n FROM mutation_requests WHERE request_id=?')
          .get(requestId) as { n: number }
      ).n,
    0,
  );
});
test('restore and cross-category move replacements preserve incoming identity', async (t) => {
  const f = await fixture(t),
    candidates = f.seed();
  const history = (
    await f.create({ title: 'Historical', category: 'movie' }, 'history')
  ).json<MediaItem>();
  const restored = await f.request('POST', '/api/replacements', {
    requestId: randomUUID(),
    targetCategory: 'movie',
    candidate: { id: candidates[0].id, expectedVersion: 1 },
    disposition: 'archive',
    incoming: { kind: 'restore', id: history.id, expectedVersion: 1 },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().id, history.id);
  const other = f.seed('tv', 1)[0];
  const moved = await f.request('POST', '/api/replacements', {
    requestId: randomUUID(),
    targetCategory: 'movie',
    candidate: { id: candidates[1].id, expectedVersion: 1 },
    disposition: 'archive',
    incoming: { kind: 'move', id: other.id, expectedVersion: 1 },
  });
  assert.equal(moved.json().id, other.id);
  assert.equal(f.service.repo.category('tv').retained, 0);
  assert.equal(f.service.repo.category('movie').retained, 10);
});
test('invalid replacement candidate and stale selection do not alter data', async (t) => {
  const f = await fixture(t),
    candidates = f.seed(),
    wrong = f.seed('tv', 1)[0];
  const make = (id: string, expectedVersion = 1) => ({
    requestId: randomUUID(),
    targetCategory: 'movie',
    candidate: { id, expectedVersion },
    disposition: 'archive',
    incoming: { kind: 'create', item: { title: 'New', category: 'movie' } },
  });
  assert.equal(
    (await f.request('POST', '/api/replacements', make(wrong.id))).json().code,
    'INVALID_REPLACEMENT',
  );
  assert.equal(
    (await f.request('POST', '/api/replacements', make(candidates[0].id, 99))).json().code,
    'VERSION_CONFLICT',
  );
  assert.equal(f.service.repo.category('movie').retained, 10);
  assert.equal(f.service.repo.list({ scope: 'archive' }).total, 0);
});
test('create and permanent delete are idempotent; same UUID different operation conflicts', async (t) => {
  const f = await fixture(t),
    requestId = randomUUID();
  const input = { title: 'Idempotent', category: 'comic' as const };
  const first = await f.create(input, 'history', requestId),
    retry = await f.create(input, 'history', requestId);
  assert.deepEqual(first.json(), retry.json());
  const item = first.json<MediaItem>(),
    deletion = { requestId: randomUUID(), expectedVersion: 1 };
  assert.equal((await f.request('DELETE', `/api/items/${item.id}`, deletion)).statusCode, 200);
  assert.equal((await f.request('DELETE', `/api/items/${item.id}`, deletion)).statusCode, 200);
  assert.equal((await f.request('GET', '/api/items?scope=history')).json().total, 0);
  assert.equal(
    (await f.create({ title: 'Changed', category: 'comic' }, 'history', requestId)).json().code,
    'REQUEST_ID_CONFLICT',
  );
});
test('runtime schemas reject unknown fields, coercion, invalid dates, ratings, statuses', async (t) => {
  const f = await fixture(t);
  for (const changes of [
    { rating: 2.3 },
    { favorite: 'false' },
    { dateAdded: '2025-02-29' },
    { title: '  ' },
    { status: 'unknown' },
    { unexpected: true },
  ]) {
    const response = await f.create({
      title: 'Invalid',
      category: 'movie',
      ...changes,
    } as MediaInput);
    assert.equal(response.statusCode, 400, JSON.stringify(changes));
  }
  assert.equal((await f.request('GET', '/api/items?pageSize=51')).statusCode, 400);
  assert.equal((await f.request('GET', '/api/items?sort=sql')).statusCode, 400);
});
test('literal search escapes wildcard characters and includes original titles; paging stable', async (t) => {
  const f = await fixture(t);
  await f.create(
    { title: '100%_完成', originalTitle: 'ORIGINAL FILM', category: 'movie' },
    'history',
  );
  await f.create({ title: 'Other', category: 'movie' }, 'history');
  assert.equal((await f.request('GET', '/api/items?scope=history&q=%25_')).json().total, 1);
  assert.equal((await f.request('GET', '/api/items?scope=history&q=original')).json().total, 1);
  const first = (await f.request('GET', '/api/items?scope=history&pageSize=1&page=1')).json();
  const second = (await f.request('GET', '/api/items?scope=history&pageSize=1&page=2')).json();
  assert.equal(first.total, 2);
  assert.notEqual(first.items[0].id, second.items[0].id);
});
test('scope and placement cannot leak archive into cabinet or undo completion filter', async (t) => {
  const f = await fixture(t);
  f.seed('movie', 1);
  await f.create({ title: 'Seen', category: 'movie' }, 'history');
  assert.equal((await f.request('GET', '/api/items')).json().total, 1);
  assert.equal(
    (await f.request('GET', '/api/items?scope=history&placement=history')).json().total,
    1,
  );
  assert.equal(
    (await f.request('GET', '/api/items?scope=history&placement=cabinet')).json().total,
    0,
  );
  assert.equal(
    (await f.request('GET', '/api/items?scope=retained&placement=history')).statusCode,
    400,
  );
});
test('untrusted Host, cross-Origin, missing token, and missing Origin reject writes', async (t) => {
  const f = await fixture(t),
    payload: CreateRequest = {
      requestId: randomUUID(),
      placement: 'history',
      item: { title: 'Unauthorized', category: 'movie' },
    };
  for (const extra of [
    { host: 'evil.test' },
    { origin: 'https://evil.test' },
    { 'x-csrf-token': '' },
    { 'x-csrf-token': 'é'.repeat(64) },
    { origin: '' },
  ] as Record<string, string>[]) {
    const result = await f.request('POST', '/api/items', payload, extra);
    assert.equal(result.statusCode, 403);
  }
  assert.equal(f.service.repo.summary().completedCount, 0);
});
test('real PNG JPEG WebP decode and persist; malformed SVG type mismatch rejected', async (t) => {
  const f = await fixture(t);
  async function upload(bytes: Buffer, mime: string) {
    const boundary = 'limitedlibraryboundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../../untrusted.png"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return f.app.inject({
      method: 'POST',
      url: '/api/assets',
      payload: body,
      headers: {
        host: f.host,
        origin: `http://${f.host}`,
        'x-csrf-token': f.token,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
    });
  }
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({
      create: { width: 16, height: 24, channels: 3, background: '#63785d' },
    })
      .toFormat(format)
      .toBuffer();
    const response = await upload(bytes, `image/${format}`);
    assert.equal(response.statusCode, 200);
    const cover = await f.request('GET', response.json().url);
    assert.equal(cover.statusCode, 200);
    assert.deepEqual(cover.rawPayload, bytes);
  }
  assert.equal((await upload(Buffer.from('<svg></svg>'), 'image/png')).statusCode, 415);
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  assert.equal((await upload(png, 'image/jpeg')).statusCode, 415);
  assert.equal((await upload(png.subarray(0, 20), 'image/png')).statusCode, 415);
  assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')).statusCode, 413);
});
test('two native independent connections contend for last slot without overflow', async (t) => {
  const f = await fixture(t);
  f.seed('movie', 9);
  const signal = new SharedArrayBuffer(4),
    state = new Int32Array(signal);
  const results: Promise<string>[] = [];
  const ready: Promise<void>[] = [];
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(new URL('./writer-worker.mjs', import.meta.url), {
      workerData: { path: join(f.dataDir, 'library.sqlite'), signal },
    });
    ready.push(
      new Promise((resolveReady, reject) => {
        worker.on('error', reject);
        worker.once('message', () => resolveReady());
      }),
    );
    results.push(
      new Promise((resolveResult, reject) => {
        worker.on('error', reject);
        worker.on('message', (message) => {
          if (message !== 'ready') resolveResult(message as string);
        });
      }),
    );
  }
  await Promise.all(ready);
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0, 2);
  assert.deepEqual((await Promise.all(results)).sort(), ['CATEGORY_FULL', 'committed']);
  assert.equal(f.service.repo.category('movie').retained, 10);
});
test('closed reopen preserves data and migration checksum rejects tampering', async (t) => {
  const directory = temp(t),
    dataDir = join(directory, 'data'),
    db = openDatabase(dataDir, true);
  db.prepare("UPDATE categories SET capacity=3 WHERE id='comic'").run();
  closeDatabase(db);
  const reopened = openDatabase(dataDir);
  assert.equal(
    (
      reopened.prepare("SELECT capacity FROM categories WHERE id='comic'").get() as {
        capacity: number;
      }
    ).capacity,
    3,
  );
  reopened.prepare('UPDATE schema_migrations SET checksum=?').run('a'.repeat(64));
  closeDatabase(reopened);
  assert.throws(() => openDatabase(dataDir), /校验和/);
});
test('unknown/corrupt existing databases are not replaced by empty ones', (t) => {
  const directory = temp(t),
    path = join(directory, 'library.sqlite');
  writeFileSync(path, 'synthetic corrupt bytes');
  const before = readFileSync(path);
  assert.throws(() => openDatabase(directory, true));
  assert.deepEqual(readFileSync(path), before);
});
test('offline backup restore verifies all fields and cover hashes without overwrite', async (t) => {
  const f = await fixture(t);
  const pixels = await sharp({
    create: { width: 20, height: 30, channels: 3, background: '#8b966f' },
  })
    .png()
    .toBuffer();
  const asset = await importCover(f.db, f.dataDir, pixels, 'image/png');
  await f.create(
    {
      title: 'Backup history',
      category: 'comic',
      cover: asset.assetId,
      notes: 'Keep exact synthetic field',
      favorite: true,
      rating: 9.5,
    },
    'history',
  );
  await f.app.close();
  const before = readFileSync(join(f.dataDir, 'library.sqlite'));
  const backup = join(f.directory, 'backup'),
    restored = join(f.directory, 'restored');
  const result = backupData(f.dataDir, backup);
  assert.equal(result.items, 1);
  assert.equal(result.covers, 1);
  const copy = restoreData(backup, restored);
  assert.equal(copy.logicalDigest, result.logicalDigest);
  assert.deepEqual(readFileSync(join(f.dataDir, 'library.sqlite')), before);
  assert.throws(() => restoreData(backup, restored), /目标已存在/);
  assert.throws(() => backupData(f.dataDir, join(f.dataDir, 'inside')), /独立/);
  writeFileSync(join(backup, 'unexpected.txt'), 'tampered');
  assert.throws(() => restoreData(backup, join(f.directory, 'tampered')), /SHA-256/);
  assert.equal(validateData(restored).items, 1);
});
test('backup refuses a running service, no destination created', async (t) => {
  const f = await fixture(t),
    destination = join(f.directory, 'unsafe-backup');
  assert.throws(() => backupData(f.dataDir, destination), /正在使用/);
  assert.equal(existsSync(destination), false);
});
