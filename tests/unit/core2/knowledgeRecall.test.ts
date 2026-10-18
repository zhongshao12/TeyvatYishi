import { expect, it } from 'vitest';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import { recallFixture } from './recallFixture';

it('degrades mixed summaries to authorized leaves and resolves actual old nested versions', async () => {
  const f = await recallFixture();
  const secret = f.batches[1]!.events[0]!.eventId, allowed = f.batches[0]!.events[0]!.eventId;
  const refs = f.batches.flatMap(row => row.sourceRefs);
  await f.publish({ memoryId: 'lower', sourceRefs: refs, eventIds: [allowed, secret], text: '安柏看过苹果，丽莎私下的秘密安排。', visibility: { kind: 'private', npcIds: ['npc-amber', 'npc-lisa'] } });
  await f.publish({ memoryId: 'upper', layer: 'long', sourceRefs: refs, eventIds: [], memoryRefs: [{ memoryId: 'lower', version: 1 }], text: '风起地 秘密安排', visibility: { kind: 'private', npcIds: ['npc-amber', 'npc-lisa'] } });
  // Editing lower must not change what upper v1 actually referred to.
  await f.publish({ memoryId: 'lower', version: 2, sourceRefs: refs, eventIds: [allowed], text: '修改后仅苹果', visibility: { kind: 'public', npcIds: [] } });
  const input = await f.request(); input.audience = { target: 'main', npcIds: ['npc-amber'] };
  const result = await retrieveCoreMemories(input, { repo: f.repo });
  expect(result.selectedLeafIds).toContain(allowed); expect(result.selectedLeafIds).not.toContain(secret);
  expect(result.optional.map(row => row.text).join('\n')).not.toContain('秘密安排');
  expect(result.diagnostics.some(row => row.reason === 'mixed_summary_degraded')).toBe(true);
  const group = await retrieveCoreMemories({ ...input, audience: { target: 'group', npcIds: ['npc-amber', 'npc-lisa'] } }, { repo: f.repo });
  expect(group.selectedLeafIds).toEqual([]);
});

it('public visibility is not omniscience and news never uses private events', async () => {
  const f = await recallFixture(), input = await f.request();
  const stranger = await retrieveCoreMemories({ ...input, audience: { target: 'private', npcIds: ['npc-stranger'] } }, { repo: f.repo });
  expect(stranger.selectedLeafIds).toEqual([]);
  const news = await retrieveCoreMemories({ ...input, audience: { target: 'news', npcIds: [] } }, { repo: f.repo });
  expect(news.selectedLeafIds).not.toContain(f.batches[1]!.events[0]!.eventId);
  expect(news.selectedLeafIds).toContain(f.batches[0]!.events[0]!.eventId);
});
