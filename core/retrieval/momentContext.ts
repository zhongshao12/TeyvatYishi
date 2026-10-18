import type { CoreSnapshot, CourierState } from '../contracts/state';
import { coreMomentAudience, selectCoreMomentPlan } from '../settlement/momentRules';
import { buildCoreConsumerContext, type ConsumerContextBundle } from './consumerContext';
import type { RecallDependencies } from './recallTypes';

export function selectCoreMomentResponders(snapshot: CoreSnapshot, postId: string, post: Extract<CourierState, { kind: 'moment' }>, previousRandomIds: readonly string[] = []): string[] {
  const available = new Set(coreMomentAudience(snapshot));
  return post.commentNpcIds ? post.commentNpcIds.filter(id => available.has(id) && post.visibilityNpcIds.includes(id)) : selectCoreMomentPlan(snapshot, postId, post, previousRandomIds).npcIds;
}
export async function buildCoreMomentRequests(input: { snapshot: CoreSnapshot; momentId: string; signal?: AbortSignal }, deps: RecallDependencies) {
  const record = input.snapshot.records.find(row => row.domain === 'courier' && row.entityId === input.momentId);
  if (record?.domain !== 'courier' || record.value.kind !== 'moment') throw Error('CORE2_MOMENT_NOT_FOUND');
  const source = (await deps.repo.querySources({ scope: input.snapshot.head.scope, cutoffSeq: input.snapshot.head.coreSeq, refs: [record.value.sourceRef] })).items[0];
  if (!source) throw Error('CORE2_MOMENT_SOURCE_MISSING');
  let text = source.blocks.filter(block => block.kind === 'message').map(block => block.text).join('\n');
  if (!text && source.kind === 'manual') {
    const command: unknown = JSON.parse(source.blocks[0]!.text);
    if (command && typeof command === 'object' && 'type' in command && command.type === 'moment' && 'text' in command && typeof command.text === 'string') text = command.text;
  }
  if (!text && !record.value.imageAssetIds.length) throw Error('CORE2_MOMENT_BODY_MISSING');
  const requests: ({ npcId: string } & ConsumerContextBundle)[] = [];
  for (const npcId of selectCoreMomentResponders(input.snapshot, input.momentId, record.value)) requests.push({ npcId, ...await buildCoreConsumerContext({ snapshot: input.snapshot,
    target: 'moment', npcIds: [npcId], conversationId: input.momentId, userInput: text || '玩家发布了图片。文字模型未见画面，不得猜测图片内容。', signal: input.signal }, deps) });
  return { requests, estimatedRequests: requests.length, displayIntervalMs: 500 };
}
