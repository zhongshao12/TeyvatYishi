import { createCoreIdentity } from '@/core/contracts/identity';
import type { BranchHead, CoreScope } from '@/core/contracts/identity';
import type { SourceRecord, FactCandidate } from '@/core/contracts/event';
import type { JourneySeed, PreparedCommit } from '@/core/contracts/operation';
import type { MemoryRecord } from '@/core/contracts/memory';
import type { NpcState, StateRecord, TravelerState } from '@/core/contracts/state';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

const fixtureScope: CoreScope = { journeyId: 'journey-fixture', branchId: 'branch-fixture' };
export const fixtureMoment: WorldMoment = { worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '10:00', weather: '晴', location: '蒙德城', travelDay: 1, turn: 1, settlementId: 'operation-fixture' };
const player: TravelerState = {
  id: 'player-fixture', 姓名: '云', 别名: '', 性别: '男', 年龄: 25, 生日: '', 身高: '', 身份: '旅人', 外貌: '', 性格: '', 背景: '', 专长知识: [], 头像: '',
  元素共鸣: [], 主元素: '', 天赋: [], attributes: {}, capabilities: [], visualArchive: { slotImages: {} }, level: 1, health: 100, experience: 0,
};
const npc: NpcState = {
  id: 'npc-amber', 姓名: '安柏', 地区: '蒙德', 身份: '侦察骑士', 天赋: [], 说明: '', aliases: [], roleTier: 'companion', affinity: 10,
  relationship: '朋友', intimate: false, travelingTogether: true, firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '云', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '', notes: [], playerCorrections: [], canonical: true, canonicalId: 'amber', avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
};
export function makeSeed(overrides: Partial<JourneySeed> = {}): JourneySeed {
  const identity = createCoreIdentity();
  const scope = identity.scope;
  const head: BranchHead = { scope, coreSeq: 0, memoryRevision: 0, sessionId: identity.sessionId };
  const source = makeSource({ scope });
  const records: StateRecord[] = [
    { scope, domain: 'traveler', entityId: identity.playerId, version: 1, value: { ...structuredClone(player), id: identity.playerId } },
    { scope, domain: 'world', entityId: 'world', version: 1, value: { moment: structuredClone(fixtureMoment), region: 'mondstadt', visitedRegions: ['mondstadt'], atmosphere: '', completedMainTurns: 0, proactiveLastTurn: 0 } },
    { scope, domain: 'npc', entityId: 'npc-amber', version: 1, value: structuredClone(npc) },
    { scope, domain: 'inventory', entityId: 'apple', version: 1, value: { kind: 'item', name: '苹果', category: 'food', quantity: 1, rarity: 1, description: '', status: 'owned' } },
    { scope, domain: 'quest', entityId: 'quest-1', version: 1, value: { id: 'quest-1', title: '问候', description: '', source: 'side', status: 'active', objectives: [], rewards: [], createdAtTurn: 1, updatedAt: 0 } },
    { scope, domain: 'story', entityId: 'story', version: 1, value: { seriesId: null, chapterId: null, nodeId: null, status: 'not_started', completedNodeIds: [] } },
    { scope, domain: 'courier', entityId: 'contact-amber', version: 1, value: { kind: 'contact', npcId: 'npc-amber', name: '安柏', remark: '', available: true } },
    { scope, domain: 'news', entityId: 'news-1', version: 1, value: { issueId: 'news-1', sourceRef: source.ref, eventIds: [], moment: structuredClone(fixtureMoment) } },
    { scope, domain: 'album', entityId: 'album-1', version: 1, value: { entryId: 'album-1', title: '蒙德城', kind: 'scene', assetId: 'asset-fixture', sourceRefs: [source.ref], npcIds: [], moment: structuredClone(fixtureMoment) } },
    { scope, domain: 'map', entityId: 'mondstadt-city', version: 1, value: { locationId: 'mondstadt-city', name: '蒙德城', region: 'mondstadt', visited: true } },
    { scope, domain: 'doudizhu', entityId: 'doudizhu', version: 1, value: { currentGame: null } },
  ];
  return { head, playerId: identity.playerId, records, sources: [source], contentRefs: [], ...overrides };
}
export function makeSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return { ref: { sourceId: `source-${crypto.randomUUID()}`, sourceVersion: 1 }, scope: structuredClone(fixtureScope), operationId: 'operation-fixture', kind: 'narrative', blocks: [{ blockId: 'body-1', kind: 'narration', text: '安柏把一枚苹果放入玩家背包。' }], moment: structuredClone(fixtureMoment), createdAt: 0, ...overrides };
}
export function makeCandidate(overrides: Partial<FactCandidate> = {}): FactCandidate {
  const source = makeSource();
  return { candidateId: 'candidate-fixture', scope: source.scope, operationId: source.operationId, kind: 'inventory', actors: ['npc-amber'], targets: ['player-fixture'], proposal: { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 1 }, evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: 14, quote: source.blocks[0]!.text }], status: 'proposed', ...overrides };
}
export function makeCommit(head: BranchHead, overrides: Partial<PreparedCommit> = {}): PreparedCommit {
  const source = makeSource({ scope: head.scope });
  const before: StateRecord<'inventory'> = { scope: head.scope, domain: 'inventory', entityId: 'apple', version: 1, value: { kind: 'item', name: '苹果', category: 'food', quantity: 1, rarity: 1, description: '', status: 'owned' } };
  const change = { ref: { domain: 'inventory' as const, entityId: 'apple', version: 1 }, before, after: { ...structuredClone(before), version: 2, value: { kind: 'item' as const, name: '苹果', category: 'food' as const, quantity: 2, rarity: 1 as const, description: '', status: 'owned' as const } }, effectKey: 'effect-apple-1' };
  return { scope: head.scope, sessionId: head.sessionId, operationId: source.operationId, sourceRefs: [source.ref], readSet: [change.ref], changes: [change], events: [{ eventId: 'event-apple-1', journeyId: head.scope.journeyId, branchId: head.scope.branchId, operationId: source.operationId, turn: 1, type: 'inventory.gain', actorIds: ['npc-amber'], targetIds: ['apple'], evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: 14, quote: source.blocks[0]!.text }], occurredMoment: structuredClone(fixtureMoment), ruleVersion: '1', committedChanges: [structuredClone(change)], visibility: { kind: 'participants', npcIds: ['npc-amber'] }, recordedAt: 0 }], knowledge: [], commitments: [], jobs: [], ...overrides };
}
export function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const source = makeSource();
  return { memoryId: 'memory-fixture', scope: source.scope, version: 1, layer: 'short', text: '安柏赠送苹果。', sourceRefs: [source.ref], eventIds: ['event-apple-1'], memoryRefs: [], turns: [1], momentRange: { start: source.moment, end: source.moment, sourceIds: [source.ref.sourceId] }, npcIds: ['npc-amber'], locations: ['蒙德城'], visibility: { kind: 'participants', npcIds: ['npc-amber'] }, importance: 1, pinned: false, status: 'active', generation: { mode: 'local', version: '1' }, editVersion: 0, ...overrides };
}
