import type { Audience, KnowledgeRecord, VisibilityDecision } from '../contracts/knowledge';
import type { MemoryRecord } from '../contracts/memory';

/** Inputs are already branch-bounded repository results. M05 must resolve nested leaves before using summary text. */
export function checkMemoryVisibility(memory: MemoryRecord, audience: Audience, knowledge: KnowledgeRecord[]): VisibilityDecision {
  if (memory.status !== 'active') return { allowed: false, reason: '该记忆尚未完成或已被替代。', leafIds: [] };
  if (audience.target === 'news' && memory.visibility.kind !== 'public') return { allowed: false, reason: '私密资料不能进入公开简报。', leafIds: [] };
  if (!audience.npcIds.length && audience.target !== 'news') return { allowed: true, reason: '仅供玩家查看，不代表角色知情。', leafIds: [...memory.eventIds] };
  const leafIds = memory.eventIds.filter(eventId => audience.npcIds.every(npcId => knowledge.some(row => row.scope.journeyId === memory.scope.journeyId && row.scope.branchId === memory.scope.branchId && row.npcId === npcId && row.eventId === eventId && row.nature === 'fact' && row.mode !== 'rumor' && row.mode !== 'inferred')));
  if (memory.memoryRefs.length) return { allowed: false, reason: '下层记忆引用尚未核对；只能使用已允许的原始事件。', leafIds };
  const allowed = memory.eventIds.length > 0 && leafIds.length === memory.eventIds.length;
  return { allowed, reason: allowed ? '每个参与角色均有该事件的明确知情记录。' : '有人尚不知道全部事件，不能使用整段摘要。', leafIds };
}
