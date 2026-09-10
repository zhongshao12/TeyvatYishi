import type { ReactNode } from 'react';

export interface JournalSystemTabsProps {
  children: ReactNode;
  variant?: 'desktop' | 'mobile';
  label?: string;
}

/** Descendant tab buttons expose the selected page with `aria-current="page"`. */
export function JournalSystemTabs({
  children,
  variant = 'desktop',
  label = variant === 'desktop' ? '冒险手账系统页签' : '冒险手账快捷页签',
}: JournalSystemTabsProps) {
  const variantClass = variant === 'mobile'
    ? 'journal-system-tabs--mobile'
    : 'journal-system-tabs--desktop';
  return (
    <nav
      className={`journal-system-tabs ${variantClass}`}
      aria-label={label}
    >
      {children}
    </nav>
  );
}
