import { useSyncExternalStore } from 'react';
import type { CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import { listCourierPhotoCandidates } from '@/services/courierPhoto';
import type { createCourierReplyQueue } from '@/hooks/useGame/courierReplyQueue';

export type CourierPhotoReplyQueue = Pick<ReturnType<typeof createCourierReplyQueue>, 'subscribe' | 'getSnapshot' | 'isPending'>;
const noSubscribe = () => () => {};
const emptySnapshot = () => 0;

export function CourierPhotoAction({ courier, npcRecords, conversationId, replyQueue, failed, onRequest }: {
  courier: CourierSystem; npcRecords: NPC记录[]; conversationId: string;
  replyQueue?: CourierPhotoReplyQueue; failed: boolean; onRequest: (messageId: string) => void;
}) {
  useSyncExternalStore(replyQueue?.subscribe ?? noSubscribe, replyQueue?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const conversation = courier.conversations.find(item => item.id === conversationId);
  const latestRequest = conversation?.messages.filter(message => message.senderId === 'player' && message.role === 'user').at(-1);
  // The banner is conversation-wide: an older failure must not lock a completed
  // new exchange. Keep the conservative banner guard when no queue is available.
  const pending = replyQueue
    ? Boolean(latestRequest && replyQueue.isPending(conversationId, [latestRequest.id]))
    : failed;
  const candidates = pending ? [] : listCourierPhotoCandidates(courier, npcRecords, conversationId);
  const group = conversation?.type === 'group';
  const disabledReason = pending ? '当前这轮回信尚未完成，请等待或重试回信。'
    : !latestRequest ? '请先发送消息并等待角色完成回信，再生成照片。'
      : !candidates.length ? '本轮没有可附照片的完整角色回复，或照片已生成、角色资料不可用。' : '';
  return <div className="flex shrink-0 flex-col gap-1">
    {group && candidates.length > 0 && <select aria-label="照片角色" className="teyvat-input max-w-32 text-xs" key={candidates.map(item => item.target.messageId).join(':')} defaultValue={candidates[0]?.target.messageId}>
      {candidates.map(item => <option key={item.target.messageId} value={item.target.messageId}>{item.npc.姓名}</option>)}
    </select>}
    <button type="button" aria-label="手机照片" className="teyvat-btn min-h-11 px-3 text-xs" disabled={!candidates.length}
      title={disabledReason || '预览本次手机照片（确认后才生成）'}
      onClick={event => {
        const selection = event.currentTarget.parentElement?.querySelector<HTMLSelectElement>('select')?.value;
        const target = candidates.find(item => item.target.messageId === selection) ?? candidates[0];
        if (target) onRequest(target.target.messageId);
      }}>手机照片</button>
    {disabledReason && <p role="status" className="max-w-48 text-[11px] leading-4" style={{ color: 'rgba(var(--tj-text-secondary),0.85)' }}>{disabledReason}</p>}
  </div>;
}
