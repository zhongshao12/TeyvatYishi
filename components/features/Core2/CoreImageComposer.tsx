import { useEffect, useRef, useState } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { CoreImageRequest } from '@/core/jobs/imageJob';
import { sameData } from '@/core/persistence/repositoryValidation';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { ImagePromptLibraryPickerBase } from '../ImageGeneration/ImagePromptLibraryPickerBase';
import { applyImagePromptSelection } from '@/utils/imagePromptLibrary';
import type { CorePhoneImageOrigin } from '@/core/retrieval/phonePhotoContext';

/** A shared explicit prepare → preview → confirm surface; mounting never calls a model. */
export function CoreImageComposer({ controller, snapshot, disabled = false, initialNpcId, initialInput = '', allowedNpcIds, phoneOrigin }: { controller: CoreController; snapshot: CoreSnapshot; disabled?: boolean; initialNpcId?: string; initialInput?: string; allowedNpcIds?: string[]; phoneOrigin?: Omit<CorePhoneImageOrigin, 'npcId'> }) {
  const people = snapshot.records.flatMap(row => row.domain === 'npc' && !row.value.archived && (!allowedNpcIds || allowedNpcIds.includes(row.entityId)) ? [{ id: row.entityId, name: row.value.姓名 }] : []);
  const [npcId, setNpc] = useState(initialNpcId ?? people[0]?.id ?? ''), [kind, setKind] = useState<'character' | 'scene' | 'snapshot'>('character');
  const [title, setTitle] = useState('旅途照片'), [input, setInput] = useState(initialInput), [size, setSize] = useState('512x512');
  const [preview, setPreview] = useState<CoreImageRequest | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const abort = useRef<AbortController | null>(null), ownerKey = JSON.stringify([snapshot.head.scope, snapshot.head.sessionId]);
  const library = controller.getImagePromptLibrary();
  useEffect(() => () => abort.current?.abort(), [ownerKey]);
  const changed = () => { setPreview(null); setError(''); setStatus(''); };
  const prepare = async () => {
    if (busy || disabled || !input.trim()) return;
    const cancellation = new AbortController(); abort.current = cancellation; setBusy(true); setError(''); setStatus('');
    try {
      const result = await controller.prepareImage({ title: title.trim() || '旅途照片', kind, npcId: npcId || null, userInput: input, positive: [], negative: [], size, ...(phoneOrigin ? { phoneOrigin: { ...phoneOrigin, npcId } } : {}) }, cancellation.signal);
      if (!cancellation.signal.aborted) setPreview(result);
    } catch (failure) { if (!cancellation.signal.aborted) setError(sanitizeApiErrorReportText(String(failure))); }
    finally { if (abort.current === cancellation) { setBusy(false); abort.current = null; } }
  };
  const confirm = async () => {
    if (!preview || busy || disabled) return; setBusy(true); setError(''); const owner = snapshot.head;
    try {
      const current = controller.getView().snapshot?.head; if (!current || !sameData(current.scope, owner.scope) || current.sessionId !== owner.sessionId) throw Error('存档已经切换，请重新确认图片。');
      const receipt = await controller.requestImage(preview); if (!['committed', 'already_committed'].includes(receipt.status)) throw Error('图片请求尚未保存，请重试。');
      setStatus('已加入生图任务，可在失败结算中心查看进度、停止或重试。'); setPreview(null);
    } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  return <div className="core2-image-composer"><fieldset disabled={disabled || busy}><legend>生成旅途图片</legend>
    <label>生图标题<input aria-label="生图标题" value={title} maxLength={200} onChange={event => { setTitle(event.target.value); changed(); }} /></label>
    <label>图片类型<select aria-label="生图类型" disabled={!!phoneOrigin} value={kind} onChange={event => { const next = event.target.value as typeof kind; setKind(next); if (next === 'scene') setNpc(''); changed(); }}><option value="character">伙伴照片</option><option value="scene">场景图</option><option value="snapshot">故事快照</option></select></label>
    <label>出镜角色<select aria-label="生图角色" value={npcId} onChange={event => { setNpc(event.target.value); changed(); }}>{!phoneOrigin && <option value="">不含角色</option>}{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>图片要求<textarea aria-label="图片要求" value={input} rows={3} onChange={event => { setInput(event.target.value); changed(); }} placeholder="描述想拍的动作、地点或景色" /></label>
    <label>图片尺寸<select aria-label="生图尺寸" value={size} onChange={event => { setSize(event.target.value); changed(); }}><option value="512x512">512 × 512</option><option value="768x1024">768 × 1024</option><option value="1024x768">1024 × 768</option><option value="1024x1024">1024 × 1024</option></select></label>
    <p>准备预览可能调用文字接口翻译角色资料；不会生成图片。确认后才调用生图接口。</p><button disabled={!input.trim() || kind === 'character' && !npcId} onClick={() => void prepare()}>{busy ? '正在准备……' : '准备生图预览'}</button>
  </fieldset>{busy && abort.current && <button onClick={() => { abort.current?.abort(); setBusy(false); }}>停止准备</button>}
    {preview && <fieldset disabled={disabled || busy}><legend>确认图片提示词</legend>
      <label>正面提示词<textarea aria-label="生图正面提示词" rows={7} value={preview.prompt} onChange={event => setPreview({ ...preview, prompt: event.target.value })} /></label>
      <label>负面提示词<textarea aria-label="生图负面提示词" rows={4} value={preview.negative} onChange={event => setPreview({ ...preview, negative: event.target.value })} /></label>
      {library && <ImagePromptLibraryPickerBase store={library} disabled={disabled || busy} onApply={selection => setPreview(current => current ? applyImagePromptSelection(current, selection) : null)} />}
      <p>发送时沿用对应接口的自动精简；角色姓名、性别和外貌细项作为保护资料保留。</p>
      <button disabled={!preview.prompt.trim()} onClick={() => void confirm()}>确认生成图片</button><button onClick={() => setPreview(null)}>返回修改</button>
    </fieldset>}{error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
  </div>;
}
