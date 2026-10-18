import { expect, it, vi } from 'vitest';
import { makeSeed } from './fixtures';
import { makeNodeRepository } from './nodeCorpusSession';
import { createCoreController } from '@/core/settlement/coreController';
import { buildCoreConsumerContext } from '@/core/retrieval/consumerContext';

it('recalls a normal narration-only turn as author reference, not as confirmed state or NPC knowledge', async () => {
  const seed = makeSeed(), repo = makeNodeRepository(`test-core2-narration-recall-${crypto.randomUUID()}`);
  const text = '云在蒙德城的门口看见一面独特的蓝色旗帜。';
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] },
    generateNarrative: vi.fn(async () => JSON.stringify({ body: [{ kind: 'narration', text }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } })),
    assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }) }) });
  await controller.initialize(seed);
  expect((await controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'narration-only', text: '看看城门' })).kind).toBe('committed');
  await controller.waitForBackground();
  const snapshot = await repo.readState(seed.head.scope);
  const author = await buildCoreConsumerContext({ snapshot, target: 'main', npcIds: [], userInput: '蓝色旗帜' }, { repo });
  expect(author.bundle.optionalText).toContain('蓝色旗帜'); expect(author.prompt).toContain('叙事记录');
  const npc = await buildCoreConsumerContext({ snapshot, target: 'private', npcIds: ['npc-amber'], userInput: '蓝色旗帜' }, { repo });
  const news = await buildCoreConsumerContext({ snapshot, target: 'news', npcIds: [], userInput: '蓝色旗帜' }, { repo });
  expect(npc.bundle.optionalText).not.toContain('蓝色旗帜'); expect(news.bundle.optionalText).not.toContain('蓝色旗帜');
  expect((await repo.queryKnowledge({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq })).items).toEqual([]);
});
