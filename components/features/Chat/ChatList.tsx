import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState, memo } from 'react';
import type { 聊天消息 } from '@/models/chat';
import type { NPC记录 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { API配置项, VisualTextSettings } from '@/models/settings';
import type { 相册系统 } from '@/models/imageGeneration';
import { useStreamingMessage } from '@/utils/streamingMessageStore';
import { TurnItem } from './TurnItem';

interface ChatListProps {
  messages: 聊天消息[];
  loading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onEditBody?: (id: string, newBody: string) => void;
  onToggleBookmark?: (messageId: string) => void;
  onRegenerateNarrativeImage?: (messageId: string) => void | Promise<void>;
  narrativeImageManualEnabled?: boolean;
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  visualTextSettings?: VisualTextSettings;
  rewriteConfig?: API配置项;
}

interface NeighborMeta {
  fallbackElementId?: string;
  previousUserInput?: string;
}

const INITIAL_RENDER_TURNS = 20;
const RENDER_TURN_INCREMENT = 20;

function findHistoryWindowStart(messages: 聊天消息[], turnLimit: number): number {
  let assistantTurns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'assistant') continue;
    assistantTurns += 1;
    if (assistantTurns > turnLimit) return index + 1;
  }
  return 0;
}

interface ChatHistoryListProps {
  messages: 聊天消息[];
  neighborMeta: NeighborMeta[];
  onEditBody?: (id: string, newBody: string) => void;
  onToggleBookmark?: (messageId: string) => void;
  onRegenerateNarrativeImage?: (messageId: string) => void | Promise<void>;
  narrativeImageManualEnabled?: boolean;
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  visualTextSettings?: VisualTextSettings;
  rewriteConfig?: API配置项;
}

/** Isolated history list: scroll chrome (nearBottom / FAB) must not remap TurnItems. */
const ChatHistoryList = memo(function ChatHistoryList({
  messages,
  neighborMeta,
  onEditBody,
  onToggleBookmark,
  onRegenerateNarrativeImage,
  narrativeImageManualEnabled = false,
  npcRecords,
  traveler,
  album,
  showInnerVoice = true,
  visualTextSettings,
  rewriteConfig,
}: ChatHistoryListProps) {
  return (
    <>
      {messages.map((msg, idx) => {
        const meta = neighborMeta[idx];
        return (
          <div key={msg.id} id={`chat-msg-${msg.id}`}>
          <TurnItem
            message={msg}
            deferOffscreen
            onEditBody={onEditBody}
            onToggleBookmark={onToggleBookmark}
            onRegenerateNarrativeImage={onRegenerateNarrativeImage}
            narrativeImageManualEnabled={narrativeImageManualEnabled}
            npcRecords={npcRecords}
            traveler={traveler}
            album={album}
            showInnerVoice={showInnerVoice}
            fallbackElementId={meta.fallbackElementId}
            previousUserInput={meta.previousUserInput}
            visualTextSettings={visualTextSettings}
            rewriteConfig={rewriteConfig}
          />
          </div>
        );
      })}
    </>
  );
});

/** One forward pass for previous-user / path-fallback neighbor metadata. */
function buildNeighborMeta(messages: 聊天消息[]): NeighborMeta[] {
  let lastUserContent: string | undefined;
  const meta: NeighborMeta[] = new Array(messages.length);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let fallbackElementId: string | undefined;
    let previousUserInput: string | undefined;

    if (msg.role === 'user') {
      lastUserContent = msg.content;
    } else if (msg.role === 'assistant') {
      previousUserInput = lastUserContent;
    }

    meta[i] = { fallbackElementId, previousUserInput };
  }

  return meta;
}

export function ChatList({ messages, loading, scrollRef, onEditBody, onToggleBookmark, onRegenerateNarrativeImage, narrativeImageManualEnabled = false, npcRecords, traveler, album, showInnerVoice = true, visualTextSettings, rewriteConfig }: ChatListProps) {
  const streamingMessage = useStreamingMessage();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const nearBottomRef = useRef(true);
  const scrollStateRafRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrollStateRafRef.current != null) return;
    scrollStateRafRef.current = requestAnimationFrame(() => {
      scrollStateRafRef.current = null;
      const nextNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (nearBottomRef.current === nextNearBottom) return;
      nearBottomRef.current = nextNearBottom;
      setNearBottom(nextNearBottom);
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current!.scrollIntoView({ behavior: 'smooth', block: 'end' });
    nearBottomRef.current = true;
    setNearBottom(true);
  }, []);

  const forceLatestMessage = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
    nearBottomRef.current = true;
    setNearBottom(true);
  }, []);

  const [renderTurnLimit, setRenderTurnLimit] = useState(INITIAL_RENDER_TURNS);
  const pendingHistoryAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const [historyWasReplaced, setHistoryWasReplaced] = useState(false);
  const previousHistoryIdentityRef = useRef<string[]>([]);

  // 识别历史是否被整体替换（切换存档 / 回滚），而不是逐回合追加：
  // 替换后立即恢复近期回合渲染上限并重置滚动状态，避免用旧窗口渲染新存档。
  useEffect(() => {
    const previousHistoryIdentity = previousHistoryIdentityRef.current;
    const currentHistoryIdentity = messages.map((message) => message.id);
    const historyWasReplaced = previousHistoryIdentity.length > 0
      && (currentHistoryIdentity.length === 0 || currentHistoryIdentity[0] !== previousHistoryIdentity[0]);
    previousHistoryIdentityRef.current = currentHistoryIdentity;
    if (historyWasReplaced) {
      setRenderTurnLimit(INITIAL_RENDER_TURNS);
      nearBottomRef.current = true;
      setNearBottom(true);
    }
    setHistoryWasReplaced(historyWasReplaced);
  }, [messages]);

  const effectiveRenderTurnLimit = historyWasReplaced ? INITIAL_RENDER_TURNS : renderTurnLimit;

  // 隐藏 [系统] 触发消息——chatHistory 中仍存在便于调试，但 UI 不渲染。
  const visibleMessages = useMemo(
    () => messages.filter((message) => !(message.role === 'user' && message.content.startsWith('[系统]'))),
    [messages],
  );
  const renderedStartIndex = useMemo(
    () => findHistoryWindowStart(visibleMessages, effectiveRenderTurnLimit),
    [effectiveRenderTurnLimit, visibleMessages],
  );
  const renderedMessages = useMemo(
    () => visibleMessages.slice(renderedStartIndex),
    [renderedStartIndex, visibleMessages],
  );
  const hasEarlierMessages = renderedStartIndex > 0;

  const allNeighborMeta = useMemo(
    () => buildNeighborMeta(visibleMessages),
    [visibleMessages],
  );
  const neighborMeta = useMemo(
    () => allNeighborMeta.slice(renderedStartIndex),
    [allNeighborMeta, renderedStartIndex],
  );

  const handleLoadEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      pendingHistoryAnchorRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    }
    setRenderTurnLimit((current) => current + RENDER_TURN_INCREMENT);
  }, [scrollRef]);

  useLayoutEffect(() => {
    const anchor = pendingHistoryAnchorRef.current;
    if (!anchor) return;
    pendingHistoryAnchorRef.current = null;
    if (historyWasReplaced) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
  }, [historyWasReplaced, renderedStartIndex, scrollRef]);

  // 继续存档、发送消息与流式回复都必须落到最新位置；加载更早历史时由锚点逻辑接管。
  useLayoutEffect(() => {
    if (pendingHistoryAnchorRef.current) return;
    forceLatestMessage();
  }, [forceLatestMessage, historyWasReplaced, loading, streamingMessage, visibleMessages.at(-1)?.id]);

  useEffect(() => {
    return () => {
      if (scrollStateRafRef.current != null) cancelAnimationFrame(scrollStateRafRef.current);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="journal-story-scroll relative flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5"
    >
      <div className="pointer-events-none fixed left-0 right-0 top-0 z-10 h-16 bg-gradient-to-b from-[rgba(var(--tj-bg-primary),0.74)] to-transparent md:hidden" />

      {hasEarlierMessages && (
        <div className="flex justify-center pb-4">
          <button
            type="button"
            onClick={handleLoadEarlier}
            className="px-3 py-1.5 text-xs"
            style={{ color: 'rgba(var(--tj-accent-primary), 0.92)' }}
          >
            继续渲染更早 20 回合
          </button>
        </div>
      )}

      {/* Empty state */}
      {visibleMessages.length === 0 && !loading && (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div
            className="text-5xl mb-5"
            style={{ color: 'rgba(var(--tj-accent-primary), 0.35)' }}
          >
            ✦
          </div>
          <p
            className="text-sm font-serif tracking-[0.15em]"
            style={{ color: 'rgba(var(--tj-text-primary), 0.7)' }}
          >
            手账新页，尚待落笔……
          </p>
          <p
            className="mt-2 text-xs tracking-wider"
            style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}
          >
            在此写下提瓦特之旅的第一页
          </p>
        </div>
      )}

      {/* Historical messages — isolated from nearBottom / FAB re-renders */}
      <ChatHistoryList
        messages={renderedMessages}
        neighborMeta={neighborMeta}
        onEditBody={onEditBody}
        onRegenerateNarrativeImage={onRegenerateNarrativeImage}
        narrativeImageManualEnabled={narrativeImageManualEnabled}
        npcRecords={npcRecords}
        traveler={traveler}
        album={album}
        showInnerVoice={showInnerVoice}
        visualTextSettings={visualTextSettings}
        rewriteConfig={rewriteConfig}
      />

      {/* Streaming preview — lives in parent so stream text does not remap history */}
      {streamingMessage && (
        <TurnItem
          message={{
            id: 'streaming',
            role: 'assistant',
            content: streamingMessage,
            timestamp: Date.now(),
            isStreaming: true,
          }}
          isStreaming
          npcRecords={npcRecords}
          traveler={traveler}
          album={album}
          showInnerVoice={showInnerVoice}
          visualTextSettings={visualTextSettings}
        />
      )}

      {/* Loading indicator (no stream yet) */}
      {loading && !streamingMessage && (
        <div className="flex items-center gap-2 py-4">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 animate-pulse-soft rounded-full"
                style={{
                  background: 'rgb(var(--tj-accent-primary))',
                  boxShadow: '0 0 6px rgba(var(--tj-accent-primary), 0.5)',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
          <span
            className="text-xs font-serif tracking-wider"
            style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}
          >
            正在沉思……
          </span>
        </div>
      )}

      <div ref={bottomRef} data-testid="main-chat-bottom" />

      {!nearBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-[calc(var(--app-safe-bottom,0px)+118px)] left-1/2 z-30 -translate-x-1/2 px-3 py-1.5 text-[11px] tracking-[0.16em] md:hidden"
          style={{
            color: 'rgba(var(--tj-accent-primary), 0.92)',
            background: 'rgba(var(--tj-surface), 0.92)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.34), 0 12px 28px rgba(var(--tj-shadow), 0.28)',
            backdropFilter: 'blur(4px)',
            clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
          }}
        >
          回到底部
        </button>
      )}
    </div>
  );
}
