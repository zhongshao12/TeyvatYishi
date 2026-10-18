import { useEffect, useRef, useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreSnapshot, StateRecord } from '@/core/contracts/state';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { coreMomentAudience } from '@/core/settlement/momentRules';
import { coreMomentText } from '@/core/settlement/momentSources';
import { useCore2Query } from '@/hooks/useCore2Query';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CoreAvatar, coreCourierName } from './CoreAvatar';
import { readCoreMomentPlan } from '@/core/jobs/momentPlan';
import type { CoreController } from '@/core/settlement/coreController';
import { CoreImageComposer } from './CoreImageComposer';
import { readImageFileBytes } from '@/utils/readImageFile';
import { sameData } from '@/core/persistence/repositoryValidation';

interface Props { repo: CoreRepository; snapshot: CoreSnapshot; revision: number; controller?: CoreController; disabled?: boolean; onCommand(command: BasicPlayerCommand): Promise<unknown>; onRetry?(id: string): Promise<unknown> }
export function CoreMomentsPanel({ repo, snapshot, controller, revision, disabled = false, onCommand, onRetry }: Props) {
  const [text, setText] = useState(''), [mentions, setMentions] = useState<string[]>([]), [images, setImages] = useState<string[]>([]);
  const [editing, setEditing] = useState<StateRecord<'courier'> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(20);
  const [file, setFile] = useState<File | null>(null), [generateOpen, setGenerateOpen] = useState(false); const uploadId = useRef<string | null>(null), fileInput = useRef<HTMLInputElement>(null);
  const audience = coreMomentAudience(snapshot), player = snapshot.records.find(row => row.domain === 'traveler');
  const posts = snapshot.records.filter((row): row is StateRecord<'courier'> => row.domain === 'courier' && row.value.kind === 'moment').sort((a, b) =>
    (b.value.kind === 'moment' ? b.value.commentPlanSeq ?? 0 : 0) - (a.value.kind === 'moment' ? a.value.commentPlanSeq ?? 0 : 0));
  const album = snapshot.records.flatMap(row => row.domain === 'album' ? [{ id: row.value.assetId, title: row.value.title }] : []);
  const clear = () => { setEditing(null); setText(''); setMentions([]); setImages([]); };
  const upload = async () => {
    if (!controller || !file || busy || disabled || images.length >= 9) return; setBusy(true); setError(''); const owner = { scope: snapshot.head.scope, sessionId: snapshot.head.sessionId };
    const current = () => { const head = controller.getView().snapshot?.head; return !!head && sameData(owner, { scope: head.scope, sessionId: head.sessionId }); };
    try {
      const bytes = await readImageFileBytes(file); if (!current()) throw Error('存档已经切换，图片未加入其它旅程。');
      const receipt = await controller.uploadImage({ title: file.name.slice(0, 200), kind: 'snapshot', npcIds: [], bytes, mimeType: file.type, operationId: uploadId.current ??= 'moment-image-' + crypto.randomUUID() });
      if (!current() || !['committed', 'already_committed'].includes(receipt.status)) throw Error('图片上传结果需要重新确认，未附加到动态。');
      const events = (await repo.queryEvents({ scope: owner.scope, cutoffSeq: receipt.coreSeq, eventIds: receipt.eventIds, limit: 200 })).items;
      const assetId = events.flatMap(event => event.committedChanges.flatMap(change => change.after?.domain === 'album' ? [change.after.value.assetId] : []))[0];
      if (!assetId || !current()) throw Error('图片没有可用的相册登记，未附加到动态。');
      setImages(before => [...new Set([...before, assetId])].slice(0, 9)); setFile(null); uploadId.current = null; if (fileInput.current) fileInput.current.value = '';
    } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  const submit = async () => {
    if (busy || disabled || !text.trim() && !images.length) return;
    setBusy(true); setError('');
    try {
      await onCommand({ type: 'moment', momentId: editing?.entityId ?? `moment-${crypto.randomUUID()}`, action: editing ? 'edit' : 'publish', text, mentionedNpcIds: mentions, imageAssetIds: images,
        ...(editing?.value.kind === 'moment' ? { visibilityNpcIds: editing.value.visibilityNpcIds } : {}) });
      clear();
    } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  return <section className="core2-moments" aria-label="朋友圈"><form className="core2-moment-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label>分享旅途见闻<textarea aria-label="分享旅途见闻" value={text} disabled={disabled || busy} onChange={event => setText(event.target.value)} /></label>
    <details><summary>@角色</summary><div className="core2-contact-scroll">{audience.map(id => <label key={id} className="core2-member-choice"><input type="checkbox" disabled={disabled || busy} checked={mentions.includes(id)} onChange={event => setMentions(before => event.target.checked ? [...before, id] : before.filter(item => item !== id))} />{coreCourierName(snapshot, id)}</label>)}</div></details>
    {album.length > 0 && <details><summary>添加相册图片</summary><div className="core2-contact-scroll">{album.map(image => <label key={image.id} className="core2-member-choice"><input type="checkbox" disabled={disabled || busy || !images.includes(image.id) && images.length >= 9} checked={images.includes(image.id)} onChange={event => setImages(before => event.target.checked ? [...before, image.id] : before.filter(id => id !== image.id))} />{image.title}</label>)}</div></details>}
    {controller && <div className="core2-panel-actions"><label>本地配图<input ref={fileInput} aria-label="选择动态图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy || images.length >= 9} onChange={event => { setFile(event.target.files?.[0] ?? null); uploadId.current = null; }} /></label><button type="button" disabled={disabled || busy || !file || images.length >= 9} onClick={() => void upload()}>上传动态配图</button><button type="button" disabled={disabled || busy} onClick={() => setGenerateOpen(value => !value)}>生成动态配图</button></div>}
    {images.length > 0 && <div className="core2-moment-images" aria-label="已选动态配图">{images.map(id => <figure key={id}><CoreMomentImage {...{ repo, snapshot }} assetId={id} /><button type="button" disabled={busy || disabled} onClick={() => setImages(before => before.filter(value => value !== id))}>移除此配图</button></figure>)}</div>}
    <button type="submit" disabled={disabled || busy || !text.trim() && !images.length}>{editing ? '保存动态' : '发布动态'}</button>{editing && <button type="button" disabled={busy} onClick={clear}>取消编辑</button>}
    {error && <p role="alert">{error}</p>}
  </form>
    {controller && generateOpen && <div><CoreImageComposer {...{ controller, snapshot }} disabled={disabled || busy} initialInput={text} /><p>图片生成后，可从“添加相册图片”中选择配图；不会自动发布动态。</p></div>}
    {posts.slice(0, count).map(post => <CoreMomentEntry key={`${snapshot.head.sessionId}:${post.entityId}:${post.version}`} {...{ repo, snapshot, post, revision, onCommand, onRetry, disabled }} own={post.value.kind === 'moment' && post.value.authorId === player?.entityId} onEdit={body => {
      if (post.value.kind !== 'moment') return; setEditing(post); setText(body); setMentions([...post.value.mentionedNpcIds]); setImages([...post.value.imageAssetIds]);
    }} />)}
    {!posts.length && <p>还没有动态。</p>}{posts.length > count && <button onClick={() => setCount(before => before + 20)}>查看更多动态</button>}
  </section>;
}

function CoreMomentEntry({ repo, snapshot, post, revision, own, disabled, onCommand, onRetry, onEdit }: Props & { post: StateRecord<'courier'>; own: boolean; onEdit(text: string): void }) {
  const [body, setBody] = useState<string | null>(null), [error, setError] = useState(''), [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ id: string; npcId: string; detail: string }[]>([]);
  const comments = useCore2Query({ kind: 'courier', head: snapshot.head, conversationId: post.entityId }, repo, revision);
  useEffect(() => {
    if (post.value.kind !== 'moment') return; let live = true;
    void repo.querySources({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, refs: [post.value.sourceRef], limit: 1 }).then(page => {
      if (!live) return; const source = page.items[0]; if (!source) throw Error('找不到这条动态的原文。'); setBody(coreMomentText(source, post.entityId));
    }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); });
    return () => { live = false; };
  // A new comment or summary must not reload the unchanged post body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, post.entityId, post.version, snapshot.head.sessionId]);
  useEffect(() => {
    if (post.value.kind !== 'moment') return; let live = true;
    const jobIds = (post.value.commentReplies ?? []).map(reply => reply.jobId);
    if (!jobIds.length) return;
    void repo.queryJobs({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, jobIds, kinds: ['courier'], limit: 200 }).then(page => {
      if (!live) return;
      setFailed(page.items.flatMap(job => job.status === 'failed' || job.status === 'cancelled' ? [{ id: job.jobId, npcId: readCoreMomentPlan(job).npcId, detail: job.failure?.detail ?? '评论已停止。' }] : []));
    }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); });
    return () => { live = false; };
  }, [repo, post, snapshot.head.scope, snapshot.head.coreSeq, revision]);
  if (post.value.kind !== 'moment') return null;
  const replyOperations = new Set((post.value.commentReplies ?? []).map(reply => reply.operationId));
  const rows = [...comments.items].reverse().filter(event => {
    // Replies to an older edition stay in the ledger, not under the edited post.
    return replyOperations.has(event.operationId);
  });
  const remove = async () => { if (busy || disabled) return; setBusy(true); try { await onCommand({ type: 'moment', momentId: post.entityId, action: 'delete' }); } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); } };
  return <article className="core2-record-entry core2-moment-entry" data-core-moment={post.entityId}><header><CoreAvatar repo={repo} snapshot={snapshot} entityId={post.value.authorId} /><strong>{coreCourierName(snapshot, post.value.authorId)}</strong></header>
    {body === null ? <p role="status">正在读取动态……</p> : <p className="core2-moment-body">{body}</p>}
    <div className="core2-moment-images">{post.value.imageAssetIds.map(id => <CoreMomentImage key={id} repo={repo} snapshot={snapshot} assetId={id} />)}</div>
    {own && <div className="core2-panel-actions"><button disabled={disabled || busy || body === null} onClick={() => onEdit(body ?? '')}>编辑动态</button><button disabled={disabled || busy} onClick={() => setDeleting(true)}>删除动态</button>{deleting && <><button disabled={busy} onClick={() => void remove()}>确认删除这条动态</button><button onClick={() => setDeleting(false)}>取消删除</button></>}</div>}
    <div aria-label="动态评论">{rows.map(row => <div className="core2-moment-comment" key={row.eventId}><CoreAvatar repo={repo} snapshot={snapshot} entityId={row.actorIds[0]!} small /><p><strong>{coreCourierName(snapshot, row.actorIds[0]!)}</strong>：{row.evidenceRefs.map(ref => ref.quote).join('\n')}</p></div>)}</div>
    {comments.cursor && <button disabled={comments.loading} onClick={() => void comments.loadMore()}>读取更多评论</button>}
    {failed.filter(failure => !rows.some(row => row.actorIds.includes(failure.npcId))).map(row => <p key={row.id} role="alert">{coreCourierName(snapshot, row.npcId)}：{row.detail}{onRetry && <button disabled={disabled || busy} onClick={() => { setBusy(true); void onRetry(row.id).then(result => { if (result && typeof result === 'object' && 'kind' in result && result.kind !== 'completed') throw Error('detail' in result ? String(result.detail) : '评论尚未恢复，请查看失败结算中心。'); }).catch(failure => setError(sanitizeApiErrorReportText(String(failure)))).finally(() => setBusy(false)); }}>重试这位角色</button>}</p>)}
    {(error || comments.error) && <p role="alert">{error || comments.error}</p>}
  </article>;
}
function CoreMomentImage({ repo, snapshot, assetId }: { repo: CoreRepository; snapshot: CoreSnapshot; assetId: string }) {
  const [src, setSrc] = useState(''), [error, setError] = useState(''); const journeyId = snapshot.head.scope.journeyId;
  useEffect(() => {
    let live = true, url = '';
    void repo.readAsset(assetId).then(asset => {
      if (!live) return; if (!asset || asset.scope.journeyId !== journeyId || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) throw Error('图片缺失或格式不支持。');
      url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mimeType })); setSrc(url);
    }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [repo, journeyId, assetId]);
  return error ? <span role="alert">{error}</span> : src ? <img src={src} loading="lazy" alt="旅途配图" /> : <span>图片读取中……</span>;
}
