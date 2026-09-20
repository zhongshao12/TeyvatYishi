import { describe, expect, it } from 'vitest';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { normalizeIrminsulMemory } from '@/models/teyvat/irminsul';
import { buildMainRecallStage } from '@/hooks/useGame/mainRecallStage';

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
