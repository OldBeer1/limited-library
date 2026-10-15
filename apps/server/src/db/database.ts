import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainDirectory } from '../config.js';
const migration = readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8');
export const checksum = createHash('sha256').update(migration).digest('hex');
export function openDatabase(dataDir: string, allowCreate = false): Database.Database {
  assertPlainDirectory(dataDir);
  const databasePath = join(dataDir, 'library.sqlite');
  const existed = existsSync(databasePath);
  if (!existed && !allowCreate)
    throw new Error('尚未初始化数据目录。请先运行 npm run init-data；不会自动创建空库替代旧库。');
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(databasePath, { fileMustExist: !allowCreate, timeout: 2000 });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 2000');
    if (existed) {
      if (db.pragma('quick_check', { simple: true }) !== 'ok')
        throw new Error('数据库完整性检查失败');
      const rows = db
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      if (rows.length !== 1 || rows[0].version !== 1 || rows[0].checksum !== checksum)
        throw new Error('数据库迁移版本或校验和不匹配；请保留原库并检查备份');
    } else {
      db.transaction(() => {
        db.exec(migration);
        db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES (1,?,?)').run(
          'initial',
          checksum,
        );
      }).immediate();
    }
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    if ((db.pragma('foreign_key_check') as unknown[]).length > 0)
      throw new Error('数据库外键检查失败');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function closeDatabase(db: Database.Database): void {
  try {
    if (db.open) db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    if (db.open) db.close();
  }
}
