import { memo, type RefObject } from 'react';
import type { CourierConversation, CourierMessage } from '@/models/teyvat/courier';
import { CLIP_ITEM } from '@/styles/clipPaths';

interface CourierMessageTimelineProps {
  selected: CourierConversation | null;
  visibleMessages: CourierMessage[];
  hiddenMessageCount: number;
  conversationWallpaper?: string;
  contactNameById: ReadonlyMap<string, string>;
  messageBottomRef: RefObject<HTMLDivElement | null>;
  resolveSenderAvatar: (message: CourierMessage) => string | undefined;
  onShowEarlier: () => void;
}

const gold = 'rgb(var(--tj-accent-primary))';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const ink = (alpha: number) => `rgba(var(--tj-text-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;

function senderInitial(message: CourierMessage): string {
  return message.senderName.trim().charAt(0) || '?';
}

const CourierMessageRow = memo(function CourierMessageRow({
  message,
  startsNewTurn,
  resolveSenderAvatar,
}: {
  message: CourierMessage;
  startsNewTurn: boolean;
  resolveSenderAvatar: (message: CourierMessage) => string | undefined;
}) {
  const isPlayer = message.senderId === 'player';
  const avatarUrl = resolveSenderAvatar(message);
  return (
    <>
      {startsNewTurn && <div data-testid="phone-turn-divider" className="my-4 flex items-center gap-3" aria-label={`第 ${message.turn} 回合`}><span className="h-px flex-1 border-t border-dashed" style={{ borderColor: goldSoft(0.38) }} /><span className="text-[10px] tracking-[0.16em]" style={{ color: muted(0.72) }}>回合 {message.turn}</span><span className="h-px flex-1 border-t border-dashed" style={{ borderColor: goldSoft(0.38) }} /></div>}
      <article data-testid={isPlayer ? 'phone-player-message-row' : undefined} data-phone-message-row="true" className={`mb-4 flex items-start gap-3 ${isPlayer ? 'flex-row-reverse' : ''}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '76px' }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={`${message.senderName} 头像`} className="mt-5 h-9 w-9 shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 1px ${goldSoft(0.4)}` }} />
        ) : (
          <span className="mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-serif text-sm" style={{ color: gold, boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}` }}>
            {senderInitial(message)}
          </span>
        )}
        <div className={`min-w-0 max-w-[78%] ${isPlayer ? 'text-right' : ''}`}>
          <p className="text-[11px]" style={{ color: muted(0.72) }}>
            {message.senderName} · 回合 {message.turn}
            {isPlayer && message.readBy.length > 1 ? ' · 已读' : ''}
          </p>
          <p
            className="mt-1 inline-block whitespace-pre-wrap px-3 py-2 text-left text-sm leading-relaxed"
            style={{
              color: ink(0.96),
              background: isPlayer ? goldSoft(0.1) : 'rgba(var(--tj-chat-bubble), var(--tj-chat-bubble-alpha, 0.78))',
              borderLeft: isPlayer ? undefined : `2px solid ${goldSoft(0.45)}`,
              borderRight: isPlayer ? `2px solid rgba(var(--tj-accent-secondary), 0.55)` : undefined,
              clipPath: CLIP_ITEM,
            }}
          >
            {message.content}
          </p>
        </div>
      </article>
    </>
  );
});

export const CourierMessageTimeline = memo(function CourierMessageTimeline({
  selected,
  visibleMessages,
  hiddenMessageCount,
  conversationWallpaper,
  contactNameById,
  messageBottomRef,
  resolveSenderAvatar,
  onShowEarlier,
}: CourierMessageTimelineProps) {
  return (
    <div
      data-testid="phone-message-timeline"
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      style={conversationWallpaper ? {
        backgroundImage: `linear-gradient(rgba(239, 227, 201, 0.88), rgba(239, 227, 201, 0.92)), url(${conversationWallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      } : undefined}
    >
      {!selected || selected.messages.length === 0 ? (
        <p className="py-10 text-center text-sm leading-6" style={{ color: muted(0.75) }}>
          {selected ? '这段会话还没有消息。' : '从左侧选择一个会话，查看协会与同伴的消息。'}
        </p>
      ) : (
        <>
          {hiddenMessageCount > 0 && (
            <div className="mb-4 flex flex-col items-center gap-1 text-center">
              <span className="text-[10px]" style={{ color: muted(0.68) }}>还有较早的 {hiddenMessageCount} 条消息未渲染</span>
              <button
                type="button"
                onClick={onShowEarlier}
                className="px-3 py-1 text-[11px]"
                style={{ color: goldSoft(0.92), boxShadow: `inset 0 0 0 1px ${goldSoft(0.28)}`, clipPath: CLIP_ITEM }}
              >
                加载更早消息
              </button>
            </div>
          )}
          {visibleMessages.map((message, index) => (
            <CourierMessageRow
              key={message.id}
              message={message}
              startsNewTurn={index > 0 && visibleMessages[index - 1]?.turn !== message.turn}
              resolveSenderAvatar={resolveSenderAvatar}
            />
          ))}
        </>
      )}
      {selected && selected.typingMemberIds.length > 0 && (
        <div className="flex items-center gap-2 pb-1 text-[12px]" style={{ color: muted(0.85) }}>
          <span className="inline-flex gap-[3px]">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full"
                style={{ background: goldSoft(0.8), animationDelay: `${dot * 0.18}s` }}
              />
            ))}
          </span>
          <span className="font-serif tracking-[0.1em]">
            {selected.typingMemberIds.map((id) => contactNameById.get(id) ?? id).join('、') || '对方'} 正在输入……
          </span>
        </div>
      )}
      <div ref={messageBottomRef} data-testid="phone-message-bottom" />
    </div>
  );
});
