import { CLIP_CARD, CLIP_MEDIUM, CLIP_SECTION, CLIP_SMALL, CLIP_XS, gradientAccent, insetRing } from '@/styles/clipPaths';
import { memo, useState } from 'react';
import type { 聊天消息 } from '@/models/chat';
import type { NPC记录 } from '@/models/npc';
import type { 角色数据结构 } from '@/models/character';
import type { API配置项, VisualTextSettings } from '@/models/settings';
import type { 相册系统 } from '@/models/imageGeneration';
import { BodyBlock, StreamingPreview, resolveTravelerAvatar } from './MessageRenderers';
import type { ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { formatTokenCount } from '@/utils/tokenEstimate';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { rewriteBody } from '@/services/ai/rewriteService';
import { 改写模式选项, type 改写模式 } from '@/prompts/cot/rewriteCot';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';

interface TurnItemProps {
  message: 聊天消息;
  isStreaming?: boolean;
  deferOffscreen?: boolean;
  onEditBody?: (id: string, newBody: string) => void;
  onToggleBookmark?: (messageId: string) => void;
  onRegenerateNarrativeImage?: (messageId: string) => void | Promise<void>;
  narrativeImageManualEnabled?: boolean;
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  previousUserInput?: string;
  visualTextSettings?: VisualTextSettings;
  rewriteConfig?: API配置项;
  // 历史回响消息若元素 ID 为空，由 ChatList 向前查找补齐。
  fallbackElementId?: string;
}

type ToolKey = 'edit' | 'rewrite' | 'usage' | 'context';

/**
 * content-visibility: auto 的占位高度模型（**实测拟合**，口径见
 * `.triage/measure-turn-height.mjs`：headless Chrome + dist 编译后 CSS 渲染逐字照抄的
 * 回合 DOM 结构，量 getBoundingClientRect().height）。
 *
 * 实测（列宽 900px → 正文容器 695px）：
 *   AI 回合   400/700/1000/1600/2400 字 → 657/897/1214/1848/2593 px
 *             拟合 height ≈ 240.3 + 0.985 × 字数（残差 RMS 23.9px）
 *   玩家回合  40/120/300/600 字 → 112/163/238/389 px
 *             拟合 height ≈ 96.9 + 0.485 × 字数（残差 RMS 5.0px）
 *
 * 旧的固定 `auto 640px` 对两种回合都不对：AI 回合低估（1000 字低估 574px、2400 字
 * 低估 1953px），玩家回合高估（600 字回合真实只有 389px）。长会话里 ChatList 一次
 * 渲染 20 回合（INITIAL_RENDER_TURNS），滚动条长度因此整体偏短。
 * `auto` 关键字保留：元素渲染过一次后浏览器改用记住的真实尺寸，估算只影响尚未渲染的那一段。
 */
interface TurnPlaceholderModel {
  basePx: number;
  pxPerChar: number;
  minPx: number;
  maxPx: number;
}

const NARRATIVE_TURN_PLACEHOLDER: TurnPlaceholderModel = {
  basePx: 240.3, pxPerChar: 0.985, minPx: 240, maxPx: 3200,
};
const TRAVELER_TURN_PLACEHOLDER: TurnPlaceholderModel = {
  basePx: 96.9, pxPerChar: 0.485, minPx: 97, maxPx: 3200,
};

export function estimateTurnPlaceholderHeight(bodyCharCount: number, role: 聊天消息['role'] = 'assistant'): number {
  const model = role === 'user' ? TRAVELER_TURN_PLACEHOLDER : NARRATIVE_TURN_PLACEHOLDER;
  const chars = Number.isFinite(bodyCharCount) ? Math.max(0, Math.trunc(bodyCharCount)) : 0;
  const estimated = model.basePx + model.pxPerChar * chars;
  return Math.round(Math.min(model.maxPx, Math.max(model.minPx, estimated)));
}

function resolveTurnPlaceholderStyle(
  message: 聊天消息,
): { contentVisibility: 'auto'; containIntrinsicSize: string } {
  const parsed = message.parsedResponse;
  const charCount = parsed ? narrativeTurnBodyText(parsed).length : message.content.length;
  return {
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${estimateTurnPlaceholderHeight(charCount, message.role)}px`,
  };
}

function TurnItemImpl({ message, isStreaming, deferOffscreen = false, onEditBody, onToggleBookmark, onRegenerateNarrativeImage, narrativeImageManualEnabled = false, npcRecords, traveler, album, showInnerVoice = true, fallbackElementId, previousUserInput, visualTextSettings, rewriteConfig }: TurnItemProps) {
  const isUser = message.role === 'user';
  const parsed = message.parsedResponse;
  const shouldDeferOffscreen = deferOffscreen && !isStreaming && !message.isStreaming;
  const visibilityStyle = shouldDeferOffscreen ? resolveTurnPlaceholderStyle(message) : undefined;

  if (isUser) {
    return (
      <div className="journal-turn journal-turn--traveler mb-4 animate-slide-up" style={visibilityStyle}>
        <UserTurnBubble content={message.content} traveler={traveler} album={album} fontSize={visualTextSettings?.playerFontSize ?? 14} />
      </div>
    );
  }

  return (
    <div className="journal-turn journal-turn--narrative mb-4 animate-slide-up" style={visibilityStyle}>
      {parsed ? (
        <AiTurnCard
          message={message}
          parsed={parsed}
          isStreaming={isStreaming}
          deferOffscreen={shouldDeferOffscreen}
          onEditBody={onEditBody}
          onToggleBookmark={onToggleBookmark}
          onRegenerateNarrativeImage={onRegenerateNarrativeImage}
          narrativeImageManualEnabled={narrativeImageManualEnabled}
          npcRecords={npcRecords}
          traveler={traveler}
          album={album}
          showInnerVoice={showInnerVoice}
          fallbackElementId={fallbackElementId}
          previousUserInput={previousUserInput}
          visualTextSettings={visualTextSettings}
          rewriteConfig={rewriteConfig}
        />
      ) : message.isStreaming ? (
        <StreamingPreview
          content={message.content}
          npcRecords={npcRecords}
          traveler={traveler}
          album={album}
          showInnerVoice={showInnerVoice}
          userInput={previousUserInput}
          visualTextSettings={visualTextSettings}
        />
      ) : null}
    </div>
  );
}

export const TurnItem = memo(TurnItemImpl);

// 玩家回合：右置「旅人手记」纸条——缎带红左边 + ✎ 落款，取代聊天气泡与头像。
export function UserTurnBubble({ content, traveler, album, fontSize = 14 }: { content: string; traveler?: 角色数据结构; album?: 相册系统; fontSize?: number }) {
  const name = traveler?.姓名?.trim() || traveler?.别名?.trim() || '旅人';

  const avatarUrl = resolveTravelerAvatar(traveler, album);

  return (
    <div className="journal-traveler-note mb-4 flex animate-slide-up">
      <div className="ml-auto flex max-w-[88%] items-start gap-2.5">
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-end gap-1.5 pr-1">
            <span className="font-serif text-[10px] tracking-[0.3em]" style={{ color: 'rgba(var(--tj-chat-muted), 0.95)' }}>
              ✎ {name} · 旅人手记
            </span>
          </div>
          <div
            className="w-fit max-w-full whitespace-pre-wrap break-words px-4 py-3"
            style={{
              background: 'rgba(var(--tj-chat-bubble), calc(var(--tj-chat-bubble-alpha, 0.78) * 0.85))',
              color: 'rgba(var(--tj-chat-text), 0.98)',
              borderLeft: '2px solid rgba(var(--tj-accent-secondary), 0.55)',
              clipPath: CLIP_SECTION,
              boxShadow:
                'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.3), 0 4px 18px rgba(var(--tj-shadow), 0.35), inset 0 0 20px rgba(var(--tj-shadow), 0.22)',
              fontSize: `${fontSize}px`,
              lineHeight: 1.8,
            }}
          >
            {content}
          </div>
          {avatarUrl ? (
            <img src={avatarUrl} alt={`${name} 头像`} className="mt-2 ml-auto block h-9 w-9 rounded-full object-cover" style={{ boxShadow: '0 0 0 1px rgba(var(--tj-accent-primary), 0.45)' }} />
          ) : (
            <span className="ml-auto mt-2 flex h-9 w-9 items-center justify-center rounded-full font-serif text-sm" style={{ color: 'rgb(var(--tj-accent-primary))', boxShadow: insetRing(0.4) }}>
              {name.charAt(0) || '旅'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface AiTurnCardProps {
  message: 聊天消息;
  parsed: NonNullable<聊天消息['parsedResponse']>;
  isStreaming?: boolean;
  deferOffscreen?: boolean;
  onEditBody?: (id: string, newBody: string) => void;
  onToggleBookmark?: (messageId: string) => void;
  onRegenerateNarrativeImage?: (messageId: string) => void | Promise<void>;
  narrativeImageManualEnabled?: boolean;
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  fallbackElementId?: string;
  previousUserInput?: string;
  visualTextSettings?: VisualTextSettings;
  rewriteConfig?: API配置项;
}

function AiTurnCard({ message, parsed, isStreaming, deferOffscreen = false, onEditBody, onToggleBookmark, onRegenerateNarrativeImage, narrativeImageManualEnabled = false, npcRecords, traveler, album, showInnerVoice = true, fallbackElementId, previousUserInput, visualTextSettings, rewriteConfig }: AiTurnCardProps) {
  const bodyText = narrativeTurnBodyText(parsed);
  const [openTool, setOpenTool] = useState<ToolKey | null>(null);
  const [draft, setDraft] = useState(bodyText);
  const [rewriteMode, setRewriteMode] = useState<改写模式>('polish');
  const [rewriteDraft, setRewriteDraft] = useState('');
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState('');

  const toggle = (key: ToolKey) => {
    setOpenTool((cur) => (cur === key ? null : key));
    if (key === 'edit') setDraft(bodyText);
    if (key === 'rewrite') {
      setRewriteMode('polish');
      setRewriteDraft('');
      setRewriteError('');
    }
  };

  const handleRewriteGenerate = async () => {
    if (!rewriteConfig) {
      setRewriteError('未配置可用的 API 档案，请先到设置中配置。');
      return;
    }
    setRewriteBusy(true);
    setRewriteError('');
    try {
      const result = await rewriteBody(rewriteConfig, bodyText, rewriteMode);
      setRewriteDraft(result);
    } catch (err) {
      setRewriteError((err as Error).message ?? String(err));
    } finally {
      setRewriteBusy(false);
    }
  };

  const handleRewriteSave = () => {
    if (onEditBody && rewriteDraft.trim()) onEditBody(message.id, rewriteDraft);
    setOpenTool(null);
  };

  const handleEditSave = () => {
    if (onEditBody) onEditBody(message.id, draft);
    setOpenTool(null);
  };

  const card = (
    <article className="journal-narrative-leaf">
      {/* 顶部工具栏 */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        <ToolButton
          label="修改正文"
          glyph="✎"
          active={openTool === 'edit'}
          onClick={() => toggle('edit')}
        />
        <ToolButton
          label="改写正文"
          glyph="✦"
          active={openTool === 'rewrite'}
          disabled={isStreaming}
          onClick={() => toggle('rewrite')}
        />
        <ToolButton
          label="响应详情"
          glyph="◉"
          active={openTool === 'usage'}
          onClick={() => toggle('usage')}
        />
        <TurnBadge value={message.gameTime ?? '?'} />
        <ToolButton
          label="请求上下文"
          glyph="⬡"
          active={openTool === 'context'}
          onClick={() => toggle('context')}
        />
        <ToolButton
          label="书签"
          glyph="❖"
          active={Boolean(message.bookmark)}
          onClick={() => onToggleBookmark?.(message.id)}
        />
      </div>

      {/* 展开面板 */}
      {openTool && (
        <div
          className="mb-2 animate-fade-in"
          style={{
            background: 'rgba(var(--tj-btn-primary-start), 0.04)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.28)',
            clipPath:
              CLIP_CARD,
          }}
        >
          {openTool === 'edit' && (
            <EditBodyPanel
              draft={draft}
              setDraft={setDraft}
              onSave={handleEditSave}
              onCancel={() => {
                setDraft(bodyText);
                setOpenTool(null);
              }}
            />
          )}
          {openTool === 'rewrite' && (
            <div className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] tracking-[0.2em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>改写模式</span>
                <select
                  value={rewriteMode}
                  onChange={(event) => setRewriteMode(event.target.value as 改写模式)}
                  className="teyvat-input px-2 py-1 text-[11px]"
                  style={{ clipPath: CLIP_SMALL }}
                >
                  {改写模式选项.map((mode) => (
                    <option key={mode.id} value={mode.id}>{mode.name} · {mode.description}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleRewriteGenerate()}
                  disabled={rewriteBusy}
                  className="teyvat-btn teyvat-btn-primary px-3 py-1.5 text-[11px] disabled:opacity-50"
                >
                  {rewriteBusy ? '生成中…' : '生成改写'}
                </button>
              </div>
              {rewriteError && (
                <div className="mb-2 text-[11px]" style={{ color: 'rgba(var(--tj-danger), 0.9)' }}>{rewriteError}</div>
              )}
              <textarea
                value={rewriteDraft}
                onChange={(event) => setRewriteDraft(event.target.value)}
                rows={8}
                placeholder="生成后会在这里预览，确认后才写回正文（不重跑回合副作用）。"
                className="w-full resize-y bg-transparent px-3 py-2 text-sm leading-7 outline-none"
                style={{ color: 'rgba(var(--tj-text-primary), 0.92)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.18)' }}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setOpenTool(null)} className="px-3 py-1.5 text-[11px]">取消</button>
                <button
                  type="button"
                  onClick={handleRewriteSave}
                  disabled={!rewriteDraft.trim()}
                  className="teyvat-btn teyvat-btn-secondary px-3 py-1.5 text-[11px] disabled:opacity-40"
                >
                  确认写回
                </button>
              </div>
            </div>
          )}
          {openTool === 'usage' && (
            <UsagePanel message={message} onClose={() => setOpenTool(null)} />
          )}
          {openTool === 'context' && (
            <PanelText content={formatDebugContext(message)} label="请求上下文" />
          )}
        </div>
      )}

      {/* 正文（无边框，铺满列宽）。 */}
      <div className="px-1 py-2">
        <BodyBlock content={bodyText} npcRecords={npcRecords} traveler={traveler} album={album} showInnerVoice={showInnerVoice} userInput={previousUserInput} visualTextSettings={visualTextSettings} deferOffscreen={deferOffscreen} />

        {isStreaming && (
          <span
            className="inline-block w-1.5 h-4 ml-1 animate-pulse-soft"
            style={{ background: 'rgb(var(--tj-btn-primary-start))', boxShadow: '0 0 6px rgba(var(--tj-btn-primary-start), 0.6)' }}
          />
        )}
      </div>

      {parsed.choices.length > 0 && (
        <div className="px-1 pb-2" aria-label="玩家可选行动">
          <div className="grid gap-1.5">
            {parsed.choices.map((choice) => (
              <div
                key={choice.id}
                className="px-3 py-2 text-sm"
                style={{
                  color: 'rgba(var(--tj-text-primary), 0.9)',
                  background: 'rgba(var(--tj-btn-primary-start), 0.05)',
                  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.2)',
                }}
              >
                {choice.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 故事快照卡片 */}
      {((message.narrativeImages && message.narrativeImages.length > 0) || (narrativeImageManualEnabled && !isStreaming)) && (
        <div className="px-1 py-2 space-y-2">
          {(message.narrativeImages ?? []).map((img) => (
            <NarrativeImageCard key={img.id} image={img} messageId={message.id} album={album} onRegenerateNarrativeImage={onRegenerateNarrativeImage} />
          ))}
          {(!message.narrativeImages || message.narrativeImages.length === 0) && (
            narrativeImageManualEnabled ? <NarrativeImageManualCard messageId={message.id} onRegenerateNarrativeImage={onRegenerateNarrativeImage} /> : null
          )}
        </div>
      )}

      {/* 底部信息：左=生成耗时，右=字数 */}
      <div
        className="mt-1 flex items-center justify-between px-1 text-xs tracking-wider"
        style={{ color: 'rgba(var(--tj-text-secondary), 0.65)' }}
      >
        <span>
          {message.responseDurationSec != null ? (
            <>
              <span style={{ color: 'rgba(var(--tj-btn-primary-start), 0.5)' }}>◆</span>
              <span className="ml-1.5">{message.responseDurationSec}s</span>
            </>
          ) : (
            ''
          )}
        </span>
        <span>
          <span className="mr-1.5">{[...bodyText].length} 字</span>
          <span style={{ color: 'rgba(var(--tj-btn-primary-start), 0.5)' }}>◆</span>
        </span>
      </div>
    </article>
  );

  return card;
}

function formatDebugContext(message: 聊天消息): string {
  const debug = message.debugContext;
  if (!debug) return '这条历史消息没有保存请求上下文。请从新增按钮后的新回合开始查看。';
  const irminsulRaw = [
    '【世界树模型原始返回】',
    debug.irminsulRecallUsedModel
      ? (debug.irminsulRecallRawText?.trim() || '（世界树模型已调用，但没有保存到原始返回文本。）')
      : '（本回合未调用世界树模型，使用本地摘要检索，或未到世界树召回触发回合。）',
  ].join('\n');
  const codexRaw = [
    '【图鉴模型原始返回】',
    debug.codexRecallUsedModel
      ? (debug.codexRecallRawText?.trim() || '（图鉴模型已调用，但没有保存到原始返回文本。）')
      : '（本回合未调用图鉴模型，使用本地规则召回；本地规则不会执行 Step0~Step8 模型思维链。）',
  ].join('\n');
  const recall = debug.recallPreview?.trim()
    ? ['【回忆、剧情编织与北陆图书馆预览】', debug.recallPreview.trim()].join('\n')
    : '【回忆、剧情编织与北陆图书馆预览】\n（无或未命中）';
  const deepSeekDiagnostics = [
    '【DeepSeek 主剧情诊断】',
    `主剧情请求模式：${debug.mainRequestMode ?? '未知'}`,
    `模式：${debug.deepSeekMainMode ?? 'off'}`,
    debug.deepSeekMainOriginalModel && debug.deepSeekMainAdaptedModel
      ? `主剧情模型适配：${debug.deepSeekMainOriginalModel} → ${debug.deepSeekMainAdaptedModel}`
      : '主剧情模型适配：未触发',
    `跳过 NarrativeTurn JSON 格式示例历史：${debug.deepSeekCotFakeHistorySkipped ? '是' : '否'}`,
    `Prefix 锁格式：${debug.deepSeekPrefixMode ? '是' : '否'}`,
    debug.deepSeekProtocolIssues?.length
      ? `协议校验失败项：${debug.deepSeekProtocolIssues.join('；')}`
      : '协议校验失败项：无',
    typeof debug.rerollSimilarity === 'number'
      ? `重roll相似度：${Math.round(debug.rerollSimilarity * 100)}%`
      : '重roll相似度：未触发',
    `重roll自动换写：${debug.rerollSimilarityRetried ? '是' : '否'}`,
  ].join('\n');
  const cachePrefixDiagnostics = debug.cachePrefixDiagnostics
    ? [
        '【缓存前缀诊断】',
        `公共前缀：${formatTokenCount(debug.cachePrefixDiagnostics.commonPrefixTokens)} / ${formatTokenCount(debug.cachePrefixDiagnostics.currentPromptTokens)} tokens（${(debug.cachePrefixDiagnostics.commonPrefixRate * 100).toFixed(1)}%）`,
        `首次变化（本回合）：${debug.cachePrefixDiagnostics.firstDiffCurrentSection}`,
        debug.cachePrefixDiagnostics.firstDiffPreviousSection
          ? `首次变化（上一回合）：${debug.cachePrefixDiagnostics.firstDiffPreviousSection}`
          : '',
        `变化后估算：${formatTokenCount(debug.cachePrefixDiagnostics.changedTailTokens)} tokens`,
        debug.cachePrefixDiagnostics.largestChangedSections.length
          ? `变化后大块：${debug.cachePrefixDiagnostics.largestChangedSections.map((item) => `${item.label}≈${formatTokenCount(item.tokens)}`).join('；')}`
          : '',
        `本回合变化片段：${debug.cachePrefixDiagnostics.firstDiffCurrentExcerpt}`,
        debug.cachePrefixDiagnostics.firstDiffPreviousExcerpt
          ? `上一回合变化片段：${debug.cachePrefixDiagnostics.firstDiffPreviousExcerpt}`
          : '',
      ].filter(Boolean).join('\n')
    : '';
  const narrativeNormalization = [
    '【正文归一化诊断】',
    debug.narrativeNormalizationWarnings?.length
      ? debug.narrativeNormalizationWarnings.map((warning) => `- ${warning}`).join('\n')
      : '（没有未知正文块或被证据校验拦下的事实。）',
  ].join('\n');
  const npcLedger = debug.npcLedgerInjection
    ? [
        '【NPC账本注入诊断】',
        `已注入：${debug.npcLedgerInjection.selectedNames.length ? debug.npcLedgerInjection.selectedNames.join('、') : '无'}`,
        debug.npcLedgerInjection.injected.length
          ? debug.npcLedgerInjection.injected.map((item) => [
              `- ${item.name}`,
              `  原因：${item.reason.join('；') || '相关'}`,
              `  字段：${item.fields.join('；') || '无账本字段，仅旧档案兜底'}`,
              `  标记：最近互动=${item.hasRecentInteraction ? '是' : '否'}；必须记得=${item.hasMustRemember ? '是' : '否'}；未完成事项=${item.hasUnresolvedItems ? '是' : '否'}`,
            ].join('\n')).join('\n')
          : '',
        debug.npcLedgerInjection.skippedNames.length
          ? `未注入示例：\n${debug.npcLedgerInjection.skippedNames.slice(0, 8).map((item) => `- ${item.name}：${item.reason}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n')
    : '【NPC账本注入诊断】\n（本回合没有保存 NPC 账本诊断；请从本功能更新后的新回合开始查看。）';
  const npcLedgerUpdate = debug.npcLedgerUpdate
    ? [
        '【NPC账本更新诊断】',
        `更新 NPC：${debug.npcLedgerUpdate.updatedNames.length ? debug.npcLedgerUpdate.updatedNames.join('、') : '无'}`,
        debug.npcLedgerUpdate.memoryAppended.length
          ? `追加同行记忆：\n${debug.npcLedgerUpdate.memoryAppended.slice(0, 8).map((item) => `- ${item}`).join('\n')}`
          : '追加同行记忆：无',
        debug.npcLedgerUpdate.ledgerFieldsUpdated.length
          ? `账本字段：\n${debug.npcLedgerUpdate.ledgerFieldsUpdated.slice(0, 12).map((item) => `- ${item}`).join('\n')}`
          : '账本字段：无',
        debug.npcLedgerUpdate.summaryTriggered.length
          ? `触发总结记忆压缩：${debug.npcLedgerUpdate.summaryTriggered.join('、')}`
          : '',
        debug.npcLedgerUpdate.warnings.length
          ? `警告：\n${debug.npcLedgerUpdate.warnings.slice(0, 8).map((item) => `- ${item}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n')
    : '【NPC账本更新诊断】\n（本回合尚未保存 NPC 账本更新诊断；变量模型未运行、未命中 NPC，或这是旧回合。）';
  const system = ['【System Prompt】', debug.systemPrompt || '（空）'].join('\n');
  const messages = [
    '【Messages】',
    ...debug.messages.map((msg, index) => [
      `## ${index + 1}. ${msg.role}`,
      msg.content || '（空）',
    ].join('\n')),
  ].join('\n\n---\n\n');
  return [deepSeekDiagnostics, narrativeNormalization, cachePrefixDiagnostics, irminsulRaw, codexRaw, npcLedger, npcLedgerUpdate, recall, system, messages]
    .filter(Boolean)
    .join('\n\n====================\n\n');
}

// 出题回合：把 <元素回响问答> 拆为紧凑的三题列表。
function AwakeningQuestionsBlock({ raw }: { raw: string }) {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items: { label: string; text: string }[] = [];
  let elementName = '';
  for (const line of lines) {
    const elementMatch = line.match(/^元素\s*[:：]\s*(.+)$/);
    if (elementMatch) {
      elementName = elementMatch[1]?.trim() ?? '';
      continue;
    }
    const mQ = line.match(/^题\s*([123一二三])\s*[:：]\s*(.+)$/);
    if (mQ) {
      items.push({ label: `第 ${mQ[1] ?? ''} 问`, text: mQ[2]?.trim() ?? '' });
    }
  }
  if (items.length === 0) return null;

  return (
    <div
      className="mt-2 p-3"
      style={{
        background: 'rgba(var(--tj-panel-bg-end),0.55)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-end),0.28)',
        clipPath:
          CLIP_CARD,
      }}
    >
      <div
        className="mb-2 text-[11px] tracking-[0.32em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start),0.85)' }}
      >
        ◆ 三 问 · {elementName || '元素回响'}
      </div>
      <div className="space-y-2">
        {items.map((q, i) => (
          <div key={i} className="flex gap-2 text-sm leading-relaxed">
            <span
              className="shrink-0 font-serif tracking-wider"
              style={{ color: 'rgba(var(--tj-btn-primary-start),0.85)' }}
            >
              {q.label}
            </span>
            <span style={{ color: 'rgba(var(--tj-text-primary),0.95)' }}>{q.text}</span>
          </div>
        ))}
      </div>
      <div
        className="mt-2 text-[11px] leading-relaxed"
        style={{ color: 'rgba(var(--tj-btn-primary-end),0.7)' }}
      >
        在下方输入框中回答这三问，元素回响会回应你对这份力量的理解。
      </div>
    </div>
  );
}

// 评判回合:当前版本只呈现升阶徽章；旧消息若带其他值,也会退回中性样式。
function AwakeningJudgementBadge({ judgement }: { judgement: string }) {
  const j = judgement.trim();
  const isPromote = j.includes('深化') || j.includes('升阶') || /promote/i.test(j);

  let label = j;
  let color = 'rgba(var(--tj-text-primary),0.95)';
  let glow = 'rgba(var(--tj-btn-primary-end),0.4)';
  let bg = 'rgba(var(--tj-panel-bg-start),0.55)';
  let stroke = 'rgba(var(--tj-btn-primary-end),0.45)';

  if (isPromote) {
    label = '共 鸣 深 化';
    color = 'rgba(var(--tj-ui-success),0.95)';
    glow = 'rgba(var(--tj-ui-success),0.55)';
    bg = 'rgba(var(--tj-ui-success),0.15)';
    stroke = 'rgba(var(--tj-ui-success),0.55)';
  }

  return (
    <div className="mt-2 flex items-center justify-center">
      <div
        className="px-6 py-2 font-serif text-base tracking-[0.5em]"
        style={{
          color,
          background: bg,
          boxShadow: `inset 0 0 0 1px ${stroke}, 0 0 20px ${glow}`,
          clipPath:
            CLIP_SECTION,
        }}
      >
        ◇ {label} ◇
      </div>
    </div>
  );
}

// 元素回响正文外壳：套一层「元素低语/评语」紫色边框，正文仍交给 BodyBlock，
// 这样【旁白】【角色名】【心声】行格式照常美化,头像也能正常显示。
function AwakeningOracleBlock({
  content,
  elementName,
  kind,
  npcRecords,
  traveler,
  album,
  showInnerVoice = true,
  deferOffscreen = false,
  visualTextSettings,
}: {
  content: string;
  elementName: string;
  kind: '出题' | '评判';
  npcRecords?: NPC记录[];
  traveler?: 角色数据结构;
  album?: 相册系统;
  showInnerVoice?: boolean;
  deferOffscreen?: boolean;
  visualTextSettings?: VisualTextSettings;
}) {
  if (!content?.trim()) return null;
  const subtitle = kind === '评判' ? '评 语' : '低 语';
  return (
    <div
      className="mx-1 px-4 py-3"
      style={{
        background:
          'linear-gradient(180deg, rgba(var(--tj-panel-bg-end),0.45) 0%, rgba(var(--tj-panel-bg-start),0.45) 100%)',
        boxShadow:
          'inset 0 0 0 1px rgba(var(--tj-btn-primary-end),0.22), inset 0 0 32px rgba(var(--tj-accent-primary-deep),0.08)',
        clipPath:
          CLIP_MEDIUM,
      }}
    >
      <div
        className="mb-2 flex items-center justify-between text-[11px] tracking-[0.32em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start),0.8)' }}
      >
        <span>◆ 元素回响 · {subtitle}</span>
        {elementName && (
          <span style={{ color: 'rgba(var(--tj-btn-primary-end),0.6)' }}>{elementName}</span>
        )}
      </div>
      <BodyBlock content={content} npcRecords={npcRecords} traveler={traveler} album={album} showInnerVoice={showInnerVoice} visualTextSettings={visualTextSettings} deferOffscreen={deferOffscreen} />
    </div>
  );
}

// 评判结果落地后的「行进感言」:当前版本只显示升阶确认。
function AwakeningAftermathLine({
  elementName,
}: {
  elementName: string;
}) {
  const label = elementName || '这种元素';

  return (
    <div className="mt-2 flex items-center justify-center px-3">
      <div
        className="font-serif text-[13px] leading-relaxed tracking-[0.12em] text-center"
        style={{ color: 'rgba(var(--tj-text-primary),0.95)', textShadow: '0 0 18px rgba(var(--tj-btn-primary-start), 0.45)' }}
      >
        你感觉到自己与「{label}」的共鸣变得更加清晰。
      </div>
    </div>
  );
}

function ToolButton({
  label,
  glyph,
  active,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-2.5 py-1 font-serif text-[11px] tracking-[0.18em] transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        color: active ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-primary), 0.85)',
        background: active ? 'rgba(var(--tj-btn-primary-start), 0.14)' : 'rgba(var(--tj-btn-primary-start), 0.04)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.55)'
          : 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.22)',
        clipPath:
          CLIP_SMALL,
      }}
      title={label}
    >
      <span className="text-xs" style={{ color: active ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-btn-primary-start), 0.65)' }}>
        {glyph}
      </span>
      <span>{label}</span>
    </button>
  );
}

function TurnBadge({ value }: { value: string }) {
  return (
    <div
      className="px-3 py-1 font-serif text-[11px] tracking-[0.22em]"
      style={{
        color: 'rgb(var(--tj-accent-primary))',
        background:
          'linear-gradient(180deg, rgba(var(--tj-btn-primary-start), 0.18), rgba(var(--tj-btn-primary-end), 0.08))',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.55)',
        clipPath:
          CLIP_SMALL,
      }}
    >
      第 {value} 回合
    </div>
  );
}

function PanelText({ content, label }: { content: string; label: string }) {
  return (
    <div className="px-4 py-3">
      <div
        className="mb-1.5 font-serif text-[11px] tracking-[0.3em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start), 0.7)' }}
      >
        ◆ {label}
      </div>
      <div
        className="whitespace-pre-wrap text-xs leading-relaxed"
        style={{ color: 'rgba(var(--tj-text-secondary), 0.92)' }}
      >
        {content}
      </div>
    </div>
  );
}

function UsagePanel({ message, onClose }: { message: 聊天消息; onClose: () => void }) {
  const usage = message.tokenUsage;
  const inputTokens = usage?.inputTokens ?? message.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? message.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens;
  const cachedTokens = usage?.cachedTokens;
  const uncachedTokens = usage?.uncachedTokens;
  const sourceLabel = usage?.source === 'api' ? 'API返回' : usage?.source === 'mixed' ? '混合' : '本地估算';
  const timeText = formatTurnTime(message.timestamp);
  const turn = message.gameTime ?? '?';
  const cacheKnown = typeof cachedTokens === 'number' || typeof uncachedTokens === 'number' || typeof usage?.cacheHitRate === 'number';
  const usageFormat = usage?.usageFormat ?? '未记录';
  const usagePath = usage?.usagePath ?? '未记录';
  const rawUsageKeys = usage?.rawUsageKeys?.length
    ? usage.rawUsageKeys.join(', ')
    : usage?.rawUsage && typeof usage.rawUsage === 'object'
      ? Object.keys(usage.rawUsage as Record<string, unknown>).sort().join(', ')
      : '未记录';
  const cacheDiagnostic = usage?.cacheDiagnostic
    ?? (usage?.rawUsage != null
      ? 'API 已返回 usage，但没有可识别的缓存统计字段。'
      : '当前回合没有 API usage 原始字段，只能显示本地估算。');
  const cacheOptimizationHint = buildCacheOptimizationHint({
    provider: usage?.provider,
    model: usage?.model,
    inputTokens,
    cachedTokens,
    uncachedTokens,
    cacheHitRate: usage?.cacheHitRate,
    cacheKnown,
  });
  const cachePrefixDiagnostics = message.debugContext?.cachePrefixDiagnostics;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 font-serif text-[15px]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>◷</span>
          <div>
            <div className="font-serif text-[13px] font-semibold tracking-[0.18em]" style={{ color: 'rgba(var(--tj-btn-primary-start),0.95)' }}>
              第 {turn} 回合
            </div>
            <div className="mt-0.5 text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
              响应详情 · {sourceLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center text-xs transition-opacity hover:opacity-85"
          style={{
            color: 'rgba(var(--tj-text-secondary),0.8)',
            background: 'rgba(var(--tj-bg-primary),0.24)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.34)',
            clipPath: CLIP_SMALL,
          }}
          title="关闭响应详情"
        >
          ×
        </button>
      </div>

      <div className="mt-3 grid gap-2.5">
        <UsageSection title="时间">
          <div className="space-y-1 text-xs leading-relaxed">
            <div>
              <span style={{ color: 'rgba(var(--tj-text-secondary),0.74)' }}>时间</span>
              <div className="mt-0.5 font-mono text-[12px]" style={{ color: 'rgba(var(--tj-text-primary),0.94)' }}>{timeText}</div>
            </div>
            <div>
              <span style={{ color: 'rgba(var(--tj-text-secondary),0.74)' }}>耗时</span>
              <span className="ml-2 font-mono" style={{ color: 'rgba(var(--tj-btn-primary-start),0.9)' }}>
                {message.responseDurationSec != null ? `${message.responseDurationSec.toFixed(1)} 秒` : '未记录'}
              </span>
            </div>
          </div>
        </UsageSection>

        <UsageSection title="Tokens">
          <div className="grid grid-cols-3 gap-2 text-center">
            <UsageMetric label="输入" value={inputTokens ? formatTokenCount(inputTokens) : '0'} tone="neutral" />
            <UsageMetric label="输出" value={outputTokens ? formatTokenCount(outputTokens) : '0'} tone="primary" />
            <UsageMetric label="总计" value={totalTokens ? formatTokenCount(totalTokens) : '0'} tone="gold" />
          </div>
        </UsageSection>

        <UsageSection title="缓存" highlighted>
          <div className="grid grid-cols-2 gap-2 text-center">
            <UsageMetric label="命中" value={typeof cachedTokens === 'number' ? formatTokenCount(cachedTokens) : '未返回'} tone="green" />
            <UsageMetric label="未命中" value={typeof uncachedTokens === 'number' ? formatTokenCount(uncachedTokens) : '未返回'} tone="red" />
          </div>
          <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
            {cacheKnown
              ? `缓存字段来自 ${sourceLabel}${usage?.cacheHitRate != null ? `，命中率 ${(usage.cacheHitRate * 100).toFixed(1)}%` : ''}。`
              : usage?.rawUsage != null
                ? `${cacheDiagnostic} Gemini 原生缓存统计通常是 usageMetadata.cachedContentTokenCount；若原始 usage 只有 prompt_tokens / completion_tokens / total_tokens，说明当前接口或中转未透传缓存命中。`
                : '当前接口没有返回缓存字段；输入/输出 token 仍可查看，缓存命中不做本地猜测。'}
          </div>
          {cacheOptimizationHint && (
            <div
              className="mt-2 px-2 py-1.5 text-[11px] leading-relaxed"
              style={{
                color: 'rgba(var(--tj-text-primary),0.86)',
                background: 'rgba(var(--tj-btn-primary-start),0.08)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start),0.22)',
              }}
            >
              <span style={{ color: 'rgba(var(--tj-btn-primary-start),0.92)' }}>缓存优化：</span>{cacheOptimizationHint}
            </div>
          )}
          {cachePrefixDiagnostics && (
            <div
              className="mt-2 px-2 py-1.5 text-[11px] leading-relaxed"
              style={{
                color: 'rgba(var(--tj-text-primary),0.86)',
                background: 'rgba(var(--tj-arcane-blue),0.08)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-blue),0.22)',
              }}
            >
              <div style={{ color: 'rgba(var(--tj-arcane-blue),0.95)' }}>前缀诊断</div>
              <div className="mt-1 grid gap-1">
                <div>公共前缀：{formatTokenCount(cachePrefixDiagnostics.commonPrefixTokens)} / {formatTokenCount(cachePrefixDiagnostics.currentPromptTokens)} tokens（{(cachePrefixDiagnostics.commonPrefixRate * 100).toFixed(1)}%）</div>
                <div>首次变化：{cachePrefixDiagnostics.firstDiffCurrentSection}</div>
                <div>变化后估算：{formatTokenCount(cachePrefixDiagnostics.changedTailTokens)} tokens</div>
              </div>
              {cachePrefixDiagnostics.largestChangedSections.length > 0 && (
                <div className="mt-1.5" style={{ color: 'rgba(var(--tj-text-secondary),0.78)' }}>
                  {cachePrefixDiagnostics.largestChangedSections.slice(0, 4).map((item) => `${item.label}≈${formatTokenCount(item.tokens)}`).join('；')}
                </div>
              )}
            </div>
          )}
          <div className="mt-2 grid gap-1.5 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
            <div><span style={{ color: 'rgba(var(--tj-btn-primary-start),0.76)' }}>模型：</span>{usage?.provider ?? '未记录'} / {usage?.model ?? '未记录'}</div>
            <div><span style={{ color: 'rgba(var(--tj-btn-primary-start),0.76)' }}>Usage格式：</span>{usageFormat} · {usagePath}</div>
            <div><span style={{ color: 'rgba(var(--tj-btn-primary-start),0.76)' }}>原始字段：</span>{rawUsageKeys || '未记录'}</div>
          </div>
          {usage?.rawUsage != null && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px]" style={{ color: 'rgba(var(--tj-btn-primary-start),0.78)' }}>
                原始 usage 字段
              </summary>
              <pre
                className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-none px-2 py-1.5 text-[10px] leading-relaxed"
                style={{
                  color: 'rgba(var(--tj-text-secondary),0.82)',
                  background: 'rgba(var(--tj-bg-primary),0.28)',
                  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.22)',
                }}
              >
                {formatRawUsage(usage.rawUsage)}
              </pre>
            </details>
          )}
        </UsageSection>
      </div>
    </div>
  );
}

function buildCacheOptimizationHint(input: {
  provider?: string;
  model?: string;
  inputTokens: number;
  cachedTokens?: number;
  uncachedTokens?: number;
  cacheHitRate?: number;
  cacheKnown: boolean;
}): string {
  if (!input.cacheKnown) return '';
  const providerModel = `${input.provider ?? ''} ${input.model ?? ''}`;
  const isDeepSeek = /deepseek/i.test(providerModel);
  const hitRate = typeof input.cacheHitRate === 'number'
    ? input.cacheHitRate
    : typeof input.cachedTokens === 'number' && input.inputTokens > 0
      ? input.cachedTokens / input.inputTokens
      : undefined;
  if (isDeepSeek && (input.cachedTokens === 0 || hitRate === 0)) {
    return 'DeepSeek 已返回缓存统计但命中为 0，说明统计链路已通，当前请求前缀仍未复用成功。建议连续生成 2-3 个新回合观察；若仍为 0，优先检查 system prompt 前段是否仍有时间、场景、记忆、北陆图书馆等动态内容提前抖动。';
  }
  if (isDeepSeek && typeof hitRate === 'number' && hitRate > 0 && hitRate < 0.25) {
    return 'DeepSeek 已命中部分缓存，但比例偏低。可继续把稳定叙事规则和固定世界观保持在请求最前段，把当前状态、记忆、北陆图书馆与历史消息后置。';
  }
  if (isDeepSeek && typeof hitRate === 'number' && hitRate >= 0.25) {
    return 'DeepSeek 缓存已经开始命中，说明前缀重排有效。后续重点是保持开头规则稳定，避免把回合时间、当前场景或检索结果插回请求前部。';
  }
  return '';
}

function UsageSection({ title, highlighted = false, children }: { title: string; highlighted?: boolean; children: React.ReactNode }) {
  return (
    <section
      className="px-3 py-2.5"
      style={{
        background: highlighted ? 'rgba(var(--tj-btn-primary-start),0.08)' : 'rgba(var(--tj-bg-primary),0.22)',
        boxShadow: highlighted
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start),0.34)'
          : 'inset 0 0 0 1px rgba(var(--tj-border),0.28)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <div className="mb-2 font-serif text-[10px] uppercase tracking-[0.28em]" style={{ color: 'rgba(var(--tj-btn-primary-start),0.78)' }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function UsageMetric({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'primary' | 'gold' | 'green' | 'red' }) {
  const color =
    tone === 'primary' ? 'rgba(var(--tj-btn-primary-start),0.95)'
      : tone === 'gold' ? 'rgba(var(--tj-btn-primary-start),0.95)'
      : tone === 'green' ? 'rgba(var(--tj-ui-success),0.95)'
      : tone === 'red' ? 'rgba(var(--tj-danger),0.95)'
      : 'rgba(var(--tj-text-primary),0.92)';
  return (
    <div className="min-w-0">
      <div className="font-serif text-[11px] tracking-[0.18em]" style={{ color: 'rgba(var(--tj-text-secondary),0.76)' }}>
        {label}
      </div>
      <div className="mt-0.5 break-words font-mono text-[13px] font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function formatTurnTime(timestamp: number): string {
  if (!timestamp) return '未记录';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRawUsage(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

function EditBodyPanel({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-4 py-3">
      <div
        className="mb-1.5 font-serif text-[11px] tracking-[0.3em]"
        style={{ color: 'rgba(var(--tj-btn-primary-start), 0.7)' }}
      >
        ◆ 修改正文
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        className="teyvat-input w-full resize-y px-3 py-2 text-sm"
        style={{
          clipPath:
            CLIP_MEDIUM,
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 font-serif text-xs tracking-[0.25em] transition-all hover:opacity-90"
          style={{
            color: 'rgba(var(--tj-text-primary), 0.9)',
            background: 'rgba(var(--tj-btn-primary-start), 0.04)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.25)',
            clipPath:
              CLIP_SMALL,
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          className="px-4 py-1.5 font-serif text-xs tracking-[0.25em] transition-all hover:opacity-90"
          style={{
            color: 'rgb(var(--tj-on-accent))',
            background: gradientAccent(0.95, 0.95),
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary), 0.5)',
            clipPath:
              CLIP_SMALL,
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

/** 故事快照可折叠卡片 */
function NarrativeImageCard({
  image,
  messageId,
  album,
  onRegenerateNarrativeImage,
}: {
  image: import('@/models/chat').叙事插图;
  messageId: string;
  album?: 相册系统;
  onRegenerateNarrativeImage?: (messageId: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const imageSrc = 解析相册资源引用(album, image.dataUrl);

  const typeLabel = image.kind === 'snapshot' || image.type === 'scene' ? '故事快照' : '角色插图';
  const icon = image.kind === 'snapshot' || image.type === 'scene' ? '▧' : '👤';
  const canRegenerate = !!onRegenerateNarrativeImage;
  const handleRegenerate = () => {
    void onRegenerateNarrativeImage?.(messageId);
  };

  if (image.status === 'generating') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-xs"
        style={{
          background: 'rgba(var(--tj-btn-primary-start), 0.06)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.2)',
          color: 'rgba(var(--tj-text-secondary), 0.8)',
        }}
      >
        <span className="animate-pulse-soft">⏳</span>
        <span className="flex-1">正在生成{typeLabel}...</span>
        {canRegenerate && (
          <button type="button" disabled className="px-2 py-1 text-[11px] opacity-45">
            重新生成
          </button>
        )}
      </div>
    );
  }

  if (image.status === 'failed') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-xs"
        style={{
          background: 'rgba(var(--tj-danger),0.06)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.2)',
          color: 'rgba(var(--tj-text-secondary), 0.8)',
        }}
      >
        <span>❌</span>
        <span className="min-w-0 flex-1 break-words">{typeLabel}生成失败{image.error ? `：${image.error}` : ''}</span>
        {canRegenerate && (
          <button
            type="button"
            onClick={handleRegenerate}
            className="shrink-0 px-2 py-1 font-serif text-[11px] tracking-[0.12em] transition-all hover:opacity-85"
            style={{
              color: 'rgba(var(--tj-btn-primary-start),0.95)',
              background: 'rgba(var(--tj-btn-primary-start),0.06)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start),0.28)',
              clipPath: CLIP_XS,
            }}
          >
            重新生成
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'rgba(var(--tj-btn-primary-start), 0.04)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.2)',
      }}
    >
      {/* 标题栏：折叠/展开按钮与「重新生成」必须是并列的兄弟控件。
          此前「重新生成」是嵌在折叠按钮内部的可聚焦 role="button" span，
          形成可聚焦控件嵌套：读屏会读到嵌套按钮，Tab 顺序也依赖 stopPropagation 才不误触折叠。 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs transition-all hover:opacity-80"
          style={{ color: 'rgba(var(--tj-text-primary), 0.85)' }}
        >
          <span>{icon}</span>
          <span className="flex-1 font-medium">{typeLabel}：{image.description || '剧情瞬间'}</span>
          <span style={{ color: 'rgba(var(--tj-text-secondary), 0.5)' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </button>
        {canRegenerate && (
          <button
            type="button"
            onClick={handleRegenerate}
            className="mr-3 shrink-0 px-2 py-1 font-serif text-[11px] tracking-[0.12em] transition-all hover:opacity-85"
            style={{
              color: 'rgba(var(--tj-btn-primary-start),0.95)',
              background: 'rgba(var(--tj-btn-primary-start),0.06)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start),0.24)',
              clipPath: CLIP_XS,
            }}
          >
            重新生成
          </button>
        )}
      </div>

      {/* 展开内容：图片 */}
      {expanded && imageSrc && (
        <div className="px-3 pb-3">
          <img
            src={imageSrc}
            alt={image.description || typeLabel}
            className="max-w-full rounded"
            style={{
              maxHeight: '512px',
              objectFit: 'contain',
            }}
          />
        </div>
      )}
    </div>
  );
}

function NarrativeImageManualCard({
  messageId,
  onRegenerateNarrativeImage,
}: {
  messageId: string;
  onRegenerateNarrativeImage?: (messageId: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const canGenerate = !!onRegenerateNarrativeImage;
  const handleGenerate = () => {
    void onRegenerateNarrativeImage?.(messageId);
  };

  return (
    <div
      style={{
        background: 'rgba(var(--tj-btn-primary-start), 0.04)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.18)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-all hover:opacity-80"
        style={{ color: 'rgba(var(--tj-text-primary), 0.85)' }}
      >
        <span>▧</span>
        <span className="flex-1 font-medium">故事快照：等待手动生成</span>
        <span style={{ color: 'rgba(var(--tj-text-secondary), 0.5)' }}>{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && (
        <div className="flex justify-center px-3 pb-3">
          <div className="mb-3 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.74)' }}>
            当前为手动故事快照模式。点击下方按钮后，会读取本回合正文并生成一张故事快照。
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full px-3 py-2 text-left transition-all hover:opacity-90 disabled:opacity-45"
            style={{
              color: 'rgb(var(--tj-on-accent))',
              background: 'linear-gradient(135deg, rgb(var(--tj-accent-primary)) 0%, rgba(var(--tj-accent-mid),0.96) 48%, rgb(var(--tj-accent-secondary)) 100%)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.42)',
              clipPath: CLIP_SMALL,
            }}
          >
            <div className="font-serif text-xs tracking-[0.18em]">生成故事快照</div>
          </button>
        </div>
      )}
    </div>
  );
}
