import type { MemoryMaintenanceProgress } from '@/models/memorySource';
export interface MemoryMaintenanceSnapshot { busy: boolean; progress: MemoryMaintenanceProgress | null; status: string }
const idle: MemoryMaintenanceSnapshot = { busy: false, progress: null, status: '' };
const snapshots = new Map<number, MemoryMaintenanceSnapshot>();
const listeners = new Set<() => void>();
export function subscribeMemoryMaintenance(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getMemoryMaintenanceSnapshot(sessionId: number): MemoryMaintenanceSnapshot { return snapshots.get(sessionId) ?? idle; }
function publish(sessionId: number, next: MemoryMaintenanceSnapshot) { snapshots.set(sessionId, next); listeners.forEach(listener => listener()); }
export interface MemoryMaintenanceLease {
  id: string; sessionId: number; rootId: string | null; signal: AbortSignal;
  cancel(): void; release(): void;
  report(progress: MemoryMaintenanceProgress | null, status?: string): void;
}
const leases = new Map<number, MemoryMaintenanceLease>();
let sequence = 0;
export function tryAcquireMemoryMaintenanceLease(sessionId: number, rootId: string | null): MemoryMaintenanceLease | null {
  if (leases.has(sessionId)) return null;
  const controller = new AbortController();
  const lease: MemoryMaintenanceLease = { id: `memory_task_${++sequence}`, sessionId, rootId, signal: controller.signal,
    report: (progress, status) => { if (leases.get(sessionId) === lease && !controller.signal.aborted) publish(sessionId, { busy: true, progress: progress ? { ...progress } : null, status: status ?? getMemoryMaintenanceSnapshot(sessionId).status }); },
    cancel: () => { controller.abort(); if (leases.get(sessionId) === lease) publish(sessionId, { ...getMemoryMaintenanceSnapshot(sessionId), status: '整理已取消，未提交结果不会覆盖现有记忆。' }); },
    release: () => { if (leases.get(sessionId) === lease) { leases.delete(sessionId); publish(sessionId, { ...getMemoryMaintenanceSnapshot(sessionId), busy: false }); } } };
  leases.set(sessionId, lease); publish(sessionId, { busy: true, progress: null, status: '正在整理记忆…' }); return lease;
}
export function isMemoryMaintenanceBusy(sessionId: number): boolean { return leases.has(sessionId); }
