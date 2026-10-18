import { describe, expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import type { JourneySeed, OperationRecord, PreparedCommit } from '@/core/contracts/operation';
import type { JobRecord } from '@/core/contracts/memory';
import { makeCommit, makeSeed, makeSource } from './fixtures';

// The same consumer-visible core contract will run against the file backend in S04.
export type CoreTransactionContract = Pick<CoreRepository,
  'initialize' | 'readHead' | 'activateSession' | 'readState' | 'putSource' | 'appendOperationSource' | 'readSource' |
  'prepareOperation' | 'stageOperation' | 'cancelOperation' | 'readOperation' | 'commit' |
  'queryEvents' | 'queryKnowledge' | 'queryCommitments' | 'queryJobs'>;
export interface RepositoryHarness { repo: CoreTransactionContract; connect(): Promise<CoreTransactionContract> }
export type RepositoryTestFactory = () => Promise<RepositoryHarness>;

export function makeJob(seed: JourneySeed, batch: PreparedCommit): JobRecord {
  return { jobId: 'job-summary-1', scope: seed.head.scope, sessionId: seed.head.sessionId,
    kind: 'turn_summary', sourceRefs: batch.sourceRefs, operationId: batch.operationId,
    status: 'pending', leaseId: null, configFingerprint: 'fixture-v1', attempts: 0, steps: [], version: 1 };
}

export function makeBatch(seed: JourneySeed): PreparedCommit {
  const batch = makeCommit(seed.head);
  batch.events[0]!.eventId = `event-${seed.head.scope.branchId}`;
  const event = batch.events[0]!;
  batch.knowledge = [{ knowledgeId: 'knowledge-apple', scope: seed.head.scope, npcId: 'npc-amber',
    eventId: event.eventId, mode: 'witnessed', evidenceRefs: event.evidenceRefs,
    learnedMoment: event.occurredMoment, nature: 'fact', version: 1 }];
  batch.commitments = [{ commitmentId: 'promise-apple', scope: seed.head.scope, participantIds: ['npc-amber'],
    text: '明天一起吃苹果。', establishedEventId: event.eventId,
    trigger: { kind: 'date', date: '旅行历 1000.03.08' }, recurring: false,
    status: 'pending', history: [], version: 1 }];
  batch.jobs = [makeJob(seed, batch)];
  return batch;
}

export async function prepareBatch(repo: CoreTransactionContract, batch: PreparedCommit): Promise<void> {
  for (const ref of batch.sourceRefs) await repo.putSource(makeSource({ ref, scope: batch.scope, operationId: batch.operationId }));
  const operation: OperationRecord = { scope: batch.scope, operationId: batch.operationId, kind: 'main', status: 'prepared',
    sourceRefs: batch.sourceRefs, readSet: batch.readSet, candidateRefs: [], effects: batch.changes.map(change => change.effectKey), attempts: 1 };
  await repo.prepareOperation(operation);
  await repo.stageOperation({ scope: batch.scope, sessionId: batch.sessionId, operationId: batch.operationId,
    sourceRefs: batch.sourceRefs, candidates: [], review: [], stageVersion: 1 });
}

export async function appleQuantity(repo: CoreTransactionContract, seed: JourneySeed): Promise<number | undefined> {
  const record = (await repo.readState(seed.head.scope)).records.find(item => item.domain === 'inventory' && item.entityId === 'apple');
  return record?.domain === 'inventory' && record.value.kind === 'item' ? record.value.quantity : undefined;
}

export function assertRepositoryContract(factory: RepositoryTestFactory): void {
  describe('shared core transaction contract', () => {
    it.each(['missing-original-event', 'self'])('rejects a reply anchored to %s without partially changing state', async target => {
      const { repo, seed, batch } = await scenario();
      batch.events[0]!.replyToEventId = target === 'self' ? batch.events[0]!.eventId : target;
      expect((await repo.commit(batch)).status).toBe('conflict'); expect(await appleQuantity(repo, seed)).toBe(1);
    });
    it('rejects a correction pointing to a missing historical event without writing its state changes', async () => {
      const { repo, seed, batch } = await scenario();
      batch.events[0]!.correctionOf = 'missing-original-event';
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });
    it('rejects a correction that points to itself instead of a previously committed event', async () => {
      const { repo, seed, batch } = await scenario(); batch.events[0]!.correctionOf = batch.events[0]!.eventId;
      expect((await repo.commit(batch)).status).toBe('conflict'); expect(await appleQuantity(repo, seed)).toBe(1);
    });
    it('rejects duplicate source block IDs consistently before storing any source', async () => {
      const { repo, seed } = await scenario();
      const source = makeSource({ scope: seed.head.scope }); source.blocks.push({ ...source.blocks[0]! });
      await expect(repo.putSource(source)).rejects.toThrow('CORE2_DUPLICATE_BLOCK_ID');
      expect(await repo.readSource(source.ref)).toBeNull();
    });
    it('appends a newly frozen response to an unsealed draft without allowing source replacement or prepared appends', async () => {
      const { repo } = await factory(); const seed = makeSeed(); await repo.initialize(seed);
      const first = makeSource({ scope: seed.head.scope, kind: 'player_input' }), second = makeSource({ scope: seed.head.scope }), third = makeSource({ scope: seed.head.scope });
      await repo.putSource(first);
      const draft: OperationRecord = { scope: seed.head.scope, operationId: first.operationId, kind: 'main', status: 'draft', sourceRefs: [first.ref], readSet: [], candidateRefs: [], effects: [], attempts: 0 };
      await repo.prepareOperation(draft);
      await expect(repo.prepareOperation({ ...draft, sourceRefs: [second.ref] })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      await expect(repo.prepareOperation({ ...draft, sourceRefs: [first.ref, second.ref] })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      const appended = { ...draft, sourceRefs: [first.ref, second.ref] };
      const append = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: first.operationId, source: second };
      await expect(repo.appendOperationSource({ ...append, sessionId: 'stale-session' })).rejects.toThrow('CORE2_SESSION_CHANGED');
      expect(await repo.readSource(second.ref)).toBeNull();
      expect(await repo.appendOperationSource(append)).toMatchObject({ sourceRefs: appended.sourceRefs });
      expect(await repo.appendOperationSource(append)).toMatchObject({ sourceRefs: appended.sourceRefs });
      expect(await repo.readSource(second.ref)).toEqual(second);
      await expect(repo.appendOperationSource({ ...append, source: third })).rejects.toThrow('CORE2_NARRATIVE_ALREADY_FROZEN');
      expect(await repo.readSource(third.ref)).toBeNull();
      await repo.stageOperation({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: first.operationId, sourceRefs: appended.sourceRefs, candidates: [], review: [], stageVersion: 1 });
      await expect(repo.prepareOperation({ ...appended, sourceRefs: [...appended.sourceRefs, third.ref] })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      await repo.prepareOperation({ ...appended, status: 'prepared' });
      await expect(repo.prepareOperation({ ...appended, status: 'prepared', sourceRefs: [...appended.sourceRefs, third.ref] })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      await expect(repo.appendOperationSource({ ...append, source: third })).rejects.toThrow('CORE2_OPERATION_NOT_OPEN');
    });
    it('preserves confirmed typed facts, stable moment locations and resumable failure detail across the backend', async () => {
      const { repo } = await factory(); const seed = makeSeed(); await repo.initialize(seed);
      const batch = makeBatch(seed);
      batch.events[0]!.fact = { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 1 };
      batch.events[0]!.occurredMoment.locationId = 'mondstadt-city';
      await prepareBatch(repo, batch); expect((await repo.commit(batch)).status).toBe('committed');
      const events = await repo.queryEvents({ scope: batch.scope, cutoffSeq: 1 });
      expect(events.items[0]).toMatchObject({ fact: batch.events[0]!.fact, occurredMoment: { locationId: 'mondstadt-city' } });
      await repo.prepareOperation({ scope: batch.scope, operationId: 'failed-extraction', kind: 'main', status: 'failed', sourceRefs: [], readSet: [], candidateRefs: [], effects: [], attempts: 1, failure: { code: 'MODEL_EMPTY', detail: 'No response' } });
      expect(await repo.readOperation(batch.scope, 'failed-extraction')).toMatchObject({ failure: { code: 'MODEL_EMPTY', detail: 'No response' } });
    });
    it('binds a captured draft to its reviewed write set once, then rejects resealing or changing captured versions', async () => {
      const { repo } = await factory(); const seed = makeSeed(); await repo.initialize(seed);
      const batch = makeBatch(seed);
      for (const ref of batch.sourceRefs) await repo.putSource(makeSource({ ref, scope: batch.scope, operationId: batch.operationId }));
      const draft: OperationRecord = { scope: batch.scope, operationId: batch.operationId, kind: 'main', status: 'draft', sourceRefs: batch.sourceRefs, readSet: batch.readSet, candidateRefs: [], effects: [], attempts: 0 };
      await repo.prepareOperation(draft);
      await repo.stageOperation({ scope: batch.scope, sessionId: batch.sessionId, operationId: batch.operationId, sourceRefs: batch.sourceRefs, candidates: [], review: [], stageVersion: 1 });
      await expect(repo.prepareOperation({ ...draft, status: 'prepared', effects: batch.changes.map(c => c.effectKey), attempts: 1, readSet: batch.readSet.map(r => ({ ...r, version: 2 })) })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      const sealed: OperationRecord = { ...draft, status: 'prepared', effects: batch.changes.map(c => c.effectKey), attempts: 1 };
      await repo.prepareOperation(sealed);
      await expect(repo.prepareOperation({ ...sealed, effects: ['different'] })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      await expect(repo.prepareOperation({ ...draft, attempts: 2 })).rejects.toThrow('CORE2_OPERATION_VERSION_CONFLICT');
      expect((await repo.commit(batch)).status).toBe('committed');
    });
    it('paginates technical IDs in a deterministic cross-backend order, not a host locale order', async () => {
      const harness = await factory();
      const seed = makeSeed();
      await harness.repo.initialize(seed);
      const batch = makeBatch(seed);
      const base = structuredClone(batch.events[0]!);
      batch.events = ['event-A', 'event-_', 'event-a'].map((eventId, index) => ({ ...structuredClone(base), eventId, committedChanges: index === 0 ? base.committedChanges : [] }));
      batch.knowledge = [];
      batch.commitments = [];
      await prepareBatch(harness.repo, batch);
      expect((await harness.repo.commit(batch)).status).toBe('committed');
      const query = { scope: seed.head.scope, cutoffSeq: 1, limit: 1 };
      const first = await harness.repo.queryEvents(query);
      expect(first.items.map(item => item.eventId)).toEqual(['event-A']);
      const second = await harness.repo.queryEvents({ ...query, cursor: first.nextCursor });
      expect(second.items.map(item => item.eventId)).toEqual(['event-_']);
      const last = await harness.repo.queryEvents({ ...query, cursor: second.nextCursor });
      expect(last.items.map(item => item.eventId)).toEqual(['event-a']);
      expect(last.nextCursor).toBeUndefined();
    });

    async function scenario() {
      const harness = await factory();
      const seed = makeSeed();
      await harness.repo.initialize(seed);
      const batch = makeBatch(seed);
      await prepareBatch(harness.repo, batch);
      return { ...harness, seed, batch };
    }

    it('saves state, events, knowledge, commitments, receipt and jobs as one completed result', async () => {
      const { repo, seed, batch, connect } = await scenario();
      const receipt = await repo.commit(batch);
      expect(receipt).toMatchObject({ status: 'committed', coreSeq: 1, eventIds: [batch.events[0]!.eventId], jobIds: ['job-summary-1'] });
      const reconnected = await connect();
      expect(await appleQuantity(reconnected, seed)).toBe(2);
      expect((await reconnected.readOperation(batch.scope, batch.operationId))?.receipt).toEqual(receipt);
      const query = { scope: batch.scope, cutoffSeq: 1 };
      expect((await reconnected.queryEvents(query)).items).toHaveLength(1);
      expect((await reconnected.queryKnowledge(query)).items.map(row => row.npcId)).toEqual(['npc-amber']);
      expect((await reconnected.queryCommitments(query)).items.map(row => row.status)).toEqual(['pending']);
      expect((await reconnected.queryJobs(query)).items.map(row => row.status)).toEqual(['pending']);
    });

    it('same operation replayed a hundred times produces only one effect', async () => {
      const { repo, seed, batch } = await scenario();
      expect((await repo.commit(batch)).status).toBe('committed');
      for (let count = 0; count < 100; count++) expect((await repo.commit(batch)).status).toBe('already_committed');
      expect(await appleQuantity(repo, seed)).toBe(2);
      expect((await repo.readHead(batch.scope)).coreSeq).toBe(1);
      expect((await repo.queryEvents({ scope: batch.scope, cutoffSeq: 1 })).items).toHaveLength(1);
    });

    it('two independent connections commit one operation only once', async () => {
      const { repo, seed, batch, connect } = await scenario();
      const second = await connect();
      const receipts = await Promise.all([repo.commit(batch), second.commit(batch)]);
      expect(receipts.map(receipt => receipt.status).sort()).toEqual(['already_committed', 'committed']);
      expect(await appleQuantity(second, seed)).toBe(2);
    });

    it('persistent cancellation prevents a late result and cannot be undone by preparing again', async () => {
      const { repo, seed, batch } = await scenario();
      await repo.cancelOperation(batch.scope, batch.operationId);
      await expect(prepareBatch(repo, batch)).rejects.toThrow('CORE2_OPERATION_TERMINAL');
      expect((await repo.commit(batch)).status).toBe('cancelled');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('session takeover rejects the old writer without advancing the world clock', async () => {
      const { repo, seed, batch } = await scenario();
      await repo.activateSession(batch.scope, 'session-new');
      expect((await repo.commit(batch)).status).toBe('cancelled');
      expect(await appleQuantity(repo, seed)).toBe(1);
      expect((await repo.readHead(batch.scope)).coreSeq).toBe(0);
    });

    it('cancel after commit preserves its receipt and already applied state', async () => {
      const { repo, seed, batch } = await scenario();
      const receipt = await repo.commit(batch);
      await repo.cancelOperation(batch.scope, batch.operationId);
      await repo.activateSession(batch.scope, 'session-new');
      expect(await repo.commit(batch)).toEqual({ ...receipt, status: 'already_committed' });
      expect(await appleQuantity(repo, seed)).toBe(2);
    });

    it('stale related record versions reject without partially writing state', async () => {
      const { repo, seed, batch } = await scenario();
      batch.readSet[0]!.version = 0;
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
      expect((await repo.queryEvents({ scope: batch.scope, cutoffSeq: 0 })).items).toEqual([]);
    });

    it('a changed before-value cannot overwrite a real record even with the correct version', async () => {
      const { repo, seed, batch } = await scenario();
      const before = batch.changes[0]!.before;
      if (before?.domain === 'inventory' && before.value.kind === 'item') before.value.quantity = 99;
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('each changed entity must be included in the exact read set', async () => {
      const { repo, seed, batch } = await scenario();
      batch.readSet = [];
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('event changes must equal the actual transaction changes', async () => {
      const { repo, seed, batch } = await scenario();
      batch.events[0]!.committedChanges = [];
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('persisted source versions and exact quotes are required before committing', async () => {
      const { repo, seed, batch } = await scenario();
      batch.events[0]!.evidenceRefs[0]!.quote = '安柏把二枚苹果放入玩家背包。';
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
      batch.events[0]!.evidenceRefs[0]!.ref.sourceVersion = 2;
      expect((await repo.commit(batch)).status).toBe('conflict');
    });

    it('uncommitted staging is recoverable but never visible as a confirmed event', async () => {
      const { repo, batch, connect } = await scenario();
      const reconnected = await connect();
      expect((await reconnected.readOperation(batch.scope, batch.operationId))?.stage?.stageVersion).toBe(1);
      expect((await reconnected.queryEvents({ scope: batch.scope, cutoffSeq: 0 })).items).toEqual([]);
      await expect(repo.stageOperation({ scope: batch.scope, sessionId: 'stale-session', operationId: batch.operationId,
        sourceRefs: batch.sourceRefs, candidates: [], review: [], stageVersion: 2 })).rejects.toThrow('CORE2_SESSION_CHANGED');
    });

    it('staging cannot roll back or replace the same version with different content', async () => {
      const { repo, batch } = await scenario();
      const stage = (await repo.readOperation(batch.scope, batch.operationId))!.stage!;
      await repo.stageOperation(stage);
      await repo.stageOperation({ ...stage, stageVersion: 2 });
      await expect(repo.stageOperation(stage)).rejects.toThrow('CORE2_STAGE_VERSION_CONFLICT');
    });

    it('source content is immutable and duplicate uploads do not reset its committed status', async () => {
      const { repo, batch } = await scenario();
      const source = (await repo.readSource(batch.sourceRefs[0]!))!;
      await repo.commit(batch);
      await repo.putSource(source);
      source.blocks[0]!.text = '错误覆盖';
      await expect(repo.putSource(source)).rejects.toThrow('CORE2_SOURCE_IMMUTABLE');
      expect((await repo.readSource(batch.sourceRefs[0]!))!.blocks[0]!.text).toBe('安柏把一枚苹果放入玩家背包。');
    });

    it('independent journeys keep identical entity names and effect keys isolated', async () => {
      const { repo, seed, batch } = await scenario();
      const otherSeed = makeSeed();
      await repo.initialize(otherSeed);
      const otherBatch = makeBatch(otherSeed);
      await prepareBatch(repo, otherBatch);
      expect((await repo.commit(batch)).status).toBe('committed');
      expect((await repo.commit(otherBatch)).status).toBe('committed');
      expect(await appleQuantity(repo, seed)).toBe(2);
      expect(await appleQuantity(repo, otherSeed)).toBe(2);
      expect((await repo.queryEvents({ scope: batch.scope, cutoffSeq: 1 })).items.map(event => event.journeyId)).toEqual([batch.scope.journeyId]);
    });

    it('input ownership is captured before asynchronous initialization begins', async () => {
      const { repo } = await factory();
      const seed = makeSeed();
      const pending = repo.initialize(seed);
      const apple = seed.records.find(record => record.domain === 'inventory')!;
      if (apple.domain === 'inventory' && apple.value.kind === 'item') apple.value.quantity = 99;
      await pending;
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('a state-changing event without any provenance is not accepted', async () => {
      const { repo, seed, batch } = await scenario();
      batch.events[0]!.evidenceRefs = [];
      await expect(repo.commit(batch)).rejects.toThrow('CORE2_INVALID_COMMIT');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('historical knowledge and commitment queries preserve the version at the requested cutoff', async () => {
      const { repo, seed, batch } = await scenario();
      await repo.commit(batch);
      const second = makeBatch(seed);
      second.operationId = 'operation-second';
      second.readSet[0]!.version = 2;
      second.changes[0]!.ref.version = 2;
      second.changes[0]!.before = structuredClone(batch.changes[0]!.after);
      second.changes[0]!.effectKey = 'effect-apple-2';
      const after = second.changes[0]!.after!;
      after.version = 3;
      if (after.domain === 'inventory' && after.value.kind === 'item') after.value.quantity = 3;
      const event = second.events[0]!;
      event.eventId = `event-second-${seed.head.scope.branchId}`;
      event.operationId = second.operationId;
      event.committedChanges = structuredClone(second.changes);
      second.knowledge[0]!.version = 2;
      second.knowledge[0]!.eventId = event.eventId;
      second.commitments[0]!.version = 2;
      second.commitments[0]!.status = 'fulfilled';
      second.commitments[0]!.history = [{ eventId: event.eventId, status: 'fulfilled', moment: event.occurredMoment }];
      second.jobs = [];
      await prepareBatch(repo, second);
      expect((await repo.commit(second)).status).toBe('committed');
      expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 1 })).items[0]!.status).toBe('pending');
      expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 2 })).items[0]!.status).toBe('fulfilled');
      expect((await repo.queryKnowledge({ scope: batch.scope, cutoffSeq: 1 })).items[0]!.eventId).toBe(batch.events[0]!.eventId);
      expect((await repo.queryKnowledge({ scope: batch.scope, cutoffSeq: 2 })).items[0]!.eventId).toBe(event.eventId);
    });

    it('reusing an effect key in another operation is rejected even with a fresh read version', async () => {
      const { repo, seed, batch } = await scenario();
      await repo.commit(batch);
      const second = structuredClone(batch);
      second.operationId = 'operation-repeated-effect';
      second.sourceRefs = [makeSource().ref];
      second.readSet[0]!.version = 2;
      second.changes[0]!.ref.version = 2;
      second.changes[0]!.before = structuredClone(batch.changes[0]!.after);
      second.changes[0]!.after!.version = 3;
      const event = second.events[0]!;
      event.operationId = second.operationId;
      event.eventId = 'event-repeated-effect';
      event.evidenceRefs[0]!.ref = second.sourceRefs[0]!;
      event.committedChanges = structuredClone(second.changes);
      second.knowledge = []; second.commitments = []; second.jobs = [];
      await prepareBatch(repo, second);
      expect((await repo.commit(second)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(2);
      expect((await repo.readHead(batch.scope)).coreSeq).toBe(1);
    });

    it('a source edited while extraction is running invalidates the old pending version', async () => {
      const { repo, seed, batch } = await scenario();
      const source = (await repo.readSource(batch.sourceRefs[0]!))!;
      await repo.putSource({ ...source, ref: { ...source.ref, sourceVersion: 2 } });
      expect((await repo.commit(batch)).status).toBe('conflict');
      expect(await appleQuantity(repo, seed)).toBe(1);
    });

    it('rejects a query cursor reused with different filters even when the last row matches both', async () => {
      const { repo, batch } = await scenario();
      for (let index = 0; index < 3; index++) batch.events.push({ ...structuredClone(batch.events[0]!), eventId: `event-extra-${index}`, committedChanges: [] });
      await repo.commit(batch);
      const query = { scope: batch.scope, cutoffSeq: 1, limit: 1, locations: ['蒙德城'] };
      const first = await repo.queryEvents(query);
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeDefined();
      await expect(repo.queryEvents({ ...query, cursor: first.nextCursor, locations: ['蒙德城', '璃月港'] })).rejects.toThrow('CORE2_CURSOR_MISMATCH');
    });

    it('NPC filters reject numbers instead of silently treating them as missing contacts', async () => {
      const { repo, batch } = await scenario();
      await expect(repo.queryKnowledge({ scope: batch.scope, cutoffSeq: 0, npcIds: [42] as unknown as string[] })).rejects.toThrow('CORE2_INVALID_QUERY');
    });
    it('reports an oversized exact cursor explicitly instead of returning an unusable continuation', async () => {
      const { repo, batch } = await scenario();
      batch.events.push({ ...structuredClone(batch.events[0]!), eventId: 'event-extra', committedChanges: [] });
      await repo.commit(batch);
      await expect(repo.queryEvents({ scope: batch.scope, cutoffSeq: 1, limit: 1,
        eventIds: [batch.events[0]!.eventId, 'event-extra', ...Array.from({ length: 20 }, (_, i) => `unmatched-${i}-${'a'.repeat(80)}`)] })).rejects.toThrow('CORE2_CURSOR_TOO_LARGE');
    });
  });
}
