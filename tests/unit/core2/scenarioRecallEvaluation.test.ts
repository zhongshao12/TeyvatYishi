import { expect, it } from 'vitest';
import { auditScenarioCases, evaluateScenarioRecall, loadScenarioCases, scenarioRecallFailures } from './scenarioRecallEvaluation';
import { makeNodeRepository } from './nodeCorpusSession';
import { createCorpusSession, commitCorpusTurn } from './coreSessionHarness';
import { makeSeed, fixtureMoment } from './fixtures';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';

it('keeps forty independently sourced scenarios with balanced query types and refuses a reused holdout source', () => {
  const data = loadScenarioCases(), audit = auditScenarioCases(data);
  expect(audit).toMatchObject({ scenarios: 40, queries: 160, relevant: 120, unauthorized: 20, none: 20, tuning: 80, holdout: 80, failures: [] });
  const reused = structuredClone(data); reused.scenarios[20]!.id = reused.scenarios[0]!.id;
  expect(auditScenarioCases(reused).failures).toContain('CORE2_SCENARIO_SOURCE_OVERLAP');
});

it('evaluates actual optional leaves and original evidence through the repository without declaring a slice complete', async () => {
  const metrics = await evaluateScenarioRecall(makeNodeRepository(`test-core2-scenario-${crypto.randomUUID()}`), { maxScenarios: 2, retrieve: (request, dependencies) => {
    expect(request.moment).toMatchObject({ date: '旅行历 1000.03.08', clock: '18:00', travelDay: 2, turn: 2 });
    return retrieveCoreMemories(request, dependencies);
  } });
  expect(metrics.executedCases).toBe(8); expect(metrics.skippedCases).toBe(152);
  expect(metrics.optionalRecallAt8).toBeGreaterThanOrEqual(0.9); expect(metrics.unauthorizedSelectedLeaves).toBe(0);
  expect(metrics.missingEvidence).toBe(0); expect(metrics.duplicateSelectedLeaves).toBe(0);
  expect(scenarioRecallFailures(metrics)).toContain('CORE2_SCENARIO_PARTIAL_COVERAGE');
}, 30_000);

it('keeps explicit event and source moments instead of stamping every recollection at ten in the morning', async () => {
  const repo = makeNodeRepository(`test-core2-scene-time-${crypto.randomUUID()}`), seed = makeSeed();
  await repo.initialize(seed);
  const sourceMoment = { ...fixtureMoment, date: '旅行历 1000.04.01', travelDay: 26 }, occurredMoment = { ...sourceMoment, clock: '18:00' };
  const session = createCorpusSession(repo, seed);
  await commitCorpusTurn(session, { turn: 1, moment: sourceMoment, events: [{ eventId: 'evening-return', type: 'narrative.observe', actors: ['npc-amber'], targets: [], text: '傍晚归还餐盒。', location: '蒙德城', visibility: { kind: 'public', npcIds: [] }, knowledge: ['witnessed'], knowledgeNpcIds: ['npc-amber'], occurredMoment }] });
  expect((await repo.readSource({ sourceId: 'source-0001', sourceVersion: 1 }))?.moment).toEqual(sourceMoment);
  expect((await repo.queryEvents({ scope: session.scope, cutoffSeq: session.head.coreSeq })).items[0]?.occurredMoment).toEqual(occurredMoment);
});

it('fails its permission gate even when a forged secret appears in a positive-answer result', async () => {
  const metrics = await evaluateScenarioRecall(makeNodeRepository(`test-core2-scene-forgery-${crypto.randomUUID()}`), { maxScenarios: 1, retrieve: async (request, dependencies) => {
    const result = await retrieveCoreMemories(request, dependencies);
    if (request.audience.npcIds.length === 2) result.selectedLeafIds.push('recall-v2-t01-1');
    return result;
  } });
  expect(metrics.unauthorizedSelectedLeaves).toBeGreaterThan(0);
  expect(scenarioRecallFailures(metrics)).toContain('CORE2_SCENARIO_UNAUTHORIZED');
});

it('counts missing original sources instead of accepting an event identity alone as valid evidence', async () => {
  const repo = makeNodeRepository(`test-core2-scene-lost-source-${crypto.randomUUID()}`), read = repo.readSource.bind(repo);
  repo.readSource = ref => ref.sourceId === 'source-0001' ? Promise.resolve(null) : read(ref);
  const metrics = await evaluateScenarioRecall(repo, { maxScenarios: 1 });
  expect(metrics.missingEvidence).toBeGreaterThan(0);
  expect(scenarioRecallFailures(metrics)).toContain('CORE2_SCENARIO_SOURCE_MISSING');
});
