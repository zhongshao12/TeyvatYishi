import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hydratePersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { 归一化剧情编织系列, 归一化剧情编织系统 } from '@/models/storyWeaving';
import { buildStoryWeavingInjection } from '@/services/storyWeaving';

describe('bundled mainline hydration into divergent saves', () => {
  it('loads new scenes without replaying a skipped legacy segment', () => {
    const raw = JSON.parse(readFileSync(resolve('public/data/story-weaving-canon/story_canon_teyvat_mondstadt_prologue_act1.json'), 'utf8'));
    const bundledSeries = 归一化剧情编织系列(raw);
    const [first, second] = bundledSeries.分段列表;
    expect(first?.场景节点?.length).toBeGreaterThan(0);
    expect(second?.场景节点?.length).toBeGreaterThan(0);
    const savedSeries = 归一化剧情编织系列({
      ...bundledSeries,
      分段列表: bundledSeries.分段列表.map((segment, index) => ({
        ...segment,
        场景节点: undefined,
        本段概括: '旧存档文案不应再投递',
        运行状态: index === 0 ? '已跳过' : index === 1 ? '当前' : '未开始',
      })),
    });
    const saved = 归一化剧情编织系统({
      系列列表: [savedSeries],
      当前系列ID: bundledSeries.id,
      当前进度: {
        当前系列ID: bundledSeries.id,
        当前分段ID: first!.id,
        当前分段组号: first!.组号,
        推进状态: '已偏离',
        已完成摘要: [],
        当前待解问题: [],
        切换说明: [],
        历史归档: [],
        最近判定理由: [],
        updatedAt: 1,
      },
    });
    const bundled = 归一化剧情编织系统({ 系列列表: [bundledSeries], 当前系列ID: bundledSeries.id });

    const hydrated = hydratePersistedStoryWeavingSystem(saved, bundled);
    expect(hydrated.系列列表[0]?.分段列表[0]?.运行状态).toBe('已跳过');
    expect(hydrated.系列列表[0]?.分段列表[1]?.场景节点?.length).toBeGreaterThan(0);
    const injection = buildStoryWeavingInjection(hydrated, {
      currentLocation: second!.场景节点![0]!.地点,
      recentUserInput: '我继续调查眼前的线索，不回头重演旧章节',
      recentAIResponse: '',
    });
    expect(injection).toContain(second!.场景节点![0]!.标题);
    expect(injection).toContain('已偏离');
    expect(injection).not.toContain(first!.场景节点![0]!.目标);
    expect(injection).not.toContain('旧存档文案不应再投递');
  });
});
