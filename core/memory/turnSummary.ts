import type { OperationRecord } from '../contracts/operation';
import type { GameEvent, SourceRecord } from '../contracts/event';
import type { MemoryRecord } from '../contracts/memory';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sameData, sourceRefKey } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { buildCoreMemory } from './memoryRecords';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { validateEvidence } from '../sources/sourceRecords';

export type CoreMemoryTextResult = { kind: 'model'; text: string } | { kind: 'failed'; code: string; detail: string };
export interface CoreSummaryRequest { items: string[]; turn: number; layer: 'short' | 'middle' | 'long'; prompt: string; signal?: AbortSignal }
export interface MemoryModelDependencies { summarize?: (request: CoreSummaryRequest) => Promise<CoreMemoryTextResult> }
export interface TurnSummaryInput { operation: OperationRecord; sources: SourceRecord[]; events: GameEvent[]; mode: 'local' | 'model'; prompt: string; signal?: AbortSignal }
export type MemoryStepResult = { kind: 'staged'; memory: MemoryRecord; modelRequests: number } | { kind: 'failed'; code: string; detail: string; modelRequests: number };
const technicalPanel = /<(?:char_seven|time_format|变量事实)(?:\s|>)/iu;
export async function summarizeCoreTurn(input: TurnSummaryInput, deps: MemoryModelDependencies): Promise<MemoryStepResult> {
  if (!isCoreJsonData({ operation: input.operation, sources: input.sources, events: input.events, mode: input.mode, prompt: input.prompt })) return { kind: 'failed', code: 'CORE2_SUMMARY_INPUT_INVALID', detail: '摘要输入不是可验证的普通数据。', modelRequests: 0 };
  const { operation, sources, events, mode, prompt } = structuredClone({ operation: input.operation, sources: input.sources, events: input.events, mode: input.mode, prompt: input.prompt });
  let modelRequests = 0;
  const failed = (code: string, detail: string): MemoryStepResult => ({ kind: 'failed', code, detail: sanitizeApiErrorReportText(detail), modelRequests });
  const completedGame = operation.kind === 'manual' && events.some(event => event.type === 'game.doudizhu.completed' && event.fact?.kind === 'experience');
  if (!validateCoreDto('operation', operation).ok || !(['main', 'courier', 'moment'].includes(operation.kind) || completedGame) || operation.status !== 'committed' || !operation.receipt || !['committed', 'already_committed'].includes(operation.receipt.status)) return failed('CORE2_SUMMARY_NOT_COMMITTED', '只有已提交的完整主回合、手机交流或已结束牌局才能建立独立摘要。');
  if (!sources.length || !sameData([...operation.sourceRefs].map(sourceRefKey).sort(), sources.map(source => sourceRefKey(source.ref)).sort())
    || sources.some(source => !validateCoreDto('source', source).ok || source.operationId !== operation.operationId || !sameData(source.scope, operation.scope))
    || !sameData([...operation.receipt.eventIds].sort(), events.map(event => event.eventId).sort())
    || events.some(event => !validateCoreDto('event', event).ok || event.operationId !== operation.operationId || event.commitSeq !== operation.receipt!.coreSeq || event.journeyId !== operation.scope.journeyId || event.branchId !== operation.scope.branchId || event.evidenceRefs.some(ref => !sources.some(source => validateEvidence(ref, source).ok)))
    || !(operation.kind === 'main' ? events.some(event => event.type === 'turn.complete') : completedGame || events.some(event => event.type.startsWith('communication.')))) return failed('CORE2_SUMMARY_SOURCE_MISMATCH', '摘要材料不属于同一个完整、已保存回合或交流。');
  if (input.signal?.aborted) return failed('CORE2_SUMMARY_CANCELLED', '摘要已停止。');
  const completion = events.find(event => event.type === 'turn.complete') ?? events.at(-1)!;
  // Never feed the completion event's full prose back as confirmed world facts:
  // it may contain candidates that were explicitly deferred or rejected.
  const confirmed = events.filter(event => event.type !== 'turn.complete');
  const items = confirmed.map(event => JSON.stringify({ kind: event.type === 'narration.recorded' ? 'recorded_narration' : event.type.startsWith('communication.') ? 'recorded_utterance' : 'confirmed_event', type: event.type, fact: event.fact ?? null,
    ...(event.type === 'narration.recorded' ? { text: event.evidenceRefs.map(ref => ref.quote).join('\n'), meaning: '叙事记录，不是已审核的状态变化，也不证明其他角色知情。' } : {}),
    ...(event.type.startsWith('communication.') ? { text: event.evidenceRefs.map(ref => ref.quote).join('\n'), meaning: '确实说过并送达的原话，不代表话中宣称已经发生。' } : {}), actorIds: event.actorIds, targetIds: event.targetIds, moment: event.occurredMoment }));
  const blocked = new Set((operation.stage?.candidates ?? []).filter(candidate => candidate.status !== 'verified').flatMap(candidate => candidate.evidenceRefs.map(ref => `${sourceRefKey(ref.ref)}:${ref.blockId}`)));
  const recordedSpeech = new Set(confirmed.filter(event => event.type.startsWith('communication.')).flatMap(event => event.evidenceRefs.map(ref => `${sourceRefKey(ref.ref)}:${ref.blockId}`)));
  for (const source of sources) if (source.kind === 'narrative') for (const block of source.blocks) {
    if (block.kind !== 'dialogue' || blocked.has(`${sourceRefKey(source.ref)}:${block.blockId}`) || recordedSpeech.has(`${sourceRefKey(source.ref)}:${block.blockId}`) || technicalPanel.test(block.text)) continue;
    items.push(JSON.stringify({ kind: block.kind === 'dialogue' ? 'recorded_utterance' : 'recorded_narration', speakerId: block.speakerId ?? null, text: block.text, meaning: '仅记录本回合原话或叙事；不是已确认的变量变化，不证明提议已履行，也不证明其他角色知情。' }));
  }
  if (items.some(item => technicalPanel.test(item))) return failed('CORE2_SUMMARY_TECHNICAL_PANEL', '已确认材料含技术面板，需要核对来源，暂不写入角色记忆。');
  const local = items.length ? items.map(item => `- ${item}`).join('\n') : '- 本回合没有新增已确认的世界变化；正文原始记录仍保留。';
  let text = local;
  if (mode === 'model') {
    if (!deps.summarize) return failed('CORE2_SUMMARY_MODEL_UNCONFIGURED', '记忆模型尚未配置。');
    try {
      modelRequests++;
      const result = await deps.summarize({ items: items.length ? items : [local], turn: completion.turn, layer: 'short', prompt: `${prompt}\n严格区分 confirmed_event 与 recorded_utterance/recorded_narration。保留原话的发言归属，不能将计划、邀请、传闻变成已发生事实；不要扩大角色知情。`, signal: input.signal });
      if (input.signal?.aborted) return failed('CORE2_SUMMARY_CANCELLED', '摘要已停止。');
      if (result.kind === 'failed') return failed(result.code, result.detail);
      if (!result.text.trim() || technicalPanel.test(result.text)) return failed('CORE2_SUMMARY_OUTPUT_INVALID', '摘要为空或包含技术面板，未发布为成功记忆。');
      text = result.text;
    } catch (error) { return failed(input.signal?.aborted ? 'CORE2_SUMMARY_CANCELLED' : 'CORE2_SUMMARY_MODEL_FAILED', String(error)); }
  }
  try {
    return { kind: 'staged', memory: buildCoreMemory({ scope: operation.scope, memoryId: `memory-turn-${checksumUtf8(JSON.stringify([operation.scope, operation.operationId]))}`, text, layer: 'short', sources, events, mode }), modelRequests };
  } catch (error) { return failed('CORE2_SUMMARY_PROVENANCE_INVALID', String(error)); }
}
