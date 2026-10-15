import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checksum } from '../apps/server/src/db/database.js';
import { acquireDataLock, assertPlainDirectory } from '../apps/server/src/config.js';
const manifestName = 'backup-manifest.json';
interface Manifest {
  version: number;
  createdAt: string;
  logicalDigest: string;
  files: Record<string, string>;
}
function digest(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function filesIn(directory: string, base = directory): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    if (name === '.data.lock' || (directory === base && name === manifestName)) continue;
    const path = join(directory, name),
      info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error('备份中不允许符号链接或 junction');
    if (info.isDirectory()) Object.assign(result, filesIn(path, base));
    else if (info.isFile())
      result[relative(base, path).split(sep).join('/')] = digest(readFileSync(path));
    else throw new Error('数据目录中包含不支持的文件类型');
  }
  return result;
}
export function validateData(directory: string) {
  assertPlainDirectory(directory);
  const db = new Database(join(directory, 'library.sqlite'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (db.pragma('foreign_key_check') as unknown[]).length
    )
      throw new Error('数据库完整性或外键检查失败');
    const version = db
      .prepare('SELECT version,checksum FROM schema_migrations ORDER BY version')
      .all() as { version: number; checksum: string }[];
    if (version.length !== 1 || version[0].version !== 1 || version[0].checksum !== checksum)
      throw new Error('备份数据库版本不受支持');
    if (
      (db.prepare('SELECT count(*) AS n FROM categories').get() as { n: number }).n !== 6 ||
      db.prepare('SELECT category_id FROM v_category_summary WHERE remaining < 0').get()
    )
      throw new Error('分类或容量检查失败');
    const tables = [
      'categories',
      'assets',
      'media_items',
      'schema_migrations',
      'mutation_requests',
    ];
    const logical = tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    ]);
    const assets = db.prepare('SELECT filename,size FROM assets').all() as {
      filename: string;
      size: number;
    }[];
    for (const asset of assets) {
      if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(asset.filename))
        throw new Error('备份资产文件名非法');
      const path = join(directory, 'covers', asset.filename);
      if (
        !existsSync(path) ||
        lstatSync(path).isSymbolicLink() ||
        lstatSync(path).size !== asset.size
      )
        throw new Error('封面缺失或文件大小不一致');
    }
    return {
      logicalDigest: digest(JSON.stringify(logical)),
      items: (db.prepare('SELECT count(*) AS n FROM media_items').get() as { n: number }).n,
      covers: assets.length,
    };
  } finally {
    db.close();
  }
}
function separate(source: string, destination: string): void {
  if (!isAbsolute(source) || !isAbsolute(destination)) throw new Error('源和目标必须是绝对路径');
  const a = resolve(source),
    b = resolve(destination);
  const inside = (parent: string, child: string) => {
    const rel = relative(parent, child);
    return !rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
  };
  if (inside(a, b) || inside(b, a)) throw new Error('源和目标必须是相互独立的目录');
  if (existsSync(b)) throw new Error('目标已存在，拒绝覆盖；请选择新的目录');
  assertPlainDirectory(a);
  assertPlainDirectory(b);
}
export function backupData(source: string, destination: string) {
  separate(source, destination);
  if (!existsSync(join(source, 'library.sqlite'))) throw new Error('源目录没有数据库');
  const release = acquireDataLock(source, 'backup');
  try {
    filesIn(source); // Preflight all paths before copying anything.
    const before = validateData(source);
    cpSync(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (path) => !['.data.lock', manifestName].includes(relative(source, path)),
    });
    const after = validateData(destination);
    if (after.logicalDigest !== before.logicalDigest)
      throw new Error('备份逻辑数据不一致；源数据保持不变');
    const manifest: Manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      logicalDigest: after.logicalDigest,
      files: filesIn(destination),
    };
    writeFileSync(join(destination, manifestName), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
    });
    return { destination, ...after, files: Object.keys(manifest.files).length };
  } finally {
    release();
  }
}
export function restoreData(source: string, destination: string) {
  separate(source, destination);
  const release = acquireDataLock(source, 'restore-source');
  try {
    const manifest = JSON.parse(readFileSync(join(source, manifestName), 'utf8')) as Manifest;
    if (
      manifest.version !== 1 ||
      JSON.stringify(filesIn(source)) !== JSON.stringify(manifest.files)
    )
      throw new Error('备份文件清单或 SHA-256 不匹配');
    const before = validateData(source);
    if (before.logicalDigest !== manifest.logicalDigest)
      throw new Error('备份数据库逻辑内容不匹配');
    cpSync(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (path) => !['.data.lock', manifestName].includes(relative(source, path)),
    });
    const after = validateData(destination);
    if (
      after.logicalDigest !== before.logicalDigest ||
      JSON.stringify(filesIn(destination)) !== JSON.stringify(manifest.files)
    )
      throw new Error('恢复副本不一致；不会覆盖原库');
    return { destination, ...after };
  } finally {
    release();
  }
}
export function cliDirectories(): { source: string; destination: string } {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--destination')
    throw new Error('参数：--source <绝对源目录> --destination <新的绝对目标目录>');
  if (!isAbsolute(args[1]) || !isAbsolute(args[3])) throw new Error('源和目标必须是绝对路径');
  return { source: resolve(args[1]), destination: resolve(args[3]) };
}
