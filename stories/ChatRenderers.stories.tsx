import type { Meta, StoryObj } from '@storybook/react-vite';
import { DialogueBubble, NarrationLine } from '@/components/features/Chat/MessageRenderers';
import { UserTurnBubble } from '@/components/features/Chat/TurnItem';

// JRPG 对话渲染视觉回归用故事：旁白 / NPC 对话框 / 主角对话框 / 旅人手记。
const meta: Meta<typeof DialogueBubble> = {
  title: 'Chat/JRPG Renderers',
  component: DialogueBubble,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))', padding: '28px 18px' }}>
        <div
          className="journal-story-page"
          style={{ maxWidth: 780, margin: '0 auto', padding: '28px 26px' }}
        >
          <Story />
        </div>
      </div>
    ),
  ],
};
export default meta;

const noAlbum = undefined;
const noTraveler = undefined;

export const ConversationSample: StoryObj = {
  render: () => (
    <div>
      <NarrationLine
        text="晚风掠过风起地的草浪，远处的风神像在暮色里亮起一点温柔的光。"
        fontSize={15}
      />
      <DialogueBubble
        name="安柏"
        text="嘿——你就是那位新来的旅行者吧？侦察骑士安柏，蒙德城见多识广的第一名飞行者，随时为你效劳！"
        color="rgb(235, 180, 145)"
        fontSize={15}
        deferOffscreen
      />
      <NarrationLine
        text="她单手叉腰，另一只手指向城门的方向，兔耳伯爵在她肩头晃了晃。"
        fontSize={15}
      />
      <DialogueBubble
        name="荧"
        text="我想先去看看风神像，那里应该能看清整座蒙德城的轮廓。"
        color="rgb(var(--tj-accent-primary))"
        isProtagonist
        fontSize={15}
        deferOffscreen
      />
      <DialogueBubble
        name="派蒙"
        text="喂喂，别急着走呀！先听侦察骑士把话说完嘛。"
        color="rgb(195, 175, 235)"
        avatarUrl={undefined}
        fontSize={15}
        deferOffscreen
      />
      <div className="mt-6 border-t border-dashed border-white/10 pt-5">
        <UserTurnBubble
          content="跟着安柏往蒙德城走，路上顺便问问龙灾的来龙去脉。"
          traveler={noTraveler}
          album={noAlbum}
          fontSize={14}
        />
      </div>
    </div>
  ),
};
