import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { teyvatAvatarRoster } from './teyvat-avatar-roster.mjs';

const allowIncomplete = process.argv.includes('--allow-incomplete');
const missing = [];
const invalid = [];
const ready = [];

const registrySource = await readFile(resolve('data', 'teyvatAvatarRegistry.generated.ts'), 'utf8');
const registryMatch = registrySource.match(/export const TEYVAT_AVATAR_SETS:[^=]+?=\s*([\s\S]+);\s*$/u);
if (!registryMatch) throw new Error('Unable to parse the generated Teyvat avatar registry.');
const runtimeRegistry = JSON.parse(registryMatch[1]);
const runtimePathsByRosterId = new Map();
for (const set of runtimeRegistry) {
  for (const candidate of set.candidates ?? []) {
    const rosterId = String(candidate.id ?? '').replace(/_\d+$/u, '');
    if (rosterId && typeof candidate.src === 'string' && !runtimePathsByRosterId.has(rosterId)) {
      runtimePathsByRosterId.set(rosterId, candidate.src);
    }
  }
}

for (const character of teyvatAvatarRoster) {
  const publicPath = runtimePathsByRosterId.get(character.id) ?? character.path;
  const absolutePath = resolve('public', decodeURIComponent(publicPath.replace(/^\/assets\//, 'assets/')));
  try {
    await access(absolutePath);
  } catch {
    missing.push({ ...character, path: publicPath });
    continue;
  }

  try {
    const [metadata, file] = await Promise.all([sharp(absolutePath).metadata(), stat(absolutePath)]);
    const problems = [];
    if (metadata.width !== 256 || metadata.height !== 256) problems.push(`${metadata.width}x${metadata.height}`);
    if (metadata.format !== 'webp') problems.push(`format=${metadata.format}`);
    if (file.size > 100 * 1024) problems.push(`bytes=${file.size}`);
    if (problems.length) invalid.push({ ...character, path: publicPath, problems });
    else ready.push({ ...character, path: publicPath, bytes: file.size });
  } catch (error) {
    invalid.push({ ...character, path: publicPath, problems: [`unreadable: ${error.message}`] });
  }
}

const byRarity = (items, rarity) => items.filter((item) => item.rarity === rarity).length;
const result = {
  expected: { total: 120, fiveStar: 69, fourStar: 51 },
  ready: { total: ready.length, fiveStar: byRarity(ready, 5), fourStar: byRarity(ready, 4) },
  missing: missing.map(({ name, path }) => ({ name, path })),
  invalid: invalid.map(({ name, path, problems }) => ({ name, path, problems })),
};

console.log(JSON.stringify(result, null, 2));

if (invalid.length || (!allowIncomplete && missing.length)) {
  process.exitCode = 1;
}
