import type { CommitmentQuery } from '../contracts/storage';
import type { CommitmentRecord } from '../contracts/knowledge';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { isCoreJsonData } from '../contracts/validation';
import { travelDateOrdinal, worldClockMinutes } from '../contracts/worldClock';
import { ownDto, ownQuery } from './repositoryValidation';

export function ownCommitmentQuery(input: CommitmentQuery): CommitmentQuery {
  if (!isCoreJsonData(input) || !input || typeof input !== 'object') throw new Error('CORE2_INVALID_QUERY');
  const { dueAt, ...base } = input;
  const query = ownQuery(base, ['participantIds', 'statuses']);
  if (dueAt === undefined) return query;
  if (query.statuses?.some(status => !['pending', 'due', 'fulfilled', 'cancelled', 'breached'].includes(status))) throw new Error('CORE2_INVALID_QUERY');
  const moment = ownDto('worldMoment', dueAt);
  if (travelDateOrdinal(moment.date) === null || (moment.clock !== null && worldClockMinutes(moment.clock) === null)) throw new Error('CORE2_INVALID_DUE_TIME');
  return { ...query, dueAt: moment };
}

/** Read-only date trigger filtering. Location/event fulfilment belongs to M01. */
export function dateCommitmentDue(record: CommitmentRecord, moment: WorldMoment): boolean {
  if (!['pending', 'due'].includes(record.status) || record.trigger.kind !== 'date') return false;
  const targetDate = travelDateOrdinal(record.trigger.date), date = travelDateOrdinal(moment.date);
  const targetClock = record.trigger.clock === undefined ? 0 : worldClockMinutes(record.trigger.clock);
  if (targetDate === null || targetClock === null) throw new Error('CORE2_INVALID_COMMITMENT_TIME');
  if (date === null) throw new Error('CORE2_INVALID_DUE_TIME');
  if (date !== targetDate) return date > targetDate;
  if (record.trigger.clock === undefined) return true;
  const clock = worldClockMinutes(moment.clock);
  if (clock === null) throw new Error('CORE2_DUE_CLOCK_UNKNOWN');
  return clock >= targetClock;
}
