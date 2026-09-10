import type { Meta, StoryObj } from '@storybook/react-vite';
import { LandingPage } from '@/components/layout/LandingPage';

// Web 落地页手账封面视觉回归：皮革底 + 金尘 + 封面框。
const meta: Meta<typeof LandingPage> = {
  title: '冒险者手账/落地页',
  component: LandingPage,
  parameters: { layout: 'fullscreen' },
};
export default meta;

const noop = () => undefined;

export const 封面样例: StoryObj = {
  render: () => (
    <LandingPage
      onNewGame={noop}
      onLoadSave={noop}
      onSettings={noop}
      onWorldbookManager={noop}
      onCodexManager={noop}
      onCloudSave={noop}
      onReleaseAnnouncements={noop}
      onDiscordPost={noop}
      onMysteryChat={noop}
      onContinue={noop}
    />
  ),
};
