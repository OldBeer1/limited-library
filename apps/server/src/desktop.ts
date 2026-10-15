// Standalone Node child: retain the server's native SQLite ABI and data guards.
import { createServer } from 'node:net';
import { once } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.js';
import { configuration } from './config.js';
import { backupData } from './services/maintenance.js';

let current: Awaited<ReturnType<typeof createApp>> | undefined;
let stopping = false;
let busy = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  // A synchronous backup cannot be interrupted midway; IPC resumes afterwards.
  if (current) await current.app.close();
  process.exit(0);
}
process.on('disconnect', () => void stop());
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  const config = configuration();
  if (
    !existsSync(join(config.dataDir, 'library.sqlite')) &&
    existsSync(config.dataDir) &&
    readdirSync(config.dataDir).length > 0
  )
    throw new Error('数据文件夹已有内容但数据库缺失，请先核实或恢复备份。');
  // A new install may initialize an empty directory; an existing DB is validated.
  config.allowCreate = true;
  for (let attempt = 0; attempt < 5; attempt++) {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('无法选择本地端口');
    config.port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    current = await createApp(config, true);
    try {
      await current.app.listen({ host: '127.0.0.1', port: config.port });
      break;
    } catch (error) {
      await current.app.close();
      current = undefined;
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === 4) throw error;
    }
  }
  if (!process.connected) await stop();
  process.send?.({ kind: 'ready', port: config.port });
  process.on('message', async (message: unknown) => {
    if (message === 'shutdown') {
      await stop();
      return;
    }
    if (
      !message ||
      typeof message !== 'object' ||
      !('kind' in message) ||
      message.kind !== 'backup' ||
      busy ||
      stopping
    )
      return;
    if (
      !('requestId' in message) ||
      typeof message.requestId !== 'string' ||
      !('destination' in message) ||
      typeof message.destination !== 'string'
    )
      return;
    const request = { requestId: message.requestId, destination: message.destination };
    busy = true;
    let result;
    let failure;
    try {
      await current?.app.close();
      current = undefined;
      result = backupData(config.dataDir, request.destination);
    } catch (error) {
      failure = error instanceof Error ? error.message : '备份失败';
    }
    try {
      // Restart only the existing DB; never initialize a replacement after backup.
      current = await createApp({ ...config, allowCreate: false }, true);
      await current.app.listen({ host: '127.0.0.1', port: config.port });
    } catch (error) {
      process.send?.({
        kind: 'fatal',
        message: error instanceof Error ? error.message : '重启失败',
      });
      await stop();
      return;
    } finally {
      busy = false;
    }
    process.send?.({ kind: 'backup', requestId: request.requestId, ...result, error: failure });
  });
} catch (error) {
  const message = error instanceof Error ? error.message : '桌面服务启动失败';
  process.send?.({ kind: 'fatal', message });
  console.error(message);
  if (current) await current.app.close();
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
