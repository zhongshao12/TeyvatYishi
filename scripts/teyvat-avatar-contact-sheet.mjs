import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';
import { teyvatAvatarRoster } from './teyvat-avatar-roster.mjs';

const outputPath = resolve(process.argv[2] ?? 'public/assets/teyvat-avatars/contact-sheet.webp');
const tile = 128;
const label = 24;
const columns = 10;
const ready = [];

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

for (const character of teyvatAvatarRoster) {
  const path = resolve('public', character.path.replace(/^\/assets\//, 'assets/'));
  try {
    await access(path);
    ready.push({ ...character, absolutePath: path });
  } catch {
    // Contact sheets intentionally include only completed assets.
  }
}

if (!ready.length) throw new Error('No Teyvat avatars are ready for a contact sheet.');

const rows = Math.ceil(ready.length / columns);
const cellHeight = tile + label;
const composites = [];

for (const [index, character] of ready.entries()) {
  const left = (index % columns) * tile;
  const top = Math.floor(index / columns) * cellHeight;
  const image = await sharp(character.absolutePath).resize(tile, tile).png().toBuffer();
  const labelSvg = Buffer.from(`<svg width="${tile}" height="${label}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8eedb"/><text x="64" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#493b32">${escapeXml(character.name)}</text></svg>`);
  composites.push({ input: image, left, top });
  composites.push({ input: labelSvg, left, top: top + tile });
}

await mkdir(dirname(outputPath), { recursive: true });
await sharp({
  create: {
    width: columns * tile,
    height: rows * cellHeight,
    channels: 3,
    background: '#efe1c8',
  },
})
  .composite(composites)
  .webp({ quality: 82, effort: 6, smartSubsample: true })
  .toFile(outputPath);

console.log(`Contact sheet written with ${ready.length} avatars: ${outputPath}`);
