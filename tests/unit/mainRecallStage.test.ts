import { describe, expect, it } from 'vitest';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { normalizeIrminsulMemory } from '@/models/teyvat/irminsul';
import { buildMainRecallStage } from '@/hooks/useGame/mainRecallStage';
import { buildSystemPrompt } from '@/hooks/useGame/systemPromptBuilder';
import { 创建空角色 } from '@/models/character';
import { 创建空世界状态 } from '@/models/world';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认游戏设置 } from '@/models/settings';

const codex = normalizeArchiveCodex({
  entries: [{
    id: 'knights',
    name: '西风骑士团',
    category: 'organization',
    summary: '蒙德的守护组织。',
    description: '琴担任代理团长。',
    keywords: ['骑士团', '琴'],
    tags: ['蒙德'],
    triggerKeywords: ['西风骑士团'],
    injection: { publicText: '西风骑士团守护蒙德。' },
    runtimeUnlock: { status: 'unlocked', note: '' },
    usage: { narrative: true },
    relatedEntryIds: [],
  }],
  unlockedEntryIds: ['knights'],
});

const irminsul = normalizeIrminsulMemory({
  entries: [{
    id: 'amber-memory',
    title: '初到蒙德',
    summary: '安柏带旅行者进入蒙德城。',
    sourceText: '旅行者与安柏同行。',
    keywords: ['安柏', '蒙德'],
    sourceTurns: [2],
  }],
});

const baseInput = {
  isOpeningSystemTrigger: false,
  turnCount: 12,
  memoryInjectionEnabled: true,
  memorySettings: {
    irminsulEnabled: true,
    earliestRecallTurn: 10,
    recallLimit: 8,
  },
  codexSettings: {
    enabled: true,
    aiSupplementEnabled: false,
    maxRelatedEntries: 5,
  },
  memoryCounts: { short: 2, medium: 1, long: 1, immediate: 3 },
  irminsul,
  codex,
  recallQuery: '玩家当前输入：我想起安柏带我进入蒙德城。',
  codexRecallQuery: '玩家当前输入：我想去西风骑士团找琴。',
};

describe('main recall stage', () => {
  it.each(['place', 'term', 'story'] as const)('delivers locked %s reference through the main prompt without granting NPC knowledge', category => {
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0]!, id: category, name: '明灯', category,
      keywords: ['明灯'], triggerKeywords: ['明灯'], tags: [], summary: '尚未解锁的明灯资料', description: '',
      injection: { publicText: '明灯的条目事实' }, runtimeUnlock: { status: 'locked', note: '' } },
      { ...codex.entries[0]!, id: 'unrelated', name: '无关商会', keywords: ['商会'], triggerKeywords: ['商会'], tags: [], summary: '无关商会资料', description: '', injection: { publicText: '不应发送的无关资料' } }], unlockedEntryIds: [] });
    const stage = buildMainRecallStage({ ...baseInput, codex: archive, codexRecallQuery: '请查询明灯' });
    const prompt = buildSystemPrompt(创建空角色(), 创建空世界状态(), 创建空记忆系统(), 创建默认游戏设置(), 12,
      undefined, undefined, [], undefined, undefined, undefined, archive, undefined, undefined, undefined, undefined, stage.codexPreview?.injection).systemPrompt;
    expect(prompt).toContain('明灯的条目事实');
    expect(prompt).not.toContain('不应发送的无关资料');
    expect(prompt).toContain('不是 NPC 已知信息');
    expect(archive.unlockedEntryIds).toEqual([]);
  });
  it('builds ranked Codex and Irminsul previews plus upload diagnostics', () => {
    const result = buildMainRecallStage(baseInput);

    expect(result.irminsulRecallEnabled).toBe(true);
    expect(result.codexRecallEnabled).toBe(true);
    expect(result.irminsulPreview?.entries.map((entry) => entry.id)).toEqual(['amber-memory']);
    expect(result.codexPreview?.entries.map((entry) => entry.id)).toEqual(['knights']);
    expect(result.summary).toContain('西风骑士团');
    expect(result.fullContent).toContain('安柏带旅行者进入蒙德城');
    expect(result.workflowHint).toContain('剧情回忆已命中');
  });

  it('disables both retrieval systems during the opening system turn', () => {
    const result = buildMainRecallStage({ ...baseInput, isOpeningSystemTrigger: true });

    expect(result.irminsulRecallEnabled).toBe(false);
    expect(result.codexRecallEnabled).toBe(false);
    expect(result.irminsulPreview).toBeNull();
    expect(result.codexPreview).toBeNull();
    expect(result.workflowHint).toContain('开局专用上下文已注入');
  });
});
