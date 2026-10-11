import { describe, expect, it } from 'vitest';
import type { ChatResult } from '@/services/ai/text';
import {
  requestMainNarrativeAttempt,
  runValidatedMainNarrativeRequest,
} from '@/hooks/useGame/mainNarrativeRequestStage';

function resultWithBody(text: string): ChatResult {
  return {
    fullText: text,
    parsed: {
      body: text ? [{ kind: 'narration', text }] : [],
      choices: [],
      factCandidates: [],
      continuation: { summary: '', unresolved: [] },
    },
  };
}

describe('main narrative request stage', () => {
  it('does not use system panels to satisfy a preset narrative length requirement', async () => {
    const result = resultWithBody('文'.repeat(800));
    result.parsed.body.push({ kind: 'system', text: '面'.repeat(2300) });
    const details: string[] = [];
    let attempts = 0;
    const output = await runValidatedMainNarrativeRequest({
      maxAttempts: 3, wordCountTarget: 3000,
      request: async () => { attempts++; return result; },
      getMissingPartyMembers: () => [],
      onValidationIssue: issue => { details.push(issue.detail); },
    });
    expect(attempts).toBe(2);
    expect(output.wordCountRetried).toBe(true);
    expect(details).toEqual(['正文只有 800 字，未达已激活酒馆预设要求的 3000 字']);
  });

  it('counts dialogue content but not speaker labels toward the preset requirement', async () => {
    const result = resultWithBody('文'.repeat(800));
    result.parsed.body.push({ kind: 'dialogue', speaker: '名字'.repeat(1200), text: '话'.repeat(100) });
    const details: string[] = [];
    let attempts = 0;
    await runValidatedMainNarrativeRequest({
      maxAttempts: 2, wordCountTarget: 3000,
      request: async () => { attempts++; return result; },
      getMissingPartyMembers: () => [],
      onValidationIssue: issue => { details.push(issue.detail); },
    });
    expect(attempts).toBe(2);
    expect(details).toEqual(['正文只有 900 字，未达已激活酒馆预设要求的 3000 字']);
  });
  it('forwards sampling options and reparses transformed provider output', async () => {
    let capturedTopP: number | undefined;
    const output = await requestMainNarrativeAttempt({
      config: { id: 'main', name: 'main', provider: 'openai', apiKey: '', baseUrl: '', model: 'test', temperature: 1, maxTokens: 1000, topP: 0.72, createdAt: 1, updatedAt: 1 },
      messages: [],
      systemPrompt: 'system',
      streaming: false,
      onDelta: () => undefined,
      send: async (_config, request) => {
        capturedTopP = request.topP;
        return resultWithBody('原始正文');
      },
      transformOutput: () => '{"body":[{"kind":"narration","text":"清理后的正文"}],"choices":[],"factCandidates":[],"continuation":{"summary":"","unresolved":[]}}',
    });

    expect(capturedTopP).toBe(0.72);
    expect(output.fullText).toContain('清理后的正文');
    expect(output.parsed.body).toEqual([{ kind: 'narration', text: '清理后的正文' }]);
  });

  it('adds a repair instruction and retries when a party member is missing', async () => {
    const instructions: string[] = [];
    const retryDetails: string[] = [];
    let attempts = 0;

    const output = await runValidatedMainNarrativeRequest({
      maxAttempts: 2,
      request: async () => resultWithBody(++attempts === 1 ? '只有安柏回应。' : '安柏与丽莎都回应了。'),
      getMissingPartyMembers: (body) => body.includes('丽莎') ? [] : ['丽莎'],
      appendRetryInstruction: (instruction) => instructions.push(instruction),
      onValidationRetry: ({ detail }) => { retryDetails.push(detail); },
    });

    expect(attempts).toBe(2);
    expect(output.result.fullText).toBe('安柏与丽莎都回应了。');
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain('丽莎');
    expect(retryDetails).toEqual(['正文遗漏同行成员：丽莎']);
  });

  it('returns final DeepSeek protocol diagnostics when the repair budget is exhausted', async () => {
    const output = await runValidatedMainNarrativeRequest({
      maxAttempts: 1,
      request: async () => resultWithBody('仍然保留可见正文。'),
      getMissingPartyMembers: () => [],
      deepSeekValidation: true,
      getProtocolIssues: () => ['continuation 无效'],
    });

    expect(output.deepSeekProtocolIssues).toEqual(['continuation 无效']);
    expect(output.attempt).toBe(1);
  });
});
