import { createApp } from './app.js';
import { configuration, acquireDataLock } from './config.js';
import { openDatabase, closeDatabase } from './db/database.js';
try {
  const config = configuration();
  if (process.argv.includes('--init')) {
    const release = acquireDataLock(config.dataDir, 'initialize');
    try {
      const db = openDatabase(config.dataDir, true);
      closeDatabase(db);
      console.log('数据目录已初始化；现有数据库不会被覆盖。');
    } finally {
      release();
    }
  } else {
    const { app } = await createApp(config, config.mode !== 'development');
    try {
      await app.listen({ host: '127.0.0.1', port: config.port });
    } catch (error) {
      await app.close();
      throw error;
    }
    console.log(`Limited Library · http://127.0.0.1:${config.port} · ${config.mode}`);
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      await app.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('message', (message) => {
      if (message === 'shutdown') void stop();
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : '启动失败');
  process.exitCode = 1;
}
