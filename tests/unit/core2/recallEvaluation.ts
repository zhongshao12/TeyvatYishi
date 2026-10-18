import os from 'node:os';
import recallCases from '@/tests/fixtures/core2/recall-cases.json';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import { CORE_RECALL_RANKING_VERSION } from '@/core/retrieval/rankCandidates';
import type { Audience } from '@/core/contracts/knowledge';
import { commitCorpusTurn, corpusMoment, type CorpusSession } from './coreSessionHarness';
import { openCorpusSession } from './nodeCorpusSession';

export type RecallSplit = 'tuning' | 'holdout';
export interface RecallCaseTarget { turn: number; slot: number }
export interface RecallCase {
  id: string; split: RecallSplit; expect: 'relevant' | 'unauthorized';
  audience: Audience; entityIds: string[]; locations: string[]; query: string;
  momentTurn: number; targets: RecallCaseTarget[];
}
export interface RecallCaseFile {
  kind: string; formatVersion: number;
  corpus: { turns: number; slots: { slot: number; actor: string; location: string }[] };
  queries: RecallCase[];
}
export interface RecallMetrics {
  corpusTurns: number; eventCount: number; caseCount: number;
  backend: 'fake-indexeddb'; executedCases: number; executedPositives: number; executedNegatives: number; datasetFailures: string[];
  positives: number; negatives: number; tuning: number; holdout: number; skippedCases: number;
  optionalRecallAt8: number; tuningRecallAt8: number; holdoutRecallAt8: number;
  unauthorizedSelectedLeafCount: number;
  missingTargetCount: number; unresolvableImportantSources: number; duplicateSelectedLeaves: number;
  indexColdStartMs: number; querySamples: number; p95StructuredQueryMs: number; maxStructuredQueryMs: number;
  rankingVersion: string; device: { node: string; platform: string; arch: string; cpu: string; memoryGiB: number };
  failures: { id: string; split: RecallSplit; expected: string[]; selected: string[]; recall: number }[];
}

/** Audit the supplied labels without changing them or tuning the ranking. */
export function auditRecallDataset(file: RecallCaseFile) {
  const targets = (split: RecallSplit) => new Set(file.queries.filter(row => row.split === split).flatMap(row => row.targets.map(target => `${target.turn}:${target.slot}`)));
  const tuning = targets('tuning'), holdout = targets('holdout');
  const overlappingTargetEvents = [...tuning].filter(key => holdout.has(key)).sort();
  const slots = (split: RecallSplit) => new Set(file.queries.filter(row => row.split === split).flatMap(row => row.targets.map(target => target.slot)));
  const tuningSlots = slots('tuning'), holdoutSlots = slots('holdout');
  const overlappingScenarioSlots = [...tuningSlots].filter(slot => holdoutSlots.has(slot)).sort();
  const failures: string[] = [];
  if (overlappingTargetEvents.length) failures.push('CORE2_RECALL_SPLITS_OVERLAP');
  if (overlappingScenarioSlots.length) failures.push('CORE2_RECALL_SCENARIOS_OVERLAP');
  if (new Set(file.queries.map(row => row.id)).size !== file.queries.length) failures.push('CORE2_RECALL_DUPLICATE_CASE_ID');
  return { overlappingTargetEvents, overlappingScenarioSlots, failures };
}

export function loadRecallCases(): RecallCaseFile {
  const file = recallCases as unknown as RecallCaseFile;
  if (file.kind !== 'teyvat-core2-recall-cases' || file.formatVersion !== 1) throw Error('CORE2_RECALL_CASES_INVALID');
  if (!Array.isArray(file.queries) || file.queries.length === 0) throw Error('CORE2_RECALL_CASES_EMPTY');
  const splits = new Set(file.queries.map(row => row.split));
  if (splits.size !== 2) throw Error('CORE2_RECALL_CASES_SPLIT_INVALID');
  return file;
}

/** The corpus generator and the committed case file share these templates. */
export function corpusEventText(slot: number, turn: number): string {
  if (slot === 0) return `第${turn}回合：安柏在蒙德城把第${turn}枚苹果递给旅人。`;
  if (slot === 1) return `第${turn}回合：丽莎在蒙德城图书馆研究禁书目录第${turn}页。`;
  if (slot === 2) return `第${turn}回合：琴在蒙德城骑士团推进第${turn}次巡查。`;
  if (slot === 3) return `第${turn}回合：凯亚在风起地记录第${turn}次巡逻路线。`;
  throw Error(`CORE2_RECALL_SLOT_UNKNOWN: ${slot}`);
}

export function corpusEventId(turn: number, slot: number): string {
  return `event-${String(turn).padStart(4, '0')}-${slot}`;
}

const SLOT_SEMANTICS = [
  { slot: 0, actor: 'npc-amber', type: 'inventory.gain', location: '蒙德城', visibility: { kind: 'public' as const, npcIds: [] } },
  { slot: 1, actor: 'npc-lisa', type: 'communication.private', location: '蒙德城图书馆', visibility: { kind: 'private' as const, npcIds: ['npc-lisa'] } },
  { slot: 2, actor: 'npc-jean', type: 'quest.progress', location: '蒙德城', visibility: { kind: 'public' as const, npcIds: [] } },
  { slot: 3, actor: 'npc-kaeya', type: 'explore', location: '风起地', visibility: { kind: 'public' as const, npcIds: [] } },
];

export async function buildRecallCorpus(turns: number): Promise<{ session: CorpusSession; knowledge: Map<string, Set<string>> }> {
  const session = await openCorpusSession(`test-core2-recall-eval-${crypto.randomUUID()}`);
  const knowledge = new Map<string, Set<string>>();
  for (let turn = 1; turn <= turns; turn += 1) {
    const events = SLOT_SEMANTICS.map(spec => ({
      eventId: corpusEventId(turn, spec.slot), type: spec.type, actors: [spec.actor], targets: [], text: corpusEventText(spec.slot, turn),
      location: spec.location, visibility: spec.visibility, knowledge: ['witnessed' as const], knowledgeNpcIds: [spec.actor],
    }));
    for (const spec of SLOT_SEMANTICS) knowledge.set(corpusEventId(turn, spec.slot), new Set([spec.actor]));
    await commitCorpusTurn(session, { turn, events });
  }
  return { session, knowledge };
}

function percentile(samples: number[], ratio: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b), index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[index]! * 100) / 100;
}

function device(): RecallMetrics['device'] {
  return { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? 'unknown', memoryGiB: Math.round(os.totalmem() / 1024 ** 3) };
}

export interface RecallEvaluationInput { corpusTurns?: number; splits?: RecallSplit[]; caseFile?: RecallCaseFile }
/** Runs the committed case file against the real retrieval path; never invents labels. */
export async function evaluateCoreRecall(input: RecallEvaluationInput = {}, deps: { retrieve?: typeof retrieveCoreMemories } = {}): Promise<RecallMetrics> {
  const file = input.caseFile ?? loadRecallCases(), corpusTurns = input.corpusTurns ?? file.corpus.turns, splits = input.splits ?? ['tuning', 'holdout'];
  if (!Number.isSafeInteger(corpusTurns) || corpusTurns < 1) throw Error('CORE2_RECALL_CORPUS_INVALID');
  const { session, knowledge } = await buildRecallCorpus(corpusTurns);
  const head = await session.repo.readHead(session.scope);
  const eventCount = corpusTurns * SLOT_SEMANTICS.length, durations: number[] = [];
  const metrics: RecallMetrics = {
    corpusTurns, eventCount, caseCount: file.queries.length,
    backend: 'fake-indexeddb', executedCases: 0, executedPositives: 0, executedNegatives: 0, datasetFailures: auditRecallDataset(file).failures,
    positives: file.queries.filter(row => row.expect === 'relevant').length,
    negatives: file.queries.filter(row => row.expect === 'unauthorized').length,
    tuning: file.queries.filter(row => row.split === 'tuning').length,
    holdout: file.queries.filter(row => row.split === 'holdout').length, skippedCases: 0,
    optionalRecallAt8: 0, tuningRecallAt8: 0, holdoutRecallAt8: 0,
    unauthorizedSelectedLeafCount: 0, missingTargetCount: 0, unresolvableImportantSources: 0, duplicateSelectedLeaves: 0,
    indexColdStartMs: 0, querySamples: 0, p95StructuredQueryMs: 0, maxStructuredQueryMs: 0,
    rankingVersion: CORE_RECALL_RANKING_VERSION, device: device(), failures: [],
  };
  const recallBySplit: Record<RecallSplit, number[]> = { tuning: [], holdout: [] };
  const positiveRecall: number[] = [];
  let firstQuery = true;
  for (const row of file.queries) {
    if (!splits.includes(row.split)) { metrics.skippedCases += 1; continue; }
    // A shorter corpus keeps the unit gate quick; the CLI always runs the full file.
    if (row.targets.some(target => target.turn > corpusTurns)) { metrics.skippedCases += 1; continue; }
    metrics.executedCases++; if (row.expect === 'relevant') metrics.executedPositives++; else metrics.executedNegatives++;
    const request = {
      scope: session.scope, head, audience: row.audience, entityIds: row.entityIds, locations: row.locations,
      query: row.query, moment: corpusMoment(Math.min(row.momentTurn, corpusTurns), `op-recall-${row.id}`), k: 8,
    };
    const started = performance.now();
    const result = await (deps.retrieve ?? retrieveCoreMemories)(request, { repo: session.repo });
    const elapsed = Math.round((performance.now() - started) * 100) / 100;
    if (firstQuery) { metrics.indexColdStartMs = elapsed; firstQuery = false; } else { durations.push(elapsed); }
    metrics.querySamples = durations.length;
    metrics.maxStructuredQueryMs = Math.max(metrics.maxStructuredQueryMs, elapsed);
    const selected = result.selectedLeafIds;
    // Privacy is checked for every result, including otherwise correct positives.
    for (const leaf of selected) {
      const holders = knowledge.get(leaf), slot = Number(leaf.split('-').at(-1)), visibility = SLOT_SEMANTICS.find(spec => spec.slot === slot)?.visibility.kind;
      const authorized = row.audience.target === 'news' ? visibility === 'public' : row.audience.npcIds.length === 0 ? true : Boolean(holders && row.audience.npcIds.every(npcId => holders.has(npcId)));
      if (!authorized) metrics.unauthorizedSelectedLeafCount++;
    }
    if (selected.length !== new Set(selected).size) metrics.duplicateSelectedLeaves += selected.length - new Set(selected).size;
    for (const leaf of selected) {
      const event = (await session.repo.queryEvents({ scope: session.scope, cutoffSeq: head.coreSeq, eventIds: [leaf], limit: 1 })).items[0];
      let resolvable = !!event && !!event.evidenceRefs.length;
      for (const ref of event?.evidenceRefs ?? []) {
        const source = await session.repo.readSource(ref.ref), block = source?.blocks.find(value => value.blockId === ref.blockId);
        if (!block || block.text.slice(ref.start, ref.end) !== ref.quote) resolvable = false;
      }
      if (!resolvable) metrics.unresolvableImportantSources++;
    }
    const expected = row.targets.map(target => corpusEventId(target.turn, target.slot));
    for (const eventId of expected) if (!knowledge.has(eventId)) metrics.missingTargetCount += 1;
    if (row.expect === 'unauthorized') continue;
    const optionalLeaves = new Set(result.optional.slice(0, 8).flatMap(item => item.leafIds));
    const hit = expected.filter(eventId => optionalLeaves.has(eventId)).length, recall = expected.length ? hit / expected.length : 0;
    positiveRecall.push(recall); recallBySplit[row.split].push(recall);
    if (recall < 1) metrics.failures.push({ id: row.id, split: row.split, expected, selected, recall: Math.round(recall * 1000) / 1000 });
  }
  const mean = (values: number[]) => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000 : 0;
  metrics.optionalRecallAt8 = mean(positiveRecall);
  metrics.tuningRecallAt8 = mean(recallBySplit.tuning);
  metrics.holdoutRecallAt8 = mean(recallBySplit.holdout);
  metrics.p95StructuredQueryMs = percentile(durations, 0.95);
  metrics.failures.sort((a, b) => a.recall - b.recall || a.id.localeCompare(b.id));
  return metrics;
}

/** Correctness gates from the 2.0 design. Latency stays separate on purpose:
 * fake-indexeddb in Node proves the contract, not the real browser backend. */
export function recallGateFailures(metrics: RecallMetrics, input: { mode?: 'acceptance' | 'contract-slice' } = {}): string[] {
  const failures: string[] = [];
  if (input.mode !== 'contract-slice') { failures.push(...metrics.datasetFailures); if (metrics.skippedCases || metrics.executedCases !== metrics.caseCount) failures.push('CORE2_RECALL_PARTIAL_COVERAGE'); }
  if (metrics.optionalRecallAt8 < 0.9) failures.push(`optionalRecallAt8=${metrics.optionalRecallAt8} < 0.90`);
  if (metrics.holdoutRecallAt8 < 0.9) failures.push(`holdoutRecallAt8=${metrics.holdoutRecallAt8} < 0.90`);
  if (metrics.unauthorizedSelectedLeafCount !== 0) failures.push(`unauthorizedSelectedLeafCount=${metrics.unauthorizedSelectedLeafCount}`);
  if (metrics.missingTargetCount !== 0) failures.push(`missingTargetCount=${metrics.missingTargetCount}`);
  if (metrics.unresolvableImportantSources !== 0) failures.push(`unresolvableImportantSources=${metrics.unresolvableImportantSources}`);
  if (metrics.duplicateSelectedLeaves !== 0) failures.push(`duplicateSelectedLeaves=${metrics.duplicateSelectedLeaves}`);
  if (metrics.failures.filter(row => row.split === 'holdout').length > metrics.holdout * 0.1) failures.push(`holdoutFailures=${metrics.failures.filter(row => row.split === 'holdout').length}`);
  return failures;
}

/** Used only where the design freezes the backend: real browser IndexedDB or the desktop file backend. */
export function latencyGateFailures(metrics: RecallMetrics, budgetMs = 200): string[] {
  if (metrics.backend === 'fake-indexeddb') return ['CORE2_LATENCY_REAL_BACKEND_REQUIRED'];
  return metrics.p95StructuredQueryMs > budgetMs ? [`p95StructuredQueryMs=${metrics.p95StructuredQueryMs} > ${budgetMs}`] : [];
}
