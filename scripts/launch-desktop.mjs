import { spawn } from 'node:child_process';
import electron from 'electron';
const child = spawn(electron, ['apps/desktop'], {
  env: { ...process.env, LL_NODE_PATH: process.execPath },
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
