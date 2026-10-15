import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  closeSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export interface AppConfig {
  dataDir: string;
  port: number;
  mode: 'development' | 'test' | 'production';
  allowCreate: boolean;
  webPort?: number;
}
export function configuration(env = process.env): AppConfig {
  const mode = env.LL_MODE ?? 'production';
  if (!['development', 'test', 'production'].includes(mode))
    throw new Error('LL_MODE 必须为 development / test / production');
  if (mode === 'test' && !env.LL_DATA_DIR) throw new Error('测试必须显式提供 LL_DATA_DIR');
  const defaultDir =
    mode === 'development'
      ? join(projectRoot, '.local-data', 'development')
      : env.LOCALAPPDATA
        ? join(env.LOCALAPPDATA, 'LimitedLibrary')
        : undefined;
  const dataDir = env.LL_DATA_DIR ?? defaultDir;
  if (!dataDir || !isAbsolute(dataDir)) throw new Error('数据目录必须是绝对路径');
  const port = Number(env.LL_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('LL_PORT 必须为 1024–65535');
  const webPort = Number(env.LL_WEB_PORT ?? 43128);
  if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
    throw new Error('LL_WEB_PORT 必须为 1024–65535');
  return {
    mode: mode as AppConfig['mode'],
    dataDir: resolve(dataDir),
    port,
    webPort,
    allowCreate: mode !== 'production',
  };
}
export function assertPlainDirectory(path: string): void {
  let cursor = resolve(path);
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('数据目录不能经过符号链接或 junction');
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
// Server and offline maintenance use the same exclusive marker. No automatic
// stale-lock deletion: an unexpected exit must be inspected with the unlock tool.
export function acquireDataLock(dataDir: string, operation: string): () => void {
  assertPlainDirectory(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dataDir, '.data.lock');
  const nonce = randomUUID();
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx');
  } catch {
    throw new Error('数据目录正在使用或留有退出锁；请先停服，核实后使用 npm run unlock。');
  }
  writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, operation, nonce, createdAt: new Date().toISOString() }),
  );
  closeSync(fd);
  return () => {
    if (existsSync(lockPath) && JSON.parse(readFileSync(lockPath, 'utf8')).nonce === nonce)
      unlinkSync(lockPath);
  };
}
