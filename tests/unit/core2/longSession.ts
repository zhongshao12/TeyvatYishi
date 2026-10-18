import os from 'node:os';
import { indexTerms, maintainCoreIndexes } from '@/core/persistence/indexMaintenance';
import { checksumBytes } from '@/core/sources/sourceIntegrity';
import type { PreparedCommit } from '@/core/contracts/operation';
import { commitCorpusTurn, type CorpusEventSpec, type CorpusSession } from './coreSessionHarness';
import { openCorpusSession } from './nodeCorpusSession';

export interface LongSessionInput {
  turns: number; eventsPerTurn?: number; npcCount?: number; images?: number;
  phoneEveryTurns?: number; momentEveryTurns?: number; querySamples?: number; skipIndex?: boolean;
}
export interface LongSessionMetrics {
  measurementScope: 'ledger-only'; endHeapMB: number; postingHits: number;
  turns: number; events: number; phoneCommits: number; momentCommits: number; images: number; imageBytes: number;
  buildMs: number; turnsPerSecond: number; readStateMs: number; firstSourceReadMs: number;
  checkpointSeq: number; recoveryCommits: number; duplicateEffects: number; committedReplaySeq: number;
  indexBuildMs: number; indexStatus: string; querySamples: number; p95PostingQueryMs: number; maxPostingQueryMs: number;
  stateBytes: number;
  device: { node: string; platform: string; cpu: string; memoryGiB: number; fakeIndexedDB: true };
}

const NPCS = ['npc-amber', 'npc-lisa', 'npc-jean', 'npc-kaeya', 'npc-barbara', 'npc-diluc'];
const LOCATIONS = ['蒙德城', '风起地', '鹰翔海滩', '千风神殿', '低语森林'];

function pad(value: number, width = 5): string {
  return String(value).padStart(width, '0');
}

/** Deterministic synthetic turn: the same seed always produces the same corpus. */
export function syntheticTurn(turn: number, input: Required<Pick<LongSessionInput, 'eventsPerTurn' | 'npcCount'>>): CorpusEventSpec[] {
  const events: CorpusEventSpec[] = [];
  for (let index = 0; index < input.eventsPerTurn; index += 1) {
    const actor = NPCS[(turn + index) % Math.max(1, input.npcCount)]!, location = LOCATIONS[(turn + index * 3) % LOCATIONS.length]!;
    events.push({
      eventId: `event-${pad(turn)}-${index}`, type: index === 0 ? 'narrative.action' : 'narrative.observe',
      actors: [actor], targets: [], text: `第${turn}回合·第${index + 1}段：${actor.slice(4)}在${location}记录了第${turn}次旅途见闻。`,
      location, visibility: { kind: 'public', npcIds: [] }, knowledge: ['witnessed'], knowledgeNpcIds: [actor],
    });
  }
  return events;
}

function percentile(samples: number[], ratio: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b), index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[index]! * 100) / 100;
}

export async function runCoreLongSession(input: LongSessionInput): Promise<LongSessionMetrics> {
  if (!Number.isSafeInteger(input.turns) || input.turns < 1) throw Error('CORE2_LONG_SESSION_TURNS_INVALID');
  const eventsPerTurn = input.eventsPerTurn ?? 5, npcCount = input.npcCount ?? 6;
  const images = input.images ?? 0, phoneEveryTurns = input.phoneEveryTurns ?? 2, momentEveryTurns = input.momentEveryTurns ?? 50;
  const querySamples = input.querySamples ?? 40, skipIndex = input.skipIndex === true;
  // This ledger-only fixture has six actors. Reject unsupported workloads rather
  // than silently claiming to have exercised a larger population.
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  if (!positive(eventsPerTurn) || !positive(npcCount) || npcCount > NPCS.length
    || !positive(phoneEveryTurns) || !positive(momentEveryTurns)
    || !Number.isSafeInteger(images) || images < 0
    || !Number.isSafeInteger(querySamples) || querySamples < (skipIndex ? 0 : 1)) {
    throw Error('CORE2_LONG_SESSION_OPTIONS_INVALID');
  }
  const session: CorpusSession = await openCorpusSession(`test-core2-long-${crypto.randomUUID()}`);
  const started = performance.now();
  let phoneCommits = 0, momentCommits = 0, lastCommit: PreparedCommit | undefined;
  for (let turn = 1; turn <= input.turns; turn += 1) {
    const events = syntheticTurn(turn, { eventsPerTurn, npcCount });
    if (turn % phoneEveryTurns === 0) {
      const npc = NPCS[turn % npcCount]!;
      events.push({ eventId: `event-${pad(turn)}-phone`, type: 'communication.private', actors: [npc], targets: [],
        text: `第${turn}回合手机：旅人与${npc.slice(4)}互道近况。`, location: '蒙德城',
        visibility: { kind: 'private', npcIds: [npc] }, knowledge: ['witnessed'], knowledgeNpcIds: [npc], channelId: `channel-${pad(turn)}` });
      phoneCommits += 1;
    }
    if (turn % momentEveryTurns === 0) {
      events.push({ eventId: `event-${pad(turn)}-moment`, type: 'moment.publish', actors: ['player'], targets: [],
        text: `第${turn}回合朋友圈：旅行者发布了第${turn}条旅途动态。`, location: '蒙德城',
        visibility: { kind: 'public', npcIds: [] }, knowledge: ['read_public'], knowledgeNpcIds: [] });
      momentCommits += 1;
    }
    const committed = await commitCorpusTurn(session, { turn, events });
    lastCommit = committed.commit;
  }
  const buildMs = Math.round(performance.now() - started);
  const head = session.head;
  // Automatic save and durable recovery position: the checkpoint must stay within 49 commits.
  const checkpoint = await session.repo.readRecoveryCheckpoint(session.scope);
  const recoveryCommits = head.coreSeq - checkpoint.coreSeq;
  // Replay of the identical operation must not duplicate effects or advance the sequence.
  const before = await session.repo.readHead(session.scope);
  if (!lastCommit) throw Error('CORE2_LONG_SESSION_EMPTY');
  const replay = await session.repo.commit(lastCommit);
  const after = await session.repo.readHead(session.scope);
  const duplicateEffects = replay.status === 'already_committed' && after.coreSeq === before.coreSeq ? 0 : 1;
  // First-source read on this connection, not a cold process/cache measurement.
  const sourceStarted = performance.now();
  const firstSource = await session.repo.readSource({ sourceId: 'source-0001', sourceVersion: 1 });
  if (!firstSource) throw Error('CORE2_LONG_SESSION_FIRST_SOURCE_MISSING');
  const firstSourceReadMs = Math.round((performance.now() - sourceStarted) * 100) / 100;
  const stateStarted = performance.now();
  const state = await session.repo.readState(session.scope);
  const readStateMs = Math.round((performance.now() - stateStarted) * 100) / 100;
  const indexStarted = performance.now();
  const receipt = skipIndex ? { status: 'published' as const } : await maintainCoreIndexes(session.repo, { scope: session.scope, sessionId: session.sessionId });
  const indexBuildMs = Math.round(performance.now() - indexStarted);
  const status = skipIndex ? { coreSeq: session.head.coreSeq, memoryRevision: session.head.memoryRevision, status: 'missing' as const, indexVersion: 0, contentVersion: undefined } : await session.repo.readIndexStatus(session.scope);
  const durations: number[] = []; let postingHits = 0;
  for (let sample = 0; sample < (skipIndex ? 0 : querySamples); sample += 1) {
    const turn = 1 + ((sample * 37) % Math.max(1, input.turns));
    const queryStarted = performance.now();
    const postings = await session.repo.queryPostings({ scope: session.scope, cutoffSeq: status.coreSeq, memoryRevision: status.memoryRevision,
      kind: 'keyword', keys: indexTerms(`第${turn}回合`), target: 'event', limit: 50 });
    postingHits += postings.items.length;
    durations.push(Math.round((performance.now() - queryStarted) * 100) / 100);
  }
  let imageBytes = 0;
  for (let index = 0; index < images; index += 1) {
    const bytes = new Uint8Array(51200).fill((index % 251) + 1);
    imageBytes += bytes.byteLength;
    await session.repo.publishAsset({ scope: session.scope, sessionId: session.sessionId, asset: {
      assetId: `asset-${pad(index)}`, scope: session.scope, mimeType: 'image/png', bytes, checksum: checksumBytes(bytes),
    } });
  }
  const memory = process.memoryUsage();
  return {
    measurementScope: 'ledger-only', endHeapMB: Math.round(memory.heapUsed / 1024 / 1024), postingHits,
    turns: input.turns, events: input.turns * eventsPerTurn + phoneCommits + momentCommits, phoneCommits, momentCommits,
    images, imageBytes, buildMs, turnsPerSecond: Math.round((input.turns / Math.max(1, buildMs)) * 1000 * 10) / 10,
    readStateMs, firstSourceReadMs, checkpointSeq: checkpoint.coreSeq, recoveryCommits, duplicateEffects,
    committedReplaySeq: after.coreSeq, indexBuildMs, indexStatus: skipIndex ? 'skipped' : receipt.status === 'published' ? `${status.status}/${status.contentVersion ?? 'none'}` : receipt.status,
    querySamples: durations.length, p95PostingQueryMs: percentile(durations, 0.95), maxPostingQueryMs: percentile(durations, 1),
    stateBytes: JSON.stringify(state.records).length,
    device: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model ?? 'unknown', memoryGiB: Math.round(os.totalmem() / 1024 ** 3), fakeIndexedDB: true },
  };
}

/** Design gates that a synthetic Node session can actually prove. */
export function longSessionGateFailures(metrics: LongSessionMetrics): string[] {
  const failures: string[] = [];
  if (metrics.recoveryCommits > 49) failures.push(`recoveryCommits=${metrics.recoveryCommits} > 49`);
  if (metrics.duplicateEffects !== 0) failures.push(`duplicateEffects=${metrics.duplicateEffects}`);
  if (metrics.committedReplaySeq !== metrics.turns) failures.push(`committedReplaySeq=${metrics.committedReplaySeq} != turns=${metrics.turns}`);
  if (metrics.firstSourceReadMs > 2_000) failures.push(`firstSourceReadMs=${metrics.firstSourceReadMs} > 2000`);
  if (metrics.indexStatus !== 'skipped' && !metrics.indexStatus.startsWith('ready')) failures.push(`indexStatus=${metrics.indexStatus}`);
  if (metrics.indexStatus !== 'skipped' && metrics.querySamples > 0 && metrics.postingHits === 0) failures.push('CORE2_POSTING_EMPTY_MEASUREMENT');
  return failures;
}
