import fs from 'node:fs';

const source = fs.readFileSync('services/dbService.ts', 'utf8');
const saveGameBody = source.slice(
  source.indexOf('export async function saveGame('),
  source.indexOf('export interface AtomicMigrationSaveOptions'),
);
const migratedSaveBody = source.slice(
  source.indexOf('export async function saveMigratedTeyvatGameAtomically('),
  source.indexOf('interface SaveGameInternalOptions'),
);

if (saveGameBody.includes('normalizeTeyvatGameState(data)')) {
  throw new Error('saveGame must not normalize a payload already normalized by buildSavePayload.');
}
if (!migratedSaveBody.includes('normalizeTeyvatGameState(data)')) {
  throw new Error('the migration boundary must retain defensive normalization.');
}

console.log('save normalization regression ok');
