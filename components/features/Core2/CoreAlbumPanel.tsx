import { useRef, useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreSnapshot, StateRecord } from '@/core/contracts/state';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { sameData } from '@/core/persistence/repositoryValidation';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CoreAssetImage } from './CoreAssetImage';
import { CoreImageComposer } from './CoreImageComposer';
import { readImageFileBytes } from '@/utils/readImageFile';
function AlbumEntry({ entry, snapshot, repo, disabled, onCommand }: { entry: StateRecord<'album'>; snapshot: CoreSnapshot; repo: CoreRepository; disabled: boolean; onCommand(command: BasicPlayerCommand): Promise<unknown> }) {
  const traveler = snapshot.records.find(row => row.domain === 'traveler');
  const people = snapshot.records.filter(row => row.domain === 'traveler' || row.domain === 'npc' && !row.value.archived);
  const [target, setTarget] = useState(entry.value.npcIds.length ? 'npc:' + entry.value.npcIds[0] : 'traveler:' + traveler?.entityId), [slot, setSlot] = useState<'profile' | 'courier' | 'narrative'>('profile');
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const run = async (command: BasicPlayerCommand) => { setBusy(true); setError(''); setMessage(''); try { await onCommand(command); return true; } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); return false; } finally { setBusy(false); } };
  const bind = async () => {
    const separator = target.indexOf(':'), domain = target.slice(0, separator), id = target.slice(separator + 1), person = people.find(row => row.domain === domain && row.entityId === id);
    if (!person || (domain !== 'traveler' && domain !== 'npc')) { setError('请先选择有效的人物。'); return; }
    if (await run({ type: 'image_bind', entryId: entry.entityId, target: domain, targetId: id, slot, expectedVersion: person.version })) setMessage('已设置到所选位置。');
  };
  const moment = entry.value.moment;
  return <article className="core2-album-entry"><h3>{entry.value.title}</h3><CoreAssetImage repo={repo} journeyId={snapshot.head.scope.journeyId} assetId={entry.value.assetId} alt={entry.value.title} />
    <p className="core2-memory-moment">{moment.date ?? '日期未记录'} {moment.clock ?? ''} · {moment.weather ?? '天气未记录'} · {moment.location ?? '地点未记录'} · 旅行第 {moment.travelDay ?? '?'} 天 · 第 {moment.turn} 回合</p>
    <fieldset disabled={disabled || busy}><label>使用目标<select aria-label="图片使用目标" value={target} onChange={event => setTarget(event.target.value)}>
      {people.map(person => <option key={person.domain + ':' + person.entityId} value={person.domain + ':' + person.entityId}>{person.domain === 'traveler' || person.domain === 'npc' ? person.value.姓名 : person.entityId}</option>)}
    </select></label><label>使用位置<select aria-label="图片使用位置" value={slot} onChange={event => setSlot(event.target.value as typeof slot)}>
      <option value="profile">人物头像</option><option value="courier">手机头像</option><option value="narrative">人物立绘</option>
    </select></label><button onClick={() => void bind()}>使用这张图片</button><button onClick={() => setConfirm(true)}>移出当前相册</button>
      {confirm && <div role="group" aria-label="确认移出相册"><p>只移出当前相册；已经使用的头像和历史存档引用仍保留，不会删除原图。</p><button onClick={() => void run({ type: 'image_delete', entryId: entry.entityId, expectedVersion: entry.version })}>确认移出相册</button><button onClick={() => setConfirm(false)}>保留图片</button></div>}
    </fieldset>{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </article>;
}
export function CoreAlbumPanel({ controller, repo, snapshot, disabled = false }: { controller: CoreController; repo: CoreRepository; snapshot: CoreSnapshot; disabled?: boolean }) {
  const [title, setTitle] = useState(''), [file, setFile] = useState<File | null>(null), [kind, setKind] = useState<'character' | 'scene' | 'snapshot'>('character'), [npcIds, setNpcs] = useState<string[]>([]);
  const [count, setCount] = useState(20), [busy, setBusy] = useState(false), [error, setError] = useState(''); const input = useRef<HTMLInputElement>(null);
  const people = snapshot.records.filter((row): row is StateRecord<'npc'> => row.domain === 'npc' && !row.value.archived), entries = snapshot.records.filter((row): row is StateRecord<'album'> => row.domain === 'album');
  const upload = async () => {
    if (!file || busy || disabled) return; setBusy(true); setError(''); const owner = { scope: snapshot.head.scope, sessionId: snapshot.head.sessionId };
    try {
      const bytes = await readImageFileBytes(file), current = controller.getView().snapshot?.head;
      if (!current || !sameData(owner, { scope: current.scope, sessionId: current.sessionId })) throw Error('存档已经切换，未把图片加入另一个旅程。');
      const result = await controller.uploadImage({ title: title.trim() || file.name, kind, npcIds, bytes, mimeType: file.type });
      if (!['committed', 'already_committed'].includes(result.status)) throw Error('相册资料没有写入，请刷新当前页面后重试。');
      setFile(null); setTitle(''); if (input.current) input.current.value = '';
    } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  return <section className="core2-card core2-album" aria-label="相册"><h2>旅途相册</h2><p>收藏旅途里的风景与人物。图片单独保存，打开相册不会自动调用模型；默认只读取前20张，可按需展开。</p>
    <CoreImageComposer {...{ controller, snapshot, disabled }} />
    <fieldset disabled={disabled || busy} className="core2-album-upload"><legend>添加本地图片</legend>
      <label>选择图片<input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); if (chosen && !title) setTitle(chosen.name); }} /></label>
      <label>图片标题<input aria-label="图片标题" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>图片分类<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="character">人物</option><option value="scene">风景</option><option value="snapshot">故事快照</option></select></label>
      <label>关联角色（可不选，按Ctrl多选，最多20位）<select multiple size={Math.min(6, Math.max(2, people.length))} value={npcIds} onChange={event => setNpcs([...event.target.selectedOptions].map(option => option.value))}>{people.map(person => <option key={person.entityId} value={person.entityId}>{person.value.姓名}</option>)}</select></label>
      <button disabled={!file || npcIds.length > 20} onClick={() => void upload()}>{busy ? '正在保存图片……' : '上传并存入相册'}</button>
    </fieldset>{error && <p role="alert">{error}</p>}<div className="core2-album-grid">{entries.slice(0, count).map(entry => <AlbumEntry key={entry.entityId} {...{ entry, snapshot, repo, disabled }} onCommand={command => controller.command(command)} />)}</div>
    {!entries.length && <p>相册还是空的。选择图片并确认上传后才会保存。</p>}{entries.length > count && <button onClick={() => setCount(value => value + 20)}>再看20张</button>}
  </section>;
}
