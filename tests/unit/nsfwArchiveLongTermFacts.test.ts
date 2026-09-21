import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '@/hooks/useGame/systemPromptBuilder';
import { 创建空角色 } from '@/models/character';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认游戏设置 } from '@/models/settings';
import { 创建空世界状态 } from '@/models/world';
import type { NPC记录 } from '@/models/npc';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';

/**
 * 「NSFW 档案里的长期事实没有发生作用」的两个成因，这里都锁住：
 * 1. 补全器把 标签/备注/长期事实 **整体删除**（只要非空就删）→ 真实长期事实下一回合消失；
 * 2. `matureArchive` 从未进入任何提示词 → 即使数据还在，正文也不会承接。
 */

const npc = (patch: Partial<NPC记录> = {}): NPC记录 => ({
  id: 'npc_lisa', 姓名: '丽莎', 别名: '', 阶位: 'companion', 好感度: 20, 关系: 'friend',
  亲密关系: true, 同行: false, 初见回合: 1, 最近回合: 5, 备注: [], ...patch,
} as NPC记录);

const enrich = (record: NPC记录) =>
  enrichNpcArchives([record], { nsfwEnabled: true, maleNsfwArchiveEnabled: false }).records[0]!;

const DURABLE = {
  enabled: true,
  年龄确认: 'adult' as const,
  长期事实: ['双方约定亲密互动前先确认边界。'],
  边界: '仅限私下场合，公开场合保持图书管理员与访客的距离。',
  禁忌: ['不得提及实验往事'],
  偏好: ['薰衣草香'],
  亲密阶段: '已建立亲密关系',
};

const buildPrompt = (records: NPC记录[], enableNsfw: boolean) => buildSystemPrompt(
  创建空角色(),
  创建空世界状态(),
  创建空记忆系统(),
  { ...创建默认游戏设置(), enableNsfw },
  5,
  undefined,
  undefined,
  records,
).systemPrompt;

describe('NSFW 档案长期事实的持久化', () => {
  it('keeps durable facts through archive enrichment', () => {
    const result = enrich(npc({ NSFW档案: { ...DURABLE } }));

    expect(result.NSFW档案?.长期事实).toEqual(DURABLE.长期事实);
    expect(result.NSFW档案?.边界).toBe(DURABLE.边界);
    expect(result.NSFW档案?.禁忌).toEqual(DURABLE.禁忌);
    expect(result.NSFW档案?.偏好).toEqual(DURABLE.偏好);
  });

  it('still cleans the legacy conservative-baseline placeholders', () => {
    const result = enrich(npc({
      NSFW档案: {
        enabled: true,
        年龄确认: 'adult',
        长期事实: ['保守基线', '真正的长期事实'],
        标签: ['等待剧情事实补充', '真心'],
        备注: '不代表已发生亲密剧情',
      },
    }));

    expect(result.NSFW档案?.长期事实).toEqual(['真正的长期事实']);
    expect(result.NSFW档案?.标签).toEqual(['真心']);
    expect(result.NSFW档案?.备注).toBeUndefined();
  });

  it('keeps an empty archive empty instead of inventing facts', () => {
    const result = enrich(npc({ NSFW档案: { enabled: true, 年龄确认: 'adult' } }));

    expect(result.NSFW档案?.长期事实 ?? []).toEqual([]);
  });
});

describe('NSFW 长期事实进入正文提示词', () => {
  it('injects the established facts while NSFW is enabled', () => {
    const prompt = buildPrompt([npc({ NSFW档案: { ...DURABLE } })], true);

    expect(prompt).toContain('已确立的亲密长期事实');
    expect(prompt).toContain('双方约定亲密互动前先确认边界。');
    expect(prompt).toContain('不得提及实验往事');
    expect(prompt).toContain('仅限私下场合');
  });

  it('does not inject them while NSFW is disabled', () => {
    const prompt = buildPrompt([npc({ NSFW档案: { ...DURABLE } })], false);

    expect(prompt).not.toContain('已确立的亲密长期事实');
    expect(prompt).not.toContain('双方约定亲密互动前先确认边界。');
  });

  it('skips characters without durable intimate facts', () => {
    const prompt = buildPrompt([npc({ NSFW档案: { enabled: true, 年龄确认: 'adult', 偏好: [], 长期事实: [] } })], true);

    expect(prompt).not.toContain('已确立的亲密长期事实');
  });
});
