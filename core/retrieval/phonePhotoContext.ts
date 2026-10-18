import type { CoreRepository } from '../contracts/storage';
import type { CoreSnapshot } from '../contracts/state';
import type { GameEvent } from '../contracts/event';
import { CORE_PHONE_PLAN_PREFIX, readCorePhonePlan } from '../jobs/phonePlan';
import { readCurrentCoreJobAttempt } from '../jobs/jobRunner';
import { sanitizeCourierPhotoText } from '@/services/courierPhoto';
export interface CorePhoneImageOrigin { conversationId: string; playerEventId: string; npcId: string }
export interface CorePhonePhotoBatch { playerEventId: string; userInput: string; npcIds: string[]; waiting: boolean }
async function batchFor(snapshot: CoreSnapshot, conversationId: string, anchor: GameEvent, repo: CoreRepository) {
  const player = snapshot.records.find(row => row.domain === 'traveler'), channel = snapshot.records.find(row => row.domain === 'courier' && row.entityId === conversationId);
  if (!player || channel?.domain !== 'courier' || channel.value.kind !== 'conversation' || channel.value.dissolved || anchor.actorIds.length !== 1 || anchor.actorIds[0] !== player.entityId
    || anchor.channelId !== conversationId || anchor.type !== 'communication.' + channel.value.conversationType) throw Error('CORE2_IMAGE_PHONE_ANCHOR');
  const operation = await repo.readOperation(snapshot.head.scope, anchor.operationId); if (operation?.status !== 'committed' || !operation.receipt) throw Error('CORE2_IMAGE_PHONE_ANCHOR');
  if (anchor.branchId !== snapshot.head.scope.branchId) {
    // Ancestor jobs are intentionally not executable in a restored branch. Read
    // only committed replies clipped by that branch's fork boundary instead.
    const people = new Set<string>(); let cursor: string | undefined;
    do {
      const page = await repo.queryEvents({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, afterSeq: anchor.commitSeq,
        channelIds: [conversationId], types: [anchor.type], limit: 200, ...(cursor ? { cursor } : {}) });
      for (const reply of page.items) if (reply.replyToEventId === anchor.eventId && reply.actorIds.length === 1 && anchor.targetIds.includes(reply.actorIds[0]!)) people.add(reply.actorIds[0]!);
      cursor = page.nextCursor;
    } while (cursor && people.size < anchor.targetIds.length);
    const members = channel.value.memberIds;
    const npcIds = snapshot.records.flatMap(row => row.domain === 'npc' && !row.value.archived && people.has(row.entityId) && members.includes(row.entityId) ? [row.entityId] : []).sort();
    return { playerEventId: anchor.eventId, userInput: sanitizeCourierPhotoText(anchor.evidenceRefs.map(ref => ref.quote).join('\n')), npcIds, waiting: false };
  }
  const jobs = [];
  for (let start = 0; start < operation.receipt.jobIds.length; start += 200) jobs.push(...(await repo.queryJobs({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, kinds: ['courier'], jobIds: operation.receipt.jobIds.slice(start, start + 200), limit: 200 })).items);
  let waiting = false; const eventIds: string[] = [], people = new Set<string>();
  for (const original of jobs) {
    if (!original.configFingerprint.startsWith(CORE_PHONE_PLAN_PREFIX)) continue;
    const job = await readCurrentCoreJobAttempt(repo, snapshot.head.scope, original.jobId); if (!job) throw Error('CORE2_IMAGE_PHONE_JOB_MISSING');
    const plan = readCorePhonePlan(job); if (plan.channelId !== conversationId || plan.playerEventId !== anchor.eventId) continue;
    if (job.status === 'pending' || job.status === 'running') waiting = true;
    const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === plan.npcId);
    if (npc?.domain !== 'npc' || npc.value.archived || !channel.value.memberIds.includes(plan.npcId)) continue;
    const reply = await repo.readOperation(snapshot.head.scope, plan.replyOperationId);
    if (reply?.status === 'committed' && reply.receipt && reply.receipt.coreSeq <= snapshot.head.coreSeq) { eventIds.push(...reply.receipt.eventIds); people.add(plan.npcId); }
  }
  const replies: GameEvent[] = [];
  for (let start = 0; start < eventIds.length; start += 200) replies.push(...(await repo.queryEvents({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, eventIds: eventIds.slice(start, start + 200), limit: 200 })).items);
  const npcIds = [...new Set(replies.flatMap(event => event.replyToEventId === anchor.eventId && event.channelId === conversationId && event.actorIds.length === 1 && people.has(event.actorIds[0]!) ? [event.actorIds[0]!] : []))].sort();
  return { playerEventId: anchor.eventId, userInput: sanitizeCourierPhotoText(anchor.evidenceRefs.map(ref => ref.quote).join('\n')), npcIds, waiting };
}
export async function readCorePhonePhotoBatch(snapshot: CoreSnapshot, conversationId: string, messages: readonly GameEvent[], repo: CoreRepository): Promise<CorePhonePhotoBatch | null> {
  const player = snapshot.records.find(row => row.domain === 'traveler');
  const anchor = messages.filter(event => event.actorIds[0] === player?.entityId && event.channelId === conversationId).sort((a, b) => b.commitSeq - a.commitSeq || (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0))[0];
  if (!anchor) return null;
  return batchFor(snapshot, conversationId, anchor, repo);
}
export async function validateCorePhoneImageOrigin(snapshot: CoreSnapshot, origin: CorePhoneImageOrigin, npcIds: string[], repo: CoreRepository): Promise<void> {
  const anchor = (await repo.queryEvents({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, eventIds: [origin.playerEventId], limit: 1 })).items[0];
  // The repository applies the branch ancestry and fork cutoff. A reachable
  // ancestor message is valid; requiring this branch ID would reject restored chats.
  if (!anchor || anchor.journeyId !== snapshot.head.scope.journeyId) throw Error('CORE2_IMAGE_PHONE_ANCHOR');
  const batch = await batchFor(snapshot, origin.conversationId, anchor, repo);
  if (batch.waiting || npcIds.length !== 1 || npcIds[0] !== origin.npcId || !batch.npcIds.includes(origin.npcId)) throw Error('CORE2_IMAGE_PHONE_REPLY_REQUIRED');
}
