import type { WorldMomentRange } from '@/models/teyvat/worldMoment';
import type { CoreScope, MemoryReadRef, SourceRef } from './identity';
import type { EventVisibility } from './event';

export type MemoryLayer = 'immediate' | 'short' | 'middle' | 'long';
export interface MemoryRecord { memoryId: string; scope: CoreScope; version: number; layer: MemoryLayer; text: string; sourceRefs: SourceRef[]; eventIds: string[]; memoryRefs: MemoryReadRef[]; turns: number[]; momentRange: WorldMomentRange; npcIds: string[]; locations: string[]; visibility: EventVisibility; importance: number; pinned: boolean; status: 'pending' | 'active' | 'failed' | 'superseded'; generation: { mode: 'local' | 'model' | 'manual'; version: string }; editVersion: number }
export interface MemorySettings { shortThreshold: number; middleThreshold: number; longThreshold: number; prompt: string; mode: 'local' | 'model' }
export interface DerivedPatch { scope: CoreScope; sessionId: string; jobId: string; leaseId: string; sourceRefs: SourceRef[]; readSet: MemoryReadRef[]; expectedMemoryRevision: number; additions: MemoryRecord[]; supersededIds: string[] }
export interface DerivedReceipt { status: 'published' | 'conflict' | 'cancelled'; memoryRevision: number; memoryIds: string[]; reason?: string }
export type JobKind = 'turn_summary' | 'compression' | 'rebuild' | 'index' | 'image' | 'courier' | 'news' | 'profile' | 'manual_memory';
export interface JobRecord { jobId: string; scope: CoreScope; sessionId: string; kind: JobKind; sourceRefs: SourceRef[]; operationId: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; leaseId: string | null; configFingerprint: string; attempts: number; steps: JobStepResult[]; failure?: { code: string; detail: string }; version: number; /** Atomic, same-branch retry lineage; historical attempts remain auditable. */ retryOfJobId?: string; retriedByJobId?: string; /** Read-only projection of the existing durable publication receipt. */ publicationReceipt?: DerivedReceipt }
export interface JobStepResult { scope: CoreScope; sessionId: string; jobId: string; leaseId: string; sourceRefs: SourceRef[]; stepId: string; status: 'completed' | 'failed'; memories: MemoryRecord[]; failure?: { code: string; detail: string } }
export interface JobClaim { scope: CoreScope; sessionId: string; jobId: string; leaseId: string; sourceRefs: SourceRef[]; expectedVersion: number }
export interface JobFinish extends JobClaim { status: 'completed' | 'failed' | 'cancelled'; failure?: { code: string; detail: string } }
