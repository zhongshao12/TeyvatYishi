import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { runCoreTurn, type CoreContextInput } from '@/core/settlement/turnRunner';
import { makeCandidate, makeSeed } from './fixtures';

async function fixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-turn-${crypto.randomUUID()}` });
  const seed = makeSeed(); await repo.initialize(seed);
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'turn-test', text: '向安柏询问路上的情况' };
  const generateNarrative = vi.fn(async () => JSON.stringify({ body: [{ kind: 'narration', text: '安柏把两枚苹果放入玩家背包。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  const factModel = vi.fn(async ({ source }: { source: import('@/core/contracts/event').SourceRecord }) => ({ kind: 'extracted' as const, attempts: 1, candidates: [makeCandidate({ scope: source.scope, operationId: source.operationId, kind: 'inventory', actors: ['npc-amber'], targets: [seed.playerId], proposal: { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 2 }, evidenceRefs: [{ ref: source.ref, blockId: source.blocks[0]!.blockId, start: 0, end: source.blocks[0]!.text.length, quote: source.blocks[0]!.text }] })] }));
  const deps = { repo, generateNarrative, factModel, assembleContext: vi.fn(async (_input: CoreContextInput) => ({ systemPrompt: 'test', messages: [] })), rulePolicy: { ruleVersion: 'test', storyNodes: [] } };
  return { repo, seed, input, deps };
}
describe('core2 complete main turn', () => {
  it('persists actual recall bundle IDs and selected worldbook entries with the frozen body, not a preview or a global setting', async () => {
    const { repo, input, deps } = await fixture();
    const bundle = { bundleId: 'actual-author-bundle', mandatoryText: 'NOT_DUPLICATED_AUDIT_BODY', optionalText: '', selectedLeafIds: [], estimatedTokens: 12, budgetOverflow: false, diagnostics: [] };
    const audited = { ...deps, assembleContext: async () => ({ systemPrompt: 'test', messages: [], worldbookEntryIds: ['book-actual'], memoryDelivery: { authorBundle: bundle, npcBundles: [] } }) };
    const result = await runCoreTurn(input, audited); expect(result.kind).toBe('committed');
    const source = await repo.readSource(result.narrativeRef!);
    expect(source?.delivery).toEqual({ version: 1, bundles: [{ bundleId: bundle.bundleId, target: 'main', npcIds: [], selectedLeafIds: [] }], worldbookEntryIds: ['book-actual'] });
    expect(JSON.stringify(source?.delivery)).not.toContain('NOT_DUPLICATED_AUDIT_BODY');
    expect((await repo.readState(input.scope)).records.find(row => row.domain === 'world')).toMatchObject({ value: { worldbookTriggers: { 'book-actual': 1 } } });
  });
  it('keeps one frozen body and one settlement even when the same send is replayed', async () => {
    const { repo, input, deps } = await fixture();
    const first = await runCoreTurn(input, deps);
    expect(first.kind).toBe('committed');
    expect((await runCoreTurn(input, deps)).kind).toBe('committed');
    expect(deps.generateNarrative).toHaveBeenCalledTimes(1);
    expect(deps.factModel).toHaveBeenCalledTimes(1);
    const sources = await repo.querySources({ scope: input.scope, cutoffSeq: 1, operationId: input.operationId });
    expect(sources.items.filter(source => source.kind === 'narrative')).toHaveLength(1);
    expect((await repo.readState(input.scope)).records.find(r => r.entityId === 'apple')?.value).toMatchObject({ quantity: 3 });
  });
  it('retries variables using the saved body instead of appending or regenerating a second body', async () => {
    const { repo, input, deps } = await fixture();
    const failed = { ...deps, factModel: vi.fn(async () => ({ kind: 'failed' as const, code: 'MODEL_EMPTY', detail: 'empty', attempts: 1 })) };
    const first = await runCoreTurn(input, failed);
    expect(first).toMatchObject({ kind: 'failed', stage: 'settlement' });
    const operation = await repo.readOperation(input.scope, input.operationId);
    const bodies = await Promise.all(operation!.sourceRefs.map(ref => repo.readSource(ref)));
    expect(bodies.filter(source => source?.kind === 'narrative')).toHaveLength(1);
    expect((await repo.querySources({ scope: input.scope, cutoffSeq: 0, operationId: input.operationId })).items).toEqual([]);
    const retry = await runCoreTurn(input, deps);
    expect(retry.kind).toBe('committed');
    expect(retry.narrativeRef).toEqual(first.narrativeRef);
    expect(deps.generateNarrative).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite input or call models when replayed with a different text under the same operation', async () => {
    const { input, deps } = await fixture();
    expect((await runCoreTurn(input, deps)).kind).toBe('committed');
    expect(await runCoreTurn({ ...input, text: '另一段话' }, deps)).toMatchObject({ kind: 'failed', code: 'CORE2_INPUT_CHANGED' });
    expect(deps.generateNarrative).toHaveBeenCalledTimes(1);
  });
  it('stores the input before generation and returns an explicit recoverable failure without any fake body', async () => {
    const { repo, input, deps } = await fixture();
    deps.generateNarrative.mockRejectedValueOnce(Error('provider timeout'));
    expect(await runCoreTurn(input, deps)).toMatchObject({ kind: 'failed', stage: 'generation' });
    const operation = await repo.readOperation(input.scope, input.operationId);
    expect(operation?.status).toBe('draft');
    expect(operation?.sourceRefs).toHaveLength(1);
    expect(await repo.readSource(operation!.sourceRefs[0]!)).toMatchObject({ kind: 'player_input' });
    expect((await repo.readHead(input.scope)).coreSeq).toBe(0);
  });
  it('does not pass another failed turn’s body to the next prompt as established history', async () => {
    const { input, deps } = await fixture();
    await runCoreTurn(input, { ...deps, factModel: async () => ({ kind: 'failed', code: 'MODEL_EMPTY', detail: 'empty', attempts: 1 }) });
    await runCoreTurn({ ...input, operationId: 'turn-two', text: '问候' }, deps);
    const contextInput = deps.assembleContext.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(contextInput)).not.toContain('安柏把两枚苹果放入玩家背包');
  });
  it('does not report a failed database write as a committed turn and reuses the saved response on retry', async () => {
    const { repo, input, deps } = await fixture();
    vi.spyOn(repo, 'commit').mockRejectedValueOnce(Error('disk failed'));
    expect(await runCoreTurn(input, deps)).toMatchObject({ kind: 'failed', stage: 'settlement', detail: expect.stringContaining('disk failed') });
    expect((await runCoreTurn(input, deps)).kind).toBe('committed');
    expect(deps.generateNarrative).toHaveBeenCalledTimes(1);
  });
  it('does not lose a paid response if saving its operation binding fails between source and preparation', async () => {
    const { repo, input, deps } = await fixture();
    const prepare = repo.prepareOperation.bind(repo); let failed = false;
    const spy = vi.spyOn(repo, 'prepareOperation').mockImplementation(async operation => { if (operation.sourceRefs.length > 1 && !failed) { failed = true; throw Error('binding interrupted'); } return prepare(operation); });
    expect((await runCoreTurn(input, deps)).kind).toBe('failed');
    spy.mockRestore();
    expect((await runCoreTurn(input, deps)).kind).toBe('committed');
    expect(deps.generateNarrative).toHaveBeenCalledTimes(1);
  });
  it('does not promote a committed turn’s disputed narrative facts into established prompt history', async () => {
    const { input, deps } = await fixture();
    deps.generateNarrative.mockResolvedValueOnce(JSON.stringify({ body: [{ kind: 'narration', text: '玩家交给安柏十二枚苹果。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
    expect((await runCoreTurn(input, deps)).kind).toBe('pending');
    await runCoreTurn({ ...input, operationId: 'turn-next', text: '问候' }, deps);
    expect(JSON.stringify(deps.assembleContext.mock.calls.at(-1)?.[0])).not.toContain('玩家交给安柏十二枚苹果');
  });
});
