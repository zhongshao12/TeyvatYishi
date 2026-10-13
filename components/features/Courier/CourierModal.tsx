import { memo } from 'react';
import { useModalAccessibility } from '@/components/ui/Modal';
import { CourierPanel, type CourierPanelProps } from './CourierPanel';

export { CourierPanel, resolveCourierMessageTurn } from './CourierPanel';
export type CourierModalProps = CourierPanelProps;

/** Compatibility host only. The game system page mounts CourierPanel directly. */
export const CourierModal = memo(function CourierModal(props: CourierModalProps) {
  const dialogRef = useModalAccessibility<HTMLElement>(props.onClose);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="提瓦特手机" tabIndex={-1}
      className="journal-story-page flex h-[100dvh] w-full flex-col overflow-hidden sm:h-[min(84vh,720px)] sm:w-[min(980px,100%)]">
      <CourierPanel {...props} />
    </section>
  </div>;
});
