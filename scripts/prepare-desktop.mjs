import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32' || process.arch !== 'x64' || !process.version.startsWith('v24.'))
  throw new Error('Windows x64 / Node 24 is required to prepare this desktop payload.');
const output = join(root, 'output/desktop/backend');
// This fixed, generated subtree contains no personal data or user-selected paths.
if (resolve(output) !== resolve(root, 'output/desktop/backend'))
  throw new Error('Invalid staging path');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const copy = (source, destination) => {
  mkdirSync(resolve(destination, '..'), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true });
};
for (const workspace of ['apps/server', 'apps/web', 'packages/contracts']) {
  copy(join(root, workspace, 'package.json'), join(output, workspace, 'package.json'));
  copy(join(root, workspace, 'dist'), join(output, workspace, 'dist'));
}
writeFileSync(
  join(output, 'package.json'),
  JSON.stringify({ private: true, type: 'module' }) + '\n',
);
// Copy only installed production packages selected by the committed npm lock.
// Keep nested resolution paths and native binaries built for the bundled Node.
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
let count = 0;
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || info.dev || info.link || !existsSync(join(root, path)))
    continue;
  const from = join(root, path),
    to = join(output, path);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (entry) =>
      entry === from ||
      !entry
        .slice(from.length + 1)
        .split(/[\\/]/)
        .includes('node_modules'),
  });
  count++;
}
copy(join(root, 'packages/contracts'), join(output, 'node_modules/@limited-library/contracts'));
mkdirSync(join(output, 'runtime'), { recursive: true });
copy(process.execPath, join(output, 'runtime/node.exe'));
const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
const license = await fetch(licenseUrl);
if (!license.ok) throw new Error(`Cannot retrieve Node license: ${license.status}`);
writeFileSync(join(output, 'runtime/LICENSE.txt'), await license.text());
const nodeHash = createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
writeFileSync(
  join(output, 'runtime/manifest.json'),
  JSON.stringify(
    { node: process.version, arch: process.arch, sha256: nodeHash, licenseUrl },
    null,
    2,
  ) + '\n',
);
const png = await sharp(join(root, 'apps/web/public/favicon.svg'))
  .resize(256, 256)
  .png()
  .toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync(join(root, 'apps/desktop/icon.ico'), Buffer.concat([header, png]));
const manifest = {};
function record(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) record(path, relative + '/');
    else manifest[relative] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
}
record(output);
writeFileSync(join(output, 'payload-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared Windows payload: ${count} production packages, Node ${process.version}.`);
