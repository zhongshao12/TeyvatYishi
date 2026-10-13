import { lazy, Suspense, useEffect, useState } from 'react';
import type { CourierMoment, CourierMomentImage } from '@/models/teyvat/courier';
import type { 相册系统 } from '@/models/imageGeneration';
import { restoreMomentMentionBindings, shiftMomentMentionBindings, type MomentMentionBinding } from '@/services/courierMoments';
import type { CourierMomentImageTools } from './useCourierMomentImages';
import { CourierSheet } from './CourierSheet';
import { CourierMomentImages } from './CourierMomentImages';

const ImageEditor = lazy(() => import('./CourierMomentImageEditor').then(module => ({ default: module.CourierMomentImageEditor })));
export interface MomentMentionCandidate { npcId: string; name: string; remark?: string }
interface Props {
  open: boolean; onClose: () => void; album?: 相册系统; imageTools?: CourierMomentImageTools;
  mentionCandidates: readonly MomentMentionCandidate[]; editing?: CourierMoment; currentRevision?: number;
  onSave: (content: string, images: readonly CourierMomentImage[], bindings: readonly MomentMentionBinding[]) => boolean | void;
}

export function CourierMomentComposer({ open, onClose, album, imageTools, mentionCandidates, editing, currentRevision, onSave }: Props) {
  const [draft, setDraft] = useState(editing?.content ?? '');
  const [bindings, setBindings] = useState<MomentMentionBinding[]>(() => editing
    ? restoreMomentMentionBindings(editing, mentionCandidates.map(candidate => ({ ...candidate, id: candidate.npcId, available: true }))) : []);
  const [images, setImages] = useState<CourierMomentImage[]>([...(editing?.images ?? [])]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  useEffect(() => { if (!open) setBusy(false); }, [open]);
  const stale = Boolean(editing && currentRevision !== editing.revision);
  const changeDraft = (next: string) => { setBindings(old => shiftMomentMentionBindings(draft, next, old)); setDraft(next); setError(''); };
  const save = () => {
    if (busy || stale || draft.length > 500 || (!draft.trim() && !images.length)) return;
    try {
      if (onSave(draft, images, bindings) === false) { setError('未保存，动态或存档可能已变化；草稿已保留。'); return; }
      setDraft(''); setImages([]); setBindings([]); setVersion(value => value + 1); setError(''); onClose();
    } catch (cause) { setError(`未保存：${cause instanceof Error ? cause.message : '请稍后重试'}。草稿已保留。`); }
  };
  if (!open) return null;
  return <CourierSheet title={editing ? '编辑朋友圈' : '发布朋友圈'} onClose={onClose} footer={<>
    <span className="mr-auto text-xs">{draft.length}/500 · 配图 {images.length}/9</span>
    <button type="button" className="teyvat-btn min-h-11 px-4" onClick={onClose}>取消</button>
    <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-4 disabled:opacity-45" disabled={busy || stale || draft.length > 500 || (!draft.trim() && !images.length)} onClick={save}>{editing ? '保存修改' : '发布'}</button>
  </>}>
    <label className="block text-sm">{editing ? '编辑旅途此刻' : '写下旅途此刻'}
      <textarea aria-label={editing ? '编辑朋友圈' : '写朋友圈'} rows={4} maxLength={500} value={draft} onChange={event => changeDraft(event.target.value)}
        className="teyvat-input mt-2 w-full resize-y rounded p-3 text-sm leading-6" placeholder="今天想和朋友们分享什么？" />
    </label>
    {mentionCandidates.length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label="点名联系人">{mentionCandidates.map(candidate => <button key={candidate.npcId} type="button" className="min-h-11 rounded-full border px-3 text-xs" onClick={() => {
      const prefix = draft && !/\s$/u.test(draft) ? ' ' : ''; const token = `@${candidate.name}`;
      const next = `${draft}${prefix}${token} `;
      if (next.length > 500) { setError('点名后会超过 500 字，请先缩短正文；原草稿未改变。'); return; }
      changeDraft(next); setBindings(old => [...old, { npcId: candidate.npcId, start: draft.length + prefix.length, token }]);
    }}>@{candidate.name}{mentionCandidates.filter(item => item.name === candidate.name).length > 1 && `（${candidate.remark || candidate.npcId}）`}</button>)}</div>}
    {mentionCandidates.some((candidate, index) => mentionCandidates.findIndex(item => item.name === candidate.name) !== index)
      && <p className="mt-1 text-xs">同名联系人请用上方按钮点名；只手写姓名无法确定是谁。</p>}
    {bindings.some(binding => binding.fromArchive && !binding.npcId) && <p className="mt-1 text-xs">旧动态的部分点名身份无法确定；修改正文时请用按钮重新选择，避免同名误投。</p>}
    <CourierMomentImages images={images} album={album} onChange={setImages} />
    {imageTools && !stale && <Suspense fallback={<p role="status">配图工具载入中…</p>}><ImageEditor key={version} tools={imageTools} images={images} onChange={setImages} onBusyChange={setBusy} editing={editing ? { id: editing.id, revision: editing.revision } : undefined} /></Suspense>}
    {stale && <p role="alert" className="mt-2 text-xs">这条动态已有更新。请取消编辑后重新打开，旧草稿不会覆盖较新的内容。</p>}
    {error && <p role="alert" className="mt-2 text-sm" style={{ color: 'rgb(var(--tj-danger))' }}>{error}</p>}
    {editing && <p className="mt-3 text-xs">保存修改将清空旧评论，并按新内容重新生成。</p>}
  </CourierSheet>;
}
