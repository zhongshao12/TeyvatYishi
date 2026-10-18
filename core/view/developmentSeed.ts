import { createCoreIdentity } from '../contracts/identity';
import type { JourneySeed } from '../contracts/operation';
import { createEmptyTravelerProfile } from '@/models/teyvat/character';
import { freezeSource } from '../sources/sourceRecords';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

/** Explicit development-only new journey; never derives a seed from a legacy save. */
export function createCore2DevelopmentSeed(name: string): JourneySeed {
  const cleanName = name.trim(); if (!cleanName || cleanName.length > 80) throw Error('请填写 1～80 字的旅人姓名。');
  const identity = createCoreIdentity(), scope = identity.scope;
  const moment: WorldMoment = { worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '10:00', weather: '晴', location: '蒙德城', travelDay: 1, turn: 0, settlementId: 'initialization' };
  const source = freezeSource({ scope, operationId: 'initialization', kind: 'initialization', moment, blocks: [{ blockId: 'opening', kind: 'configuration', text: JSON.stringify({ name: cleanName, location: '蒙德城', mode: 'development' }) }] });
  return { head: { scope, sessionId: identity.sessionId, coreSeq: 0, memoryRevision: 0 }, playerId: identity.playerId, contentRefs: [], sources: [source], records: [
    { scope, domain: 'traveler', entityId: identity.playerId, version: 1, value: { ...createEmptyTravelerProfile(), id: identity.playerId, 姓名: cleanName, 身份: '旅人', visualArchive: { slotImages: {} }, level: 1, health: 100, experience: 0 } },
    { scope, domain: 'world', entityId: 'world', version: 1, value: { moment, region: 'mondstadt', visitedRegions: ['mondstadt'], atmosphere: '', completedMainTurns: 0, proactiveLastTurn: 0 } },
    { scope, domain: 'inventory', entityId: 'wallet', version: 1, value: { kind: 'wallet', mora: 0 } },
    { scope, domain: 'story', entityId: 'story', version: 1, value: { seriesId: null, chapterId: null, nodeId: null, completedNodeIds: [], status: 'not_started' } },
  ] };
}
