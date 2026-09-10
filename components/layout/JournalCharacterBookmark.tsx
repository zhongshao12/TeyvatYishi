import type { ReactNode } from 'react';

export interface JournalCharacterBookmarkProps {
  children: ReactNode;
  label?: string;
}

export function JournalCharacterBookmark({
  children,
  label = '旅行者档案书签',
}: JournalCharacterBookmarkProps) {
  return (
    <aside className="journal-character-bookmark" aria-label={label}>
      <div className="journal-character-bookmark__spine" aria-hidden="true" />
      <div className="journal-character-bookmark__body journal-leather-surface">
        {children}
      </div>
      <div className="journal-character-bookmark__tail" aria-hidden="true" />
    </aside>
  );
}
