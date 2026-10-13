import type { CourierDeliverySeed, CourierSystem } from '@/models/teyvat/courier';
import { 提取NPC同行记忆文本列表, type NPC记录 } from '@/models/npc';

/**
 * 角色主动行为（2026-09-29，用户第 4 项）。
 *
 * 规则不是本节新定的 —— `docs/superpowers/specs/2026-09-29-world-moment-and-chapter-boundary-design.md:63`
 * 已确认：**只限已有手机联系人、好感度至少 100、只按游戏世界时间推进、每完成 15 个游戏回合最多
 * 一位角色主动联系玩家、采用全局冷却**。
 *
 * 本模块只做一件事：把「谁、为什么、现在该不该找你」算成一条 `CourierDeliverySeed`，
 * 交给既有投递链路（`processScheduledCourierSeeds` → 来信 → 未读 → 记忆回写）——
 * **0 新 schema、0 新 UI**。幂等键挂在既有的 `relatedEventId` 上（该字段此前是死字段）。
 */

export const PROACTIVE_CONTACT_MIN_AFFINITY = 100;
/** 全局冷却 / 节奏：每 15 个游戏回合最多一位角色主动联系。 */
export const PROACTIVE_CONTACT_INTERVAL_TURNS = 15;
/** 玩家沉默多久算「久未联系」，用于推导主动来信的理由。 */
export const PROACTIVE_CONTACT_SILENCE_TURNS = 15;
export const PROACTIVE_CONTACT_EVENT_PREFIX = 'proactive:';

export interface ProactiveContactInput {
  courier: CourierSystem;
  npcs: readonly NPC记录[];
  /** 已提交的回合号（游戏世界时间的推进单位）。 */
  turn: number;
  /** 旅行天数（游戏世界日期），用于「同一天不重复打扰」。 */
  travelDay: number;
  location?: string;
  weather?: string;
  clock?: string;
}

export interface ProactiveContactPlan {
  seeds: CourierDeliverySeed[];
  /** 未产出种子时的可读原因（供失败结算中心/诊断展示，不静默）。 */
  skippedReason?: string;
}

function 是手机联系人(courier: CourierSystem, npc: NPC记录, npcs: readonly NPC记录[]): boolean {
  return courier.contacts.some((contact) =>
    contact.available && (!contact.status || contact.status === 'available')
    && (contact.npcId ? contact.npcId === npc.id : contact.id === npc.id
      || (Boolean(contact.name?.trim()) && npcs.filter(candidate =>
        candidate.姓名 === contact.name.trim() || candidate.别名 === contact.name.trim()).length === 1
        && (contact.name.trim() === npc.姓名 || contact.name.trim() === npc.别名))));
}

function 提取主动联系回合(seeds: readonly CourierDeliverySeed[]): number {
  return seeds.reduce((latest, seed) => (
    typeof seed.relatedEventId === 'string' && seed.relatedEventId.startsWith(PROACTIVE_CONTACT_EVENT_PREFIX)
      ? Math.max(latest, Number(seed.turn) || 0)
      : latest
  ), 0);
}

type 主动触发 = 'promise_due' | 'silence' | 'relationship';

function 推导触发(npc: NPC记录, turn: number): { trigger: 主动触发; reason: string } {
  const 最近 = Number(npc.最近回合 || 0);
  const 沉默 = turn - 最近;
  const 未完成事项 = (npc.未完成事项 ?? []).filter((item) => typeof item === 'string' && item.trim());
  if (未完成事项.length && 沉默 >= 3) {
    return { trigger: 'promise_due', reason: `旧约未了：${未完成事项[未完成事项.length - 1]!.replace(/\s+/g, ' ').trim().slice(0, 60)}` };
  }
  if (沉默 >= PROACTIVE_CONTACT_SILENCE_TURNS) {
    return { trigger: 'silence', reason: `已有 ${沉默} 个回合没有联系；牵挂旅行者的近况与安危` };
  }
  return { trigger: 'relationship', reason: '关系已足够亲近，主动问候并延续近期共同经历' };
}

/**
 * 选出本回合该主动联系玩家的角色（最多一位），产出可直接投递的来信种子。
 * 纯函数：相同输入必得相同输出，便于测试与在恢复/重放路径上复用。
 */
export function planProactiveContacts(input: ProactiveContactInput): ProactiveContactPlan {
  const turn = Math.max(0, Math.trunc(input.turn) || 0);
  if (turn < PROACTIVE_CONTACT_INTERVAL_TURNS) return { seeds: [], skippedReason: `未完成 ${PROACTIVE_CONTACT_INTERVAL_TURNS} 个游戏回合` };
  const 上次主动 = 提取主动联系回合(input.courier.deliverySeeds);
  if (上次主动 > 0 && turn - 上次主动 < PROACTIVE_CONTACT_INTERVAL_TURNS) {
    return { seeds: [], skippedReason: `距上次主动联系仅 ${turn - 上次主动} 个回合，未到 ${PROACTIVE_CONTACT_INTERVAL_TURNS} 回合节奏` };
  }

  const 候选人 = input.npcs
    .filter((npc) => Number(npc.好感度 || 0) >= PROACTIVE_CONTACT_MIN_AFFINITY)
    .filter((npc) => npc.关系 !== 'enemy')
    .filter((npc) => 是手机联系人(input.courier, npc, input.npcs));
  if (!候选人.length) {
    return {
      seeds: [],
      skippedReason: input.npcs.some((npc) => Number(npc.好感度 || 0) >= PROACTIVE_CONTACT_MIN_AFFINITY)
        ? `好感度 ≥ ${PROACTIVE_CONTACT_MIN_AFFINITY} 的角色里没有已建立手机联系人的对象`
        : `没有好感度 ≥ ${PROACTIVE_CONTACT_MIN_AFFINITY} 的手机联系人`,
    };
  }

  const 评分 = (npc: NPC记录): number => {
    const 最近 = Number(npc.最近回合 || 0);
    const 记忆数 = 提取NPC同行记忆文本列表(npc).length;
    const 未完成 = (npc.未完成事项 ?? []).length;
    const 冲突 = (npc.未解决冲突 ?? []).length;
    return (
      Math.min(30, Math.trunc(Number(npc.好感度 || 0) / 5))
      + (未完成 ? 25 : 0)
      + (冲突 ? 15 : 0)
      + (npc.同行 ? 20 : 0)
      + Math.min(12, 记忆数 * 3)
      // 越久没互动越该主动，但最多抵消 20 分，避免长期沉默角色垄断名额。
      - Math.min(20, Math.max(0, turn - 最近) * 0.8)
    );
  };
  const 目标 = [...候选人].sort((a, b) => 评分(b) - 评分(a) || String(a.id).localeCompare(String(b.id)))[0]!;
  const { trigger, reason } = 推导触发(目标, turn);
  const relatedEventId = `${PROACTIVE_CONTACT_EVENT_PREFIX}day${Math.max(0, Math.trunc(input.travelDay) || 0)}:${trigger}:${目标.id}`;
  // 「同一天不重复打扰」按 **日 + 角色** 判定（不区分触发类型）：否则同一天里换个理由就能再打扰一次。
  const 今日前缀 = `${PROACTIVE_CONTACT_EVENT_PREFIX}day${Math.max(0, Math.trunc(input.travelDay) || 0)}:`;
  if (input.courier.deliverySeeds.some((seed) => (
    typeof seed.relatedEventId === 'string'
    && seed.relatedEventId.startsWith(今日前缀)
    && seed.relatedEventId.endsWith(`:${目标.id}`)
  ))) {
    return { seeds: [], skippedReason: `今天已经打扰过 ${目标.姓名}` };
  }

  const 环境 = [
    input.location ? `地点：${input.location}` : '',
    input.weather ? `天气：${input.weather}` : '',
    input.clock ? `时刻：${input.clock}` : '',
  ].filter(Boolean).join('；');
  const 记忆 = 提取NPC同行记忆文本列表(目标).slice(-1)[0];
  const seed: CourierDeliverySeed = {
    id: `courier_seed_proactive_${turn}_${目标.id}_${trigger}`,
    senderId: 目标.id,
    reason: `主动联系（${trigger}）：${reason}`,
    turn,
    source: 'memory',
    triggerType: trigger === 'promise_due' ? 'quest' : 'relationship',
    priority: 'normal',
    targetType: 'private',
    targetId: 目标.id,
    title: `${目标.姓名}主动来找你`,
    context: [
      `${目标.姓名}与旅行者关系亲近（好感度 ${Number(目标.好感度 || 0)}），本回合主动联系。`,
      `主动理由：${reason}。`,
      记忆 ? `最近共同经历：${记忆.replace(/\s+/g, ' ').trim().slice(0, 120)}。` : '',
      环境 ? `当前环境：${环境}。` : '',
      '来信要自然、口语化、符合该角色人设与当前关系阶段；不要写成系统通知，不要复述本条说明。',
    ].filter(Boolean).join(''),
    relatedNpcIds: [目标.id],
    expiresAfterTurns: 8,
    relatedEventId,
    status: 'pending',
  };
  return { seeds: [seed] };
}
