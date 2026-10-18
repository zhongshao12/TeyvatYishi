import { describe, expect, it } from 'vitest';
import type { FactProposal } from '@/core/contracts/state';
import type { EventDraft } from '@/core/contracts/event';
import type { CommitmentRecord } from '@/core/contracts/knowledge';
import { projectCoreCommitments, selectDueCommitments } from '@/core/knowledge/commitments';
import { makeCommit, makeSeed, fixtureMoment } from './fixtures';

function event(action: 'create' | 'fulfill' | 'cancel', text: string, id = 'event-promise'): EventDraft & { fact: FactProposal } {
  const seed = makeSeed(); const base = makeCommit(seed.head).events[0]!;
  return { ...base, committedChanges: [], eventId: id, type: `commitment.${action}`, targetIds: ['promise-1', 'npc-amber'], actorIds: [seed.playerId, 'npc-amber'], fact: { kind: 'commitment', action, commitmentId: 'promise-1', text, participantIds: [seed.playerId, 'npc-amber'] }, evidenceRefs: [{ ...base.evidenceRefs[0]!, quote: text, end: text.length }], occurredMoment: { ...fixtureMoment, turn: action === 'create' ? 80 : 650 } };
}
describe('core2 promises across hundreds of turns', () => {
  it('keeps a turn-80 promise until its actual date at turn 650, without automatically fulfilling it', () => {
    const formed = event('create', '玩家与安柏约定在旅行历 1000.10.01 的10:00一起旅行。');
    const records = projectCoreCommitments([formed], [], formed.occurredMoment);
    expect(records).toMatchObject([{ commitmentId: 'promise-1', status: 'pending', recurring: false, trigger: { kind: 'date', date: '旅行历 1000.10.01', clock: '10:00' } }]);
    expect(selectDueCommitments(records, { ...fixtureMoment, turn: 649, date: '旅行历 1000.09.31', clock: '23:59' })).toEqual([]);
    expect(selectDueCommitments(records, { ...fixtureMoment, turn: 650, date: '旅行历 1000.10.01', clock: '10:00' })).toHaveLength(1);
    expect(records[0]?.status).toBe('pending');
  });
  it('does not re-trigger completed or cancelled promises and is idempotent when an event is replayed', () => {
    const formed = event('create', '玩家与安柏约定明天一起旅行。');
    const created = projectCoreCommitments([formed], [], formed.occurredMoment);
    const fulfilled = event('fulfill', '玩家与安柏履行了约定，一起旅行。', 'event-fulfilled'); fulfilled.journeyId = formed.journeyId; fulfilled.branchId = formed.branchId; if (fulfilled.fact.kind === 'commitment') fulfilled.fact.participantIds = created[0]!.participantIds;
    const done = projectCoreCommitments([fulfilled], created, fulfilled.occurredMoment);
    expect(done[0]?.status).toBe('fulfilled');
    expect(selectDueCommitments(done, { ...fixtureMoment, date: '旅行历 1000.12.01' })).toEqual([]);
    expect(projectCoreCommitments([fulfilled], done, fulfilled.occurredMoment)).toEqual(done);
    const cancelled: CommitmentRecord[] = done.map(record => ({ ...record, status: 'cancelled' }));
    expect(selectDueCommitments(cancelled, { ...fixtureMoment, date: '旅行历 1000.12.01' })).toEqual([]);
  });
  it('does not invent an unknown deadline or fulfill a promise from a plan to fulfill it', () => {
    const formed = event('create', '安柏与玩家约定以后一起旅行。');
    expect(projectCoreCommitments([formed], [], fixtureMoment)).toEqual([]);
    const definite = event('create', '玩家与安柏约定明天一起旅行。');
    const records = projectCoreCommitments([definite], [], fixtureMoment);
    const planned = event('fulfill', '玩家准备与安柏履行约定。'); planned.journeyId = definite.journeyId; planned.branchId = definite.branchId;
    expect(projectCoreCommitments([planned], records, fixtureMoment)).toEqual(records);
  });
  it('tracks location and event conditions by stable identifiers and marks due without fulfilling', () => {
    const formed = event('create', '安柏与玩家约定抵达蒙德城后见面。');
    Object.assign(formed.fact, { trigger: { kind: 'location', locationId: 'mondstadt-city' } });
    const records = projectCoreCommitments([formed], [], fixtureMoment);
    expect(records).toHaveLength(1);
    expect(selectDueCommitments(records, { ...fixtureMoment, location: '同名但不同地点', locationId: 'somewhere-else' })).toEqual([]);
    expect(selectDueCommitments(records, { ...fixtureMoment, locationId: 'mondstadt-city' })).toHaveLength(1);
    const condition = event('create', '安柏与玩家约定任务完成后见面。');
    Object.assign(condition.fact, { trigger: { kind: 'event', eventType: 'quest.complete', targetId: 'quest-1' } });
    const pending = projectCoreCommitments([condition], [], fixtureMoment);
    const completed = { ...condition, eventId: 'quest-completed', type: 'quest.complete', targetIds: ['quest-1'], fact: { kind: 'quest' as const, questId: 'quest-1', action: 'complete' as const } };
    const due = projectCoreCommitments([completed], pending, fixtureMoment);
    expect(due[0]?.status).toBe('due');
    expect(due[0]?.history.at(-1)?.eventId).toBe('quest-completed');
  });
});
