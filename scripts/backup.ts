import { backupData, cliDirectories } from './maintenance.js';
try {
  const { source, destination } = cliDirectories();
  console.log(JSON.stringify(backupData(source, destination), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : '备份失败');
  process.exitCode = 1;
}
