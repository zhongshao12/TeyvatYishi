import { expect, it, vi } from 'vitest';
import { createCoreController } from '@/core/settlement/coreController';
import { makeNodeRepository } from './nodeCorpusSession';
import { makeSeed } from './fixtures';
import type { CoreSummaryRequest } from '@/core/memory/turnSummary';

it.each(['failed', 'cancelled'] as const)('does not resurrect the same %s compression on each new turn, while new input and manual retries remain possible', async status => {
  const seed = makeSeed(), repo = makeNodeRepository(`test-core2-compression-stop-${crypto.randomUUID()}`), middleInputs: string[] = [];
  let allowMiddle = false;
  const summarize = vi.fn(async (request: CoreSummaryRequest) => {
    if (request.layer === 'middle') { middleInputs.push(JSON.stringify(request.items)); if (!allowMiddle) return { kind: 'failed' as const, code: 'TEST_MODEL_DOWN', detail: 'test' }; }
    return { kind: 'model' as const, text: request.items.join('\n') };
  });
  const controller = createCoreController({ repo, autoSave: false, memoryModels: { summarize }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] },
    summarySettings: { mode: 'model', shortThreshold: 2, middleThreshold: 10, longThreshold: 10, prompt: '' }, assembleContext: async () => ({ systemPrompt: '', messages: [] }),
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，一路顺风。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }),
    factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }) }) });
  await controller.initialize(seed);
  const send = async (turn: number) => { expect((await controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: `turn-${turn}`, text: `出发${turn}` })).kind).toBe('committed'); await controller.waitForBackground(); };
  try {
    await send(1); await send(2); expect(middleInputs).toHaveLength(1);
    const job = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: controller.getView().snapshot!.head.coreSeq, kinds: ['compression'], statuses: ['failed'] })).items[0]!;
    if (status === 'cancelled') await controller.stopJob(job.jobId);
    await send(3); expect(middleInputs).toHaveLength(1);
    await send(4); expect(middleInputs).toHaveLength(2); expect(new Set(middleInputs).size).toBe(2);
    allowMiddle = true; expect((await controller.retryJob(job.jobId)).kind).toBe('completed'); await controller.waitForBackground();
    expect(middleInputs).toHaveLength(3);
  } finally { controller.dispose(); }
});
