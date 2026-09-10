import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const regionDir = path.resolve('public/assets/regions');
const manifestPath = path.join(regionDir, 'manifest.json');
const prompts = {
  'mondstadt-journal.webp': 'Mondstadt: Original Japanese-Western fantasy travel-journal landscape, windswept green highlands, dandelions and a distant old-European fantasy city, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.',
  'liyue-journal.webp': 'Liyue: Original Japanese-Western fantasy travel-journal landscape, layered karst peaks, amber evening harbor lights and restrained eastern-fantasy roof silhouettes, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.',
  'inazuma-journal.webp': 'Inazuma: Original Japanese-Western fantasy travel-journal landscape, storm-lit island cliffs, violet clouds, distant shrine roofs and luminous sakura mist, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.',
  'sumeru-journal.webp': 'Sumeru: Original Japanese-Western fantasy travel-journal landscape, lush rainforest terraces flowing into a sunlit desert and distant scholarly fantasy city, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.',
  'fontaine-journal.webp': 'Fontaine: Original Japanese-Western fantasy travel-journal landscape, elegant canal city, pale-blue waterworks, brass clockwork details and bright cloud reflections, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.',
  'natlan-journal.webp': 'Natlan: Original Japanese-Western fantasy travel-journal landscape, volcanic highlands, red-gold canyon vegetation, geothermal mist and a distant cliff settlement, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.',
};
const expectedFiles = Object.keys(prompts);

assert(fs.existsSync(manifestPath), `missing region asset manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(Array.isArray(manifest.assets), 'region asset manifest must contain an assets array');
assert(manifest.assets.length === expectedFiles.length, `region asset manifest must contain exactly ${expectedFiles.length} entries`);

const manifestFiles = manifest.assets.map((entry) => entry?.file);
assert(new Set(manifestFiles).size === manifestFiles.length, 'region asset manifest contains duplicate file entries');
assert(
  JSON.stringify([...manifestFiles].sort()) === JSON.stringify([...expectedFiles].sort()),
  `region asset manifest entries must match exactly: ${expectedFiles.join(', ')}`,
);

for (const entry of manifest.assets) {
  for (const field of ['file', 'sourceType', 'creator', 'license', 'prompt', 'sha256']) {
    assert(typeof entry?.[field] === 'string' && entry[field].trim().length > 0, `${entry?.file ?? 'unknown asset'} is missing ${field}`);
  }

  assert(entry.prompt === prompts[entry.file], `${entry.file} must retain the exact approved generation prompt`);
  assert(/^[a-f0-9]{64}$/.test(entry.sha256), `${entry.file} has an invalid lowercase SHA-256`);

  const assetPath = path.join(regionDir, entry.file);
  assert(path.dirname(assetPath) === regionDir, `${entry.file} escapes the region asset directory`);
  assert(fs.existsSync(assetPath), `missing region background: ${entry.file}`);

  const bytes = fs.readFileSync(assetPath);
  assert(bytes.length < 650 * 1024, `${entry.file} must remain under 650 KB`);
  assert(
    bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    `${entry.file} is not a WebP file`,
  );

  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert(actualHash === entry.sha256, `${entry.file} SHA-256 does not match manifest`);
}

const actualWebpFiles = fs.readdirSync(regionDir).filter((file) => file.toLowerCase().endsWith('.webp')).sort();
assert(
  JSON.stringify(actualWebpFiles) === JSON.stringify([...expectedFiles].sort()),
  'region asset directory contains missing or untracked WebP files',
);

console.log(`OK: verified ${manifest.assets.length} original region backgrounds and provenance records.`);
