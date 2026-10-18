import type { JourneySeed } from '@/core/contracts/operation';
import { readCoreNpcImageFacts } from '@/core/retrieval/imageContext';
export const AMBER_IMAGE_FACTS = { language: 'en' as const, name: 'Amber', gender: 'female' };
/** Explicit test setup for an already prepared, saved character translation. */
export function seedAmberImageFacts(seed: JourneySeed): void {
  const npc = seed.records.find(row => row.domain === 'npc' && row.entityId === 'npc-amber'); if (npc?.domain !== 'npc') throw Error('fixture');
  npc.value.visualArchive.englishFacts = { schemaVersion: 1, sourceKey: JSON.stringify(readCoreNpcImageFacts(npc.value)), preparedAt: 1, facts: structuredClone(AMBER_IMAGE_FACTS) };
}
