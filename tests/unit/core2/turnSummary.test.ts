import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { summarizeCoreTurn } from '@/core/memory/turnSummary';
import { makeCandidate, makeSeed, makeSource } from './fixtures';

it('builds one separate memory per committed main turn and preserves all sources when turn 8 summarization fails', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-summary-${crypto.randomUUID()}` });
  const seed = makeSeed(); await repo.initialize(seed);
  const summarize = vi.fn(async ({ turn }: { turn: number }) => turn === 8 ? { kind: 'failed' as const, code: 'timeout', detail: '模型超时' } : { kind: 'model' as const, text: `第${turn}回合安柏赠送苹果。` });
  const successes = [], failures = [];
  for (let turn = 1; turn <= 15; turn++) {
    const source = makeSource({ scope: seed.head.scope, operationId: `summary-turn-${turn}`, moment: { ...seed.sources[0]!.moment, turn } });
    const candidate = makeCandidate({ scope: source.scope, operationId: source.operationId, candidateId: `candidate-${turn}`, actors: ['npc-amber'], targets: [seed.playerId], proposal: { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 1 }, evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: source.blocks[0]!.text.length, quote: source.blocks[0]!.text }] });
    const receipt = await settleCoreOperation({ scope: source.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main', sources: [source] }, { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted', candidates: [candidate], attempts: 1 }) });
    const operation = (await repo.readOperation(source.scope, source.operationId))!;
    const events = (await repo.queryEvents({ scope: source.scope, cutoffSeq: receipt.coreSeq, eventIds: receipt.eventIds })).items;
    const result = await summarizeCoreTurn({ operation, sources: [source], events, mode: 'model', prompt: '逐回合记录' }, { summarize });
    if (result.kind === 'staged') successes.push(result.memory); else failures.push(result);
  }
  expect(successes.map(memory => memory.turns)).toEqual(Array.from({ length: 15 }, (_, index) => [index + 1]).filter(turn => turn[0] !== 8));
  expect(failures).toHaveLength(1); expect(failures[0]).toMatchObject({ kind: 'failed', code: 'timeout' });
  expect(summarize).toHaveBeenCalledTimes(15);
  const sources = (await repo.querySources({ scope: seed.head.scope, cutoffSeq: 15, kinds: ['narrative'], limit: 50 })).items;
  expect(sources.filter(source => source.operationId.startsWith('summary-turn-'))).toHaveLength(15);
  expect((await repo.readHead(seed.head.scope)).memoryRevision).toBe(0); // staging is not a publication
});
it('never promotes an uncommitted body or treats a courier operation as an extra main turn', async () => {
  const seed = makeSeed(), source = seed.sources[0]!;
  const operation = { scope: seed.head.scope, operationId: source.operationId, kind: 'main' as const, status: 'draft' as const, sourceRefs: [source.ref], readSet: [], candidateRefs: [], effects: [], attempts: 0 };
  const summarize = vi.fn();
  expect((await summarizeCoreTurn({ operation, sources: [source], events: [], mode: 'model', prompt: '' }, { summarize })).kind).toBe('failed');
  expect((await summarizeCoreTurn({ operation: { ...operation, kind: 'courier' }, sources: [source], events: [], mode: 'local', prompt: '' }, {})).kind).toBe('failed');
  expect(summarize).not.toHaveBeenCalled();
});
it('does not give disputed body text to the summary model as a confirmed fact', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-summary-disputed-${crypto.randomUUID()}` });
  const seed = makeSeed(); await repo.initialize(seed);
  const source = makeSource({ scope: seed.head.scope, operationId: 'disputed-summary', blocks: [{ blockId: 'body-1', kind: 'narration', text: '玩家准备得到黄金宝库。UNCONFIRMED_SENTINEL' }] });
  const candidate = makeCandidate({ scope: source.scope, operationId: source.operationId, actors: [seed.playerId], evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: source.blocks[0]!.text.length, quote: source.blocks[0]!.text }] });
  const receipt = await settleCoreOperation({ scope: source.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main', sources: [source] }, { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted', candidates: [candidate], attempts: 1 }) });
  const operation = (await repo.readOperation(source.scope, source.operationId))!;
  const events = (await repo.queryEvents({ scope: source.scope, cutoffSeq: receipt.coreSeq, eventIds: receipt.eventIds })).items;
  const summarize = vi.fn(async () => ({ kind: 'model' as const, text: '本回合没有新增已确认变化。' }));
  expect((await summarizeCoreTurn({ operation, sources: [source], events, mode: 'model', prompt: '' }, { summarize })).kind).toBe('staged');
  expect(JSON.stringify(summarize.mock.calls)).not.toContain('UNCONFIRMED_SENTINEL');
});
it('preserves attributed dialogue as a transcript, without pretending an invitation was completed', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-dialogue-memory-${crypto.randomUUID()}` }), seed = makeSeed(); await repo.initialize(seed);
  const text = '云，今天一起去风起地看蒲公英吧。';
  const source = makeSource({ scope: seed.head.scope, operationId: 'dialogue-only', blocks: [{ blockId: 'dialogue-1', kind: 'dialogue', speakerId: 'npc-amber', text }] });
  const receipt = await settleCoreOperation({ scope: source.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main', sources: [source] }, { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }) });
  const operation = (await repo.readOperation(source.scope, source.operationId))!, events = (await repo.queryEvents({ scope: source.scope, cutoffSeq: 1, eventIds: receipt.eventIds })).items;
  const result = await summarizeCoreTurn({ operation, sources: [source], events, mode: 'local', prompt: '' }, {});
  expect(result.kind).toBe('staged'); if (result.kind !== 'staged') return;
  expect(result.memory.text).toContain(text); expect(result.memory.text).toContain('recorded_utterance');
  expect(result.memory.text.split(text).length - 1).toBe(1);
  expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'world')?.value).toMatchObject({ moment: { location: '蒙德城' } });
});
