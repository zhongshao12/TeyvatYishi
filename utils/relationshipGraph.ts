import { 格式化NPC关系, type NPC记录 } from '@/models/npc';
import type { 变量命令批次 } from '@/models/variableCommand';

export interface RelationshipNode {
  id: string;
  name: string;
  affinity: number;
  relationLabel: string;
  following: boolean;
  intimate: boolean;
  enemy: boolean;
}

export interface RelationshipEdge {
  from: string;
  to: string;
  kind: "companion" | "rival" | "intimate";
}

/** 以玩家为中心构建 NPC 关系图：节点 + 玩家与 NPC 的边（同行 / 敌对 / 亲密）。 */
export function 构建关系图(npcRecords: NPC记录[]): { nodes: RelationshipNode[]; edges: RelationshipEdge[] } {
  const nodes: RelationshipNode[] = [];
  const edges: RelationshipEdge[] = [];
  for (const npc of Array.isArray(npcRecords) ? npcRecords : []) {
    const affinity = npc.好感度 ?? 0;
    nodes.push({
      id: npc.id,
      name: npc.姓名,
      affinity,
      // `npc.关系` is the storage enum (stranger/friend/...) and must never leak
      // into the Chinese-facing graph. Derive the readable stage from affinity.
      relationLabel: 格式化NPC关系(affinity, Boolean(npc.亲密关系)),
      following: Boolean(npc.同行),
      intimate: Boolean(npc.亲密关系),
      enemy: affinity <= -31,
    });
    edges.push({ from: "player", to: npc.id, kind: npc.亲密关系 ? "intimate" : affinity <= -31 ? "rival" : "companion" });
  }
  return { nodes, edges };
}

export interface 好感变化事件 {
  npcId: string;
  /** 展示名：优先用调用方给的解析结果，拿不到就退回 id。 */
  npcName: string;
  turn: number;
  /** add / sub 的增量；`set` 没有增量语义，固定为 null。 */
  delta: number | null;
  /** `set` 的目标绝对值；add / sub 固定为 null。 */
  value: number | null;
  action: 'add' | 'sub' | 'set';
  /** 结算时记录的原因（旧批次没有这个字段）。 */
  reason?: string;
}

/** 只认 NPC 根下的好感字段。 */
const NPC_ROOT_RE = /^NPC[./]/;
/** 字段名必须是结尾：`affinity`（现行）或 `好感度`（旧存档里的历史批次）。 */
const AFFINITY_FIELD_RE = /(?:^|[.[/])(?:affinity|好感度)$/;
/** 现行 key 形如 `NPC.[id=npc_amber].affinity`。 */
const ID_SELECTOR_RE = /\[id=([^\]]+)\]/;
/** 旧 key 形如 `NPC.安柏.好感度` 或 `NPC/安柏/好感度`。 */
const NPC_PATH_NAME_RE = /^NPC[./]([^/.[\]]+)/;

/**
 * 解析结算批次里的好感命令 key。
 *
 * 注意这里必须同时认英文 `affinity` 与中文 `好感度`：
 * 现行结算写的是 `变量命令结果.command.key = `${root}.${path}``，
 * 而 NPC 路径字段是英文 `affinity`（`variableSettlementWorkflow` 组装、`teyvatCommandRegistry` 校验），
 * 中文 `好感度` 只存在于接入领域命令之前的旧批次里 —— 旧存档的批次历史仍要能显示。
 * 只认中文会让面板永远为空（曾发生），只认英文会让旧存档历史消失。
 */
function 解析好感命令key(key: string): { npcId: string; npcName: string } | null {
  if (!NPC_ROOT_RE.test(key) || !AFFINITY_FIELD_RE.test(key)) return null;
  const id = key.match(ID_SELECTOR_RE)?.[1]?.trim();
  if (id) return { npcId: id, npcName: id };
  const name = key.match(NPC_PATH_NAME_RE)?.[1]?.trim();
  if (!name) return null;
  return { npcId: name, npcName: name };
}

/** 从变量批次中提取 NPC 好感度变化事件（add / sub / set 命令）。 */
export function 提取好感变化事件(
  batches: 变量命令批次[],
  options: { resolveNpcName?: (npcId: string) => string | undefined } = {},
): 好感变化事件[] {
  const events: 好感变化事件[] = [];
  for (const batch of Array.isArray(batches) ? batches : []) {
    for (const result of batch.results ?? []) {
      if (!result.ok) continue;
      const command = result.command;
      const target = 解析好感命令key(String(command.key ?? ''));
      if (!target) continue;
      const numeric = Number(command.value);
      if (!Number.isFinite(numeric)) continue;
      const action = command.action === 'add' || command.action === 'sub' ? command.action : 'set';
      events.push({
        npcId: target.npcId,
        npcName: options.resolveNpcName?.(target.npcId)?.trim() || target.npcName,
        turn: Number(batch.turn) || 0,
        // `set` 是绝对值覆盖，把它当成增量会在面板上显示成假变化（旧实现就是这么做的）。
        delta: action === 'set' ? null : action === 'sub' ? -numeric : numeric,
        value: action === 'set' ? numeric : null,
        action,
        ...(result.evidence?.trim() ? { reason: result.evidence.trim() } : {}),
      });
    }
  }
  return events.sort((a, b) => a.turn - b.turn);
}
