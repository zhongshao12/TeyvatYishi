import type { Meta, StoryObj } from '@storybook/react-vite';
import { DesktopHomeScreen } from '@/components/layout/DesktopHomeScreen';

// 手账封面首页视觉回归：金箔标题 + 缎带书签 + 羊皮纸内页卡。
const meta: Meta<typeof DesktopHomeScreen> = {
  title: '冒险者手账/应用外壳',
  component: DesktopHomeScreen,
  parameters: { layout: 'fullscreen' },
};
export default meta;

const noop = () => undefined;

export const 手账封面首页: StoryObj = {
  render: () => (
    <div style={{ minHeight: '100vh' }}>
      <DesktopHomeScreen
        onNewGame={noop}
        onLoadSave={noop}
        onContinue={async () => true}
        onOpenSettings={noop}
        onOpenStorageManager={noop}
        onOpenWorldbookManager={noop}
        onOpenCodexManager={noop}
        onOpenCloudSave={noop}
        onOpenReleaseAnnouncements={noop}
        onDiscordPost={noop}
        onMysteryChat={noop}
        currentTheme="inazuma"
      />
    </div>
  ),
};
