import { describe, expect, it } from 'vitest';
import { createEmptyCourierSystem, type CourierDeliverySeed, type CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import {
  PROACTIVE_CONTACT_INTERVAL_TURNS,
  PROACTIVE_CONTACT_MIN_AFFINITY,
  planProactiveContacts,
} from '@/services/proactiveContacts';
import { runCourierDeliveryTask } from '@/hooks/useGame/courierBackgroundJobs';

/**
 * 用户第 4 项「增加角色主动行为」。
 *
 * 规则来自仓库自己的规格（`docs/superpowers/specs/2026-09-29-world-moment-and-chapter-boundary-design.md:63`）：
 * 只限已有手机联系人、好感度至少 100、只按游戏世界时间推进、每完成 15 个游戏回合最多一位、全局冷却。
 */

function 角色(overrides: Partial<NPC记录> & { id: string; 姓名: string }): NPC记录 {
  return {
    阶位: 'companion', 好感度: PROACTIVE_CONTACT_MIN_AFFINITY, 关系: '朋友', 同行: false,
    初见回合: 1, 最近回合: 30, 同行记忆: [], 未完成事项: [], 未解决冲突: [],
    ...overrides,
  } as NPC记录;
}

function 手机(contactIds: string[]): CourierSystem {
  return {
    ...createEmptyCourierSystem(),
    contacts: contactIds.map((id) => ({ id, name: id, available: true })),
  };
}

function 主动种子(turn: number): CourierDeliverySeed {
  return {
    id: `seed_${turn}`, senderId: 'amber', reason: '主动联系', turn, source: 'memory',
    triggerType: 'relationship', priority: 'normal', targetType: 'private', targetId: 'amber',
    title: '安柏主动来找你', context: '', relatedNpcIds: ['amber'],
    relatedEventId: `proactive:day1:silence:amber`, status: 'generated',
  };
}

describe('角色主动行为（2026-09-29 第 4 项）', () => {
  it('好感度达标且有手机联系人的角色会主动联系', () => {
    const plan = planProactiveContacts({
      courier: 手机(['amber']), npcs: [角色({ id: 'amber', 姓名: '安柏', 最近回合: 1 })],
      turn: 30, travelDay: 9, location: '蒙德城', clock: '10:00',
    });
    expect(plan.seeds).toHaveLength(1);
    const seed = plan.seeds[0]!;
    expect(seed.senderId).toBe('amber');
    expect(seed.targetType).toBe('private');
    expect(seed.status).toBe('pending');
    expect(seed.relatedEventId).toBe('proactive:day9:silence:amber');
    expect(seed.context).toContain('好感度 100');
  });

  it('好感度低于 100 不主动（规格硬门槛）', () => {
    const plan = planProactiveContacts({
      courier: 手机(['amber']), npcs: [角色({ id: 'amber', 姓名: '安柏', 好感度: 99, 最近回合: 1 })],
      turn: 30, travelDay: 9,
    });
    expect(plan.seeds).toEqual([]);
    expect(plan.skippedReason).toContain('100');
  });

  it('不是手机联系人的角色不主动（规格硬门槛）', () => {
    const plan = planProactiveContacts({
      courier: 手机([]), npcs: [角色({ id: 'amber', 姓名: '安柏' })],
      turn: 30, travelDay: 9,
    });
    expect(plan.seeds).toEqual([]);
    expect(plan.skippedReason).toContain('手机联系人');
  });

  it('敌对关系不主动', () => {
    const plan = planProactiveContacts({
      courier: 手机(['amber']), npcs: [角色({ id: 'amber', 姓名: '安柏', 关系: 'enemy' })],
      turn: 30, travelDay: 9,
    });
    expect(plan.seeds).toEqual([]);
  });

  it('全局冷却：距上次主动联系不足 15 个回合不再打扰', () => {
    const courier = { ...手机(['amber']), deliverySeeds: [主动种子(20)] };
    const plan = planProactiveContacts({
      courier, npcs: [角色({ id: 'amber', 姓名: '安柏' })], turn: 20 + PROACTIVE_CONTACT_INTERVAL_TURNS - 1, travelDay: 9,
    });
    expect(plan.seeds).toEqual([]);
    expect(plan.skippedReason).toContain(String(PROACTIVE_CONTACT_INTERVAL_TURNS));
  });

  it('满 15 个回合后可以再次主动联系', () => {
    const courier = { ...手机(['amber']), deliverySeeds: [主动种子(20)] };
    const plan = planProactiveContacts({
      courier, npcs: [角色({ id: 'amber', 姓名: '安柏', 最近回合: 1 })], turn: 20 + PROACTIVE_CONTACT_INTERVAL_TURNS, travelDay: 12,
    });
    expect(plan.seeds).toHaveLength(1);
    expect(plan.seeds[0]!.relatedEventId).toBe('proactive:day12:silence:amber');
  });

  it('同一天不重复打扰同一位角色（幂等键挂在 relatedEventId 上）', () => {
    const first = planProactiveContacts({
      courier: 手机(['amber']), npcs: [角色({ id: 'amber', 姓名: '安柏' })], turn: 30, travelDay: 9,
    });
    const courier = { ...手机(['amber']), deliverySeeds: [{ ...first.seeds[0]!, status: 'generated' as const }] };
    const second = planProactiveContacts({
      courier, npcs: [角色({ id: 'amber', 姓名: '安柏' })], turn: 45, travelDay: 9,
    });
    expect(second.seeds).toEqual([]);
    expect(second.skippedReason).toContain('今天');
  });

  it('有未完成约定时优先按「旧约未了」主动联系', () => {
    const plan = planProactiveContacts({
      courier: 手机(['amber']),
      npcs: [角色({ id: 'amber', 姓名: '安柏', 未完成事项: ['答应带旅行者去看风起地的大树'], 最近回合: 25 })],
      turn: 30, travelDay: 9,
    });
    expect(plan.seeds[0]!.relatedEventId).toContain('promise_due');
    expect(plan.seeds[0]!.context).toContain('风起地');
  });

  it('多人达标时只选一位，且优先关系更深、记忆更多的一方', () => {
    const plan = planProactiveContacts({
      courier: 手机(['amber', 'lisa']),
      npcs: [
        角色({ id: 'amber', 姓名: '安柏', 好感度: 100, 最近回合: 29, 同行记忆: [{ 回合: 2, 摘要: '一起清剿丘丘人营地' } as never] }),
        角色({ id: 'lisa', 姓名: '丽莎', 好感度: 140, 最近回合: 29, 同行: true, 同行记忆: [{ 回合: 3, 摘要: '一起整理图书馆藏书' } as never, { 回合: 4, 摘要: '约定研究元素反应' } as never] }),
      ],
      turn: 30, travelDay: 9,
    });
    expect(plan.seeds).toHaveLength(1);
    expect(plan.seeds[0]!.senderId).toBe('lisa');
  });

  it('联系人是同一 NPC 的 npcId 绑定时也算已建立联系人', () => {
    const courier: CourierSystem = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'contact_lisa', npcId: 'lisa', name: '丽莎', available: true }],
    };
    const plan = planProactiveContacts({
      courier, npcs: [角色({ id: 'lisa', 姓名: '丽莎' })], turn: 30, travelDay: 9,
    });
    expect(plan.seeds).toHaveLength(1);
  });

  it('投递任务优先投递主动来信，且不再叠加通用跟进兜底', async () => {
    const plan = planProactiveContacts({
      courier: 手机(['amber']), npcs: [角色({ id: 'amber', 姓名: '安柏', 最近回合: 1 })], turn: 30, travelDay: 9,
    });
    expect(plan.seeds).toHaveLength(1);
    const result = await runCourierDeliveryTask({
      enabled: true, autoGenerateSeeds: true, courier: 手机(['amber']),
      npcs: [角色({ id: 'amber', 姓名: '安柏', 最近回合: 1 })],
      turn: 30, now: 1_700_000_000_000, userInput: '我们继续赶路。', body: '队伍沿官道前进。',
      maxSeedsPerTurn: 1, contactCooldownTurns: 3, letterApiConfig: null,
      proactiveSeeds: plan.seeds,
    });
    const proactive = result.courier.deliverySeeds.filter((seed) => seed.relatedEventId?.startsWith('proactive:'));
    const fallback = result.courier.deliverySeeds.filter((seed) => seed.id.includes('courier_seed_fallback'));
    expect(proactive).toHaveLength(1);
    expect(fallback).toHaveLength(0);
    // 种子被标记为已生成（进入来信流水线），而不是停在 pending。
    expect(proactive[0]!.status).not.toBe('pending');
  });
});
