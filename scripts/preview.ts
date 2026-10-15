// Explicit synthetic preview. It never opens the production or development DB.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';
import { projectRoot } from '../apps/server/src/config.js';
import type { CategoryId } from '@limited-library/contracts';
const port = Number(process.env.LL_PREVIEW_PORT ?? 43127);
const dataDir = mkdtempSync(join(tmpdir(), 'limited-library-browser-'));
const { app, service } = await createApp({ mode: 'test', dataDir, port, allowCreate: true }, true);
for (const [category, titles] of Object.entries({
  movie: ['演示 · 远山来信', '演示 · 雨后街角'],
  tv: ['演示 · 四季之间'],
  anime: ['演示 · 风的颜色'],
  documentary: ['演示 · 走向旷野'],
  theatre: ['演示 · 灯光之后'],
  comic: ['演示 · 夜航日记'],
})) {
  for (const [index, title] of titles.entries())
    service.create({
      requestId: randomUUID(),
      placement: 'cabinet',
      item: {
        title,
        category: category as CategoryId,
        status: 'completed',
        favorite: index === 0,
        rating: 8 + index * 0.5,
        dateCompleted: '2026-10-01',
      },
    });
  service.create({
    requestId: randomUUID(),
    placement: 'history',
    item: { title: `演示 · ${category}往日记忆`, category: category as CategoryId },
  });
}
service.capacity('movie', { requestId: randomUUID(), expectedVersion: 1, capacity: 2 });
mkdirSync(join(projectRoot, '.github-project.local'), { recursive: true });
writeFileSync(
  join(projectRoot, '.github-project.local/preview.json'),
  JSON.stringify({ dataDir, pid: process.pid, port }),
);
try {
  await app.listen({ host: '127.0.0.1', port });
} catch (error) {
  await app.close();
  throw error;
}
console.log(`Synthetic UI preview ready: http://127.0.0.1:${port}`);
if (process.send) process.send({ kind: 'ready', dataDir, port });
process.on('message', async (message) => {
  if (message === 'shutdown') {
    await app.close();
    process.exit(0);
  }
});
process.on('SIGINT', async () => {
  await app.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});
