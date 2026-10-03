import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CourierMessageTimeline } from '@/components/features/Courier/CourierMessageTimeline';
import { CourierMomentsPanel } from '@/components/features/Courier/CourierMomentsPanel';
import { captureWorldMoment } from '@/services/worldMoment';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import type { CourierConversation, CourierMessage, CourierMoment } from '@/models/teyvat/courier';

describe('phone game-time display', () => {
  const worldMoment = captureWorldMoment({
    ...createEmptyTeyvatGameState().世界,
    当前日期: '旅行历 1000.03.08', 当前时间: '14:00', 当前地点: '蒙德城', 旅程天数: 8,
  }, 6, 'turn-6');

  it('shows the frozen game time on a message without replacing it with device time', () => {
    const message: CourierMessage = {
      id: 'message-6', senderId: 'amber', senderName: '安柏', role: 'assistant', content: '在城门见。',
      turn: 6, timestamp: 1_000, readBy: [], worldMoment,
    };
    const conversation: CourierConversation = {
      id: 'chat-amber', title: '安柏', participantIds: ['player', 'amber'], messages: [message],
      unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1_000,
    };
    const html = renderToStaticMarkup(<CourierMessageTimeline
      selected={conversation} visibleMessages={[message]} hiddenMessageCount={0}
      contactNameById={new Map()} messageBottomRef={{ current: null }}
      resolveSenderAvatar={() => undefined} onShowEarlier={() => undefined}
    />);
    expect(html).toContain('旅行历 1000.03.08');
    expect(html).toContain('14:00');
    expect(html).not.toContain('1970');
  });

  it('labels a moment with both game time and device publishing time', () => {
    const post: CourierMoment = {
      id: 'post-6', authorId: 'player', content: '今日见闻', turn: 6, createdAt: 1_000,
      updatedAt: 1_000, revision: 1, targets: [], comments: [], worldMoment,
    };
    const html = renderToStaticMarkup(<CourierMomentsPanel
      moments={[post]} travelerName="旅行者" eligibleCommenterCount={0} canGenerateComments={false}
      commenterNames={new Map()} onPublish={() => false} onEdit={() => undefined}
      onDelete={() => undefined} onRetry={() => undefined}
    />);
    expect(html).toContain('游戏时间：旅行历 1000.03.08 14:00');
    expect(html).toContain('现实发布时间：');
  });
});
