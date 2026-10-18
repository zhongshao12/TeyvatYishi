import type { EventDraft } from '../contracts/event';
import type { CommitmentRecord } from '../contracts/knowledge';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { dateCommitmentDue } from '../persistence/commitmentDates';
import { validateCoreDto } from '../contracts/validation';
import { dateTriggerFromText } from './commitmentTriggers';
/** Full projection; V04 persists only changed versions, together with their originating events. */
export function projectCoreCommitments(events: EventDraft[], existing: CommitmentRecord[], moment: WorldMoment): CommitmentRecord[] {
  const records = new Map(existing.map(row => [row.commitmentId, structuredClone(row)]));
  const nextVersion = (id: string) => (existing.find(row => row.commitmentId === id)?.version ?? 0) + 1;
  for (const event of events) {
    if (!validateCoreDto('eventDraft', event).ok) throw Error('CORE2_COMMITMENT_EVENT_INVALID');
    const fact = event.fact;
    if (fact?.kind !== 'commitment') continue;
    const text = event.evidenceRefs.map(ref => ref.quote).join('\n');
    if (/(?:准备|打算|没有|尚未|回忆|假如).{0,16}(?:约定|承诺|履行|完成|取消)/u.test(text)) continue;
    const current = records.get(fact.commitmentId);
    if (current && (current.scope.journeyId !== event.journeyId || current.scope.branchId !== event.branchId)) throw Error('CORE2_COMMITMENT_SCOPE');
    if (current?.history.some(entry => entry.eventId === event.eventId)) continue;
    if (fact.action === 'create') {
      if (current || !/约定|承诺|答应/u.test(text)) continue;
      const trigger = fact.trigger ?? dateTriggerFromText(fact.text, event.occurredMoment);
      if (!trigger) continue;
      records.set(fact.commitmentId, { commitmentId: fact.commitmentId, scope: { journeyId: event.journeyId, branchId: event.branchId }, participantIds: [...new Set(fact.participantIds)], text: fact.text, establishedEventId: event.eventId, trigger, recurring: /每年|每月|每天|每逢/u.test(fact.text), status: 'pending', history: [{ eventId: event.eventId, status: 'pending', moment: structuredClone(event.occurredMoment) }], version: 1 });
    } else if (current && ['pending', 'due'].includes(current.status)) {
      if (fact.participantIds.length !== current.participantIds.length || !fact.participantIds.every(id => current.participantIds.includes(id))) continue;
      const status = fact.action === 'fulfill' && /履行|赴约|完成.{0,4}约定/u.test(text) ? 'fulfilled' : fact.action === 'cancel' && /取消|作废|不再履行/u.test(text) ? 'cancelled' : null;
      if (status) records.set(current.commitmentId, { ...current, status, history: [...current.history, { eventId: event.eventId, status, moment: structuredClone(event.occurredMoment) }], version: nextVersion(current.commitmentId) });
    }
  }
  for (const record of records.values()) if (record.status === 'pending') {
    const established = events.findIndex(event => event.eventId === record.establishedEventId);
    const triggerEvent = events.find((event, index) => index >= established && event.journeyId === record.scope.journeyId && event.branchId === record.scope.branchId && (
      record.trigger.kind === 'event' ? event.type === record.trigger.eventType && (!record.trigger.targetId || event.targetIds.includes(record.trigger.targetId))
        : record.trigger.kind === 'location' ? event.occurredMoment.locationId === record.trigger.locationId
          : dateCommitmentDue(record, event.occurredMoment)));
    if (triggerEvent && !record.history.some(row => row.eventId === triggerEvent.eventId && row.status === 'due')) {
      record.status = 'due'; record.version = nextVersion(record.commitmentId); record.history.push({ eventId: triggerEvent.eventId, status: 'due', moment: structuredClone(triggerEvent.occurredMoment) });
    }
  }
  if (!validateCoreDto('worldMoment', moment).ok || [...records.values()].some(record => !validateCoreDto('commitment', record).ok)) throw Error('CORE2_COMMITMENT_INVALID');
  return [...records.values()];
}
export function selectDueCommitments(records: CommitmentRecord[], moment: WorldMoment): CommitmentRecord[] {
  return records.filter(record => ['pending', 'due'].includes(record.status) && (record.trigger.kind === 'date'
    ? dateCommitmentDue(record, moment)
    : record.trigger.kind === 'location' ? record.trigger.locationId === moment.locationId : record.status === 'due')).map(record => structuredClone(record));
}
