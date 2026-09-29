import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { runVariableSettlementWorkflow } from '@/hooks/useGame/variableSettlementWorkflow';

const model = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/services/ai/variableModel', () => ({ callVariableModel: model.call }));

const config: API配置项 = {
  id: 'main', name: '主模型', provider: 'deepseek', baseUrl: 'https://example.invalid/v1', apiKey: 'test',
  model: 'test', maxTokens: 4096, temperature: 0.8, topP: 0.9, retryCount: 0, createdAt: 1, updatedAt: 1,
};

describe('world moment on committed variable settlement', () => {
  beforeEach(() => model.call.mockReset());

  it('persists the settled clock on the matching batch and restores it without restamping a replay', async () => {
    model.call.mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    let live = createEmptyTeyvatGameState();
    live.世界.当前日期 = '旅行历 1000.03.07';
    live.世界.当前时间 = '23:30';
    live.世界.当前天气 = '晴';
    live.世界.当前地点 = '蒙德城';
    live.世界.旅程天数 = 1;
    const settle = () => runVariableSettlementWorkflow({
      mainApiConfig: config, currentGame: live, settings: 创建默认游戏设置(),
      npcRecords: mapTeyvatNpcsToLegacy(live), commitGame: (next) => { live = next; return true; },
      userInput: '等待', body: '三天后，队伍抵达营地。', turnAfter: 7,
      memorySystemSnapshot: 创建空记忆系统(), settlementId: 'turn-7',
    });

    await settle();
    const moment = live.叙事.lastCommittedMoment;
    expect(moment).toMatchObject({
      date: '旅行历 1000.03.10', clock: '23:30', weather: '晴', location: '蒙德城',
      travelDay: 4, turn: 7, settlementId: 'turn-7',
    });
    expect(live.叙事.variableBatches).toHaveLength(1);
    expect(live.叙事.variableBatches[0]?.worldMoment).toEqual(moment);
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(live)));
    expect(restored.叙事.lastCommittedMoment).toEqual(moment);
    expect(restored.叙事.variableBatches[0]?.worldMoment).toEqual(moment);

    live = restored;
    await settle();
    expect(live.世界.旅程天数).toBe(4);
    expect(live.叙事.variableBatches).toHaveLength(1);
    expect(live.叙事.lastCommittedMoment).toEqual(moment);
    expect(model.call).toHaveBeenCalledTimes(1);
  });
});
