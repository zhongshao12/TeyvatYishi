import type { 剧情书签 } from '@/utils/storyBookmarks';

interface ChatBookmarksPanelProps {
  bookmarks: 剧情书签[];
  onSelect: (messageId: string) => void;
  onClose: () => void;
}

const cardClip = 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';
const smallClip = 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';

export function ChatBookmarksPanel({ bookmarks, onSelect, onClose }: ChatBookmarksPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="剧情书签">
      <div className="w-[min(560px,94vw)] overflow-hidden" style={{ background: "rgba(var(--tj-surface-strong),0.98)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.4), 0 24px 60px rgba(0,0,0,0.5)", clipPath: cardClip }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: "rgba(var(--tj-accent-primary),0.08)" }}>
        <span className="font-serif text-xs font-bold tracking-[0.18em]" style={{ color: "rgb(var(--tj-accent-primary))" }}>剧情书签</span>
        <button type="button" onClick={onClose} className="px-3 py-1 text-xs" style={{ color: "rgba(var(--tj-text-secondary),0.85)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.3)", clipPath: smallClip }}>关闭</button>
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 py-3">
        {bookmarks.length === 0 ? (
          <div className="py-6 text-center text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.65)" }}>还没有书签。在 AI 回合工具栏点击「书签」即可标记。</div>
        ) : bookmarks.map((bookmark) => (
          <button key={bookmark.messageId} type="button" onClick={() => onSelect(bookmark.messageId)} className="block w-full px-4 py-2.5 text-left" style={{ background: "rgba(var(--tj-accent-primary),0.05)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.14)", clipPath: smallClip }}>
            <div className="truncate text-sm font-semibold" style={{ color: "rgb(var(--tj-text-primary))" }}>{bookmark.title}</div>
            {bookmark.note && <div className="mt-1 line-clamp-2 text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.7)" }}>{bookmark.note}</div>}
            {bookmark.turn > 0 && <div className="mt-1 text-[10px]" style={{ color: "rgba(var(--tj-arcane-accent),0.72)" }}>第 {bookmark.turn} 回合</div>}
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}
