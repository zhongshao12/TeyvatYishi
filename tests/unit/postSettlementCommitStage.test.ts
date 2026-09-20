import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { 创建空剧情编织系统, type 剧情编织系统 } from '@/models/storyWeaving';
import {
  buildSettlementCommitFeedback,
  buildStoryProgressMemoryLine,
  preparePostSettlementNpcState,
  planPostSettlementStoryAlignment,
  publishSettlementCommitFeedback,
  resolveStoryWeavingForBackgroundWrite,
} from '@/hooks/useGame/postSettlementCommitStage';

describe('post settlement commit stage', () => {
  it('builds and publishes talent, quest and variable feedback through injected effects', () => {
    const feedback = buildSettlementCommitFeedback({
      beforeTalents: [{ id: 'wind', 名称: '风涡剑', 等级: 2 }],
      afterTalents: [{ id: 'wind', 名称: '风涡剑', 等级: 3 }],
      questEnabled: true,
      committedQuestUpdate: '完成任务：捕风的异乡人',
      variableApplied: true,
    });
    const queue: string[] = [];
    const toast: string[] = [];
    const questNotifications: Array<string | undefined> = [];

    publishSettlementCommitFeedback(feedback, {
      queue: (task, status, detail) => queue.push(`${task}:${status}:${detail}`),
      toast: (_kind, title, detail) => toast.push(`${title}:${detail}`),
      notifyQuest: (detail) => questNotifications.push(detail),
    });

    expect(queue).toEqual([
      'variable:success:天赋成长：风涡剑 升至 Lv.3。',
      'quest:success:完成任务：捕风的异乡人',
      'variable:success:回复后的变量命令已落地。',
    ]);
    expect(toast).toEqual(['天赋成长:风涡剑 Lv.3']);
    expect(questNotifications).toEqual(['完成任务：捕风的异乡人']);
  });

  it('compresses NPC ledgers and merges summary names into the variable debug payload', () => {
    const npc = 创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 初见回合: 1, 原著角色: true });
    npc.同行记忆 = Array.from({ length: 5 }, (_, index) => ({
      id: `memory-${index}`,
      回合: index + 1,
      摘要: `与安柏共同完成第 ${index + 1} 次侦察任务，并记录了清晰的行动结果。`,
      来源: '正文' as const,
    }));

    const prepared = preparePostSettlementNpcState({
      source: [npc],
      nsfwEnabled: false,
      maleNsfwArchiveEnabled: false,
      compressionThreshold: 3,
      compressionPrompt: '',
      turn: 6,
      variableDebug: {
        updatedNames: ['安柏'],
        memoryAppended: ['安柏'],
        ledgerFieldsUpdated: [],
        summaryTriggered: [],
        warnings: [],
      },
    });

    expect(prepared.changed).toBe(true);
    expect(prepared.records[0]?.总结记忆?.length).toBeGreaterThan(0);
    expect(prepared.debug?.summaryTriggered).toEqual(['安柏']);
  });

  it('preserves a committed quest notification even when the quest panel is disabled', () => {
    const feedback = buildSettlementCommitFeedback({
      beforeTalents: [],
      afterTalents: [],
      questEnabled: false,
      committedQuestUpdate: '隐藏任务状态已结算',
      variableApplied: false,
    });
    const notifications: Array<string | undefined> = [];

    publishSettlementCommitFeedback(feedback, {
      queue: () => undefined,
      toast: () => undefined,
      notifyQuest: (detail) => notifications.push(detail),
    });

    expect(feedback.quest.status).toBe('skipped');
    expect(notifications).toEqual(['隐藏任务状态已结算']);
  });

  it('formats an advanced story checkpoint as durable memory', () => {
    const before = 创建空剧情编织系统();
    const after: 剧情编织系统 = {
      ...before,
      当前系列ID: 'mondstadt',
      系列列表: [{
        id: 'mondstadt', 标题: '蒙德序章', 作品名: '原神', 来源类型: 'canon', 来源图鉴条目ID: [],
        章节列表: [], 分段列表: [], 每段章数: 1, 激活注入: true, 当前分段组号: 2,
        当前阶段概括: '', 核心角色摘要: [], 核心角色: [], 涉及地点索引: [], 涉及派系索引: [],
        createdAt: 1, updatedAt: 2,
      }],
      当前进度: {
        当前系列ID: 'mondstadt', 当前分段组号: 2, 推进状态: '推进中', 已完成摘要: ['完成第一幕'],
        当前待解问题: ['风魔龙的去向'], 切换说明: [], 历史归档: [], 最近判定理由: ['正文已进入骑士团总部'],
        updatedAt: 2,
      },
    };

    expect(buildStoryProgressMemoryLine(before, after)).toContain('蒙德序章 当前进入第 2 段');
    expect(buildStoryProgressMemoryLine(before, after)).toContain('待解：风魔龙的去向');
  });

  it('keeps the proposed story write when the persisted base has not changed', async () => {
    const base = 创建空剧情编织系统();
    const proposed = { ...base, 当前系列ID: 'proposal' };

    await expect(resolveStoryWeavingForBackgroundWrite({
      workflowBase: base,
      proposed,
      loadLatest: async () => base,
    })).resolves.toEqual({ system: proposed, concurrentChange: false });
  });

  it('skips automatic story alignment during the opening system turn', () => {
    const story = 创建空剧情编织系统();

    const plan = planPostSettlementStoryAlignment({
      openingSystemTurn: true,
      storyWeaving: story,
      turn: 1,
      userInput: '',
      body: '开局正文',
    });

    expect(plan).toEqual({
      alignment: { system: story, changed: false, progressed: false },
      memoryLine: '',
    });
  });
});
