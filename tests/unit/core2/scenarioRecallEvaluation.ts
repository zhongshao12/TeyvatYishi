import cases from '@/tests/fixtures/core2/recall-scenes-v2.json';
import type { CoreRepository } from '@/core/contracts/storage';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import { CORE_RECALL_RANKING_VERSION } from '@/core/retrieval/rankCandidates';
import { maintainCoreIndexes } from '@/core/persistence/indexMaintenance';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { validateEvidence } from '@/core/sources/sourceRecords';
import { makeSeed } from './fixtures';
import { commitCorpusTurn, corpusMoment, type CorpusSession } from './coreSessionHarness';

export interface ScenarioCase {
  id: string; split: 'tuning' | 'holdout'; owner: string; observer: string; location: string;
  events: string[]; queries: [string, number[], 'both' | 'owner' | 'observer', 'relevant' | 'unauthorized' | 'none'][];
}
export interface ScenarioCases { kind: string; version: number; provenance: string; rankingVersion: string; actors: Record<string, string>; scenarios: ScenarioCase[] }
export interface ScenarioMetrics {
  executedCases: number; skippedCases: number; optionalRecallAt8: number; holdoutRecallAt8: number;
  unauthorizedSelectedLeaves: number; missingEvidence: number; duplicateSelectedLeaves: number;
  backend: 'fake-indexeddb' | 'browser-indexeddb' | 'desktop'; datasetFingerprint: string; rankingVersion: string;
  indexBuildMs: number; p95RecallMs: number; querySamples: number; mandatoryLeaves: number;
  noRelevantCases: number; noRelevantCasesWithBackground: number;
  caseFailures: { id: string; recall: number; expected: string[]; optional: string[] }[];
  audit: ReturnType<typeof auditScenarioCases>;
}
export function loadScenarioCases(): ScenarioCases {
  const data = structuredClone(cases);
  const scenarios: ScenarioCase[] = data.scenarios.map(scene => {
    if (scene.split !== 'tuning' && scene.split !== 'holdout') throw Error('CORE2_SCENARIO_SPLIT');
    const queries: ScenarioCase['queries'] = scene.queries.map(tuple => {
      const [question, targets, audience, expected] = tuple;
      if (tuple.length !== 4 || typeof question !== 'string' || !Array.isArray(targets) || targets.some(value => typeof value !== 'number')
        || audience !== 'both' && audience !== 'owner' && audience !== 'observer'
        || expected !== 'relevant' && expected !== 'unauthorized' && expected !== 'none') throw Error('CORE2_SCENARIO_LABEL');
      return [question, targets, audience, expected];
    });
    return { ...scene, split: scene.split, queries };
  });
  return { ...data, scenarios };
}
export function auditScenarioCases(data: ScenarioCases): { scenarios: number; queries: number; relevant: number; unauthorized: number; none: number; tuning: number; holdout: number; failures: string[] } {
  const failures = new Set<string>(), ids = new Map<string, string>(), texts = new Map<string, string>();
  let queries = 0, relevant = 0, unauthorized = 0, none = 0, tuning = 0, holdout = 0;
  if (data.kind !== 'teyvat-core2-scenario-recall' || data.version !== 2 || data.rankingVersion !== CORE_RECALL_RANKING_VERSION) failures.add('CORE2_SCENARIO_FORMAT');
  for (const scene of data.scenarios) {
    if (ids.has(scene.id)) failures.add(ids.get(scene.id) === scene.split ? 'CORE2_SCENARIO_DUPLICATE' : 'CORE2_SCENARIO_SOURCE_OVERLAP');
    ids.set(scene.id, scene.split);
    const textKey = checksumUtf8(stableJson(scene.events));
    if (texts.has(textKey) && texts.get(textKey) !== scene.split) failures.add('CORE2_SCENARIO_SOURCE_OVERLAP');
    texts.set(textKey, scene.split);
    if (!data.actors[scene.owner] || !data.actors[scene.observer] || scene.owner === scene.observer || !scene.location.trim()
      || scene.events.length !== 3 || scene.events.some(text => !text.trim()) || scene.queries.length !== 4) failures.add('CORE2_SCENARIO_SHAPE');
    for (const [question, targets, audience, expected] of scene.queries) {
      queries++; if (scene.split === 'tuning') tuning++; else if (scene.split === 'holdout') holdout++; else failures.add('CORE2_SCENARIO_SPLIT');
      if (!question.trim() || targets.some(slot => !Number.isSafeInteger(slot) || slot < 0 || slot > 2) || new Set(targets).size !== targets.length) failures.add('CORE2_SCENARIO_LABEL');
      if (expected === 'relevant') { relevant++; if (!targets.length || targets.length > 4 || audience !== 'owner' && targets.includes(1)) failures.add('CORE2_SCENARIO_LABEL'); }
      else if (expected === 'unauthorized') { unauthorized++; if (audience !== 'observer' || targets.length !== 1 || targets[0] !== 1) failures.add('CORE2_SCENARIO_LABEL'); }
      else if (expected === 'none') { none++; if (targets.length) failures.add('CORE2_SCENARIO_LABEL'); }
      else failures.add('CORE2_SCENARIO_LABEL');
    }
  }
  if (data.scenarios.length !== 40 || queries !== 160 || relevant !== 120 || unauthorized !== 20 || none !== 20 || tuning !== 80 || holdout !== 80) failures.add('CORE2_SCENARIO_COUNTS');
  if (checksumUtf8(stableJson(data)) !== '5e36dda1819a8160') failures.add('CORE2_SCENARIO_FROZEN_DATA_CHANGED');
  return { scenarios: data.scenarios.length, queries, relevant, unauthorized, none, tuning, holdout, failures: [...failures].sort() };
}
const eventId = (scene: ScenarioCase, slot: number) => `recall-v2-${scene.id}-${slot}`;
const npcId = (actor: string) => `npc-${actor}`;

// Literal fixture chronology, not inferred from a retrieval result or wall time.
// Each independent scene has its own travel day, using the game's 31-day calendar.
function sceneMoment(index: number, scene: ScenarioCase, slot = 0) {
  const day = 6 + index, month = 3 + Math.floor(day / 31);
  return { ...corpusMoment(index + 1, `op-${String(index + 1).padStart(4, '0')}`, scene.location),
    date: `旅行历 1000.${String(month).padStart(2, '0')}.${String(day % 31 + 1).padStart(2, '0')}`,
    clock: scene.id === 'h18' ? ['19:00', '19:30', '20:00'][slot]! : slot === 0 ? '10:00' : slot === 1 ? '11:00' : scene.id === 't05' ? '15:00' : scene.id === 'h15' ? '21:00' : '18:00',
    weather: (scene.id === 't17' && slot !== 2 || scene.id === 'h01') ? '雨' : '晴' };
}

/** Dataset labels are literals, authored separately from retrieval. No query
 * result or ranking helper is used to construct its expected event identities. */
export async function evaluateScenarioRecall(repo: CoreRepository, options: { maxScenarios?: number; backend?: ScenarioMetrics['backend']; retrieve?: typeof retrieveCoreMemories } = {}): Promise<ScenarioMetrics> {
  const data = loadScenarioCases(), audit = auditScenarioCases(data), count = options.maxScenarios ?? data.scenarios.length;
  if (audit.failures.length) throw Error(audit.failures.join(';'));
  if (!Number.isSafeInteger(count) || count < 1 || count > data.scenarios.length) throw Error('CORE2_SCENARIO_LIMIT');
  const scenes = data.scenarios.slice(0, count), seed = makeSeed(), baseNpc = seed.records.find(row => row.domain === 'npc')!;
  if (baseNpc.domain !== 'npc') throw Error('CORE2_SCENARIO_SEED');
  seed.records = seed.records.filter(row => row.domain !== 'npc' && row.domain !== 'album');
  for (const [actor, name] of Object.entries(data.actors)) seed.records.push({ ...structuredClone(baseNpc), entityId: npcId(actor), value: { ...structuredClone(baseNpc.value), id: npcId(actor), 姓名: name, gender: ['kaeya', 'thoma', 'tighnari'].includes(actor) ? '男' : '女', canonical: false, canonicalId: actor, travelingTogether: false } });
  await repo.initialize(seed);
  const session: CorpusSession = { repo, seed, scope: seed.head.scope, sessionId: seed.head.sessionId, head: seed.head, committedTurns: 0, databaseName: 'test-core2-scenario-evaluation' };
  for (const [index, scene] of scenes.entries()) await commitCorpusTurn(session, { turn: index + 1, moment: sceneMoment(index, scene), events: scene.events.map((text, slot) => ({ eventId: eventId(scene, slot), type: slot === 1 ? 'communication.private' : 'narrative.observe', actors: [npcId(scene.owner)], targets: [], text, location: scene.location, occurredMoment: sceneMoment(index, scene, slot),
    visibility: slot === 1 ? { kind: 'private', npcIds: [npcId(scene.owner)] } : { kind: 'public', npcIds: [] }, knowledge: ['witnessed'], knowledgeNpcIds: slot === 1 ? [npcId(scene.owner)] : [npcId(scene.owner), npcId(scene.observer)] })) });
  const indexing = performance.now();
  if ((await maintainCoreIndexes(repo, { scope: session.scope, sessionId: session.sessionId })).status !== 'published') throw Error('CORE2_SCENARIO_INDEX');
  const metrics: ScenarioMetrics = { executedCases: 0, skippedCases: audit.queries - scenes.reduce((sum, scene) => sum + scene.queries.length, 0), optionalRecallAt8: 0, holdoutRecallAt8: 0, unauthorizedSelectedLeaves: 0, missingEvidence: 0, duplicateSelectedLeaves: 0,
    backend: options.backend ?? 'fake-indexeddb', datasetFingerprint: checksumUtf8(stableJson(data)), rankingVersion: CORE_RECALL_RANKING_VERSION, indexBuildMs: Math.round(performance.now() - indexing), p95RecallMs: 0, querySamples: 0, mandatoryLeaves: 0, noRelevantCases: 0, noRelevantCasesWithBackground: 0, caseFailures: [], audit };
  const scores: number[] = [], holdout: number[] = [], times: number[] = [];
  for (const scene of scenes) for (const [index, [query, slots, role, expected]] of scene.queries.entries()) {
    const recipients = role === 'both' ? [npcId(scene.owner), npcId(scene.observer)] : [npcId(role === 'owner' ? scene.owner : scene.observer)];
    const request = { scope: session.scope, head: session.head, audience: { target: role === 'both' ? 'group' as const : 'private' as const, npcIds: recipients }, entityIds: expected === 'none' ? [] : [npcId(scene.owner)], locations: expected === 'none' ? [] : [scene.location], query,
      moment: { ...sceneMoment(count - 1, scenes[count - 1]!, 2), settlementId: `query-${scene.id}-${index}` }, k: 8 };
    const start = performance.now(), result = await (options.retrieve ?? retrieveCoreMemories)(request, { repo });
    times.push(performance.now() - start); metrics.executedCases++; metrics.mandatoryLeaves += result.mandatory.flatMap(row => row.leafIds).length;
    metrics.duplicateSelectedLeaves += result.selectedLeafIds.length - new Set(result.selectedLeafIds).size;
    const selected = result.optional.slice(0, 8).flatMap(row => row.leafIds), expectedIds = slots.map(slot => eventId(scene, slot));
    if (expected === 'relevant') {
      const score = expectedIds.filter(id => selected.includes(id)).length / expectedIds.length; scores.push(score); if (scene.split === 'holdout') holdout.push(score);
      if (score < 1) metrics.caseFailures.push({ id: `${scene.id}-q${index + 1}`, recall: score, expected: expectedIds, optional: selected });
    } else if (expected === 'none') { metrics.noRelevantCases++; if (selected.length) metrics.noRelevantCasesWithBackground++; }
    const actual = (await repo.queryEvents({ scope: session.scope, cutoffSeq: session.head.coreSeq, eventIds: result.selectedLeafIds, limit: 200 })).items;
    metrics.missingEvidence += result.selectedLeafIds.filter(id => !actual.some(event => event.eventId === id)).length;
    const known = (await repo.queryKnowledge({ scope: session.scope, cutoffSeq: session.head.coreSeq, npcIds: recipients, limit: 200 })).items;
    for (const event of actual) {
      if (!recipients.every(id => known.some(row => row.npcId === id && row.eventId === event.eventId && row.nature === 'fact' && !['inferred', 'rumor'].includes(row.mode)))) metrics.unauthorizedSelectedLeaves++;
      for (const evidence of event.evidenceRefs) { const source = await repo.readSource(evidence.ref); if (!source || !validateEvidence(evidence, source).ok) metrics.missingEvidence++; }
    }
    if (expected === 'unauthorized') metrics.unauthorizedSelectedLeaves += expectedIds.filter(id => selected.includes(id) && !actual.some(event => event.eventId === id)).length;
  }
  metrics.optionalRecallAt8 = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
  metrics.holdoutRecallAt8 = holdout.reduce((sum, value) => sum + value, 0) / Math.max(1, holdout.length);
  metrics.querySamples = times.length; metrics.p95RecallMs = [...times].sort((a, b) => a - b)[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0;
  return metrics;
}
export function scenarioRecallFailures(metrics: ScenarioMetrics): string[] {
  const failures = [...metrics.audit.failures];
  if (metrics.skippedCases || metrics.executedCases !== metrics.audit.queries) failures.push('CORE2_SCENARIO_PARTIAL_COVERAGE');
  if (metrics.optionalRecallAt8 < 0.9) failures.push('CORE2_SCENARIO_RECALL_BELOW_TARGET');
  if (metrics.holdoutRecallAt8 < 0.9) failures.push('CORE2_SCENARIO_HOLDOUT_BELOW_TARGET');
  if (metrics.unauthorizedSelectedLeaves) failures.push('CORE2_SCENARIO_UNAUTHORIZED');
  if (metrics.missingEvidence) failures.push('CORE2_SCENARIO_SOURCE_MISSING');
  if (metrics.duplicateSelectedLeaves) failures.push('CORE2_SCENARIO_DUPLICATES');
  return failures;
}
