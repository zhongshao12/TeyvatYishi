import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToastHost } from '@/components/ui/ToastHost';
import { getToasts, pushToast } from '@/utils/toastStore';
import { useEffect } from 'react';

// 应用内 toast 通知中心视觉回归：信息 / 成功 / 失败三态。
const meta: Meta<typeof ToastHost> = {
  title: '冒险者手账/通知中心',
  component: ToastHost,
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const 三态样例: StoryObj = {
  render: () => {
    useEffect(() => {
      // Storybook 挂载时灌入三条静态样例（持续时长内可截图）。
      if (getToasts().length === 0) {
        pushToast({ kind: 'info', title: '蒸汽鸟报已更新', detail: '风起地的丰收祭：低语森林的蜂蜜酒节开幕。' });
        pushToast({ kind: 'success', title: '故事快照已生成', detail: '生成了 2 张正文插图。' });
        pushToast({ kind: 'error', title: '回合结算失败', detail: '模型返回格式无法解析（已记录到 API 错误报告）。', durationMs: 120000 });
      }
    }, []);
    return (
      <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))' }}>
        <ToastHost />
      </div>
    );
  },
};
