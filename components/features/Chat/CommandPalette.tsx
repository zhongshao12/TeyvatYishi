import { CLIP_PANEL, CLIP_SMALL, insetRing } from '@/styles/clipPaths';
import { useMemo, useRef, useState } from 'react';
import { searchCommands, type CommandItem } from '@/utils/commandRegistry';

interface CommandPaletteProps {
  commands: CommandItem[];
  onClose: () => void;
}




export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCommands(query).slice(0, 12), [query]);
  const run = (item: CommandItem) => {
    item.run();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center bg-black/40 px-4 pt-[14vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-[min(560px,calc(100vw-32px))] overflow-hidden" style={{ background: "rgba(var(--tj-surface-strong),0.98)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.35), 0 24px 60px rgba(0,0,0,0.4)", clipPath: CLIP_PANEL }}>
        <div className="px-4 py-3" style={{ background: "rgba(var(--tj-accent-primary),0.08)" }}>
          <input
            ref={inputRef}
            value={query}
            autoFocus
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { onClose(); return; }
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(results.length - 1, index + 1)); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); return; }
              if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); run(results[activeIndex]); }
            }}
            placeholder="输入命令或搜索（跳转系统 / 存档 / 重 roll / 北陆图书馆）"
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: CLIP_SMALL }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto px-2 py-2">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs" style={{ color: "rgba(var(--tj-text-secondary),0.6)" }}>没有匹配的命令。</div>
          ) : results.map((item, index) => (
            <button key={item.id} type="button" onClick={() => run(item)} className="block w-full px-3 py-2 text-left" style={{ background: index === activeIndex ? "rgba(var(--tj-accent-primary),0.14)" : "transparent", boxShadow: index === activeIndex ? insetRing(0.3) : "none", clipPath: CLIP_SMALL }}>
              <span className="text-xs" style={{ color: "rgb(var(--tj-text-primary))" }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
