import { useEffect, useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { GameEvent } from '@/core/contracts/event';
import type { CoreController } from '@/core/settlement/coreController';
import { readCorePhonePhotoBatch, type CorePhonePhotoBatch } from '@/core/retrieval/phonePhotoContext';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CoreImageComposer } from './CoreImageComposer';
import { CoreAssetImage } from './CoreAssetImage';
import { sameData } from '@/core/persistence/repositoryValidation';

export function CorePhonePhotos({ repo, controller, snapshot, conversationId, events, shown, revision, disabled }: { repo: CoreRepository; controller: CoreController; snapshot: CoreSnapshot; conversationId: string; events: readonly GameEvent[]; shown: readonly GameEvent[]; revision: number; disabled: boolean }) {
  const [batch, setBatch] = useState<CorePhonePhotoBatch | null>(null), [error, setError] = useState(''), [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void readCorePhonePhotoBatch(snapshot, conversationId, events, repo).then(result => { if (live) { setBatch(before => sameData(before, result) ? before : result); setError(''); } }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); });
    return () => { live = false; };
  }, [repo, snapshot, conversationId, events, revision]);
  const playerEventId = batch?.playerEventId;
  useEffect(() => { setOpen(false); }, [playerEventId]);
  const npcIds = batch?.npcIds.filter(id => shown.some(event => event.actorIds[0] === id && event.replyToEventId === batch.playerEventId)) ?? [];
  const photos = snapshot.records.flatMap(row => row.domain === 'album' && row.value.phoneOrigin?.conversationId === conversationId ? [row] : []).sort((a, b) => b.value.moment.turn - a.value.moment.turn).slice(0, 10);
  return <section className="core2-phone-photos" aria-label="聊天照片工具">
    {batch && <button disabled={disabled || batch.waiting || !npcIds.length} onClick={() => setOpen(value => !value)}>聊天照片</button>}
    {open && batch && !batch.waiting && npcIds.length > 0 && <CoreImageComposer key={batch.playerEventId} {...{ controller, snapshot, disabled }} initialNpcId={npcIds[0]} initialInput={batch.userInput} allowedNpcIds={npcIds} phoneOrigin={{ conversationId, playerEventId: batch.playerEventId }} />}
    {photos.length > 0 && <div className="core2-album-grid" aria-label="手机照片">{photos.map(photo => <figure key={photo.entityId}><CoreAssetImage repo={repo} journeyId={snapshot.head.scope.journeyId} assetId={photo.value.assetId} alt={photo.value.title} /><figcaption>{photo.value.title}</figcaption></figure>)}</div>}
    {error && <p role="alert">照片上下文暂不可用：{error}</p>}
  </section>;
}
