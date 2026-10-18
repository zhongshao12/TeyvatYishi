import type { CoreSnapshot } from '../contracts/state';
import type { EventDraft, FactCandidate, GameEvent, SourceRecord } from '../contracts/event';
import type { CoreRepository } from '../contracts/storage';
import type { KnowledgeRecord } from '../contracts/knowledge';
import type { RecordRef, SourceRef } from '../contracts/identity';
import { stableJson, sameData } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { courierExchangeAffinity } from '@/utils/courierAffinity';
import { sanitizeCourierMessageText } from '@/utils/courierTextSanitizer';
import { 格式化NPC关系, 限制NPC好感度 } from '@/models/npc';
import { planCoreProactiveContact, type CoreProactivePlan } from './proactiveContact';
import type { CorePhoneResponsePlan } from '../jobs/phonePlan';
import { coreMomentAudience } from './momentRules';

export interface CoreInteractionDescriptor { target: 'private' | 'group' | 'moment'; channelId: string; recipientIds: string[]; proactive?: CoreProactivePlan; replyToEventId?: string; responsePlan?: CorePhoneResponsePlan; momentSourceRef?: SourceRef; momentVersion?: number }
export function coreDeliveryDescriptor(input: CoreInteractionDescriptor): CoreInteractionDescriptor {
  return { target: input.target, channelId: input.channelId, recipientIds: [...input.recipientIds], ...(input.proactive ? { proactive: structuredClone(input.proactive) } : {}), ...(input.replyToEventId ? { replyToEventId: input.replyToEventId } : {}), ...(input.responsePlan ? { responsePlan: structuredClone(input.responsePlan) } : {}), ...(input.momentSourceRef ? { momentSourceRef: structuredClone(input.momentSourceRef), momentVersion: input.momentVersion } : {}) };
}
export async function readCoreReplyAnchor(repo: CoreRepository, snapshot: CoreSnapshot, descriptor: CoreInteractionDescriptor): Promise<GameEvent | undefined> {
  if (!descriptor.replyToEventId) return undefined;
  const event = (await repo.queryEvents({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, eventIds: [descriptor.replyToEventId], limit: 1 })).items[0];
  const player = snapshot.records.find(row => row.domain === 'traveler');
  if (!event || !player || event.type !== `communication.${descriptor.target}` || event.channelId !== descriptor.channelId || event.actorIds.length !== 1 || event.actorIds[0] !== player.entityId
    || !descriptor.recipientIds.every(id => event.targetIds.includes(id)) || descriptor.proactive) throw Error('CORE2_REPLY_ANCHOR');
  return event;
}
export function assertCoreDeliverySource(source: SourceRecord | undefined, descriptor: CoreInteractionDescriptor, message: SourceRecord): void {
  if (!source || source.kind !== 'manual' || source.operationId !== message.operationId || !sameData(source.scope, message.scope) || source.blocks.length !== 1
    || source.blocks[0]!.kind !== 'configuration' || source.blocks[0]!.text !== stableJson(coreDeliveryDescriptor(descriptor))) throw Error('CORE2_INTERACTION_REPLAY_MISMATCH');
}
export function projectCoreInteraction(snapshot: CoreSnapshot, source: SourceRecord, descriptor: CoreInteractionDescriptor, ruleVersion: string, replyTo?: GameEvent, momentOrigin?: SourceRecord) {
  const player = snapshot.records.find(row => row.domain === 'traveler'), world = snapshot.records.find(row => row.domain === 'world');
  if (player?.domain !== 'traveler' || world?.domain !== 'world') throw Error('CORE2_INTERACTION_STATE');
  if (!['private', 'group', 'moment'].includes(descriptor.target) || source.kind !== (descriptor.target === 'moment' ? 'moment' : 'courier')
    || source.blocks.some(block => block.kind !== 'message' || !block.speakerId || !block.text.trim() || sanitizeCourierMessageText(block.text) !== block.text.trim())) throw Error('CORE2_INTERACTION_SOURCE');
  const withoutIdentity = (value: typeof source.moment) => { const { settlementId: _id, ...rest } = value; return rest; };
  if (descriptor.replyToEventId && (!replyTo || replyTo.eventId !== descriptor.replyToEventId || source.blocks.length !== 1 || source.blocks[0]!.speakerId === player.entityId)) throw Error('CORE2_REPLY_ANCHOR');
  if (descriptor.momentSourceRef && (descriptor.target !== 'moment' || !momentOrigin || !sameData(momentOrigin.ref, descriptor.momentSourceRef))) throw Error('CORE2_MOMENT_REVISION_CHANGED');
  const reservedMoment = descriptor.proactive && world.value.proactivePending?.operationId === descriptor.proactive.operationId ? world.value.proactivePending.moment : undefined;
  if (!sameData(withoutIdentity(source.moment), withoutIdentity(reservedMoment ?? momentOrigin?.moment ?? replyTo?.occurredMoment ?? world.value.moment))) throw Error('CORE2_INTERACTION_WORLD_TIME');
  const channel = snapshot.records.find(row => row.domain === 'courier' && row.entityId === descriptor.channelId);
  const ids = [...new Set(descriptor.recipientIds)];
  const people = snapshot.records.filter(row => row.domain === 'npc' && ids.includes(row.entityId));
  if (channel?.domain !== 'courier' || !ids.length || ids.length !== descriptor.recipientIds.length || people.length !== ids.length) throw Error('CORE2_INTERACTION_CHANNEL');
  if (descriptor.target === 'moment') {
    if (channel.value.kind !== 'moment' || !ids.every(id => channel.value.kind === 'moment' && channel.value.visibilityNpcIds.includes(id))) throw Error('CORE2_INTERACTION_CHANNEL');
    if (descriptor.momentSourceRef && (channel.version !== descriptor.momentVersion || !sameData(channel.value.sourceRef, descriptor.momentSourceRef)
      || !ids.every(id => coreMomentAudience(snapshot).includes(id)) || source.blocks.some(block => channel.value.kind !== 'moment' || !channel.value.commentNpcIds?.includes(block.speakerId!)))) throw Error('CORE2_MOMENT_COMMENT_UNAVAILABLE');
  } else if (channel.value.kind !== 'conversation' || channel.value.dissolved || channel.value.conversationType !== descriptor.target
    || ids.length !== channel.value.memberIds.length || !ids.every(id => channel.value.kind === 'conversation' && channel.value.memberIds.includes(id))) throw Error('CORE2_INTERACTION_CHANNEL');
  const contacts = snapshot.records.filter(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.available && ids.includes(row.value.npcId));
  if (descriptor.target === 'private' && !ids.every(id => contacts.some(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === id))) throw Error('CORE2_INTERACTION_CONTACT_UNAVAILABLE');
  if (source.blocks.some(block => block.speakerId !== player.entityId && !ids.includes(block.speakerId!))) throw Error('CORE2_INTERACTION_CHANNEL');
  if (descriptor.responsePlan && (descriptor.target === 'moment' || descriptor.replyToEventId || descriptor.proactive || source.blocks.length !== 1 || source.blocks[0]!.speakerId !== player.entityId
    || !descriptor.responsePlan.npcIds.length || new Set(descriptor.responsePlan.npcIds).size !== descriptor.responsePlan.npcIds.length || !descriptor.responsePlan.npcIds.every(id => ids.includes(id)))) throw Error('CORE2_PHONE_RESPONSE_PLAN');
  const availability = descriptor.target === 'moment' ? snapshot.records.filter(row => row.domain === 'courier' && row.value.kind === 'contact' && ids.includes(row.value.npcId)) : [];
  const readSet: RecordRef[] = [player, world, channel, ...people, ...contacts, ...availability].map(row => ({ domain: row.domain, entityId: row.entityId, version: row.version }));
  const deliveredMoment = { ...world.value.moment, settlementId: source.operationId };
  const events: EventDraft[] = source.blocks.map((block, sourceOrder) => {
    const eventId = `event-message-${checksumUtf8(stableJson(replyTo ? [source.scope, replyTo.eventId, block.speakerId] : [source.scope, source.operationId, source.ref, block.blockId]))}`;
    return { eventId, journeyId: source.scope.journeyId, branchId: source.scope.branchId, operationId: source.operationId, turn: deliveredMoment.turn,
      type: `communication.${descriptor.target}`, channelId: descriptor.channelId, sourceOrder, actorIds: [block.speakerId!], targetIds: ids, evidenceRefs: [{ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text }],
      occurredMoment: deliveredMoment, ruleVersion, committedChanges: [], visibility: { kind: 'participants', npcIds: ids }, recordedAt: source.createdAt, ...(replyTo ? { replyToEventId: replyTo.eventId } : {}) };
  });
  const knowledge: KnowledgeRecord[] = events.flatMap(event => ids.map(npcId => ({ knowledgeId: `knowledge-message-${checksumUtf8(stableJson([source.scope, event.eventId, npcId]))}`,
    scope: source.scope, npcId, eventId: event.eventId, mode: 'told', channelId: descriptor.channelId, informantId: event.actorIds[0]!,
    evidenceRefs: event.evidenceRefs, learnedMoment: deliveredMoment, nature: 'fact', version: 1 })));
  const incoming = events.filter(event => event.actorIds[0] !== player.entityId);
  if (channel.value.kind === 'conversation' && incoming.length) {
    const after = structuredClone(channel); if (after.value.kind !== 'conversation') throw Error('CORE2_INTERACTION_CHANNEL');
    after.version++; after.value.unreadCount += incoming.length;
    incoming[0]!.committedChanges.push({ ref: { domain: 'courier', entityId: channel.entityId, version: channel.version }, before: channel, after,
      effectKey: `effect-unread-${checksumUtf8(stableJson([source.scope, source.operationId, channel.entityId]))}` });
  }
  // Reuse the existing phone rule, not physical-intimacy text scanning or model-proposed amounts.
  const playerText = replyTo ? replyTo.evidenceRefs.map(ref => ref.quote).join('\n') : source.blocks.filter(block => block.speakerId === player.entityId).map(block => block.text).join('\n');
  const delta = descriptor.target === 'moment' ? 0 : courierExchangeAffinity(playerText), replied = new Set(source.blocks.map(block => block.speakerId));
  for (const npc of people) if (npc.domain === 'npc' && replied.has(npc.entityId) && delta) {
    const after = structuredClone(npc); after.version++;
    after.value.affinity = 限制NPC好感度(npc.value.affinity + delta); after.value.relationship = 格式化NPC关系(after.value.affinity, after.value.intimate);
    const event = events.find(row => row.actorIds.includes(npc.entityId))!;
    event.committedChanges.push({ ref: { domain: 'npc', entityId: npc.entityId, version: npc.version }, before: npc, after,
      effectKey: `effect-phone-${checksumUtf8(stableJson([source.scope, source.operationId, npc.entityId]))}` });
  }
  if (descriptor.proactive) {
    const reserved = world.value.proactivePending;
    const planned = reserved ? { npcId: reserved.npcId, contactId: reserved.contactId, operationId: reserved.operationId, atTurn: reserved.atTurn, previousTurn: reserved.previousTurn } : planCoreProactiveContact(snapshot);
    if (!planned || reserved && reserved.originBranchId !== snapshot.head.scope.branchId || !sameData(planned, descriptor.proactive) || source.operationId !== planned.operationId || ids.length !== 1 || ids[0] !== planned.npcId
      || source.blocks.some(block => block.speakerId !== planned.npcId) || world.value.proactiveLastTurn !== planned.previousTurn
      || world.value.completedMainTurns < planned.atTurn || !people.some(row => row.domain === 'npc' && row.entityId === planned.npcId && !row.value.archived && row.value.affinity >= 100)) throw Error('CORE2_PROACTIVE_INELIGIBLE');
    const after = structuredClone(world); after.version++; after.value.proactiveLastTurn = world.value.completedMainTurns; delete after.value.proactivePending;
    events[0]!.committedChanges.push({ ref: { domain: 'world', entityId: world.entityId, version: world.version }, before: world, after, effectKey: `effect-${planned.operationId}` });
    const contact = snapshot.records.find(row => row.domain === 'courier' && row.entityId === planned.contactId)!;
    readSet.push({ domain: contact.domain, entityId: contact.entityId, version: contact.version });
  }
  return { events, knowledge, readSet };
}

/** A speaker knows having said their line; the line's claims are not objective facts. */
export function projectCoreDialogue(snapshot: CoreSnapshot, sources: SourceRecord[], ruleVersion: string): { events: EventDraft[]; knowledge: KnowledgeRecord[] } {
  const events: EventDraft[] = [], knowledge: KnowledgeRecord[] = [];
  for (const source of sources) if (source.kind === 'narrative') for (const block of source.blocks) {
    if (block.kind !== 'dialogue' || !block.speakerId || !snapshot.records.some(row => row.domain === 'npc' && row.entityId === block.speakerId)) continue;
    const eventId = `event-speech-${checksumUtf8(stableJson([source.scope, source.operationId, source.ref, block.blockId]))}`;
    const event: EventDraft = { eventId, journeyId: source.scope.journeyId, branchId: source.scope.branchId, operationId: source.operationId, turn: source.moment.turn, type: 'communication.speech', actorIds: [block.speakerId], targetIds: [],
      evidenceRefs: [{ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text }], occurredMoment: source.moment, ruleVersion, committedChanges: [], visibility: { kind: 'private', npcIds: [block.speakerId] }, recordedAt: source.createdAt };
    events.push(event); knowledge.push({ knowledgeId: `knowledge-${eventId}`, scope: source.scope, npcId: block.speakerId, eventId, mode: 'witnessed', evidenceRefs: event.evidenceRefs, learnedMoment: source.moment, nature: 'fact', version: 1 });
  }
  return { events, knowledge };
}

/** An author transcript, never a world-state assertion or a grant of NPC knowledge. */
export function projectCoreNarration(sources: SourceRecord[], candidates: FactCandidate[], ruleVersion: string): EventDraft[] {
  const referenced = new Set(candidates.flatMap(candidate => candidate.evidenceRefs.map(ref => stableJson([ref.ref, ref.blockId]))));
  const events: EventDraft[] = [];
  for (const source of sources) if (source.kind === 'narrative') for (const block of source.blocks) {
    if (block.kind !== 'narration' || referenced.has(stableJson([source.ref, block.blockId])) || /<(?:char_seven|time_format|变量事实)(?:\s|>)/iu.test(block.text)) continue;
    events.push({ eventId: `event-narration-${checksumUtf8(stableJson([source.scope, source.operationId, source.ref, block.blockId]))}`,
      journeyId: source.scope.journeyId, branchId: source.scope.branchId, operationId: source.operationId, turn: source.moment.turn,
      type: 'narration.recorded', actorIds: [], targetIds: [], evidenceRefs: [{ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text }],
      occurredMoment: source.moment, ruleVersion, committedChanges: [], visibility: { kind: 'private', npcIds: [] }, recordedAt: source.createdAt });
  }
  return events;
}
