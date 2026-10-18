import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { runCoreTurn } from '@/core/settlement/turnRunner';
import { summarizeCoreTurn } from '@/core/memory/turnSummary';
import { runCoreJob } from '@/core/jobs/jobRunner';
import { makeSeed } from './fixtures';

export async function makeMemoryMaintenanceFixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-maintenance-${crypto.randomUUID()}` }), seed = makeSeed(); await repo.initialize(seed);
  const turns = [];
  for (let turn = 1; turn <= 3; turn++) {
    const result = await runCoreTurn({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: `turn-${turn}`, text: '问候安柏' }, { repo, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text: '安柏向你挥手。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } });
    if (result.kind !== 'committed') throw Error('fixture turn failed');
    const operation = (await repo.readOperation(seed.head.scope, `turn-${turn}`))!, sources = (await Promise.all(operation.sourceRefs.map(ref => repo.readSource(ref)))).map(source => source!);
    const events = (await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: turn, eventIds: result.receipt.eventIds })).items;
    const summary = await summarizeCoreTurn({ operation, sources, events, mode: 'local', prompt: '' }, {}); if (summary.kind !== 'staged') throw Error('fixture summary failed');
    const head = await repo.readHead(seed.head.scope), jobId = result.receipt.jobIds[0]!;
    await runCoreJob({ scope: seed.head.scope, sessionId: seed.head.sessionId, jobId }, { repo, handlers: { turn_summary: { steps: [{ stepId: 'summary', run: async () => [summary.memory] }], finalize: async ({ job }, steps) => repo.publishDerived({ scope: job.scope, sessionId: job.sessionId, jobId, leaseId: job.leaseId!, sourceRefs: job.sourceRefs, readSet: [], expectedMemoryRevision: head.memoryRevision, additions: steps.flatMap(step => step.memories), supersededIds: [] }) } } });
    turns.push({ operation, completion: events.find(event => event.type === 'turn.complete')! });
  }
  const memories = (await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: 3, memoryRevision: 3, statuses: ['active'] })).items;
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, jobId: 'maintenance-job', cutoffSeq: 3, memoryRevision: 3, anchorOperationId: 'turn-3', mode: 'compress' as const, settings: { shortThreshold: 3, middleThreshold: 4, longThreshold: 5, mode: 'model' as const, prompt: '整理共同经历' }, memories, turns };
  return { repo, seed, memories, input };
}
