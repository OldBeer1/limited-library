import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: root,
    env: { ...process.env, LL_MODE: 'development' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  }),
  spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      '--config',
      'vite.config.ts',
    ],
    { cwd: fileURLToPath(new URL('../apps/web/', import.meta.url)), stdio: 'inherit' },
  ),
];
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  if (children[0].connected) children[0].send('shutdown');
  children[1].kill();
}
for (const child of children)
  child.on('exit', (code) => {
    if (!closing && code) process.exitCode = code;
    stop();
    if (process.connected) process.disconnect();
  });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

process.on('message', (message) => {
  if (message === 'shutdown') {
    stop();
    if (process.connected) process.disconnect();
  }
});
