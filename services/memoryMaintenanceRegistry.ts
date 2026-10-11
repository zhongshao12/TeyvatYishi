export interface MemoryMaintenanceLease {
  id: string; sessionId: number; rootId: string | null; signal: AbortSignal;
  cancel(): void; release(): void;
}
const leases = new Map<number, MemoryMaintenanceLease>();
let sequence = 0;
export function tryAcquireMemoryMaintenanceLease(sessionId: number, rootId: string | null): MemoryMaintenanceLease | null {
  if (leases.has(sessionId)) return null;
  const controller = new AbortController();
  const lease: MemoryMaintenanceLease = { id: `memory_task_${++sequence}`, sessionId, rootId, signal: controller.signal,
    cancel: () => controller.abort(), release: () => { if (leases.get(sessionId) === lease) leases.delete(sessionId); } };
  leases.set(sessionId, lease); return lease;
}
export function isMemoryMaintenanceBusy(sessionId: number): boolean { return leases.has(sessionId); }
