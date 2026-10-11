import { describe, expect, it, vi } from 'vitest';
import { runVariableSettlementWorkflow } from '@/hooks/useGame/variableSettlementWorkflow';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';

const model = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/services/ai/variableModel', () => ({ callVariableModel: model.call }));
const params = () => ({
  mainApiConfig: { id: 'test', provider: 'openai', model: 'variable-test' } as API配置项,
  currentGame: createEmptyTeyvatGameState(), settings: 创建默认游戏设置(), npcRecords: [],
  userInput: '继续', body: '风吹过蒙德城。', turnAfter: 1,
  memorySystemSnapshot: 创建空记忆系统(), commitGame: vi.fn(() => true),
});

describe('variable settlement failure classification', () => {
  it('retains an API failure instead of calling it a save switch', async () => {
    const input = params();
    model.call.mockRejectedValueOnce(new Error('API Error 429: variable quota exhausted'));
    const result = await runVariableSettlementWorkflow(input);
    expect(result).toMatchObject({ failure: { code: 'VARIABLE_MODEL_FAILED', detail: 'API Error 429: variable quota exhausted' } });
    expect(result?.committedGame).toBeUndefined();
    expect(input.commitGame).not.toHaveBeenCalled();
  });

  it('retains the actual commit exception without reporting a successful commit', async () => {
    model.call.mockResolvedValueOnce({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    const result = await runVariableSettlementWorkflow({ ...params(), commitGame: () => { throw new Error('live root write failed'); } });
    expect(result).toMatchObject({ failure: { code: 'VARIABLE_COMMIT_FAILED', detail: 'live root write failed' } });
    expect(result?.committedGame).toBeUndefined();
  });

  it('distinguishes a refused commit from a model failure', async () => {
    model.call.mockResolvedValueOnce({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    const result = await runVariableSettlementWorkflow({ ...params(), commitGame: () => false });
    expect(result).toMatchObject({ failure: { code: 'VARIABLE_COMMIT_REJECTED' } });
    expect(result?.committedGame).toBeUndefined();
  });
});
