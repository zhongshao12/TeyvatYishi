import { CLIP_CARD, CLIP_MEDIUM } from '@/styles/clipPaths';
import { useEffect, useMemo, useState } from 'react';
import { getSaveList, type SaveListItemSummary } from '@/services/dbService';
import { buildResumePreview } from '@/hooks/useGameState';
import { getHomeBackground } from '@/data/homeBackgrounds';

interface LandingPageProps {
  onNewGame: () => void;
  onLoadSave: () => void;
  onSettings: () => void;
  onWorldbookManager: () => void;
  onCodexManager: () => void;
  onCloudSave: () => void;
  onReleaseAnnouncements: () => void;
  onDiscordPost: () => void;
  onMysteryChat: () => void;
  onContinue: () => boolean | void | Promise<boolean | void>;
  /** 当前主题 id：决定封面用的六国背景图。 */
  currentTheme?: string;
}

interface TwinkleStar {
  x: number;
  y: number;
  size: number;
  opacity: number;
  color: string;
}

export function LandingPage({
  onNewGame,
  onLoadSave,
  onSettings,
  onWorldbookManager,
  onCodexManager,
  onCloudSave,
  onReleaseAnnouncements,
  onDiscordPost,
  onMysteryChat,
  onContinue,
  currentTheme,
}: LandingPageProps) {
  const [latestSave, setLatestSave] = useState<SaveListItemSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSaveList()
      .then((list) => {
        if (cancelled) return;
        setLatestSave(list[0] ?? null);
      })
      .catch((err) => {
        console.warn('[landing] 续玩卡读取失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resumePreview = latestSave ? buildResumePreview(latestSave) : null;

  const stars: TwinkleStar[] = useMemo(() => {
    // 封面烫金尘埃：皮革底上的金箔微粒，取代旧星空。
    const list: TwinkleStar[] = [];
    for (let i = 0; i < 24; i++) {
      const isBright = Math.random() < 0.12;
      list.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: isBright ? 2 + Math.random() * 2 : 0.5 + Math.random() * 1.5,
        opacity: isBright ? 0.4 + Math.random() * 0.35 : 0.1 + Math.random() * 0.3,
        color: 'rgba(213, 182, 110, OPACITY)',
      });
    }
    return list;
  }, []);

  const themeBackground = getHomeBackground(currentTheme);
  // 有主题背景图时：图上压皮革色渐变保证可读；无图则维持纯皮革封面。
  const coverBackground = themeBackground
    ? `linear-gradient(180deg, rgba(75, 52, 40, 0.62), rgba(37, 26, 22, 0.88) 78%), url(${themeBackground.src}) center/cover no-repeat`
    : 'radial-gradient(ellipse at 50% 8%, rgba(240, 213, 139, 0.12), transparent 46%), radial-gradient(ellipse at 16% 92%, rgba(135, 79, 67, 0.24), transparent 42%), linear-gradient(180deg, var(--journal-leather), var(--journal-leather-deep) 74%)';

  return (
    <div
      className="relative flex h-[100dvh] flex-col items-center justify-center overflow-hidden px-5 py-6"
      style={{ background: coverBackground }}
    >
      {/* ── 封面金尘 ── */}
      {stars.map((s, i) => (
        <div
          key={`s-${i}`}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background: s.color.replace('OPACITY', String(s.opacity)),
            boxShadow: s.size > 2
              ? `0 0 ${s.size * 3}px ${s.size * 0.8}px ${s.color.replace('OPACITY', String(s.opacity * 0.6))}`
              : 'none',
          }}
        />
      ))}

      <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2 sm:left-5 sm:top-5">
        <button
          type="button"
          onClick={onCloudSave}
          className="px-4 py-2 font-serif text-[12px] tracking-[0.18em] transition-all hover:opacity-90 sm:text-[13px]"
          style={{
            color: 'rgba(var(--tj-accent-primary), 0.92)',
            background: 'rgba(0, 0, 0, 0.22)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.45), 0 10px 24px rgba(0,0,0,0.22)',
            clipPath: CLIP_MEDIUM,
          }}
        >
          GitHub 云存档
        </button>
        <button
          type="button"
          onClick={onReleaseAnnouncements}
          className="px-4 py-2 font-serif text-[12px] tracking-[0.18em] transition-all hover:opacity-90 sm:text-[13px]"
          style={{
            color: 'rgba(var(--tj-text-primary), 0.9)',
            background: 'rgba(0, 0, 0, 0.18)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.36), 0 10px 24px rgba(0,0,0,0.2)',
            clipPath: CLIP_MEDIUM,
          }}
        >
          更新公告
        </button>
        <button
          type="button"
          onClick={onDiscordPost}
          className="px-4 py-2 font-serif text-[12px] tracking-[0.18em] transition-all hover:opacity-90 sm:text-[13px]"
          style={{
            color: 'rgba(var(--tj-accent-primary), 0.92)',
            background: 'rgba(0, 0, 0, 0.18)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.34), 0 10px 24px rgba(0,0,0,0.2)',
            clipPath: CLIP_MEDIUM,
          }}
        >
          Discord 帖
        </button>
        <button
          type="button"
          onClick={onMysteryChat}
          className="px-4 py-2 font-serif text-[12px] tracking-[0.18em] transition-all hover:opacity-90 sm:text-[13px]"
          style={{
            color: 'rgba(var(--tj-text-primary), 0.9)',
            background: 'rgba(0, 0, 0, 0.18)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.36), 0 10px 24px rgba(0,0,0,0.2)',
            clipPath: CLIP_MEDIUM,
          }}
        >
          神秘聊天
        </button>
      </div>

      <div
        className="absolute right-4 top-4 z-20 flex items-center gap-2 px-4 py-2 font-serif text-[12px] tracking-[0.16em] sm:right-5 sm:top-5 sm:text-[13px]"
        style={{
          color: 'rgba(var(--tj-text-primary), 0.86)',
          background: 'rgba(0, 0, 0, 0.22)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.34), 0 10px 24px rgba(0,0,0,0.22)',
          clipPath: CLIP_MEDIUM,
        }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: 'rgba(var(--tj-text-secondary), 0.65)',
            boxShadow: 'none',
          }}
        />
        <span>在线旅行者</span>
      </div>

      {/* ── Hero Content：手账封面框 ── */}
      <div
        className="relative z-10 flex min-h-0 w-full max-w-[620px] flex-col items-center justify-center animate-fade-in px-5 py-8 sm:px-8 sm:py-10"
        style={{
          background: 'linear-gradient(165deg, rgba(0, 0, 0, 0.24), rgba(0, 0, 0, 0.4))',
          boxShadow: 'inset 0 0 0 1px rgba(240, 213, 139, 0.4), inset 0 0 0 7px rgba(0, 0, 0, 0.12), inset 0 0 0 8px rgba(240, 213, 139, 0.2), 0 24px 60px rgba(0, 0, 0, 0.45)',
          clipPath: CLIP_CARD,
        }}
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-0 h-16 w-6 -translate-x-1/2"
          style={{
            background: 'linear-gradient(180deg, var(--journal-ribbon-red), color-mix(in srgb, var(--journal-ribbon-red) 68%, #000 32%))',
            clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - 10px), 0 100%)',
            boxShadow: '0 6px 14px rgba(0, 0, 0, 0.38)',
          }}
        />
        {(['left-2.5 top-2.5', 'right-2.5 top-2.5', 'left-2.5 bottom-2.5', 'right-2.5 bottom-2.5'] as const).map((pos) => (
          <span key={pos} aria-hidden className={`absolute ${pos} select-none text-xs opacity-45`} style={{ color: 'var(--journal-antique-gold-soft)' }}>
            ❦
          </span>
        ))}
        <div className="mb-3 flex w-full items-center justify-center gap-3 sm:gap-6">
          <span className="hidden text-2xl sm:inline" style={{ color: 'rgba(var(--tj-accent-primary), 0.55)' }}>◆</span>
          <h1
            className="flex flex-col items-center gap-1 text-center font-serif text-[clamp(2.8rem,17vw,4rem)] font-bold leading-[0.98] tracking-[0.12em] sm:block sm:text-6xl sm:tracking-[0.28em]"
            style={{
              background: 'linear-gradient(180deg, rgb(var(--tj-text-primary)) 0%, rgb(var(--tj-accent-primary)) 50%, rgb(var(--tj-accent-secondary)) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 0 24px rgba(var(--tj-accent-primary), 0.35))',
            }}
          >
            <span>旅行者</span>
            <span>纪事</span>
          </h1>
          <span className="hidden text-2xl sm:inline" style={{ color: 'rgba(var(--tj-accent-primary), 0.55)' }}>◆</span>
        </div>

        <div className="mb-3 flex w-full items-center justify-center gap-3 sm:mb-4 sm:gap-4">
          <div
            className="h-px w-10 sm:w-14"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--tj-accent-primary), 0.65))' }}
          />
          <p
            className="font-serif text-sm tracking-[0.28em] sm:text-lg sm:tracking-[0.5em]"
            style={{ color: 'rgb(var(--tj-accent-primary))' }}
          >
            原神 · 提瓦特
          </p>
          <div
            className="h-px w-10 sm:w-14"
            style={{ background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary), 0.65), transparent)' }}
          />
        </div>

        <p
          className="mb-3 text-center text-xs leading-relaxed tracking-[0.16em] sm:mb-4 sm:text-sm sm:tracking-[0.22em]"
          style={{ color: 'rgba(var(--tj-text-secondary),0.6)' }}
        >
          踏入提瓦特，聆听七国之风，写下你的旅行纪事吧
        </p>

        {/* Four-pointed star */}
        <div className="relative my-0.5 sm:my-1">
          <svg
            width="100"
            height="50"
            viewBox="-50 -25 100 50"
            style={{ display: 'block' }}
          >
            <defs>
              <radialGradient id="hero-star-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(var(--tj-ui-title),1)" />
                <stop offset="25%" stopColor="rgba(var(--tj-accent-primary),0.9)" />
                <stop offset="60%" stopColor="rgba(var(--tj-accent-primary),0.4)" />
                <stop offset="100%" stopColor="rgba(var(--tj-accent-primary),0)" />
              </radialGradient>
              <filter id="hero-star-glow">
                <feGaussianBlur stdDeviation="1" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d="M 0,-22 Q 0,0 14,0 Q 0,0 0,22 Q 0,0 -14,0 Q 0,0 0,-22 Z"
              fill="url(#hero-star-core)"
              filter="url(#hero-star-glow)"
            />
            <line x1="0" y1="-25" x2="0" y2="25" stroke="rgba(var(--tj-accent-primary),0.4)" strokeWidth="0.6" />
            <line x1="-25" y1="0" x2="25" y2="0" stroke="rgba(var(--tj-accent-primary),0.4)" strokeWidth="0.6" />
          </svg>
          <div
            className="absolute rounded-full"
            style={{
              left: '50%',
              top: '50%',
              width: '80px',
              height: '80px',
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(circle, rgba(var(--tj-accent-primary),0.4) 0%, rgba(var(--tj-accent-secondary),0.1) 40%, transparent 70%)',
              animation: 'star-glow-pulse 3s ease-in-out infinite',
            }}
          />
        </div>

        <div className="mt-3 flex w-full max-w-[340px] flex-col gap-3 animate-slide-up sm:w-72 sm:gap-3.5">
          {resumePreview && latestSave && (
            <button
              type="button"
              onClick={() => void onContinue()}
              className="w-full px-4 py-3 text-left transition-all hover:opacity-90"
              style={{
                color: 'rgba(var(--tj-text-primary),0.92)',
                background: 'rgba(0, 0, 0, 0.26)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.5), 0 12px 28px rgba(0,0,0,0.24)',
                clipPath: CLIP_CARD,
              }}
            >
              <div className="font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-accent-primary),0.9)' }}>
                ◈ 续玩 · 第 {resumePreview.turnCount} 回合
              </div>
              <div className="mt-1 truncate text-[13px] font-medium">
                {latestSave.travelerName || '未命名旅人'} · {resumePreview.currentLocation || resumePreview.currentArc || '未知坐标'}
              </div>
              {resumePreview.recentTurns[0] && (
                <div className="mt-1 line-clamp-2 text-[11px] leading-5" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
                  {resumePreview.recentTurns[0]}
                </div>
              )}
            </button>
          )}

          <button
            onClick={onNewGame}
            className="teyvat-btn teyvat-btn-primary group px-6 py-3.5 text-base font-medium"
          >
            <span
              className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out pointer-events-none"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--tj-text-primary), 0.45), transparent)' }}
            />
            <span className="relative">踏上旅途</span>
          </button>

              <button
                type="button"
                onClick={onLoadSave}
                className="w-full px-4 py-3 font-serif text-base font-semibold tracking-[0.14em] transition-all hover:opacity-90 sm:py-3"
                style={{
                  color: 'var(--journal-ink)',
                  background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 88%, var(--journal-leather) 12%))',
                  boxShadow: `inset 0 0 0 1px rgba(53, 46, 39, 0.2), 0 10px 24px rgba(0, 0, 0, 0.28)`,
                  clipPath: CLIP_CARD,
                }}
              >
                读取存档
              </button>

              <button
                type="button"
                onClick={onWorldbookManager}
                className="w-full px-4 py-3 font-serif text-base font-semibold tracking-[0.14em] transition-all hover:opacity-90 sm:py-3"
                style={{
                  color: 'var(--journal-ink)',
                  background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 88%, var(--journal-leather) 12%))',
                  boxShadow: `inset 0 0 0 1px rgba(53, 46, 39, 0.2), 0 10px 24px rgba(0, 0, 0, 0.28)`,
                  clipPath: CLIP_CARD,
                }}
              >
                提瓦特之书
              </button>

              <button
                type="button"
                onClick={onCodexManager}
                className="w-full px-4 py-3 font-serif text-base font-semibold tracking-[0.14em] transition-all hover:opacity-90 sm:py-3"
                style={{
                  color: 'var(--journal-ink)',
                  background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 88%, var(--journal-leather) 12%))',
                  boxShadow: `inset 0 0 0 1px rgba(53, 46, 39, 0.2), 0 10px 24px rgba(0, 0, 0, 0.28)`,
                  clipPath: CLIP_CARD,
                }}
              >
                北陆图书馆
              </button>

          <div className="flex items-center gap-3 my-1 mx-2">
            <div
              className="h-px flex-1"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--tj-accent-primary), 0.35), transparent)' }}
            />
            <span className="text-[10px]" style={{ color: 'rgba(var(--tj-accent-primary), 0.5)' }}>◆</span>
            <div
              className="h-px flex-1"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--tj-accent-primary), 0.35), transparent)' }}
            />
          </div>

          <button
            onClick={onSettings}
            className="teyvat-btn teyvat-btn-quiet px-6 py-2.5 text-xs"
          >
            <span className="relative">设置</span>
          </button>
        </div>
      </div>

      <div
        className="absolute bottom-4 left-4 right-4 z-10 flex flex-col items-center gap-1 text-center text-xs opacity-60"
        style={{ color: 'rgb(var(--tj-text-secondary))' }}
      >
        <p>旅行者纪事 v{__APP_VERSION__}</p>
        <p className="text-[11px] leading-relaxed">
          作者：牢云
        </p>
      </div>
    </div>
  );
}
