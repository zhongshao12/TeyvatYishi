import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCoreStoryCatalog, createCoreStoryResources } from '@/core/content/storyCatalog';
import { makeSeed } from './fixtures';
import { makeCandidate } from './fixtures';
import { attachCoreStoryResources } from '@/core/content/storyContext';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { IDBFactory } from 'fake-indexeddb';
import { runCoreTurn } from '@/core/settlement/turnRunner';

const source = (id: string) => ({ id, 标题: id, 分段列表: [{ id: `${id}-chapter`, 标题: '序章', 本段概括: '初到蒙德', 场景节点: [
  { id: `${id}-arrival`, 标题: '抵达', 地点: '蒙德城', 目标: '抵达城门', 完成证据: ['抵达城门'], 开场事实: [], 完成后事实: [] },
  { id: `${id}-greeting`, 标题: '问候', 地点: '蒙德城', 目标: '与安柏问候', 完成证据: ['安柏作了自我介绍'], 开场事实: [], 完成后事实: [] },
] }] });

it('keeps stable resource IDs and explicit prerequisites without mutating canonical source', () => {
  const resource = source('mondstadt'), before = structuredClone(resource), nodes = buildCoreStoryCatalog(resource);
  expect(nodes.map(node => node.nodeId)).toEqual(['mondstadt-arrival', 'mondstadt-greeting']);
  expect(nodes[1]).toMatchObject({ seriesId: 'mondstadt', chapterId: 'mondstadt-chapter', prerequisites: ['mondstadt-arrival'], completionEvidence: ['安柏作了自我介绍'] });
  expect(resource).toEqual(before);
  const actual = JSON.parse(readFileSync('public/data/story-weaving-canon/story_canon_teyvat_mondstadt_prologue_act1.json', 'utf8'));
  expect(buildCoreStoryCatalog(actual).length).toBeGreaterThan(4);
});

it('loads only the active series and exposes an upcoming series only after current completion', async () => {
  const load = vi.fn(async (id: string) => source(id)), resources = createCoreStoryResources(['mondstadt', 'liyue', 'inazuma'], load), seed = makeSeed();
  const snapshot = { head: seed.head, records: seed.records, contentRefs: [] }, first = await resources.prepare(snapshot);
  expect(load.mock.calls.map(call => call[0])).toEqual(['mondstadt']); expect(first.nodes.map(row => row.nodeId)).toEqual(['mondstadt-arrival']);
  const story = snapshot.records.find(row => row.domain === 'story')!;
  if (story.domain !== 'story') throw Error('fixture');
  story.value = { seriesId: 'mondstadt', chapterId: 'mondstadt-chapter', nodeId: 'mondstadt-greeting', status: 'completed', completedNodeIds: ['mondstadt-arrival', 'mondstadt-greeting'] };
  const next = await resources.prepare(snapshot);
  expect(load.mock.calls.map(call => call[0])).toEqual(['mondstadt', 'liyue']); expect(next.nodes.some(row => row.nodeId === 'liyue-arrival')).toBe(true);
  expect(resources.getNodes().find(row => row.nodeId === 'liyue-arrival')?.prerequisites).toEqual(['mondstadt-greeting']);
  expect(JSON.stringify(next)).not.toContain('inazuma');
});

it('delivers the same registered story window to the narrative, variable model and settlement policy', async () => {
  const seed = makeSeed(), snapshot = { head: seed.head, records: seed.records, contentRefs: [] };
  const resources = createCoreStoryResources(['mondstadt', 'liyue'], async id => source(id));
  const factModel = vi.fn(async () => ({ kind: 'extracted' as const, candidates: [], attempts: 1 }));
  const ports = attachCoreStoryResources({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '原有规则', messages: [] }), generateNarrative: vi.fn(), factModel }, resources);
  const context = await ports.assembleContext({ snapshot, userInput: '去城门', history: [], commitments: [] });
  expect(context.systemPrompt).toContain('mondstadt-arrival'); expect(context.systemPrompt).toContain('不授予NPC知识');
  await ports.factModel!({ snapshot, source: seed.sources[0]! });
  expect(factModel).toHaveBeenCalledWith(expect.objectContaining({ storyCatalog: expect.arrayContaining([expect.objectContaining({ nodeId: 'mondstadt-arrival' })]) }));
  expect(ports.rulePolicy.storyNodes.map(row => row.nodeId)).toEqual(['mondstadt-arrival', 'mondstadt-greeting']);
});

it('restores story policy on a staged variable-only retry without regenerating body or candidates', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-story-retry-${crypto.randomUUID()}` }), seed = makeSeed(); await repo.initialize(seed);
  const narrative = vi.fn(async () => JSON.stringify({ body: [{ kind: 'narration', text: '云的主线推进到了抵达节点。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  const facts = vi.fn(async ({ source: text }: { source: import('@/core/contracts/event').SourceRecord }) => ({ kind: 'extracted' as const, attempts: 1, candidates: [makeCandidate({ scope: seed.head.scope, operationId: 'story-retry', kind: 'story', actors: [seed.playerId], targets: [], proposal: { kind: 'story', seriesId: 'mondstadt', chapterId: 'mondstadt-chapter', nodeId: 'mondstadt-arrival' }, evidenceRefs: [{ ref: text.ref, blockId: text.blocks[0]!.blockId, start: 0, end: text.blocks[0]!.text.length, quote: text.blocks[0]!.text }] })] }));
  const raw = { rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: narrative, factModel: facts };
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'story-retry', text: '出发' };
  const commit = vi.spyOn(repo, 'commit').mockRejectedValueOnce(Error('TEST_BEFORE_COMMIT'));
  expect((await runCoreTurn(input, { repo, ...attachCoreStoryResources(raw, createCoreStoryResources(['mondstadt'], async id => source(id))) })).kind).toBe('failed');
  expect(commit).toHaveBeenCalledTimes(1);
  const load = vi.fn(async (id: string) => source(id));
  const retry = await runCoreTurn(input, { repo, ...attachCoreStoryResources(raw, createCoreStoryResources(['mondstadt'], load)) });
  expect(retry.kind, JSON.stringify(retry)).toBe('committed');
  expect(load).toHaveBeenCalledWith('mondstadt'); expect(narrative).toHaveBeenCalledTimes(1); expect(facts).toHaveBeenCalledTimes(1);
  expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'story')?.value).toMatchObject({ nodeId: 'mondstadt-arrival', status: 'progressing' });
});
