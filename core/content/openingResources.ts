import type { JourneySeed } from '../contracts/operation';
import type { CoreStoryResources } from './storyContext';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';
import { validateCoreDto } from '../contracts/validation';

/** Freeze the selected resource before the first durable write, not after creating a half journey. */
export async function bindCoreOpeningResources(input: JourneySeed, resources?: CoreStoryResources): Promise<JourneySeed> {
  const seed = structuredClone(input), world = seed.records.find(row => row.domain === 'world'), story = seed.records.find(row => row.domain === 'story');
  if (!resources || world?.domain !== 'world' || !world.value.opening || story?.domain !== 'story' || story.value.nodeId) return seed;
  const prepared = await resources.prepare({ head: seed.head, records: seed.records, contentRefs: seed.contentRefs });
  const nodes = prepared.catalog.filter(node => node.seriesId === story.value.seriesId), first = nodes[0];
  if (!first || !seed.sources[0]) throw Error('开局所选主线资料没有有效节点，尚未建立旅程。');
  const checksum = checksumUtf8(stableJson(nodes));
  story.value = { seriesId: first.seriesId, chapterId: first.chapterId, nodeId: first.nodeId, status: 'progressing', completedNodeIds: [...first.prerequisites] };
  seed.contentRefs.push({ contentId: first.seriesId, version: 'core2-opening-' + checksum, checksum });
  seed.sources[0].blocks.push({ blockId: 'opening-story-anchor', kind: 'content', text: stableJson({ first, checksum, meaning: '玩家选择此时点作为世界背景；前置标记只用于定位主线，不代表玩家亲历、NPC知情或已领取奖励。' }) });
  if (!validateCoreDto('seed', seed).ok) throw Error('开局主线资料绑定校验失败，尚未建立旅程。');
  return seed;
}
