import type { CoreSnapshot, CourierState } from '../contracts/state';
import { MOMENT_FRIEND_AFFINITY_MIN, selectMomentFriendIds } from '@/utils/momentCommentSelection';
import type { CoreScope, SourceRef } from '../contracts/identity';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';

export type CoreMoment = Extract<CourierState, { kind: 'moment' }>;
export function coreMomentReplyIdentity(scope: CoreScope, postId: string, ref: SourceRef, npcId: string) {
  const key = checksumUtf8(stableJson([scope, postId, ref, npcId]));
  return { npcId, jobId: `moment-job-${key}`, operationId: `moment-reply-${key}`, sourceId: `moment-output-${key}` };
}
/** Reading a catalogue entry alone never makes somebody a friend or an audience. */
export function coreMomentAudience(snapshot: CoreSnapshot): string[] {
  return snapshot.records.flatMap(row => {
    if (row.domain !== 'npc' || row.value.archived) return [];
    const contacts = snapshot.records.filter(contact => contact.domain === 'courier' && contact.value.kind === 'contact' && contact.value.npcId === row.entityId);
    return contacts.some(contact => contact.domain === 'courier' && contact.value.kind === 'contact' && contact.value.available)
      || !contacts.length && row.value.travelingTogether ? [row.entityId] : [];
  });
}
export function selectCoreMomentPlan(snapshot: CoreSnapshot, seed: string, post: CoreMoment, previousRandomIds: readonly string[] = []) {
  const available = new Set(coreMomentAudience(snapshot)), visible = new Set(post.visibilityNpcIds);
  const mentions = post.mentionedNpcIds.filter(id => available.has(id) && visible.has(id));
  const team = snapshot.records.flatMap(row => row.domain === 'npc' && row.value.travelingTogether && available.has(row.entityId) && visible.has(row.entityId) ? [row.entityId] : []);
  const required = [...new Set([...mentions, ...team])];
  const friends = snapshot.records.flatMap(row => row.domain === 'npc' && available.has(row.entityId) && visible.has(row.entityId) && !required.includes(row.entityId)
    && row.value.affinity >= MOMENT_FRIEND_AFFINITY_MIN ? [row.entityId] : []);
  const randomNpcIds = selectMomentFriendIds(friends, seed, previousRandomIds);
  return { npcIds: [...required, ...randomNpcIds], randomNpcIds };
}
