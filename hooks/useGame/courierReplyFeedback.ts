import { failureItemId } from '@/models/failureCenter';
import type { reportFailure } from '@/utils/failureCenterStore';
import type { pushToast } from '@/utils/toastStore';
import type { CourierReplyBatchIntent } from './courierReplyQueue';

export function courierReplyFailureKey(batch: CourierReplyBatchIntent, scope: 'members' | 'messages'): string {
  return `${batch.conversationId}:${scope}:${batch.messageIds.at(-1) ?? ''}`;
}

/** Member-level feedback has no React state ownership; each original batch owns one retry record. */
export function publishCourierReplyFeedback(input: {
  batch: CourierReplyBatchIntent;
  replied: number;
  failedMemberNames?: readonly string[];
  turn: number;
}, effects: {
  report: (failure: Parameters<typeof reportFailure>[0]) => void;
  registerRetry: (id: string, retry: () => void) => void;
  resolve: (id: string) => void;
  retry: (conversationId: string, messageIds: readonly string[]) => void;
  toast: (toast: Parameters<typeof pushToast>[0]) => void;
}): void {
  const { batch, replied, failedMemberNames, turn } = input;
  const dedupeKey = courierReplyFailureKey(batch, 'members');
  const failureId = failureItemId('courier_reply', dedupeKey);
  if (!failedMemberNames?.length) {
    if (replied > 0) {
      effects.resolve(failureId);
      effects.resolve(failureItemId('courier_reply', courierReplyFailureKey(batch, 'messages')));
    }
    return;
  }
  const names = failedMemberNames.join('、');
  const title = replied > 0 ? '群聊回信部分完成' : '群聊回信待重试';
  effects.report({
    source: 'courier_reply', reasonCode: 'phone_reply_partial_members',
    humanReason: `${title}：${names}没有回复。`,
    dedupeKey, retryable: 'manual', retryLabel: '重试未回复成员', turn,
  });
  effects.registerRetry(failureId, () => effects.retry(batch.conversationId, batch.messageIds));
  effects.toast({ kind: 'info', title, detail: replied > 0
    ? `${names}没有回复；其余成员已回信，可在失败结算里重试。`
    : `${names}没有回复；当前没有可接收的回信，可在失败结算里重试。` });
}
