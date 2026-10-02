import { describe, expect, it, vi } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import {
  appendMomentComment,
  composeMomentCommentLocally,
  createMoment,
  editMoment,
  markMomentTarget,
  momentCommentCapacity,
  parseMomentMentions,
} from '@/services/courierMoments';
import { runMomentComments } from '@/hooks/useGame/courierMomentWorkflow';

/**
 * 用户第 7 项：「朋友圈新增可以 @ 角色，并且发布后被 @ 的角色一定会回复」。
 *
 * 基线缺口（实测）：朋友圈实现了「自动评论」（好感度 > 100、最多 3 位、按动态 ID 哈希选人），
 * 但**完全没有 @ 机制**；而且名额硬编码 3 出现在 5 处（其中 2 处在存档归一化里），
 * 若 @ 目标排在第 4 位，运行时会被丢弃、读档后评论也会消失。
 */

const config: API配置项 = {
  id: 'test', name: 'test', provider: 'openai_compatible',
  baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1,
};

const contacts = [
  { id: 'c_amber', npcId: 'amber', name: '安柏', available: true },
  { id: 'c_lisa', npcId: 'lisa', name: '丽莎', available: true },
  { id: 'c_kaeya', npcId: 'kaeya', name: '凯亚', available: true },
];

function npc(id: string, 姓名: string, 好感度 = 120): NPC记录 {
  return { id, 姓名, 好感度, 关系: 'friend', 阶位: 'companion', 同行: false, 初见回合: 1, 最近回合: 1, 备注: [] } as NPC记录;
}

function 手机(overrides: Partial<CourierSystem> = {}): CourierSystem {
  return { ...createEmptyCourierSystem(), contacts: contacts.map((contact) => ({ ...contact })), ...overrides };
}

describe('朋友圈 @ 角色（2026-09-29 第 7 项）', () => {
  it('解析 @：带空格、带标点、不带空格都能命中，重复只算一次', () => {
    expect(parseMomentMentions('今天@安柏 和 ＠丽莎 一起出城。', contacts)).toEqual(['amber', 'lisa']);
    expect(parseMomentMentions('@安柏，你好', contacts)).toEqual(['amber']);
    // 群聊解析用 (?=\s|$|标点) 前瞻，这种写法不会命中；朋友圈必须命中（最长前缀匹配）。
    expect(parseMomentMentions('@安柏你好呀', contacts)).toEqual(['amber']);
    expect(parseMomentMentions('@安柏 @安柏', contacts)).toEqual(['amber']);
    expect(parseMomentMentions('今天天气不错', contacts)).toEqual([]);
    expect(parseMomentMentions('@某个不存在的人', contacts)).toEqual([]);
  });

  it('名额 = 3 + 点名人数（自动评论名额不被 @ 挤掉）', () => {
    expect(momentCommentCapacity({})).toBe(3);
    expect(momentCommentCapacity({ mentionIds: ['amber', 'lisa'] })).toBe(5);
  });

  it('运行时：@ 两位 + 自动三位可同时存在，第 6 位被拒', () => {
    const withMentions = createMoment(手机(), {
      id: 'm1', content: '@安柏 ＠丽莎 出发了', turn: 3, now: 1, mentionIds: ['amber', 'lisa'],
    });
    let system = withMentions;
    for (const npcId of ['amber', 'lisa', 'kaeya', 'jean', 'eula']) {
      system = markMomentTarget(system, 'm1', 1, npcId, 'done');
    }
    expect(system.moments?.[0]?.targets).toHaveLength(5);
    system = markMomentTarget(system, 'm1', 1, 'sixth', 'done');
    expect(system.moments?.[0]?.targets).toHaveLength(5);
    for (const npcId of ['amber', 'lisa', 'kaeya', 'jean', 'eula']) {
      system = appendMomentComment(system, 'm1', 1, { id: npcId, npcId, npcName: npcId, content: '收到。', createdAt: 1 });
    }
    expect(system.moments?.[0]?.comments).toHaveLength(5);
    const before = system.moments?.[0]?.comments.length;
    system = appendMomentComment(system, 'm1', 1, { id: 'sixth', npcId: 'sixth', npcName: 'sixth', content: '我也来。', createdAt: 1 });
    expect(system.moments?.[0]?.comments).toHaveLength(before!);
  });

  it('存档往返：点名与第 4、5 条评论都不会被归一化截断', () => {
    let system = createMoment(手机(), {
      id: 'm1', content: '@安柏 ＠丽莎 出发了', turn: 3, now: 1, mentionIds: ['amber', 'lisa'],
    });
    for (const npcId of ['amber', 'lisa', 'kaeya', 'jean', 'eula']) {
      system = markMomentTarget(system, 'm1', 1, npcId, 'generating');
      system = appendMomentComment(system, 'm1', 1, { id: npcId, npcId, npcName: npcId, content: '收到。', createdAt: 1 });
    }
    const roundTrip = normalizeCourierSystem(JSON.parse(JSON.stringify(system)));
    const post = roundTrip.moments?.[0];
    expect(post?.mentionIds).toEqual(['amber', 'lisa']);
    expect(post?.comments).toHaveLength(5);
    expect(post?.targets).toHaveLength(5);
  });

  it('编辑后重新解析 @（正文删掉点名就不再点名）', () => {
    const created = createMoment(手机(), { id: 'm1', content: '@安柏 出发了', turn: 3, now: 1, mentionIds: ['amber'] });
    const edited = editMoment(created, 'm1', '出发了', 2, []);
    expect(edited.moments?.[0]?.mentionIds).toBeUndefined();
  });

  it('被 @ 的角色即使模型失败也一定会得到回应，且标注为本地回应', async () => {
    const system = createMoment(手机(), {
      id: 'm1', content: '@安柏 我回来了', turn: 3, now: 1, mentionIds: ['amber'],
    });
    let live = system;
    await runMomentComments({
      getSessionId: () => 1,
      getCourier: () => live,
      setCourier: (update) => { live = update(live); },
      getNpcs: () => [npc('amber', '安柏')],
      getApiConfig: () => config,
      generateComment: vi.fn().mockRejectedValue(new Error('MODEL_DOWN')),
    }, 'm1', 1);
    const post = live.moments?.[0];
    expect(post?.comments).toHaveLength(1);
    expect(post?.comments[0]?.npcId).toBe('amber');
    expect(post?.comments[0]?.source).toBe('local');
    expect(post?.targets.find((target) => target.npcId === 'amber')?.status).toBe('done');
  });

  it('自动评论目标失败时仍然保持 failed（原契约不变：不得用套话伪装模型评论）', async () => {
    // 未预设 target：走自动评论选人路径（只有 amber 达标），失败后必须留 failed 供手动重试。
    const system: CourierSystem = {
      ...手机(),
      moments: [{
        id: 'm1', authorId: 'player', content: '今天天气不错', turn: 3, createdAt: 1, updatedAt: 1, revision: 1,
        targets: [], comments: [],
      }],
    };
    let live = system;
    await runMomentComments({
      getSessionId: () => 1,
      getCourier: () => live,
      setCourier: (update) => { live = update(live); },
      getNpcs: () => [npc('amber', '安柏')],
      getApiConfig: () => config,
      generateComment: vi.fn().mockRejectedValue(new Error('MODEL_DOWN')),
    }, 'm1', 1);
    const post = live.moments?.[0];
    expect(post?.comments).toHaveLength(0);
    expect(post?.targets.find((target) => target.npcId === 'amber')?.status).toBe('failed');
  });

  it('@ 目标与自动评论者取并集：点名不会挤掉自动评论', async () => {
    const system = createMoment(手机(), {
      id: 'm1', content: '@凯亚 出发了', turn: 3, now: 1, mentionIds: ['kaeya'],
    });
    let live = system;
    const asked: string[] = [];
    await runMomentComments({
      getSessionId: () => 1,
      getCourier: () => live,
      setCourier: (update) => { live = update(live); },
      // 只有 amber/lisa 达到自动评论门槛（>100），凯亚是 @ 点名。
      getNpcs: () => [npc('amber', '安柏'), npc('lisa', '丽莎'), npc('kaeya', '凯亚', 40)],
      getApiConfig: () => config,
      generateComment: async (_config, input) => { asked.push(input.npc.id); return '收到。'; },
    }, 'm1', 1);
    expect(asked).toContain('kaeya');
    expect(asked.length).toBeGreaterThan(1);
    expect(live.moments?.[0]?.comments.length).toBe(asked.length);
  });

  it('本地写作器满足评论长度约束并以句末标点收尾（角色名由面板渲染，不重复写进正文）', () => {
    const text = composeMomentCommentLocally(npc('amber', '安柏'), { content: '今天在风起地遇到了很多丘丘人，差点没能回来' });
    expect([...text].length).toBeLessThanOrEqual(120);
    expect(/[。！？…」]$/u.test(text)).toBe(true);
    expect(text).toContain('今天在风起地');
    const long = composeMomentCommentLocally(npc('amber', '安柏'), { content: '风'.repeat(500) });
    expect([...long].length).toBeLessThanOrEqual(120);
    expect(/[。！？…」]$/u.test(long)).toBe(true);
  });

  it('未被点名的角色低于好感度门槛时不会自动评论', async () => {
    const system = createMoment(手机(), { id: 'm1', content: '今天天气不错', turn: 3, now: 1 });
    let live = system;
    const asked: string[] = [];
    await runMomentComments({
      getSessionId: () => 1,
      getCourier: () => live,
      setCourier: (update) => { live = update(live); },
      getNpcs: () => [npc('amber', '安柏', 40)],
      getApiConfig: () => config,
      generateComment: async (_config, input) => { asked.push(input.npc.id); return '收到。'; },
    }, 'm1', 1);
    expect(asked).toEqual([]);
  });
});
