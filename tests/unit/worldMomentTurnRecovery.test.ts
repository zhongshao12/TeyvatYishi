import { describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { executeTeyvatSaveLoadTransaction } from '@/hooks/useGame/saveLoadWorkflow';
import { fromLegacyStoryWeaving, mapTeyvatNpcsToLegacy, toLegacyStoryWeaving } from '@/hooks/useGameState';
import { 归一化剧情编织分段, 归一化剧情编织系列, 归一化剧情编织系统 } from '@/models/storyWeaving';
import { getCurrentStoryChapterLabel } from '@/services/storyProgressService';
import { commitTurnContext } from '@/hooks/useGame/postSettlementCommitStage';
import { stampCommittedEventProvenance } from '@/services/committedEventProvenance';
import { runVariableSettlementWorkflow } from '@/hooks/useGame/variableSettlementWorkflow';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';

const model = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/services/ai/variableModel', () => ({ callVariableModel: model.call }));

const config: API配置项 = {
  id: 'main', name: '主模型', provider: 'deepseek', baseUrl: 'https://example.invalid/v1', apiKey: 'test',
  model: 'test', maxTokens: 4096, temperature: 0.8, topP: 0.9, retryCount: 0, createdAt: 1, updatedAt: 1,
};

describe('committed world moment recovery', () => {
  it('advances a narrative turn once, then reloads and replays the same settlement without a second clock jump', async () => {
    model.call.mockReset().mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    let live = createEmptyTeyvatGameState();
    live.世界.当前日期 = '旅行历 1000.03.07';
    live.世界.当前时间 = '23:30';
    live.世界.旅程天数 = 1;
    const settle = () => runVariableSettlementWorkflow({
      mainApiConfig: config, currentGame: live, settings: 创建默认游戏设置(),
      npcRecords: mapTeyvatNpcsToLegacy(live), commitGame: (next) => { live = next; return true; },
      userInput: '等待', body: '三天后，队伍抵达营地。', turnAfter: 7,
      memorySystemSnapshot: 创建空记忆系统(), settlementId: 'settlement-7',
    });
    await settle();
    const saved = JSON.parse(JSON.stringify(live));
    const loaded = await executeTeyvatSaveLoadTransaction(saved, {
      classify: () => ({ kind: 'teyvat', state: saved }),
      replaceGameState: (next) => { live = next; },
    });
    expect(loaded.叙事.lastCommittedMoment?.date).toBe('旅行历 1000.03.10');
    expect(loaded.世界.旅程天数).toBe(4);
    await settle();
    expect(live.世界.旅程天数).toBe(4);
    expect(live.叙事.variableBatches).toHaveLength(1);
    expect(model.call).toHaveBeenCalledTimes(1);
  });

  it('reloads the committed chapter and event times without re-aligning or restamping them', async () => {
    const before = createEmptyTeyvatGameState();
    before.turnCount = 7;
    before.世界.当前日期 = '旅行历 1000.03.10';
    before.世界.当前时间 = '14:00';
    before.世界.当前地点 = '璃月港';
    before.世界.旅程天数 = 4;
    before.世界.开局设定 = {
      来源: 'official', 主线启用: true, 地区ID: 'liyue', 地区名称: '璃月',
      章节锚点ID: 'liyue_ritual_incident', 章节锚点名称: '请仙典仪', 防回退规则: [],
    };
    const committedStory = 归一化剧情编织系统({
      当前系列ID: 'story_canon_teyvat_mondstadt_prologue_act1',
      系列列表: [归一化剧情编织系列({
        id: 'story_canon_teyvat_mondstadt_prologue_act1', 标题: '蒙德序章', 激活注入: true,
        分段列表: [归一化剧情编织分段({ id: 'mondstadt-1', 组号: 1, 标题: '捕风的异乡人', 处理状态: '已完成', 运行状态: '当前' }, 1)],
      }), 归一化剧情编织系列({
        id: 'story_canon_teyvat_liyue_chapter1', 标题: '璃月其一', 激活注入: false,
        分段列表: [归一化剧情编织分段({ id: 'liyue-1', 组号: 1, 标题: '请仙典仪', 处理状态: '已完成', 运行状态: '未开始' }, 1)],
      })],
    });
    const settled = commitTurnContext({
      game: { ...before, 叙事: { ...before.叙事, storyWeaving: fromLegacyStoryWeaving(committedStory) } },
      storyWeaving: committedStory,
      settlementId: 'settlement-7',
    });
    const withEvent = {
      ...settled.game,
      世界: { ...settled.game.世界, 世界事件: ['旅人在璃月港见到了安柏'] },
    };
    const committed = stampCommittedEventProvenance(before, withEvent, settled.context.moment);
    const saved = JSON.parse(JSON.stringify(committed));
    let replaced = createEmptyTeyvatGameState();
    const loaded = await executeTeyvatSaveLoadTransaction(saved, {
      classify: () => ({ kind: 'teyvat', state: saved }),
      replaceGameState: (next) => { replaced = next; },
    });
    expect(loaded).toEqual(replaced);
    expect(loaded.叙事.lastCommittedMoment).toEqual(settled.context.moment);
    expect(loaded.世界.旅程天数).toBe(4);
    expect(loaded.世界.世界事件记录[0]?.worldMoment).toEqual(settled.context.moment);
    expect(getCurrentStoryChapterLabel(toLegacyStoryWeaving(loaded.叙事.storyWeaving)))
      .toBe(getCurrentStoryChapterLabel(committedStory));
    const replay = stampCommittedEventProvenance(before, normalizeTeyvatGameState(loaded), settled.context.moment);
    expect(replay.世界.世界事件记录).toHaveLength(1);
  });
});
