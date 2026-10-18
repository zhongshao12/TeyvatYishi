export interface CoreScope { journeyId: string; branchId: string }
export interface SourceRef { sourceId: string; sourceVersion: number }
export interface RecordRef { domain: import('./state').CoreDomain; entityId: string; version: number }
export interface MemoryReadRef { memoryId: string; version: number }
export interface ContentRef { contentId: string; version: string; checksum: string }
export interface BranchHead {
  scope: CoreScope;
  coreSeq: number;
  memoryRevision: number;
  sessionId: string;
  parent?: CoreScope;
  forkSeq?: number;
  forkMemoryRevision?: number;
}
export interface CoreIdentity { scope: CoreScope; playerId: string; sessionId: string }

export function createCoreIdentity(): CoreIdentity {
  return { scope: { journeyId: crypto.randomUUID(), branchId: crypto.randomUUID() }, playerId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
}
