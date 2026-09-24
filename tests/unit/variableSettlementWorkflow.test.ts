import { describe, expect, it } from 'vitest';
import type { API配置项, 变量API覆盖 } from '@/models/settings';
import {
  excludeRejectedSettlementCommands,
  markRejectedSettlementResults,
  resolveVariableSettlementApiConfig,
} from '@/hooks/useGame/variableSettlementWorkflow';

function createMainConfig(): API配置项 {
  return {
    id: 'main',
    name: '主模型',
    provider: 'deepseek',
    baseUrl: 'https://main.example/v1',
    apiKey: 'main-key',
    model: 'main-model',
    maxTokens: 4096,
    temperature: 0.8,
    topP: 0.9,
    retryCount: 4,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('variable settlement workflow boundaries', () => {
  it('merges only non-empty variable API overrides and preserves shared sampling settings', () => {
    const override: 变量API覆盖 = {
      provider: 'openai_compatible',
      baseUrl: '  ',
      apiKey: ' variable-key ',
      model: ' variable-model ',
      maxTokens: 2048,
      retryCount: 2,
    };

    const resolved = resolveVariableSettlementApiConfig(createMainConfig(), override);

    expect(resolved.config).toMatchObject({
      provider: 'openai_compatible',
      baseUrl: 'https://main.example/v1',
      apiKey: 'variable-key',
      model: 'variable-model',
      maxTokens: 2048,
      temperature: 0.8,
      topP: 0.9,
    });
    expect(resolved.overrodeAny).toBe(true);
  });

  it('removes every command rejected by preflight without mutating the source batch', () => {
    const commands = [{ id: 'keep-a' }, { id: 'drop-b' }, { id: 'keep-c' }, { id: 'drop-d' }];

    const filtered = excludeRejectedSettlementCommands(commands, [
      { index: 3 },
      { index: 1 },
      { index: 3 },
    ]);

    expect(filtered).toEqual([{ id: 'keep-a' }, { id: 'keep-c' }]);
    expect(commands).toHaveLength(4);
  });

  it('records rejected preflight commands as failures instead of claiming they committed', () => {
    const accepted = { command: { action: 'add' as const, key: '背包.mora', value: 1 }, ok: true, kind: 'command' as const };
    const rejected = { command: { action: 'add' as const, key: '背包.mora', value: 999 }, ok: true, kind: 'command' as const };
    const results = markRejectedSettlementResults([accepted, rejected], [{ index: 1, code: 'INVALID_NUMERIC_RESULT' }]);

    expect(results[0]).toEqual(accepted);
    expect(results[1]).toMatchObject({ ok: false, kind: 'rejected', reason: 'INVALID_NUMERIC_RESULT' });
    expect(rejected.ok).toBe(true);
  });
});
