import { ImagePromptLibraryPicker } from '@/components/features/ImageGeneration/ImagePromptLibraryPicker';
import { applyImagePromptSelection } from '@/utils/imagePromptLibrary';
import { MAX_MOMENT_IMAGES } from '@/models/teyvat/courier';
import { resolveMomentImage } from '@/services/courierMomentImages';
import { useCourierMomentImages, type CourierMomentImageEditorProps } from './useCourierMomentImages';

export function CourierMomentImageEditor(props: CourierMomentImageEditorProps) {
  const tool = useCourierMomentImages(props);
  const full = props.images.length >= MAX_MOMENT_IMAGES;
  const choices = props.tools.album.entries.filter(entry => !props.images.some(image => image.assetId === entry.assetId)
    && resolveMomentImage(props.tools.album, { entryId: entry.id, assetId: entry.assetId }));
  return <div className="mt-3 space-y-2" aria-label="朋友圈配图工具">
    <p className="text-xs text-[rgb(var(--tj-text-secondary))]">配图 {props.images.length}/9 · 先预览再发布。移除配图不会删除相册原图。</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={tool.busy || full} className="teyvat-btn min-h-11 px-3 text-xs" onClick={() => tool.setMode(tool.mode === 'album' ? 'none' : 'album')}>从相册选择</button>
      <label className={`teyvat-btn flex min-h-11 items-center px-3 text-xs ${tool.busy || full ? 'opacity-45' : 'cursor-pointer'}`}>
        上传配图<input type="file" accept="image/*" aria-label="上传朋友圈配图" className="sr-only" disabled={tool.busy || full} onChange={event => { void tool.upload(event.target.files); event.target.value = ''; }} />
      </label>
      <button type="button" disabled={tool.busy || full} className="teyvat-btn min-h-11 px-3 text-xs" onClick={() => tool.setMode(tool.mode === 'generate' ? 'none' : 'generate')}>生成配图</button>
    </div>
    {tool.uploading && <button type="button" className="teyvat-btn min-h-11 px-3 text-xs" onClick={tool.close}>取消上传</button>}
    {tool.mode !== 'none' && <label className="block text-xs">公开配图说明（可留空）<textarea aria-label="公开配图说明" maxLength={200} rows={2} className="teyvat-input mt-1 w-full" disabled={tool.busy} value={tool.caption} onChange={event => tool.setCaption(event.target.value)} /></label>}
    {tool.mode === 'album' && <div className="max-h-64 overflow-y-auto rounded border p-2" aria-label="选择朋友圈相册配图">
      {!choices.length && <p className="text-xs">暂无可选择的普通图片，可上传或生成一张。</p>}
      <div className="grid grid-cols-3 gap-2">{choices.map(entry => <button key={entry.id} type="button" aria-label={`选择${entry.title}`} className="min-h-11 rounded border p-1 text-xs" onClick={() => tool.select(entry.id)}>
        <img src={resolveMomentImage(props.tools.album, { entryId: entry.id, assetId: entry.assetId })} alt="" loading="lazy" className="aspect-square w-full object-cover" />{entry.title}
      </button>)}</div>
    </div>}
    {tool.mode === 'generate' && <div className="space-y-2 rounded border p-3" aria-label="朋友圈配图生成预览">
      <p className="text-xs">普通图片接口 · 点击确认才会生成。选角色时只读取姓名、性别和公开外貌，先准备英文资料；不读取关系、记忆、穿着或私密档案。生成完成只加入草稿，不自动发布。</p>
      <label className="block text-xs">画面角色<select aria-label="朋友圈配图角色" className="teyvat-input ml-2" disabled={tool.busy} value={tool.characterId} onChange={event => tool.setCharacterId(event.target.value)}>
        <option value="scene">纯场景，不带角色</option>
        {props.tools.traveler && <option value="traveler">{props.tools.traveler.姓名 || '旅行者'}</option>}
        {props.tools.npcRecords.map(npc => <option key={npc.id} value={npc.id}>{npc.姓名}</option>)}
      </select></label>
      <ImagePromptLibraryPicker disabled={tool.busy} onApply={selection => tool.setDraft(previous => applyImagePromptSelection(previous, selection))} />
      <label className="block text-xs">正面提示词<textarea aria-label="朋友圈配图正面提示词" placeholder="填写地点、动作、构图，可直接写英文提示词" rows={3} className="teyvat-input mt-1 w-full" disabled={tool.busy} value={tool.draft.prompt} onChange={event => tool.setDraft(previous => ({ ...previous, prompt: event.target.value }))} /></label>
      <label className="block text-xs">负面提示词<textarea aria-label="朋友圈配图负面提示词" rows={2} className="teyvat-input mt-1 w-full" disabled={tool.busy} value={tool.draft.negative} onChange={event => tool.setDraft(previous => ({ ...previous, negative: event.target.value }))} /></label>
      <div className="flex gap-2">
        <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-3 text-xs" disabled={tool.busy || Boolean(tool.disabledReason) || !tool.draft.prompt.trim()} onClick={() => { void tool.generate(); }}>{tool.busy ? '生成中…' : '确认生成配图'}</button>
        <button type="button" className="teyvat-btn min-h-11 px-3 text-xs" onClick={tool.close}>{tool.busy ? '取消生成' : '关闭生成预览'}</button>
      </div>
    </div>}
    {tool.disabledReason && <p className="whitespace-pre-wrap text-xs">{tool.disabledReason}</p>}
    <p role="status" className="whitespace-pre-wrap text-xs">{tool.status}</p>
  </div>;
}
