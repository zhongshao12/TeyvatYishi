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
  npcName: string;
  turn: number;
  delta: number;
}

/** 从变量批次中提取 NPC 好感度变化事件（add / sub 命令）。 */
export function 提取好感变化事件(batches: 变量命令批次[]): 好感变化事件[] {
  const events: 好感变化事件[] = [];
  for (const batch of Array.isArray(batches) ? batches : []) {
    for (const result of batch.results ?? []) {
      if (!result.ok) continue;
      const command = result.command;
      if (!String(command.key).includes("好感度")) continue;
      const numeric = Number(command.value);
      if (!Number.isFinite(numeric)) continue;
      const delta = command.action === "sub" ? -numeric : numeric;
      const key = String(command.key);
      const nameMatch = key.match(/(?:NPC\/|NPC\[)[^/\]]+/);
      const npcName = nameMatch ? nameMatch[0].replace(/^NPC\//, "") : "NPC";
      events.push({ npcName, turn: batch.turn, delta });
    }
  }
  return events.sort((a, b) => a.turn - b.turn);
}
