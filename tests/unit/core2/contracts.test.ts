import { describe, expect, it } from 'vitest';
import { createCoreIdentity } from '@/core/contracts/identity';
import { validateCoreDto } from '@/core/contracts/storage';
import { makeCandidate, makeCommit, makeMemory, makeSeed, makeSource } from './fixtures';

describe('core2 boundary contracts', () => {
  it('accepts a new journey seed and its current-state snapshot', () => {
    const seed = makeSeed();
    expect(validateCoreDto('seed', seed).ok).toBe(true);
    expect(validateCoreDto('snapshot', { head: seed.head, records: seed.records, contentRefs: seed.contentRefs }).ok).toBe(true);
  });

  it('rejects a legacy save root instead of interpreting it as new current state', () => {
    expect(validateCoreDto('snapshot', { schemaVersion: 2, 旅人: { 姓名: '云' }, NPC: [], 记忆: {} }).ok).toBe(false);
  });

  it('keeps same-name new journeys and player identities separate', () => {
    const a = createCoreIdentity();
    const b = createCoreIdentity();
    expect(a.scope.journeyId).not.toBe(b.scope.journeyId);
    expect(a.playerId).not.toBe(b.playerId);
    expect(a.scope.branchId).not.toBe(b.scope.branchId);
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('rejects a state record from another journey in a snapshot', () => {
    const seed = makeSeed();
    const records = structuredClone(seed.records);
    records[0]!.scope.journeyId = 'foreign-journey';
    expect(validateCoreDto('snapshot', { head: seed.head, records, contentRefs: seed.contentRefs }).ok).toBe(false);
  });

  it('rejects undeclared current-state fields rather than silently dropping them', () => {
    const seed = makeSeed();
    const world = structuredClone(seed.records.find(record => record.domain === 'world')!);
    Object.assign(world.value, { worldEvents: ['history must not grow in current state'] });
    expect(validateCoreDto('state', world).ok).toBe(false);
  });

  it('rejects history arrays embedded in a current NPC', () => {
    const seed = makeSeed();
    const npc = structuredClone(seed.records.find(record => record.domain === 'npc')!);
    Object.assign(npc.value, { sharedMemories: [], relationshipLedger: { protectedFacts: [] } });
    expect(validateCoreDto('state', npc).ok).toBe(false);
  });

  it('rejects unsafe dictionary keys without applying or normalizing them', () => {
    const seed = makeSeed();
    const player = structuredClone(seed.records.find(record => record.domain === 'traveler')!);
    Object.assign(player.value, { attributes: JSON.parse('{"__proto__":10}') });
    expect(validateCoreDto('state', player).ok).toBe(false);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('rejects non-finite numbers at nested boundaries', () => {
    const seed = makeSeed();
    const npc = structuredClone(seed.records.find(record => record.domain === 'npc')!);
    Object.assign(npc.value, { affinity: Number.NaN });
    expect(validateCoreDto('state', npc).ok).toBe(false);
  });

  it('does not execute getters or recurse through cycles in unknown inputs', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'head', { enumerable: true, get() { reads += 1; return {}; } });
    expect(validateCoreDto('snapshot', input).ok).toBe(false);
    expect(reads).toBe(0);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(validateCoreDto('snapshot', cyclic).ok).toBe(false);
  });

  it('keeps fact-review, operation and memory statuses on separate axes', () => {
    const candidate = makeCandidate();
    expect(validateCoreDto('candidate', candidate).ok).toBe(true);
    expect(validateCoreDto('event', candidate).ok).toBe(false);
    expect(validateCoreDto('candidate', { ...candidate, status: 'committed' }).ok).toBe(false);
    expect(validateCoreDto('memory', { ...makeMemory(), status: 'verified' }).ok).toBe(false);
  });

  it('rejects arbitrary JSON patch proposals from a model', () => {
    expect(validateCoreDto('candidate', { ...makeCandidate(), proposal: { action: 'set', path: 'NPC[0].affinity', value: 150 } }).ok).toBe(false);
  });

  it('accepts source provenance but rejects hidden-reasoning blocks', () => {
    const source = makeSource();
    expect(validateCoreDto('source', source).ok).toBe(true);
    expect(validateCoreDto('source', { ...source, blocks: [{ blockId: 'hidden', kind: 'analysis', text: 'internal' }] }).ok).toBe(false);
  });

  it('rejects malformed source spans and invented game-world provenance', () => {
    const candidate = makeCandidate();
    candidate.evidenceRefs[0]!.end = -1;
    expect(validateCoreDto('candidate', candidate).ok).toBe(false);
    expect(validateCoreDto('source', { ...makeSource(), moment: { turn: 1, timestamp: Date.now() } }).ok).toBe(false);
  });

  it('rejects foreign-scope nested writes in a prepared commit', () => {
    const seed = makeSeed();
    const batch = makeCommit(seed.head);
    batch.changes[0]!.after!.scope.branchId = 'foreign-branch';
    expect(validateCoreDto('commit', batch).ok).toBe(false);
  });

  it('rejects preallocated commit sequence in event drafts', () => {
    const batch = makeCommit(makeSeed().head);
    expect(validateCoreDto('commit', batch).ok).toBe(true);
    Object.assign(batch.events[0]!, { commitSeq: 999 });
    expect(validateCoreDto('commit', batch).ok).toBe(false);
  });

  it('accepts actual turn gaps in memory and rejects fabricated range-only provenance', () => {
    const memory = makeMemory({ turns: [3, 5] });
    expect(validateCoreDto('memory', memory).ok).toBe(true);
    expect(validateCoreDto('memory', { ...memory, turns: [], sourceRefs: [], eventIds: [], memoryRefs: [] }).ok).toBe(false);
  });

  it('accepts every declared current-state domain and rejects an unknown domain', () => {
    const seed = makeSeed();
    for (const record of seed.records) expect(validateCoreDto('state', record).ok, record.domain).toBe(true);
    expect(seed.records.map(record => record.domain).sort()).toEqual(['album', 'courier', 'doudizhu', 'inventory', 'map', 'news', 'npc', 'quest', 'story', 'traveler', 'world']);
    expect(validateCoreDto('state', { ...seed.records[0], domain: 'anything' }).ok).toBe(false);
  });

  it('rejects legacy package markers and accepts only the new manifest version', () => {
    expect(validateCoreDto('manifest', { schemaVersion: 2, saves: [] }).ok).toBe(false);
    expect(validateCoreDto('manifest', { kind: 'teyvat-core2-package', formatVersion: 999 }).ok).toBe(false);
  });

  it('accepts legitimate lineage metadata without allowing foreign writable records', () => {
    const seed = makeSeed();
    seed.head.parent = { journeyId: seed.head.scope.journeyId, branchId: 'parent-branch' };
    seed.head.forkSeq = 12;
    seed.head.coreSeq = 12;
    seed.head.forkMemoryRevision = 0;
    expect(validateCoreDto('snapshot', { head: seed.head, records: seed.records, contentRefs: [] }).ok).toBe(true);
    seed.head.parent.journeyId = 'foreign-journey';
    expect(validateCoreDto('snapshot', { head: seed.head, records: seed.records, contentRefs: [] }).ok).toBe(false);
  });

  it('rejects sparse arrays and hidden properties that would change during serialization', () => {
    const source = makeSource();
    source.blocks = new Array(1);
    expect(validateCoreDto('source', source).ok).toBe(false);
    const hidden = Object.defineProperty(makeMemory(), 'hiddenPrompt', { value: 'not declared', enumerable: false });
    expect(validateCoreDto('memory', hidden).ok).toBe(false);
  });

  it('rejects foreign writes inside a standalone committed event', () => {
    const batch = makeCommit(makeSeed().head);
    const event = { ...batch.events[0]!, commitSeq: 1 };
    event.committedChanges[0]!.after!.scope.journeyId = 'foreign-journey';
    expect(validateCoreDto('event', event).ok).toBe(false);
  });

  it('rejects malformed unicode that cannot cross the desktop JSON boundary unchanged', () => {
    const source = makeSource();
    source.blocks[0]!.text = '\uD83D';
    expect(validateCoreDto('source', source).ok).toBe(false);
  });

  it('supports operations, derived jobs, knowledge and commitments without accepting extra fields', () => {
    const source = makeSource();
    const candidate = makeCandidate({ scope: source.scope, evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: 14, quote: source.blocks[0]!.text }] });
    const memory = makeMemory({ scope: source.scope });
    const entries = [
      ['operation', { scope: source.scope, operationId: source.operationId, kind: 'main', status: 'prepared', sourceRefs: [source.ref], readSet: [], candidateRefs: [], effects: [], attempts: 1 }],
      ['stage', { scope: source.scope, sessionId: 'session-fixture', operationId: source.operationId, sourceRefs: [source.ref], candidates: [candidate], review: [], stageVersion: 1 }],
      ['derived', { scope: source.scope, sessionId: 'session-fixture', jobId: 'job-fixture', leaseId: 'lease-fixture', sourceRefs: [source.ref], readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] }],
      ['job', { jobId: 'job-fixture', scope: source.scope, sessionId: 'session-fixture', kind: 'turn_summary', sourceRefs: [source.ref], operationId: source.operationId, status: 'pending', leaseId: null, configFingerprint: '', attempts: 0, steps: [], version: 1 }],
      ['knowledge', { knowledgeId: 'knowledge-fixture', scope: source.scope, npcId: 'npc-amber', eventId: 'event-fixture', mode: 'witnessed', evidenceRefs: candidate.evidenceRefs, learnedMoment: source.moment, nature: 'fact', version: 1 }],
      ['commitment', { commitmentId: 'promise-fixture', scope: source.scope, participantIds: ['npc-amber', 'player-fixture'], text: '明天一起旅行', establishedEventId: 'event-fixture', trigger: { kind: 'date', date: '旅行历 1000.03.08' }, recurring: false, status: 'pending', history: [], version: 1 }],
      ['manifest', { kind: 'teyvat-core2-package', formatVersion: 1, scope: source.scope, snapshotId: 'snapshot-fixture', files: [], containsPrivateData: false }],
    ] as const;
    for (const [kind, entry] of entries) {
      expect(validateCoreDto(kind, entry).ok, kind).toBe(true);
      expect(validateCoreDto(kind, { ...entry, hiddenPrompt: 'extra' }).ok, kind).toBe(false);
    }
  });
});
