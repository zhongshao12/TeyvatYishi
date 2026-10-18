import type { StateChange } from '../contracts/operation';
import type { CoreDomain, CoreSnapshot, StateRecord, FactProposal } from '../contracts/state';
import type { RecordRef } from '../contracts/identity';
import { stableJson } from '../persistence/repositoryValidation';
import { validateCoreDto } from '../contracts/validation';
import { checksumUtf8 } from '../sources/sourceIntegrity';

export class RuleContext {
  readonly changes: StateChange[] = [];
  readonly readSet = new Map<string, RecordRef>();
  normalizedFact?: FactProposal;
  constructor(readonly state: CoreSnapshot, readonly effectKey: string, readonly operationTurn?: number) {}
  get<D extends CoreDomain>(domain: D, entityId?: string): StateRecord<D> {
    const record = this.state.records.find(r => r.domain === domain && (entityId === undefined || r.entityId === entityId));
    if (!record) throw Error(`找不到 ${domain} 资料：${entityId ?? ''}`);
    this.readSet.set(`${record.domain}:${record.entityId}`, { domain: record.domain, entityId: record.entityId, version: record.version });
    const copy = structuredClone(record);
    if (copy.domain === 'world' && this.operationTurn !== undefined) copy.value.moment.turn = this.operationTurn;
    return copy as StateRecord<D>;
  }
  put(record: StateRecord): void {
    const before = this.state.records.find(r => r.domain === record.domain && r.entityId === record.entityId) ?? null;
    if (before && stableJson(before.value) === stableJson(record.value)) return;
    const after = { ...structuredClone(record), version: (before?.version ?? 0) + 1 } as StateRecord;
    if (!validateCoreDto('state', after).ok) throw Error('领域规则产生了无效资料。');
    const ref = { domain: record.domain, entityId: record.entityId, version: before?.version ?? 0 };
    this.readSet.set(`${ref.domain}:${ref.entityId}`, ref);
    const existing = this.changes.findIndex(change => change.ref.domain === ref.domain && change.ref.entityId === ref.entityId);
    const change = { ref, before: before ? structuredClone(before) : null, after, effectKey: `effect-${checksumUtf8(stableJson([this.effectKey, record.domain, record.entityId]))}` };
    if (this.changes.some(c => c.effectKey === change.effectKey && (c.ref.domain !== ref.domain || c.ref.entityId !== ref.entityId))) throw Error('效果身份冲突，需要人工检查。');
    if (existing < 0) this.changes.push(change); else this.changes[existing] = change;
  }
}
export function projectChanges(state: CoreSnapshot, changes: StateChange[]): CoreSnapshot {
  const result = structuredClone(state);
  for (const change of changes) {
    result.records = result.records.filter(r => r.domain !== change.ref.domain || r.entityId !== change.ref.entityId);
    if (change.after) result.records.push(structuredClone(change.after));
  }
  return result;
}
