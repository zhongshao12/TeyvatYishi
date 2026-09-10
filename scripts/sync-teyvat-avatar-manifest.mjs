import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';
import { teyvatAvatarRoster } from './teyvat-avatar-roster.mjs';

const manifestPath = resolve('public/assets/teyvat-avatars/manifest.json');
const registryPath = resolve('data/teyvatAvatarRegistry.generated.ts');
let previous = { assets: [] };
try {
  previous = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  // A fresh manifest is valid for a new workspace.
}

const previousById = new Map((previous.assets ?? []).map((asset) => [asset.id, asset]));
const registrySource = await readFile(registryPath, 'utf8');
const registryMatch = registrySource.match(/export const TEYVAT_AVATAR_SETS:[^=]+?=\s*([\s\S]+);\s*$/u);
if (!registryMatch) throw new Error('Unable to parse the generated Teyvat avatar registry.');
const runtimeRegistry = JSON.parse(registryMatch[1]);
const runtimeAssetsByRosterId = new Map();
for (const set of runtimeRegistry) {
  for (const candidate of set.candidates ?? []) {
    const rosterId = String(candidate.id ?? '').replace(/_\d+$/u, '');
    if (rosterId && typeof candidate.src === 'string' && !runtimeAssetsByRosterId.has(rosterId)) {
      runtimeAssetsByRosterId.set(rosterId, { path: candidate.src, canonicalName: set.canonicalName });
    }
  }
}
const assets = [];

for (const character of teyvatAvatarRoster) {
  const runtimeAsset = runtimeAssetsByRosterId.get(character.id);
  const publicPath = runtimeAsset?.path ?? character.path;
  const absolutePath = resolve('public', decodeURIComponent(publicPath.replace(/^\/assets\//, 'assets/')));
  try {
    await access(absolutePath);
  } catch {
    continue;
  }

  const [metadata, file] = await Promise.all([sharp(absolutePath).metadata(), stat(absolutePath)]);
  const old = previousById.get(character.id);
  assets.push({
    id: character.id,
    name: old?.name ?? character.name,
    canonicalName: runtimeAsset?.canonicalName ?? character.name,
    rarity: character.rarity,
    element: character.element,
    path: publicPath,
    bytes: file.size,
    generation: old?.generation ?? {
      mode: 'built-in-imagegen',
      createdAt: '2026-09-02',
      sourceType: 'original-fan-art',
      promptSummary: `${character.name} compact chat portrait; approved warm Japanese-fantasy journal style; iconic character cues; circular-crop-safe; no text, logo, watermark, or copied official artwork.`,
    },
    optimization: old?.optimization ?? {
      outputDimensions: `${metadata.width}x${metadata.height}`,
      quality: 78,
      effort: 6,
      smartSubsample: true,
    },
  });
}

const payload = {
  version: 2,
  purpose: 'Compact, original fan-art portraits for the Teyvat chat UI.',
  roster: {
    expected: 120,
    ready: assets.length,
    pending: 120 - assets.length,
  },
  format: {
    width: 256,
    height: 256,
    encoding: 'webp',
    targetUse: 'chat-avatar',
  },
  assets,
};

await writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Manifest synchronized: ${assets.length}/120 ready.`);
