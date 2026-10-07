import { describe, expect, it } from 'vitest';
import { deliverDueCourierSeeds, resolveSeedConversationType, seedQualifiesAsStoryGroup } from '@/services/ai/courierService';
import { getDefaultBuiltinAvatar, getBuiltinAvatarSet } from '@/data/builtinAvatars';
import { 创建NPC记录 } from '@/models/npc';
import type { CourierDeliverySeed, CourierSystem } from '@/models/teyvat/courier';

/**
 * 2026-10-03 玩家反馈两条：
 *  ① 「角色老是拉个群聊和我对话，这不是正常行为」；
 *  ② 「留云借风真君/闲云的头像没有显示」。
 *
 * ① 的现场：`deliverDueCourierSeeds` 见到 `targetType: 'group'` 的种子就**无条件新建群**并把玩家拉进去。
 *    现在默认关闭剧情建群（设置项 `手机系统.allowStoryCreatedGroups`），开启时也要求真实多人上下文。
 * ② 的现场：我把「闲云」并入原著身份「留云借风真君」后，头像查找只按正名匹配，
 *    而头像注册表里的素材名仍是「闲云」→ 查不到 → 头像消失。现在按 原始名/正名/正名别名 一起找。
 */

function seed(patch: Partial<CourierDeliverySeed> = {}): CourierDeliverySeed {
  return {
    id: 'seed_1',
    senderId: 'npc_amber',
    reason: '测试',
    turn: 1,
    source: 'main_story',
    triggerType: 'quest',
    priority: 'normal',
    targetType: 'private',
    targetId: '',
    title: '低语森林的调查结果',
    context: '安柏想知道调查结果。',
    relatedNpcIds: [],
    status: 'pending',
    scheduledAtTurn: 1,
    ...patch,
  } as CourierDeliverySeed;
}

const system = {
  contacts: [], conversations: [], letters: [], deliverySeeds: [], unreadTotal: 0, wallpapers: [],
} as unknown as CourierSystem;

describe('A 剧情不再默认把玩家拉进群聊', () => {
  it('默认（设置未开启）：群种子按私聊投递，并给出降级原因', () => {
    const groupSeed = seed({
      targetType: 'group',
      title: '骑士团频道',
      context: '几位骑士在群里同步巡逻情况。',
      relatedNpcIds: ['npc_kaeya'],
    });
    const result = deliverDueCourierSeeds(
      { ...system, deliverySeeds: [{ ...groupSeed, status: 'pending', scheduledAtTurn: 1 }] } as CourierSystem,
      2,
      Date.now(),
      { npcs: [], allowStoryCreatedGroups: false },
    );
    expect(result.next.conversations).toHaveLength(1);
    expect(result.next.conversations[0]!.type).toBe('private');
    expect(result.next.conversations[0]!.participantIds).toEqual(['player', 'npc_amber']);
    expect(result.groupDowngrades).toHaveLength(1);
    expect(result.groupDowngrades[0]!.reason).toContain('未允许剧情建群');
  });

  it('开启设置但缺少多人上下文时仍不建群', () => {
    const noSecondNpc = seed({ targetType: 'group', title: '骑士团频道', relatedNpcIds: [] });
    expect(seedQualifiesAsStoryGroup(noSecondNpc)).toBe(false);
    expect(resolveSeedConversationType(noSecondNpc, { allowStoryCreatedGroups: true })).toBe('private');

    const noGroupWording = seed({ targetType: 'group', title: '闲聊', context: '问问近况。', relatedNpcIds: ['npc_kaeya'] });
    expect(seedQualifiesAsStoryGroup(noGroupWording)).toBe(false);
    expect(resolveSeedConversationType(noGroupWording, { allowStoryCreatedGroups: true })).toBe('private');
  });

  it('开启设置且确有多人频道时允许建群', () => {
    const realGroup = seed({
      targetType: 'group',
      title: '骑士团频道',
      context: '几位骑士在群里同步巡逻情况。',
      relatedNpcIds: ['npc_kaeya'],
    });
    expect(seedQualifiesAsStoryGroup(realGroup)).toBe(true);
    expect(resolveSeedConversationType(realGroup, { allowStoryCreatedGroups: true })).toBe('group');
    const result = deliverDueCourierSeeds(
      { ...system, deliverySeeds: [{ ...realGroup, status: 'pending', scheduledAtTurn: 1 }] } as CourierSystem,
      2,
      Date.now(),
      { npcs: [], allowStoryCreatedGroups: true },
    );
    expect(result.next.conversations[0]!.type).toBe('group');
    expect(result.next.conversations[0]!.participantIds).toEqual(['player', 'npc_amber', 'npc_kaeya']);
  });

  it('私聊种子永远进私聊', () => {
    expect(resolveSeedConversationType(seed({ targetType: 'private' }), { allowStoryCreatedGroups: true })).toBe('private');
  });
});

describe('B 闲云/留云借风真君 的头像不再因为身份合并而丢失', () => {
  it('两个名字都能取到注册表里的头像素材', () => {
    const avatar = getDefaultBuiltinAvatar('闲云');
    expect(avatar).toBeTruthy();
    expect(getDefaultBuiltinAvatar('留云借风真君')).toBe(avatar);
    expect(getBuiltinAvatarSet('Xianyun')?.canonicalName).toBe('闲云');
  });

  it('其他原著角色不受影响（正名与别名一致解析）', () => {
    expect(getDefaultBuiltinAvatar('安柏')).toBe(getDefaultBuiltinAvatar('Amber'));
    expect(getDefaultBuiltinAvatar('琴')).toBeTruthy();
  });

  it('没有素材的自定义角色仍然返回 undefined（交给调用方回退首字）', () => {
    expect(getDefaultBuiltinAvatar('原创路人甲')).toBeUndefined();
  });

  it('NPC 记录的档案头像链路可用（读取NPC头像→内置头像）', async () => {
    const npc = { ...创建NPC记录({ 姓名: '闲云', 阶位: 'companion', 初见回合: 1 }), id: 'npc_xianyun' };
    const { 读取NPC头像 } = await import('@/models/npc');
    expect(读取NPC头像(npc, '正文') ?? getDefaultBuiltinAvatar(npc.姓名)).toBeTruthy();
  });
});
