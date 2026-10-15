import { cpSync } from 'node:fs';
cpSync(
  new URL('../apps/server/src/db/migrations', import.meta.url),
  new URL('../apps/server/dist/db/migrations', import.meta.url),
  { recursive: true },
);
