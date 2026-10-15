import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './errors.js';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export async function importCover(
  db: Database.Database,
  dataDir: string,
  bytes: Buffer,
  declaredMime: string,
) {
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new AppError('ASSET_TOO_LARGE', 413, '封面不能超过 5 MiB。');
  // Reject SVG before invoking a decoder, even if disguised with an image MIME.
  const signature = bytes.subarray(0, 12);
  const format = signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : signature[0] === 255 && signature[1] === 216 && signature[2] === 255
      ? 'jpeg'
      : signature.toString('ascii', 0, 4) === 'RIFF' &&
          signature.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : undefined;
  const mime = format ? `image/${format}` : '';
  if (!format || mime !== declaredMime)
    throw new AppError('ASSET_TYPE_UNSUPPORTED', 415, '请上传真实的静态 PNG、JPEG 或 WebP 图片。');
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' }).timeout({
      seconds: 5,
    });
    const meta = await image.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 8192 ||
      meta.height > 8192 ||
      (meta.pages ?? 1) !== 1 ||
      meta.format !== format
    )
      throw new Error('Invalid dimensions or animation');
    await image.clone().raw().toBuffer(); // Force full pixel decode; metadata alone is insufficient.
  } catch {
    throw new AppError('ASSET_TYPE_UNSUPPORTED', 415, '封面无法安全解码，或尺寸过大／包含动画。');
  }
  const id = randomUUID(),
    filename = `${id}.${format === 'jpeg' ? 'jpg' : format}`;
  const directory = join(dataDir, 'covers');
  await mkdir(directory, { recursive: true });
  const pending = join(directory, `${id}.pending`),
    destination = join(directory, filename);
  try {
    await writeFile(pending, bytes, { flag: 'wx' });
    await rename(pending, destination);
    db.prepare('INSERT INTO assets(id,filename,mime,size) VALUES (?,?,?,?)').run(
      id,
      filename,
      mime,
      bytes.length,
    );
  } catch (error) {
    await unlink(pending).catch(() => {});
    await unlink(destination).catch(() => {});
    throw error;
  }
  return { assetId: id, url: `/api/assets/${id}` };
}
export async function readCover(db: Database.Database, dataDir: string, id: string) {
  const row = db.prepare('SELECT filename,mime FROM assets WHERE id=?').get(id) as
    { filename: string; mime: string } | undefined;
  if (!row || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(row.filename))
    throw new AppError('ASSET_NOT_FOUND', 404, '封面不存在。');
  try {
    return { bytes: await readFile(join(dataDir, 'covers', row.filename)), mime: row.mime };
  } catch {
    throw new AppError('ASSET_NOT_FOUND', 404, '封面文件缺失，作品资料仍保留。');
  }
}
