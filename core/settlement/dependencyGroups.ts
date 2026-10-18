import type { CoreAction } from './actions';
export interface ActionGroup { groupId: string; actions: CoreAction[]; dependencies: string[]; status: 'ready' | 'pending'; reason?: string }
function anchors(action: CoreAction) { return action.kind === 'narrative' ? action.candidate.evidenceRefs : []; }
function related(a: CoreAction, b: CoreAction): boolean {
  if (a.dependsOn?.includes(b.actionId) || b.dependsOn?.includes(a.actionId)) return true;
  if (a.kind !== 'narrative' || b.kind !== 'narrative' || a.candidate.kind === 'weather' || b.candidate.kind === 'weather') return false;
  if (a.candidate.operationId === b.candidate.operationId && (a.candidate.kind === 'time' && b.candidate.kind === 'npc' || b.candidate.kind === 'time' && a.candidate.kind === 'npc')) return true;
  if (a.candidate.proposal.kind === 'relationship' && b.candidate.proposal.kind === 'relationship' && a.candidate.proposal.npcId === b.candidate.proposal.npcId) return true;
  return anchors(a).some(x => anchors(b).some(y => x.ref.sourceId === y.ref.sourceId && x.ref.sourceVersion === y.ref.sourceVersion && x.blockId === y.blockId && x.start < y.end && y.start < x.end));
}
function order(a: CoreAction, b: CoreAction) {
  const x = anchors(a)[0], y = anchors(b)[0];
  return x && y ? (a.sourceOrder !== undefined && b.sourceOrder !== undefined ? a.sourceOrder - b.sourceOrder : x.ref.sourceId.localeCompare(y.ref.sourceId) || x.ref.sourceVersion - y.ref.sourceVersion || x.blockId.localeCompare(y.blockId)) || x.start - y.start || a.actionId.localeCompare(b.actionId) : a.actionId.localeCompare(b.actionId);
}
export function groupCoreActions(actions: CoreAction[]): ActionGroup[] {
  const ids = new Set(actions.map(a => a.actionId)), remaining = [...actions].sort(order), groups: ActionGroup[] = [];
  while (remaining.length) {
    const members = [remaining.shift()!];
    for (let changed = true; changed;) {
      changed = false;
      for (let i = remaining.length - 1; i >= 0; i--) if (members.some(member => related(member, remaining[i]!))) { members.push(remaining.splice(i, 1)[0]!); changed = true; }
    }
    const sorted: CoreAction[] = [], pending = [...members].sort(order);
    let reason = members.find(a => a.blockedReason)?.blockedReason;
    if (members.some(a => a.dependsOn?.some(id => !ids.has(id)))) reason = '依赖动作缺失。';
    while (pending.length) {
      const index = pending.findIndex(a => !a.dependsOn?.some(id => pending.some(other => other.actionId === id)));
      if (index < 0) { reason = '依赖形成循环，不能部分执行。'; sorted.push(...pending); break; }
      sorted.push(pending.splice(index, 1)[0]!);
    }
    groups.push({ groupId: `group:${members.map(a => a.actionId).sort()[0]!}`, actions: sorted, dependencies: [], status: reason ? 'pending' : 'ready', ...(reason ? { reason } : {}) });
  }
  return groups.sort((a, b) => order(a.actions[0]!, b.actions[0]!));
}
