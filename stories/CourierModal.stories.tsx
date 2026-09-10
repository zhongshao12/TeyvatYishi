import type { Meta, StoryObj } from '@storybook/react-vite';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import type { CourierSystem } from '@/models/teyvat/courier';

// 信使终端视觉回归：会话列表筛选 / 私聊气泡 / 群组 / 系统投递 / 玩家投递框。
const meta: Meta<typeof CourierModal> = {
  title: '冒险者手账/信使终端',
  component: CourierModal,
  parameters: { layout: 'fullscreen' },
};
export default meta;

const now = Date.now();

const sampleCourier: CourierSystem = {
  contacts: [
    { id: 'paimon', name: '派蒙', npcId: 'npc-paimon', available: true, relationLabel: '向导' },
    { id: 'amber', name: '安柏', npcId: 'npc-amber', available: true, relationLabel: '侦察骑士' },
    { id: 'guild', name: '凯瑟琳', available: true, organization: '冒险家协会' },
  ],
  letters: [],
  conversations: [
    {
      id: 'conv-paimon',
      title: '派蒙',
      participantIds: ['player', 'paimon'],
      unread: 2,
      type: 'private',
      typingMemberIds: [],
      pinned: true,
      updatedAt: now,
      messages: [
        { id: 'm1', senderId: 'paimon', senderName: '派蒙', role: 'assistant', content: '喂——别光顾着看风景呀！前面就是风起地了，派蒙闻到蜂蜜酒的味道了！', turn: 3, timestamp: now - 3600_000, readBy: ['paimon'] },
        { id: 'm2', senderId: 'player', senderName: '荧', role: 'user', content: '先去神像那里看看吧，说不定有新的线索。', turn: 3, timestamp: now - 3000_000, readBy: ['player', 'paimon'] },
        { id: 'm3', senderId: 'paimon', senderName: '派蒙', role: 'assistant', content: '嗯嗯，那就说定了！顺便……顺便在附近的锅子里尝尝蒙德烤鱼嘛。', turn: 4, timestamp: now - 600_000, readBy: ['paimon'] },
      ],
    },
    {
      id: 'conv-guild',
      title: '冒险家协会通告',
      participantIds: ['guild'],
      unread: 0,
      type: 'system',
      typingMemberIds: [],
      updatedAt: now - 7200_000,
      messages: [
        { id: 'm4', senderId: 'guild', senderName: '凯瑟琳', role: 'assistant', content: '向着星辰与深渊！新的委托已发布：清理风龙废墟周边的丘丘人营地。', turn: 2, timestamp: now - 7200_000, readBy: ['guild', 'player'] },
      ],
    },
    {
      id: 'conv-group',
      title: '蒙德同行小队',
      participantIds: ['player', 'paimon', 'amber'],
      unread: 0,
      type: 'group',
      typingMemberIds: [],
      announcement: '出发前请检查补给与风之翼耐久。',
      updatedAt: now - 86400_000,
      messages: [
        { id: 'm5', senderId: 'amber', senderName: '安柏', role: 'assistant', content: '兔兔伯爵已经就位！明天早上八点，城门口集合～', turn: 1, timestamp: now - 86400_000, readBy: ['amber', 'player'] },
      ],
    },
  ],
  deliverySeeds: [],
  unreadTotal: 2,
  wallpapers: {},
};

const noop = () => undefined;

export const 信使终端样例: StoryObj = {
  render: () => (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))' }}>
      <CourierModal
        courier={sampleCourier}
        npcRecords={[]}
        travelerName="荧"
        onCourierChange={noop}
        onClose={noop}
      />
    </div>
  ),
};
