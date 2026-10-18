import type { SourceRecord } from '../contracts/event';
import type { SourceRef } from '../contracts/identity';
import type { CoreSnapshot } from '../contracts/state';
import type { CoreRepository } from '../contracts/storage';
import { sameData } from '../persistence/repositoryValidation';

export function coreMomentText(source: SourceRecord, momentId: string): string {
  if (source.kind !== 'manual' || source.blocks.length !== 1 || source.blocks[0]!.kind !== 'configuration') throw Error('CORE2_MOMENT_SOURCE_INVALID');
  const command: unknown = JSON.parse(source.blocks[0]!.text);
  if (!command || typeof command !== 'object' || !('type' in command) || command.type !== 'moment' || !('momentId' in command) || command.momentId !== momentId
    || !('action' in command) || !['publish', 'edit'].includes(String(command.action))) throw Error('CORE2_MOMENT_SOURCE_INVALID');
  return 'text' in command && typeof command.text === 'string' ? command.text : '';
}
export async function readCoreMomentOrigin(repo: CoreRepository, snapshot: CoreSnapshot, descriptor: { channelId: string; momentSourceRef?: SourceRef; momentVersion?: number }): Promise<SourceRecord | undefined> {
  if (!descriptor.momentSourceRef) return undefined;
  const post = snapshot.records.find(row => row.domain === 'courier' && row.entityId === descriptor.channelId);
  if (post?.domain !== 'courier' || post.value.kind !== 'moment' || post.version !== descriptor.momentVersion || !sameData(post.value.sourceRef, descriptor.momentSourceRef)) throw Error('CORE2_MOMENT_REVISION_CHANGED');
  const origin = (await repo.querySources({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, refs: [descriptor.momentSourceRef], limit: 1 })).items[0];
  if (!origin) throw Error('CORE2_MOMENT_SOURCE_MISSING');
  coreMomentText(origin, descriptor.channelId); return origin;
}
