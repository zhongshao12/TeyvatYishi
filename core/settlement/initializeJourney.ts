import type { CoreRepository } from '../contracts/storage';
import type { JourneySeed } from '../contracts/operation';
import type { BranchHead } from '../contracts/identity';
import { validateCoreDto } from '../contracts/validation';

export async function initializeCoreJourney(repo: CoreRepository, seed: JourneySeed): Promise<BranchHead> {
  if (!validateCoreDto('seed', seed).ok || seed.head.coreSeq !== 0 || seed.head.memoryRevision !== 0 || seed.head.parent
    || seed.records.filter(r => r.domain === 'traveler').length !== 1 || !seed.records.some(r => r.domain === 'traveler' && r.entityId === seed.playerId && r.value.id === seed.playerId)
    || seed.records.filter(r => r.domain === 'world').length !== 1) throw Error('CORE2_INVALID_JOURNEY_SEED');
  return repo.initialize(structuredClone(seed));
}
