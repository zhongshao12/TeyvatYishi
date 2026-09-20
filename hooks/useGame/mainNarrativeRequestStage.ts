import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import type { 聊天消息 } from '@/models/chat';
import type { API配置项 } from '@/models/settings';
import { sendChatMessage, type ChatResult } from '@/services/ai/text';
import { isEmptyResponse, parseResponse } from '@/services/ai/responseParser';
import { runMainNarrativeAttempts } from '@/services/ai/mainNarrativeAttemptRunner';
import { shouldRetryNarrativeAttempt } from '@/services/ai/mainNarrativeRetryPolicy';
import { decideMainNarrativeValidation } from '@/services/ai/mainNarrativeValidation';

export const DEEPSEEK_MAIN_FORMAT_GUARD = [
  'DeepSeek 主剧情格式校验：只输出一个合法 NarrativeTurn JSON 对象。',
  '根字段固定为 body、choices、factCandidates、continuation；不要 Markdown 围栏、标签、解释或额外字段。',
  'body 只含可见 narration/dialogue/system 块；不要输出 thinking、analysis、推理过程或工具载荷。',
].join('\n');

export type MainNarrativeValidationIssueKind = 'empty' | 'missing_party' | 'reroll_similarity' | 'protocol';

export interface MainNarrativeValidationIssue {
  kind: MainNarrativeValidationIssueKind;
  attempt: number;
  maxAttempts: number;
  detail: string;
  responseText: string;
}

export interface MainNarrativeValidationRetry {
  kind: MainNarrativeValidationIssueKind;
  attempt: number;
  detail: string;
}

export interface MainNarrativeRequestStageOptions {
  maxAttempts: number;
  signal?: AbortSignal;
  request: (context: { attempt: number; maxAttempts: number }) => Promise<ChatResult>;
  getMissingPartyMembers: (candidateText: string) => string[];
  deepSeekValidation?: boolean;
  getProtocolIssues?: (parsed: NarrativeTurn) => string[];
  rerollContext?: { previousResponse: string };
  appendRetryInstruction?: (instruction: string) => void;
  onValidationIssue?: (issue: MainNarrativeValidationIssue) => void | Promise<void>;
  onValidationRetry?: (retry: MainNarrativeValidationRetry) => void | Promise<void>;
  isNonRetryableError?: (error: unknown) => boolean;
  onAttemptError?: (error: unknown, context: { attempt: number; maxAttempts: number }) => void | Promise<void>;
  onErrorRetry?: (error: unknown, context: { attempt: number; maxAttempts: number }) => void | Promise<void>;
}

export interface MainNarrativeRequestStageResult {
  result: ChatResult;
  attempt: number;
  deepSeekProtocolIssues: string[];
  rerollSimilarity?: number;
  rerollSimilarityRetried: boolean;
}

export interface MainNarrativeAttemptRequestOptions {
  config: API配置项;
  messages: 聊天消息[];
  systemPrompt: string;
  streaming: boolean;
  signal?: AbortSignal;
  prefixMode?: boolean;
  prefixContent?: string;
  onDelta: (delta: string) => void;
  onStreamReset?: () => void;
  transformOutput?: (text: string) => string | null | undefined;
  send?: typeof sendChatMessage;
}

export async function requestMainNarrativeAttempt(
  options: MainNarrativeAttemptRequestOptions,
): Promise<ChatResult> {
  let result = await (options.send ?? sendChatMessage)(options.config, {
    messages: options.messages,
    systemPrompt: options.systemPrompt,
    onDelta: options.onDelta,
    onStreamReset: options.onStreamReset,
    signal: options.signal,
    streaming: options.streaming,
    prefixMode: options.prefixMode,
    prefixContent: options.prefixContent,
    topP: options.config.topP,
    topK: options.config.topK,
    topA: options.config.topA,
    minP: options.config.minP,
    repetitionPenalty: options.config.repetitionPenalty,
    frequencyPenalty: options.config.frequencyPenalty,
    presencePenalty: options.config.presencePenalty,
    maxContext: options.config.maxContext,
  });
  const transformedText = options.transformOutput?.(result.fullText);
  if (transformedText != null && transformedText !== result.fullText) {
    result = {
      ...result,
      fullText: transformedText,
      parsed: parseResponse(transformedText),
    };
  }
  return result;
}

export async function runValidatedMainNarrativeRequest(
  options: MainNarrativeRequestStageOptions,
): Promise<MainNarrativeRequestStageResult> {
  let deepSeekProtocolIssues: string[] = [];
  let rerollSimilarity: number | undefined;
  let rerollSimilarityRetried = false;

  const attemptRun = await runMainNarrativeAttempts({
    maxAttempts: options.maxAttempts,
    signal: options.signal,
    request: options.request,
    evaluate: async (attemptResult, context) => {
      const candidateText = narrativeTurnBodyText(attemptResult.parsed);
      const canRetry = shouldRetryNarrativeAttempt({
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
      });
      const missingPartyMembers = options.getMissingPartyMembers(candidateText);
      const nextRerollSimilarity = options.rerollContext
        ? calculateRerollSimilarity(candidateText, options.rerollContext.previousResponse)
        : 0;
      const protocolIssues = options.deepSeekValidation
        ? (options.getProtocolIssues ?? getDeepSeekMainProtocolIssues)(attemptResult.parsed)
        : [];
      const validation = decideMainNarrativeValidation({
        blank: !candidateText || isEmptyResponse(attemptResult.parsed),
        missingPartyMembers,
        rerollSimilarity: nextRerollSimilarity,
        protocolIssues,
        canRetry,
      });

      if (validation.kind === 'empty') {
        const detail = 'AI response was empty';
        await options.onValidationIssue?.({
          kind: 'empty',
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
          detail,
          responseText: attemptResult.fullText || '（空响应）',
        });
        if (validation.action === 'retry') {
          await options.onValidationRetry?.({ kind: 'empty', attempt: context.attempt, detail });
          return { status: 'retry' as const, reason: 'empty narrative response', exhaustedError: new Error(detail) };
        }
        return { status: 'reject' as const, error: new Error(detail) };
      }

      if (validation.kind === 'missing_party') {
        const detail = `正文遗漏同行成员：${validation.missingPartyMembers.join('、')}`;
        await options.onValidationIssue?.({
          kind: 'missing_party',
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
          detail,
          responseText: attemptResult.fullText || candidateText,
        });
        if (validation.action === 'retry') {
          options.appendRetryInstruction?.(`${detail}。请完整重写本回合，并让每位同行成员至少有一次具名发言、行动或可观察反应。仍只输出合法 NarrativeTurn JSON。`);
          await options.onValidationRetry?.({ kind: 'missing_party', attempt: context.attempt, detail });
          return { status: 'retry' as const, reason: detail, exhaustedError: new Error(detail) };
        }
        return { status: 'reject' as const, error: new Error(detail) };
      }

      if (options.rerollContext) rerollSimilarity = nextRerollSimilarity;
      if (validation.kind === 'reroll_similarity' && options.rerollContext) {
        rerollSimilarityRetried = true;
        const detail = `重roll结果与上一版过于相似，相似度 ${Math.round(nextRerollSimilarity * 100)}%。`;
        await options.onValidationIssue?.({
          kind: 'reroll_similarity',
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
          detail,
          responseText: attemptResult.fullText || candidateText,
        });
        options.appendRetryInstruction?.(buildRerollSimilarityRetryGuard(
          options.rerollContext.previousResponse,
          nextRerollSimilarity,
        ));
        await options.onValidationRetry?.({ kind: 'reroll_similarity', attempt: context.attempt, detail });
        return { status: 'retry' as const, reason: 'reroll response too similar' };
      }

      if (validation.kind === 'protocol') {
        deepSeekProtocolIssues = protocolIssues;
        const detail = `DeepSeek 输出协议不完整：${protocolIssues.join('；')}`;
        await options.onValidationIssue?.({
          kind: 'protocol',
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
          detail,
          responseText: attemptResult.fullText || '（空响应）',
        });
        options.appendRetryInstruction?.(buildDeepSeekProtocolRetryGuard(protocolIssues));
        await options.onValidationRetry?.({ kind: 'protocol', attempt: context.attempt, detail });
        return { status: 'retry' as const, reason: `DeepSeek protocol: ${protocolIssues.join('; ')}` };
      }

      if (validation.action === 'accept' && validation.protocolIssues.length) {
        deepSeekProtocolIssues = validation.protocolIssues;
      } else if (options.deepSeekValidation) {
        deepSeekProtocolIssues = [];
      }
      return { status: 'accept' as const, value: attemptResult };
    },
    isNonRetryableError: options.isNonRetryableError,
    onAttemptError: options.onAttemptError,
    onErrorRetry: options.onErrorRetry,
  });

  return {
    result: attemptRun.value,
    attempt: attemptRun.attempt,
    deepSeekProtocolIssues,
    ...(rerollSimilarity === undefined ? {} : { rerollSimilarity }),
    rerollSimilarityRetried,
  };
}

export function getDeepSeekMainProtocolIssues(parsed: NarrativeTurn): string[] {
  const issues: string[] = [];
  if (!narrativeTurnBodyText(parsed)) issues.push('body 没有可见正文块');
  if (!Array.isArray(parsed.choices)) issues.push('choices 不是数组');
  if (!Array.isArray(parsed.factCandidates)) issues.push('factCandidates 不是数组');
  if (!parsed.continuation || !Array.isArray(parsed.continuation.unresolved)) issues.push('continuation 无效');
  return issues;
}

export function buildDeepSeekProtocolRetryGuard(issues: string[]): string {
  return [
    'DeepSeek 主剧情自动重试：上一版 JSON 未通过 NarrativeTurn 协议校验。',
    `失败项：${issues.join('；') || '未知格式错误'}。`,
    '请完全重写，不要延续上一版残缺输出。',
    DEEPSEEK_MAIN_FORMAT_GUARD,
  ].join('\n');
}

export function calculateRerollSimilarity(nextText: string, previousText: string): number {
  const left = normalizeRerollCompareText(nextText);
  const right = normalizeRerollCompareText(previousText);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 80 && right.includes(left)) return 0.98;
  if (right.length >= 80 && left.includes(right)) return 0.98;

  const buildGrams = (text: string): Set<string> => {
    const grams = new Set<string>();
    for (let index = 0; index <= text.length - 8; index += 2) {
      grams.add(text.slice(index, index + 8));
    }
    return grams;
  };
  const leftGrams = buildGrams(left);
  const rightGrams = buildGrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let shared = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) shared += 1;
  }
  return shared / Math.max(1, Math.min(leftGrams.size, rightGrams.size));
}

export function buildRerollGenerationGuard(nonce: string, previousResponse: string): string {
  const previousExcerpt = previousResponse.replace(/\s+/g, ' ').trim().slice(0, 1000);
  return [
    '重roll末尾强约束：本轮是玩家主动要求重写上一版回复。',
    `重roll nonce: ${nonce}`,
    '事实起点、玩家输入和可用上下文保持一致，但正文表达路径必须明显不同。',
    '必须更换开场镜头、段落推进顺序、对白切入、收尾钩子和行动选项写法；不得复用上一版前三句、连续短语、变量草稿句式或相同结尾。',
    '如果上一版以旁白开场，本版优先从角色动作或短对白开场；如果上一版以对白开场，本版优先从环境、动作或感官细节切入。',
    '仍必须输出完整合法的 NarrativeTurn JSON，不得因为重roll省略任何根字段。',
    previousExcerpt ? `上一版回复摘录（只用于避重复，不是当前事实）：${compactForRerollInstruction(previousResponse)}` : '',
  ].filter(Boolean).join('\n');
}

export function buildRerollSimilarityRetryGuard(previousResponse: string, similarity: number): string {
  return [
    '重roll自动换写：上一版重roll结果与被替换回复过于相似。',
    `相似度：${Math.round(similarity * 100)}%。`,
    '请完全换一种写法重写本回合：',
    '- 保留事实起点和玩家输入，但更换开场镜头、行动顺序、对白切入、句式和收束钩子。',
    '- 不得复用上一版连续短语、段落结构、对白顺序或相同结尾。',
    '- 若上一版以旁白开场，本版优先以 NPC 动作或一句短对白开场；若上一版以对白开场，本版优先以环境或动作开场。',
    '- 仍必须输出完整合法的 NarrativeTurn JSON，不得省略任何根字段。',
    previousResponse ? `被替换回复摘录（只用于避重复）：${compactForRerollInstruction(previousResponse)}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeRerollCompareText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[【】「」『』“”"'‘’（）()\[\]{}<>《》,，.。!！?？:：;；、\s]/g, '')
    .toLowerCase()
    .slice(0, 6000);
}

function compactForRerollInstruction(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 900 ? `${cleaned.slice(0, 900)}...` : cleaned;
}
