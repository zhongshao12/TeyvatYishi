import type { EventDraft, SourceRecord } from '../contracts/event';
import type { CoreSnapshot } from '../contracts/state';
import type { StateChange } from '../contracts/operation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { refKey, stableJson } from '../persistence/repositoryValidation';

/** Keep every audited fact, but publish a single before→after version for each changed record. */
export function foldCoreChanges(base: CoreSnapshot, events: EventDraft[]): { changes: StateChange[]; events: EventDraft[] } {
  const result = structuredClone(events), owners = new Map<string, { changes: StateChange[]; event: EventDraft }>();
  for (const event of result) {
    for (const change of event.committedChanges) {
      const key = refKey(change.ref), entry = owners.get(key);
      if (entry) { entry.changes.push(change); entry.event = event; }
      else owners.set(key, { changes: [change], event });
    }
    event.committedChanges = [];
  }
  const changes: StateChange[] = [];
  for (const [key, { changes: history, event }] of owners) {
    const first = history[0]!, last = history.at(-1)!;
    const before = base.records.find(record => refKey({ domain: record.domain, entityId: record.entityId, version: record.version }) === key) ?? null;
    const version = before?.version ?? base.tombstones?.find(ref => refKey(ref) === key)?.version ?? 0;
    const change: StateChange = { ref: { ...first.ref, version }, before: before ? structuredClone(before) : null,
      after: last.after ? { ...structuredClone(last.after), version: version + 1 } : null,
      effectKey: `effect-${checksumUtf8(stableJson([event.operationId, event.journeyId, event.branchId, key, history.map(row => row.effectKey)]))}` };
    changes.push(change); event.committedChanges.push(change);
  }
  return { changes, events: result };
}
export function mainTurnCompletion(base: CoreSnapshot, projected: CoreSnapshot, source: SourceRecord, ruleVersion: string): EventDraft {
  const before = projected.records.find(r => r.domain === 'world');
  if (!before || before.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
  const after = structuredClone(before); after.version++;
  after.value.completedMainTurns++;
  after.value.moment.turn = after.value.completedMainTurns;
  after.value.moment.settlementId = source.operationId;
  if (source.delivery?.worldbookEntryIds.length) after.value.worldbookTriggers = Object.fromEntries([
    ...Object.entries(after.value.worldbookTriggers ?? {}), ...source.delivery.worldbookEntryIds.map(id => [id, after.value.completedMainTurns] as const),
  ]);
  const key = checksumUtf8(stableJson([base.head.scope, source.operationId, 'turn.complete']));
  const changes: StateChange[] = [{ ref: { domain: 'world', entityId: before.entityId, version: before.version }, before, after, effectKey: `effect-turn-${key}` }];
  return { eventId: `event-turn-${key}`, journeyId: source.scope.journeyId, branchId: source.scope.branchId, operationId: source.operationId, turn: after.value.completedMainTurns,
    type: 'turn.complete', actorIds: [], targetIds: [], evidenceRefs: source.blocks.map(block => ({ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text })), occurredMoment: structuredClone(after.value.moment), ruleVersion, committedChanges: changes, visibility: { kind: 'private', npcIds: [] }, recordedAt: source.createdAt };
}
