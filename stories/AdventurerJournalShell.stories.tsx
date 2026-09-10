import type { Meta, StoryObj } from '@storybook/react-vite';
import { GameView } from '../components/layout/GameView';
import { MobileQuickMenu } from '../components/layout/MobileQuickMenu';
import '../styles/tailwind.css';
import '../styles/root-theme.css';
import '../styles/global.css';

const noop = () => {};

function TopBarPreview() {
  return (
    <header className="teyvat-topbar journal-topbar hidden min-h-14 items-center justify-between px-6 md:flex">
      <strong className="font-serif tracking-[0.24em]">提瓦特冒险者手账</strong>
      <span className="font-serif text-xs tracking-[0.18em]">风起地 · 清晨 07:20</span>
      <span className="text-xs">冒险第 12 日</span>
    </header>
  );
}

function BookmarkPreview() {
  return (
    <section className="teyvat-left-panel journal-bookmark-content hidden h-full flex-col p-5 md:flex">
      <span className="text-center font-serif text-[11px] tracking-[0.35em]">TRAVELER</span>
      <div className="mx-auto mt-5 flex h-20 w-20 items-center justify-center rounded-full border border-amber-200/60 text-3xl">旅</div>
      <h2 className="mt-4 text-center font-serif text-xl">伊塔</h2>
      <p className="mt-2 text-center text-xs opacity-70">风元素 · 冒险家</p>
      <button type="button" onClick={noop} className="journal-focus-target mt-6 min-h-11 border border-amber-200/30 px-3 font-serif">查看旅人档案</button>
    </section>
  );
}

function StoryPreview() {
  return (
    <div className="journal-story-scroll overflow-y-auto px-6 py-8 text-[var(--journal-ink)]">
      <div className="mx-auto max-w-[68ch] font-serif leading-8">
        <p className="text-xs tracking-[0.3em] text-[var(--journal-travel-green)]">蒙德 · 风起地</p>
        <h1 className="mt-2 text-2xl">蒲公英掠过旧路标</h1>
        <hr className="journal-gilded-rule my-5" />
        <p>晨光从巨树的枝叶间落下。远处的风车刚刚转过第一圈，冒险家协会的委托纸还带着墨香。</p>
        <p className="mt-4">你把地图折进手账，看见一枚新鲜的风史莱姆印迹停在溪边。</p>
        <aside className="journal-traveler-note mt-6 ml-auto max-w-sm border-l-2 border-[var(--journal-antique-gold)] bg-amber-900/5 px-4 py-3">
          “先去溪边看看，也许能赶在骑士团之前找到线索。”
        </aside>
      </div>
    </div>
  );
}

function TabsPreview() {
  const labels = ['元素', '任务', '背包', '伙伴', '图鉴', '记忆'];
  return (
    <div className="teyvat-right-menu journal-system-tabs__rail hidden h-full flex-col gap-2 pt-5 md:flex">
      {labels.map((label, index) => (
        <button
          key={label}
          type="button"
          onClick={noop}
          aria-current={index === 1 ? 'page' : undefined}
          className="teyvat-menu-item journal-system-tab journal-focus-target min-h-11 px-4 text-left font-serif"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const meta = {
  title: '冒险者手账/应用外壳',
  component: GameView,
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: '地区水彩背景、皮革旅人书签、奶油纸故事页与实体页签组成的响应式冒险手账。' } },
  },
  render: (args) => (
    <>
      <GameView {...args} />
      <MobileQuickMenu
        onCharacter={noop}
        onCourier={noop}
        onSettings={noop}
        onSave={noop}
        onHome={noop}
        onSystemSelect={noop}
        courierUnread={2}
      />
    </>
  ),
  args: {
    region: 'mondstadt',
    weatherId: 'clear',
    topBar: <TopBarPreview />,
    leftPanel: <BookmarkPreview />,
    chatArea: <StoryPreview />,
    rightPanel: <TabsPreview />,
  },
} satisfies Meta<typeof GameView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 蒙德晨风: Story = {};

export const 稻妻雨夜: Story = {
  args: { region: 'inazuma', weatherId: 'heavy_rain', danger: 'watch' },
};

export const 纳塔警戒: Story = {
  args: { region: 'natlan', weatherId: 'clear', danger: 'danger' },
};
