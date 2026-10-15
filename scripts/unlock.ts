import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { assertPlainDirectory } from '../apps/server/src/config.js';
try {
  const [flag, directory] = process.argv.slice(2);
  if (flag !== '--data-dir' || !directory || !isAbsolute(directory))
    throw new Error('参数：--data-dir <绝对数据目录>');
  assertPlainDirectory(directory);
  const path = join(directory, '.data.lock');
  if (!existsSync(path)) throw new Error('没有退出锁，无需处理');
  const bytes = readFileSync(path, 'utf8');
  const lock = JSON.parse(bytes) as { pid: number; nonce: string };
  if (!Number.isInteger(lock.pid) || lock.pid <= 0 || !lock.nonce)
    throw new Error('锁格式异常，请人工检查，未删除');
  try {
    process.kill(lock.pid, 0);
    throw new Error('原进程仍存在，拒绝移除锁；请先正常关闭');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  if (readFileSync(path, 'utf8') !== bytes) throw new Error('锁已变化，拒绝移除');
  unlinkSync(path);
  console.log('已移除已退出进程的锁；个人数据未修改。');
} catch (error) {
  console.error(error instanceof Error ? error.message : '退出锁处理失败');
  process.exitCode = 1;
}
