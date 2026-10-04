import { describe, expect, it } from 'vitest';
import { decideMainNarrativeValidation } from '@/services/ai/mainNarrativeValidation';
import { runValidatedMainNarrativeRequest } from '@/hooks/useGame/mainNarrativeRequestStage';
import type { ChatResult } from '@/services/ai/text';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';

const valid = {
  blank: false,
  missingPartyMembers: [] as string[],
  rerollSimilarity: 0,
  protocolIssues: [] as string[],
  canRetry: true,
};

describe('main narrative validation decision', () => {
  it('rejects a final blank response instead of accepting it', () => {
    expect(decideMainNarrativeValidation({ ...valid, blank: true, canRetry: false })).toEqual({
      action: 'reject',
      kind: 'empty',
    });
  });

  it('prioritizes missing party members over later protocol checks', () => {
    expect(decideMainNarrativeValidation({
      ...valid,
      missingPartyMembers: ['安柏', '丽莎'],
      protocolIssues: ['缺少 choices'],
    })).toEqual({ action: 'retry', kind: 'missing_party', missingPartyMembers: ['安柏', '丽莎'] });
  });

  it('accepts a similar reroll on the final attempt', () => {
    expect(decideMainNarrativeValidation({ ...valid, rerollSimilarity: 0.91, canRetry: false })).toEqual({
      action: 'accept',
      protocolIssues: [],
    });
  });

  it('retries an incomplete DeepSeek protocol only while budget remains', () => {
    expect(decideMainNarrativeValidation({ ...valid, protocolIssues: ['缺少 continuation'] })).toEqual({
      action: 'retry',
      kind: 'protocol',
      protocolIssues: ['缺少 continuation'],
    });
    expect(decideMainNarrativeValidation({ ...valid, protocolIssues: ['缺少 continuation'], canRetry: false })).toEqual({
      action: 'accept',
      protocolIssues: ['缺少 continuation'],
    });
  });
});

// 「预设要求 3000 字，模型只写 800 字」必须自动重写一次，但**每回合最多一次**
// （重写 = 再跑一次长文生成，不能因为模型顽固而反复烧 token/时间）。
describe('word count enforcement retries once per turn', () => {
  function buildTurn(bodyChars: number): NarrativeTurn {
    return {
      body: [{ kind: 'narration', id: 'n1', text: '一'.repeat(bodyChars) }],
      choices: [{ id: 'c1', label: '继续前进' }],
      factCandidates: [],
      continuation: { summary: '摘要', unresolved: [] },
    } as NarrativeTurn;
  }
  function chatResult(bodyChars: number): ChatResult {
    const parsed = buildTurn(bodyChars);
    return { fullText: JSON.stringify(parsed), parsed } as ChatResult;
  }

  it('正文明显短于预设下限时重写一次，第二次短也不再重写', async () => {
    const attempts: string[] = [];
    const instructions: string[] = [];
    const run = await runValidatedMainNarrativeRequest({
      maxAttempts: 4,
      wordCountTarget: 3000,
      request: async () => {
        attempts.push('call');
        return chatResult(800);
      },
      getMissingPartyMembers: () => [],
      appendRetryInstruction: (instruction) => instructions.push(instruction),
    });
    expect(attempts).toHaveLength(2);
    expect(run.wordCountRetried).toBe(true);
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain('不少于 3000 字');
  });

  it('达标时直接接受，不做任何重写', async () => {
    let calls = 0;
    const run = await runValidatedMainNarrativeRequest({
      maxAttempts: 4,
      wordCountTarget: 3000,
      request: async () => {
        calls += 1;
        return chatResult(3200);
      },
      getMissingPartyMembers: () => [],
      appendRetryInstruction: () => undefined,
    });
    expect(calls).toBe(1);
    expect(run.wordCountRetried).toBe(false);
  });

  it('预设没声明字数下限时不做长度校验', async () => {
    let calls = 0;
    const run = await runValidatedMainNarrativeRequest({
      maxAttempts: 4,
      request: async () => {
        calls += 1;
        return chatResult(120);
      },
      getMissingPartyMembers: () => [],
      appendRetryInstruction: () => undefined,
    });
    expect(calls).toBe(1);
    expect(run.wordCountRetried).toBe(false);
  });
});
