import { access, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';
import { teyvatAvatarRoster } from './teyvat-avatar-roster.mjs';

const [sourceArg, characterId, overwriteFlag] = process.argv.slice(2);
if (!sourceArg || !characterId) {
  console.error('Usage: node scripts/optimize-teyvat-avatar.mjs <source-image> <character-id> [--overwrite]');
  process.exit(2);
}

const character = teyvatAvatarRoster.find((item) => item.id === characterId);
if (!character) {
  console.error(`Unknown Teyvat avatar character id: ${characterId}`);
  process.exit(2);
}

const sourcePath = resolve(sourceArg);
const outputPath = resolve('public', character.path.replace(/^\/assets\//, 'assets/'));
await access(sourcePath);

if (overwriteFlag !== '--overwrite') {
  try {
    await access(outputPath);
    console.error(`Refusing to overwrite existing avatar without --overwrite: ${outputPath}`);
    process.exit(2);
  } catch {
    // Expected when creating a new avatar.
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await sharp(sourcePath)
  .resize(256, 256, { fit: 'cover', position: 'centre' })
  .webp({ quality: 78, effort: 6, smartSubsample: true })
  .toFile(outputPath);

const [metadata, file] = await Promise.all([sharp(outputPath).metadata(), stat(outputPath)]);
console.log(JSON.stringify({
  id: character.id,
  name: character.name,
  sourcePath,
  outputPath,
  width: metadata.width,
  height: metadata.height,
  format: metadata.format,
  bytes: file.size,
}, null, 2));
