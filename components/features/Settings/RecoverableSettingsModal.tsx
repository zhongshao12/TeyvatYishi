import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { SettingsModalProps } from './SettingsModal';
import { useModalAccessibility } from '@/components/ui/Modal';

function SettingsLoadNotice({ error, onRetry, onClose }: {
  error?: Error; onRetry?: () => void; onClose: () => void;
}) {
  const dialogRef = useModalAccessibility<HTMLElement>(onClose);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={error ? '设置加载失败' : '设置载入中'} tabIndex={-1}
        className="max-w-lg rounded-lg border border-[rgba(var(--tj-accent-primary),0.5)] bg-[rgb(var(--tj-bg-primary))] p-6 text-[rgb(var(--tj-text-primary))]">
        <h2 className="mb-3 text-lg">{error ? '设置加载失败' : '设置载入中'}</h2>
        {error && <>
          <p className="mb-3 text-sm">游戏仍保持运行，未清除存档或当前回合。请重试；若仍失败，请重启开发服务后重新打开页面。</p>
          <pre className="mb-4 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">{error.message}</pre>
        </>}
        <div className="flex gap-3">
          {error && <button className="rounded border px-4 py-2" onClick={onRetry}>重试加载设置</button>}
          <button className="rounded border px-4 py-2" onClick={onClose}>{error ? '关闭并返回游戏' : '取消打开设置'}</button>
        </div>
      </section>
    </div>
  );
}

class SettingsLoadBoundary extends Component<{
  children: ReactNode; onRetry: () => void; onClose: () => void;
}, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() {
    if (!this.state.error) return this.props.children;
    return <SettingsLoadNotice error={this.state.error} onRetry={this.props.onRetry} onClose={this.props.onClose} />;
  }
}

/** A failed settings chunk must not reload or unmount the live game. */
export function createRecoverableSettingsModal(loader: () => Promise<{ default: ComponentType<SettingsModalProps> }>) {
  return function RecoverableSettings(props: SettingsModalProps) {
    const [attempt, setAttempt] = useState(0);
    // React.lazy caches rejection. A user-triggered retry needs a fresh lazy instance
    // and a fresh boundary, not merely another render of the rejected instance.
    const Modal = useMemo(() => lazy(loader), [loader, attempt]);
    return (
      <SettingsLoadBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)} onClose={props.onClose}>
        <Suspense fallback={<SettingsLoadNotice onClose={props.onClose} />}>
          <Modal {...props} />
        </Suspense>
      </SettingsLoadBoundary>
    );
  };
}

export const RecoverableSettingsModal = createRecoverableSettingsModal(
  () => import('./SettingsModal').then(module => ({ default: module.SettingsModal })),
);
