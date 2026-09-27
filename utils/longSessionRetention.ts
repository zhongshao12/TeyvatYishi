import type { 聊天消息, 回合快照 } from '@/models/chat';
import type { PlayerChoice, StoryBlock } from '@/models/teyvat/narrativeTurn';
import type { 变量命令批次, 变量命令结果 } from '@/models/variableCommand';

export const DETAILED_CHAT_TURNS = 20;
export const MAX_CHAT_MESSAGES = 1200;
const MAX_RETAINED_OLD_BOOKMARKS = 100;
/** 诊断窗口内保留完整请求上下文（systemPrompt / messages）的回合数；
 *  其余窗口回合的 debugContext 走瘦身：大字段替换为占位说明，小诊断字段保留。 */
export const FULL_DEBUG_CHAT_TURNS = 2;
export const DETAILED_VARIABLE_BATCHES = 20;
export const SUMMARY_VARIABLE_BATCHES = 80;

const MAX_VARIABLE_BATCHES = DETAILED_VARIABLE_BATCHES + SUMMARY_VARIABLE_BATCHES;
const MAX_BATCH_REPORT_LENGTH = 2000;
const MAX_BATCH_FAILURE_RESULTS = 12;
const MAX_FAILURE_REASON_LENGTH = 500;
const MAX_COMMAND_KEY_LENGTH = 240;
const MAX_COMMAND_STRING_VALUE_LENGTH = 160;

export function compactVariableBatchHistory(
  value: readonly 变量命令批次[] | null | undefined,
): 变量命令批次[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const retained = value.slice(-MAX_VARIABLE_BATCHES);
  const detailedStart = Math.max(0, retained.length - DETAILED_VARIABLE_BATCHES);

  return retained.map((batch, index) => {
    if (index >= detailedStart) return batch;
    if (batch.retentionSummary && !batch.rawText) return batch;
    const results: 变量命令结果[] = Array.isArray(batch.results) ? batch.results : [];
    const diagnosticResults = results
      .filter((result) => !result.ok || (result.kind && result.kind !== 'command'))
      .slice(-MAX_BATCH_FAILURE_RESULTS)
      .map(compactVariableDiagnosticResult);
    const succeeded = results.filter((result) => result.ok && (!result.kind || result.kind === 'command')).length;
    const omittedDiagnostics = Math.max(
      0,
      results.length - succeeded - diagnosticResults.length,
    );
    const historySummary = `[旧批次摘要] 共 ${results.length} 条，成功 ${succeeded} 条，失败/警告 ${results.length - succeeded} 条。`;
    const reportBody = batch.report && batch.report.length > MAX_BATCH_REPORT_LENGTH
      ? `${batch.report.slice(0, MAX_BATCH_REPORT_LENGTH)}\n...[旧变量报告已截断]`
      : batch.report;
    const omittedSummary = omittedDiagnostics > 0
      ? `\n...[另有 ${omittedDiagnostics} 条失败/警告摘要已省略]`
      : '';
    const { rawText: _rawText, committedChanges: _committedChanges, omittedCommittedChanges: _omittedCommittedChanges, ...summary } = batch;
    void _rawText;
    void _committedChanges;
    void _omittedCommittedChanges;
    return {
      ...summary,
      results: diagnosticResults,
      report: reportBody
        ? `${historySummary}\n${reportBody}${omittedSummary}`
        : `${historySummary}${omittedSummary}`,
      retentionSummary: {
        totalResults: results.length,
        succeededResults: succeeded,
        diagnosticResults: results.length - succeeded,
        omittedDiagnosticResults: omittedDiagnostics,
      },
    };
  });
}

function compactVariableDiagnosticResult(result: 变量命令结果): 变量命令结果 {
  const command = result.command ?? { action: 'set', key: '', value: undefined };
  const reason = result.reason && result.reason.length > MAX_FAILURE_REASON_LENGTH
    ? `${result.reason.slice(0, MAX_FAILURE_REASON_LENGTH)}...[已截断]`
    : result.reason;
  return {
    ...result,
    command: {
      action: command.action,
      key: String(command.key ?? '').slice(0, MAX_COMMAND_KEY_LENGTH),
      value: compactCommandValue(command.value),
    },
    reason,
  };
}

function compactCommandValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_COMMAND_STRING_VALUE_LENGTH
      ? `${value.slice(0, MAX_COMMAND_STRING_VALUE_LENGTH)}...[旧命令值已截断]`
      : value;
  }
  if (Array.isArray(value)) return `[旧数组值已省略，共 ${value.length} 项]`;
  if (value && typeof value === 'object') {
    return `[旧对象值已省略，共 ${Object.keys(value as Record<string, unknown>).length} 个字段]`;
  }
  return value;
}

function slimText(value: string | undefined, label: string, keepChars: number): string | undefined {
  if (value === undefined) return undefined;
  if (value.length <= keepChars) return value;
  return `${value.slice(0, keepChars)}……[已瘦身：原 ${value.length} 字符，仅最近 ${FULL_DEBUG_CHAT_TURNS} 回合保留完整${label}]`;
}

/** 瘦身单条 debugContext：替换 systemPrompt / messages / 原始召回大文本，保留其余小诊断字段。 */
function slimDebugContext(debug: NonNullable<聊天消息['debugContext']>): NonNullable<聊天消息['debugContext']> {
  return {
    ...debug,
    systemPrompt: `[已瘦身] 原长 ${debug.systemPrompt.length} 字符；仅最近 ${FULL_DEBUG_CHAT_TURNS} 回合保留完整请求上下文。`,
    messages: [],
    recallFullContent: slimText(debug.recallFullContent, '召回全文', 200),
    irminsulRecallRawText: slimText(debug.irminsulRecallRawText, '世界树原始返回', 200),
    codexRecallInjection: slimText(debug.codexRecallInjection, '图鉴注入全文', 200),
    codexRecallRawText: slimText(debug.codexRecallRawText, '图鉴模型原始返回', 200),
    npcLedgerSelectionRaw: undefined,
  };
}

export function compactChatHistoryForLongSession(
  value: readonly 聊天消息[] | null | undefined,
): 聊天消息[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const retained = retainBoundedChatHistory(value);
  const detailedAssistantIndices = collectRecentAssistantIndices(retained, DETAILED_CHAT_TURNS);
  const fullDebugIndices = collectRecentAssistantIndices(retained, FULL_DEBUG_CHAT_TURNS);
  const snapshotCarrierIndex = findLatestSnapshotCarrier(retained);

  return retained.map((message, index) => {
    let next = message;
    const keepSnapshot = index === snapshotCarrierIndex;
    if (message.preTurnSnapshot && !keepSnapshot) {
      next = { ...next, preTurnSnapshot: undefined };
    } else if (message.preTurnSnapshot && keepSnapshot) {
      const snapshot = compactSnapshotVariableBatches(message.preTurnSnapshot);
      if (snapshot !== message.preTurnSnapshot) next = { ...next, preTurnSnapshot: snapshot };
    }

    if (message.role !== 'assistant' || detailedAssistantIndices.has(index)) {
      if (
        message.role === 'assistant' &&
        detailedAssistantIndices.has(index) &&
        !fullDebugIndices.has(index) &&
        next.debugContext
      ) {
        return { ...next, debugContext: slimDebugContext(next.debugContext) };
      }
      return next;
    }

    const parsed = message.parsedResponse;
    return {
      ...next,
      debugContext: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
      tokenUsage: undefined,
      responseDurationSec: undefined,
      parsedResponse: parsed
        ? {
            body: parsed.body.map((block: StoryBlock) => ({ ...block })),
            choices: parsed.choices.map((choice: PlayerChoice) => ({ ...choice })),
            factCandidates: [],
            continuation: {
              summary: parsed.continuation.summary,
              unresolved: [...parsed.continuation.unresolved],
            },
          }
        : parsed,
    };
  });
}

function retainBoundedChatHistory(messages: readonly 聊天消息[]): readonly 聊天消息[] {
  if (messages.length <= MAX_CHAT_MESSAGES) return messages;
  const originalCutoff = messages.length - MAX_CHAT_MESSAGES;
  const oldBookmarks = messages
    .slice(0, originalCutoff)
    .filter((message) => Boolean(message.bookmark))
    .slice(-MAX_RETAINED_OLD_BOOKMARKS);
  const recent = messages.slice(-(MAX_CHAT_MESSAGES - oldBookmarks.length));
  return [...oldBookmarks, ...recent];
}

function collectRecentAssistantIndices(messages: readonly 聊天消息[], count: number): Set<number> {
  const indices = new Set<number>();
  let remaining = count;
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    if (messages[index]?.role !== 'assistant') continue;
    indices.add(index);
    remaining -= 1;
  }
  return indices;
}

function findLatestSnapshotCarrier(messages: readonly 聊天消息[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role !== 'assistant' && message.role !== 'user') continue;
    if (message.role === 'user') return message.preTurnSnapshot ? index : -1;
    return message.preTurnSnapshot ? index : -1;
  }
  return -1;
}

function compactSnapshotVariableBatches(snapshot: 回合快照): 回合快照 {
  const current = Array.isArray(snapshot.variableBatches)
    ? snapshot.variableBatches as 变量命令批次[]
    : [];
  const compacted = compactVariableBatchHistory(current);
  const unchanged = compacted.length === current.length
    && compacted.every((batch, index) => batch === current[index]);
  return unchanged ? snapshot : { ...snapshot, variableBatches: compacted };
}
