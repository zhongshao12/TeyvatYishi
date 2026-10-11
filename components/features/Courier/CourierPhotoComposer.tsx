import type { CourierPhotoTarget } from '@/services/courierPhoto';
import type { CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import type { 文生图系统设置 } from '@/models/settings';
import type { 相册系统 } from '@/models/imageGeneration';
import type { TeyvatGameState } from '@/models/teyvat/state';
import { useCourierPhotoGeneration } from './useCourierPhotoGeneration';

export interface CourierPhotoComposerProps {
  target: CourierPhotoTarget;
  courier: CourierSystem;
  album: 相册系统;
  npcRecords: NPC记录[];
  imageSettings: 文生图系统设置;
  getGameSessionId?: () => number;
  onAlbumChange: (update: 相册系统 | ((previous: 相册系统) => 相册系统)) => void;
  onCommitPhoto: (update: (current: TeyvatGameState) => TeyvatGameState, sessionId: number | null) => boolean;
  onClose: () => void;
}
export function CourierPhotoComposer(props: CourierPhotoComposerProps) {
  const photo = useCourierPhotoGeneration(props);
  return <section aria-label="手机照片预览" className="max-h-[65vh] shrink-0 overflow-y-auto border-t p-4" style={{ background: 'rgb(var(--tj-bg-primary))', color: 'rgb(var(--tj-text-primary))', borderColor: 'rgba(var(--tj-accent-primary),0.3)' }}>
    <h3 className="font-serif text-base">手机照片预览</h3>
    <p className="mt-2 text-sm">照片角色：{photo.name}</p>
    <p className="mt-1 text-xs">资料来源：本次玩家拍照要求、角色姓名、性别与已记录外貌；不读取关系、记忆或私密档案。外貌细项保留来源，未记录数值不推测。</p>
    <p className="my-2 text-xs">普通照片 · 点击确认才调用图片接口。生成后显示在该消息下，并收入相册；不会替换角色头像。</p>
    {!photo.description.trim() && <p role="note" className="my-2 text-xs">未能确定本次玩家拍照要求，请在下方填写照片需求，再更新提示词。</p>}
    <label className="block text-xs">照片描述<textarea aria-label="照片描述" placeholder="填写本次拍照要求：地点、动作、构图等" rows={2} value={photo.description} disabled={photo.busy} onChange={event => photo.setDescription(event.target.value)} className="teyvat-input mt-1 w-full" /></label>
    <button type="button" disabled={photo.busy} onClick={photo.rebuild} className="teyvat-btn my-2 min-h-11 px-3 text-xs">更新提示词</button>
    <label className="block text-xs">正面提示词<textarea aria-label="照片正面提示词" rows={4} value={photo.draft.prompt} disabled={photo.busy} onChange={event => photo.setDraft(previous => ({ ...previous, prompt: event.target.value, error: '' }))} className="teyvat-input mt-1 w-full" /></label>
    <label className="mt-2 block text-xs">负面提示词<textarea aria-label="照片负面提示词" rows={2} value={photo.draft.negative} disabled={photo.busy} onChange={event => photo.setDraft(previous => ({ ...previous, negative: event.target.value }))} className="teyvat-input mt-1 w-full" /></label>
    <p role="status" className="my-2 whitespace-pre-wrap text-xs">{photo.disabledReason || photo.draft.error || photo.status}</p>
    <div className="flex gap-3">
      <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-4 text-xs" disabled={photo.busy || Boolean(photo.disabledReason || photo.draft.error) || !photo.draft.prompt.trim()} onClick={() => { void photo.generate(); }}>{photo.busy ? '生成中…' : photo.status.startsWith('生成失败') ? '重试生成' : '确认生成'}</button>
      <button type="button" onClick={photo.close} className="teyvat-btn min-h-11 px-4 text-xs">{photo.busy ? '取消生成' : '关闭预览'}</button>
    </div>
  </section>;
}
