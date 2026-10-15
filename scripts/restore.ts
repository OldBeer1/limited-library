import { restoreData, cliDirectories } from './maintenance.js';
try {
  const { source, destination } = cliDirectories();
  console.log(JSON.stringify(restoreData(source, destination), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : '恢复失败');
  process.exitCode = 1;
}
