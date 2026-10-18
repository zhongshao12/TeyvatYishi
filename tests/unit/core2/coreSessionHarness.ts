import type { CoreRepository } from '@/core/contracts/storage';
import type { BranchHead, CoreScope } from '@/core/contracts/identity';
import type { GameEvent, SourceBlock, SourceRecord } from '@/core/contracts/event';
import type { JourneySeed, PreparedCommit } from '@/core/contracts/operation';
import type { KnowledgeRecord } from '@/core/contracts/knowledge';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { makeSeed } from './fixtures';

/** Deterministic world moment: the synthetic corpus never reads the wall clock. */
export function corpusMoment(turn: number, settlementId: string, location = '蒙德城', clock = '10:00'): WorldMoment {
  return { worldName: '提瓦特', date: '旅行历 1000.03.07', clock, weather: '晴', location, travelDay: turn, turn, settlementId };
}

export interface CorpusEventSpec {
  eventId: string; type: string; actors: string[]; targets: string[]; text: string;
  location: string; visibility: GameEvent['visibility']; knowledge: KnowledgeRecord['mode'][];
  knowledgeNpcIds: string[]; channelId?: string; occurredMoment?: WorldMoment;
}

export interface CorpusTurn {
  turn: number; events: CorpusEventSpec[]; moment?: WorldMoment;
}

export interface CorpusSession {
  repo: CoreRepository; seed: JourneySeed; scope: CoreScope; sessionId: string; head: BranchHead;
  committedTurns: number; databaseName: string;
}

/** Builds the session wrapper around an already-opened repository (Node or browser). */
export function createCorpusSession(repo: CoreRepository, seed: JourneySeed = makeSeed(), databaseName = 'test-core2-corpus'): CorpusSession {
  return { repo, seed, scope: seed.head.scope, sessionId: seed.head.sessionId, head: seed.head, committedTurns: 0, databaseName };
}

function pad(value: number, width = 4): string {
  return String(value).padStart(width, '0');
}

/** One committed main turn: immutable source blocks in, one transaction, real receipt. */
export async function commitCorpusTurn(session: CorpusSession, turn: CorpusTurn): Promise<{ commit: PreparedCommit }> {
  const { repo, scope, sessionId } = session;
  const operationId = `op-${pad(turn.turn)}`;
  const blocks: SourceBlock[] = turn.events.map((event, index) => ({
    blockId: `block-${index}`, kind: 'narration', text: event.text,
  }));
  const source: SourceRecord = {
    ref: { sourceId: `source-${pad(turn.turn)}`, sourceVersion: 1 },
    scope, operationId, kind: 'narrative', blocks, moment: turn.moment ?? corpusMoment(turn.turn, operationId), createdAt: turn.turn,
  };
  await repo.putSource(source);
  await repo.prepareOperation({ scope, operationId, kind: 'main', status: 'prepared', sourceRefs: [source.ref], readSet: [], candidateRefs: [], effects: [], attempts: 1 });
  await repo.stageOperation({ scope, sessionId, operationId, sourceRefs: [source.ref], candidates: [], review: [], stageVersion: 1 });
  const knowledge: KnowledgeRecord[] = [];
  const events = turn.events.map((spec, index) => {
    const evidenceRefs = [{ ref: source.ref, blockId: `block-${index}`, start: 0, end: spec.text.length, quote: spec.text }];
    const moment = spec.occurredMoment ?? corpusMoment(turn.turn, operationId, spec.location);
    spec.knowledgeNpcIds.forEach((npcId, order) => spec.knowledge.forEach((mode, modeOrder) => {
      knowledge.push({
        knowledgeId: `knowledge-${pad(turn.turn)}-${index}-${npcId}-${order}${modeOrder}`, scope, npcId, eventId: spec.eventId,
        mode, evidenceRefs, learnedMoment: moment, nature: 'fact', version: 1,
      });
    }));
    return {
      eventId: spec.eventId, journeyId: scope.journeyId, branchId: scope.branchId, operationId,
      turn: turn.turn, type: spec.type, actorIds: spec.actors, targetIds: spec.targets, evidenceRefs,
      occurredMoment: moment, ruleVersion: 'core2-v1', committedChanges: [], visibility: spec.visibility,
      recordedAt: turn.turn, ...(spec.channelId ? { channelId: spec.channelId } : {}),
    } satisfies Omit<GameEvent, 'commitSeq'>;
  });
  const prepared: PreparedCommit = { scope, sessionId, operationId, readSet: [], sourceRefs: [source.ref], changes: [], events, knowledge, commitments: [], jobs: [] };
  const receipt = await repo.commit(prepared);
  if (receipt.status !== 'committed') throw Error(`CORE2_CORPUS_COMMIT_${receipt.status.toUpperCase()}`);
  // The receipt carries the committed position; no extra read per turn keeps the corpus linear.
  session.head = { ...session.head, coreSeq: receipt.coreSeq };
  session.committedTurns = turn.turn;
  return { commit: prepared };
}
