import { expect, it, vi } from 'vitest';
import { generateCoreNews } from '@/core/retrieval/newsContext';
import { recallFixture } from './recallFixture';

it('feeds the independent news model exact public ledger facts, not private text or general summaries', async () => {
  const f = await recallFixture(), snapshot = await f.repo.readState(f.seed.head.scope);
  await f.publish({ memoryId: 'secret-summary', text: 'PRIVATE_SUMMARY_SENTINEL', visibility: { kind: 'private', npcIds: ['npc-lisa'] } });
  snapshot.head = await f.repo.readHead(f.seed.head.scope);
  const generate = vi.fn().mockImplementation(async (_config, input) => [{ title: '消息', lead: '安柏送来苹果。', body: '骑士团的安柏送来苹果，旅人表示感谢。', sourceFactIds: [input.publicFacts[0].id] }]);
  const result = await generateCoreNews({ snapshot, config: { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'not-a-key', model: 'test', createdAt: 0, updatedAt: 0 } }, { repo: f.repo, generate });
  const payload = JSON.stringify(generate.mock.calls[0]![1]);
  expect(payload).not.toContain(f.batches[1]!.events[0]!.eventId); expect(payload).not.toContain('PRIVATE_SUMMARY_SENTINEL');
  expect(result.kind).toBe('generated'); expect(payload).toContain(f.batches[0]!.events[0]!.eventId);
});
