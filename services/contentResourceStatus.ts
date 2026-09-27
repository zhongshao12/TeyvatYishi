export type ContentResourceStage = 'fetch' | 'parse' | 'normalize' | 'initialize';
export type ContentResourceState = 'loading' | 'ready' | 'failed';

export interface ContentResourceStatus {
  resourceId: string;
  state: ContentResourceState;
  stage?: ContentResourceStage;
  recoveryHint?: string;
}

const MAX_STATUSES = 200;
const statuses = new Map<string, ContentResourceStatus>();
const listeners = new Set<() => void>();
let snapshot: ContentResourceStatus[] = [];

function publish(): void {
  snapshot = [...statuses.values()];
  listeners.forEach((listener) => listener());
}

function update(status: ContentResourceStatus): void {
  statuses.delete(status.resourceId);
  statuses.set(status.resourceId, status);
  while (statuses.size > MAX_STATUSES) {
    const oldest = statuses.keys().next().value;
    if (oldest === undefined) break;
    statuses.delete(oldest);
  }
  publish();
}

export function getContentResourceStatuses(): ContentResourceStatus[] { return snapshot; }
export function getContentResourceStatus(resourceId: string): ContentResourceStatus | undefined { return statuses.get(resourceId); }
export function subscribeContentResourceStatuses(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function clearContentResourceStatuses(): void { statuses.clear(); publish(); }
export function markContentResourceLoading(resourceId: string, stage: ContentResourceStage): void {
  update({ resourceId, state: 'loading', stage });
}
export function markContentResourceReady(resourceId: string): void {
  update({ resourceId, state: 'ready' });
}
export function markContentResourceFailed(resourceId: string, stage: ContentResourceStage, recoveryHint: string): ContentResourceError {
  update({ resourceId, state: 'failed', stage, recoveryHint });
  return new ContentResourceError(resourceId, stage, recoveryHint);
}

export class ContentResourceError extends Error {
  constructor(
    readonly resourceId: string,
    readonly stage: ContentResourceStage,
    readonly recoveryHint: string,
  ) {
    super(`资源 ${resourceId} 在 ${stage} 阶段加载失败。${recoveryHint}`);
    this.name = 'ContentResourceError';
  }
}
