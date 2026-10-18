import type { FactCandidate } from '../contracts/event';
import type { CoreSnapshot, FactProposal, StateRecord } from '../contracts/state';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';
import { parseNarrativeNumber } from '@/utils/narrativeNumbers';

function nameKey(name: string): string { return name.normalize('NFKC').trim().replace(/\s+/gu, ' '); }
function cleanName(name: string): boolean {
  return !!name.trim() && name === name.trim() && name.length <= 80 && !/[\r\n<>`]/u.test(name) && !/系统提示|七维关系|变量事实|旁白|INVALID_|Complete\./iu.test(name);
}
/** Models can describe a name, never choose the persistent identity of a new entity. */
export function normalizeCoreRegistration(candidate: FactCandidate, state: CoreSnapshot): void {
  const p = candidate.proposal;
  const remap = (old: string, next: string) => { candidate.targets = candidate.targets.map(id => id === old ? next : id); };
  if (p.kind === 'inventory' && p.action === 'gain' && p.itemName && !state.records.some(row => row.domain === 'inventory' && row.entityId === p.itemId)) {
    const found = state.records.filter(row => row.domain === 'inventory' && row.value.kind === 'item' && nameKey(row.value.name) === nameKey(p.itemName!));
    if (found.length > 1) return;
    const id = found[0]?.entityId ?? 'item-' + checksumUtf8(stableJson([state.head.scope, nameKey(p.itemName)]));
    remap(p.itemId, id); p.itemId = id;
  }
  if (p.kind === 'quest' && p.action === 'start' && p.definition && !state.records.some(row => row.domain === 'quest' && row.entityId === p.questId)) {
    const found = state.records.filter(row => row.domain === 'quest' && nameKey(row.value.title) === nameKey(p.definition!.title));
    if (found.length > 1) return;
    const id = found[0]?.entityId ?? 'quest-' + checksumUtf8(stableJson([state.head.scope, nameKey(p.definition.title)]));
    remap(p.questId, id); p.questId = id;
  }
}
export function coreNewItemName(p: Extract<FactProposal, { kind: 'inventory' }>, state: CoreSnapshot): string | null {
  if (p.action !== 'gain' || !p.itemName || !cleanName(p.itemName)) return null;
  if (state.records.some(row => row.domain === 'inventory' && row.value.kind === 'item' && nameKey(row.value.name) === nameKey(p.itemName!))) return null;
  return p.itemId === 'item-' + checksumUtf8(stableJson([state.head.scope, nameKey(p.itemName)])) ? p.itemName : null;
}
export function coreQuestDefinitionProblem(p: Extract<FactProposal, { kind: 'quest' }>, text: string): string | null {
  const definition = p.definition;
  if (p.action !== 'start' || !definition || !cleanName(definition.title) || !text.includes(definition.title) || !/(?:接取|接受|接下|领取)(?:了)?(?:新)?任务/u.test(text)) return '新任务缺少明确的接取记录与名称。';
  if (!definition.objectives.length || definition.objectives.length > 20 || new Set(definition.objectives.map(row => row.description)).size !== definition.objectives.length) return '新任务目标缺失、重复或过多。';
  for (const objective of definition.objectives) {
    if (!objective.description.trim() || objective.description.length > 500 || !text.includes(objective.description) || objective.targetCount > 10000) return '任务目标没有逐字依据。';
    if (objective.targetCount !== 1 && ![...objective.description.matchAll(/[零〇一二两三四五六七八九十百千万]+|\d+/gu)].some(match => parseNarrativeNumber(match[0]) === objective.targetCount)) return '任务目标数量没有明确依据。';
  }
  return null;
}
export function createCoreQuestBaseline(candidate: FactCandidate, state: CoreSnapshot, turn: number): StateRecord<'quest'> | undefined {
  const p = candidate.proposal; if (p.kind !== 'quest' || p.action !== 'start' || !p.definition) return;
  const text = candidate.evidenceRefs.map(ref => ref.quote).join('\n');
  if (coreQuestDefinitionProblem(p, text) || p.questId !== 'quest-' + checksumUtf8(stableJson([state.head.scope, nameKey(p.definition.title)]))) return;
  const moment = state.records.find(row => row.domain === 'world')?.value.moment;
  return { scope: state.head.scope, domain: 'quest', entityId: p.questId, version: 1, value: { id: p.questId, title: p.definition.title, description: '', source: 'custom', status: 'not_started', rewards: [],
    objectives: p.definition.objectives.map((row, index) => ({ ...row, id: 'objective-' + checksumUtf8(stableJson([p.questId, index, row.description])), currentCount: 0, completed: false })), createdAtTurn: turn, updatedAt: turn,
    ...(moment ? { worldMoment: { ...moment, turn, settlementId: candidate.operationId } } : {}) } };
}
