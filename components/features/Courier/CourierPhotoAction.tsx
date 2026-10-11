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
  const pending = Boolean(replyQueue?.isPending(conversationId) || failed);
  const candidates = pending ? [] : listCourierPhotoCandidates(courier, npcRecords, conversationId);
  const group = courier.conversations.find(item => item.id === conversationId)?.type === 'group';
  return <div className="flex shrink-0 flex-col gap-1">
    {group && candidates.length > 0 && <select aria-label="照片角色" className="teyvat-input max-w-32 text-xs" key={candidates.map(item => item.target.messageId).join(':')} defaultValue={candidates[0]?.target.messageId}>
      {candidates.map(item => <option key={item.target.messageId} value={item.target.messageId}>{item.npc.姓名}</option>)}
    </select>}
    <button type="button" aria-label="手机照片" className="teyvat-btn min-h-11 px-3 text-xs" disabled={!candidates.length}
      title={pending ? '回信排队、生成或待重试，交流尚未完成。' : !candidates.length ? '当前交流没有可附照片的有效角色回复，或已附照片。' : '预览本次手机照片（确认后才生成）'}
      onClick={event => {
        const selection = event.currentTarget.parentElement?.querySelector<HTMLSelectElement>('select')?.value;
        const target = candidates.find(item => item.target.messageId === selection) ?? candidates[0];
        if (target) onRequest(target.target.messageId);
      }}>手机照片</button>
  </div>;
}
