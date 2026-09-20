import { memo } from 'react';
import type { CourierConversation } from '@/models/teyvat/courier';
import { CLIP_ITEM } from '@/styles/clipPaths';

interface CourierConversationListProps {
  conversations: CourierConversation[];
  selectedId?: string;
  hiddenConversationCount: number;
  onSelect: (conversationId: string) => void;
  onShowMore: () => void;
}

const TYPE_LABELS: Record<CourierConversation['type'], string> = {
  private: '私聊',
  group: '群聊',
  system: '系统通知',
};

const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const ink = (alpha: number) => `rgba(var(--tj-text-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;
const VISIBLE_CONVERSATION_INCREMENT = 60;

const CourierConversationListItem = memo(function CourierConversationListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: CourierConversation;
  active: boolean;
  onSelect: (conversationId: string) => void;
}) {
  const last = conversation.messages.at(-1);
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className="mb-2 w-full px-3 py-2.5 text-left transition-colors"
      style={{
        background: active ? goldSoft(0.12) : goldSoft(0.04),
        boxShadow: `inset 0 0 0 1px ${active ? goldSoft(0.5) : goldSoft(0.16)}`,
        clipPath: CLIP_ITEM,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="min-w-0 truncate font-serif text-sm tracking-wide" style={{ color: ink(0.96) }}>
          {conversation.pinned ? '📌 ' : ''}{conversation.title || '未命名会话'}
        </strong>
        {conversation.unread > 0 && (
          <span className="shrink-0 px-1.5 text-[11px] font-bold" style={{ color: 'rgb(var(--tj-on-accent))', background: goldSoft(0.9) }}>
            {conversation.unread}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="min-w-0 break-words text-[12px]" style={{ color: muted(0.8) }}>
          {last ? `${last.senderName}：${last.content.slice(0, 24)}` : TYPE_LABELS[conversation.type]}
        </span>
        <span className="shrink-0 text-[10px]" style={{ color: muted(0.6) }}>
          {conversation.type === 'group' ? `${conversation.participantIds.filter((id) => id !== 'player').length}位成员` : TYPE_LABELS[conversation.type]}
        </span>
      </div>
    </button>
  );
});

export const CourierConversationList = memo(function CourierConversationList({
  conversations,
  selectedId,
  hiddenConversationCount,
  onSelect,
  onShowMore,
}: CourierConversationListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {conversations.length === 0 && (
        <p className="px-1 py-6 text-center text-xs leading-6" style={{ color: muted(0.75) }}>
          还没有聊天。继续冒险后，同伴与协会的消息会出现在这里。
        </p>
      )}
      {conversations.map((conversation) => (
        <CourierConversationListItem
          key={conversation.id}
          conversation={conversation}
          active={selectedId === conversation.id}
          onSelect={onSelect}
        />
      ))}
      {hiddenConversationCount > 0 && (
        <div className="flex flex-col items-center gap-1 px-1 pb-2 text-center">
          <span className="text-[10px]" style={{ color: muted(0.68) }}>还有 {hiddenConversationCount} 个会话未显示</span>
          <button
            type="button"
            onClick={onShowMore}
            className="w-full px-3 py-1.5 text-[11px]"
            style={{ color: goldSoft(0.92), boxShadow: `inset 0 0 0 1px ${goldSoft(0.28)}`, clipPath: CLIP_ITEM }}
          >
            再显示 {Math.min(VISIBLE_CONVERSATION_INCREMENT, hiddenConversationCount)} 个会话
          </button>
        </div>
      )}
    </div>
  );
});
