import type { CoreRepository } from '../contracts/storage';
import type { CoreScope, SourceRef } from '../contracts/identity';
import type { SourceRecord, SourceBlock } from '../contracts/event';
import type { CoreSnapshot } from '../contracts/state';
import type { CommitmentRecord } from '../contracts/knowledge';
import type { CommitReceipt } from '../contracts/operation';
import type { ChatCompletionRequest } from '@/services/ai/chatCompletionClient';
import type { API配置项 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import { parseNarrativeTurn } from '@/services/ai/narrativeTurnParser';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { freezeSource } from '../sources/sourceRecords';
import { sameScope } from '../persistence/repositoryValidation';
import { resolveCoreEntity } from './entityResolution';
import { settleCoreOperation, type SettlementDependencies } from './settleOperation';

export interface CoreTurnInput { scope: CoreScope; sessionId: string; operationId: string; text: string; signal?: AbortSignal; config?: API配置项; promptModules?: 提示词模块[] }
export interface CoreContextInput { snapshot: CoreSnapshot; userInput: string; history: SourceRecord[]; commitments: CommitmentRecord[]; signal?: AbortSignal }
export interface CoreTurnContext { systemPrompt: string; messages: ChatCompletionRequest['messages']; worldbookEntryIds?: string[]; validation?: { wordCountTarget: number | null; partyNpcIds: string[] }; memoryDelivery?: { authorBundle: import('../retrieval/recallTypes').MemoryContextBundle; npcBundles: (import('../retrieval/recallTypes').MemoryContextBundle & { npcId: string })[] } }
export interface CoreTurnDependencies extends SettlementDependencies {
  onSource?: (source: SourceRecord) => void;
  assembleContext(input: CoreContextInput): Promise<CoreTurnContext>;
  generateNarrative(input: { context: CoreTurnContext; snapshot: CoreSnapshot; signal?: AbortSignal; config?: API配置项 }): Promise<string>;
}
export type CoreTurnResult = { kind: 'committed' | 'pending'; operationId: string; narrativeRef: SourceRef; receipt: CommitReceipt }
  | { kind: 'failed'; operationId: string; stage: 'generation' | 'settlement'; code: string; detail: string; narrativeRef?: SourceRef }
  | { kind: 'cancelled'; operationId: string; narrativeRef?: SourceRef };

async function recentConfirmedSources(repo: CoreRepository, snapshot: CoreSnapshot): Promise<SourceRecord[]> {
  const operations = await repo.queryCommittedOperations({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, afterSeq: 0, kinds: ['main'], direction: 'desc', limit: 10 });
  const sources: SourceRecord[] = [];
  for (const operation of [...operations.items].reverse()) if (operation.kind === 'main') for (const ref of operation.sourceRefs) {
    const source = await repo.readSource(ref);
    if (source && (source.kind === 'player_input' || source.kind === 'narrative' && !operation.stage?.review.some(row => row.status !== 'verified'))) sources.push(source);
  }
  return sources;
}
/** One operation owns its input and visible body. Variable retries never regenerate that body. */
export async function runCoreTurn(input: CoreTurnInput, deps: CoreTurnDependencies): Promise<CoreTurnResult> {
  const scope = structuredClone(input.scope), text = input.text, { repo } = deps;
  let narrative: SourceRecord | undefined, stage: 'generation' | 'settlement' = 'generation';
  const active = async () => {
    const head = await repo.readHead(scope), current = deps.getActiveSession?.();
    return !input.signal?.aborted && head.sessionId === input.sessionId && (deps.getActiveSession === undefined || !!current && current.sessionId === input.sessionId && sameScope(current.scope, scope));
  };
  const cancelled = (): CoreTurnResult => ({ kind: 'cancelled', operationId: input.operationId, ...(narrative ? { narrativeRef: narrative.ref } : {}) });
  try {
    if (!text.trim()) throw Error('CORE2_EMPTY_INPUT');
    let operation = await repo.readOperation(scope, input.operationId);
    const sources: SourceRecord[] = [];
    if (operation) for (const ref of operation.sourceRefs) {
      const source = await repo.readSource(ref);
      if (!source) throw Error('CORE2_TURN_SOURCE_MISSING');
      sources.push(source);
    }
    let playerInput = sources.find(source => source.kind === 'player_input');
    narrative = sources.find(source => source.kind === 'narrative');
    if (playerInput && playerInput.blocks.filter(b => b.kind === 'message').map(b => b.text).join('\n') !== text) throw Error('CORE2_INPUT_CHANGED');
    if (operation?.receipt && narrative && ['committed', 'already_committed'].includes(operation.receipt.status)) return { kind: 'committed', operationId: input.operationId, narrativeRef: narrative.ref, receipt: operation.receipt };
    if (operation?.status === 'cancelled' || !await active()) return cancelled();
    const snapshot = await repo.readState(scope);
    if (!await active()) return cancelled();
    if (!playerInput) {
      const world = snapshot.records.find(record => record.domain === 'world');
      if (!world || world.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
      playerInput = freezeSource({ scope, operationId: input.operationId, kind: 'player_input', moment: { ...world.value.moment, turn: world.value.completedMainTurns + 1 }, blocks: [{ blockId: 'player-input', kind: 'message', text }] });
      await repo.putSource(playerInput); sources.push(playerInput);
      operation = { scope, operationId: input.operationId, kind: 'main', status: 'draft', sourceRefs: [playerInput.ref], readSet: snapshot.records.map(r => ({ domain: r.domain, entityId: r.entityId, version: r.version })), candidateRefs: [], effects: [], attempts: 0 };
      await repo.prepareOperation(operation);
      deps.onSource?.(structuredClone(playerInput));
    }
    if (!narrative) {
      if (!await active()) return cancelled();
      const history = await recentConfirmedSources(repo, snapshot);
      const commitments = (await repo.queryCommitments({ scope, cutoffSeq: snapshot.head.coreSeq, statuses: ['pending', 'due'], limit: 50 })).items;
      const context = await deps.assembleContext({ snapshot, userInput: text, history, commitments, signal: input.signal });
      if (!await active()) return cancelled();
      if (!operation) throw Error('CORE2_OPERATION_NOT_PREPARED');
      const { stage: _previousStage, receipt: _previousReceipt, failure: _failure, ...draft } = operation;
      operation = { ...draft, attempts: draft.attempts + 1 };
      await repo.prepareOperation(operation);
      const raw = await deps.generateNarrative({ context, snapshot, signal: input.signal, config: input.config });
      if (!await active()) { await repo.cancelOperation(scope, input.operationId); return cancelled(); }
      const parsed = parseNarrativeTurn(raw);
      const blocks: SourceBlock[] = parsed.body.filter(block => block.kind === 'narration' || block.kind === 'dialogue').map((block, index) => {
        const resolution = block.speaker ? resolveCoreEntity({ name: block.speaker }, snapshot) : null;
        return { blockId: `body-${index + 1}`, kind: block.kind === 'dialogue' ? 'dialogue' : 'narration', text: block.text, ...(resolution?.kind === 'matched' ? { speakerId: resolution.entityId } : {}) };
      });
      const bundles = context.memoryDelivery ? [{ bundleId: context.memoryDelivery.authorBundle.bundleId, target: 'main' as const, npcIds: [], selectedLeafIds: context.memoryDelivery.authorBundle.selectedLeafIds },
        ...context.memoryDelivery.npcBundles.map(bundle => ({ bundleId: bundle.bundleId, target: 'main' as const, npcIds: [bundle.npcId], selectedLeafIds: bundle.selectedLeafIds }))] : [];
      narrative = freezeSource({ scope, operationId: input.operationId, kind: 'narrative', blocks, moment: playerInput.moment,
        ...(bundles.length || context.worldbookEntryIds?.length ? { delivery: { version: 1, bundles, worldbookEntryIds: context.worldbookEntryIds ?? [] } } : {}) });
      operation = await repo.appendOperationSource({ scope, sessionId: input.sessionId, operationId: input.operationId, source: narrative });
      sources.push(narrative);
      deps.onSource?.(structuredClone(narrative));
    }
    stage = 'settlement';
    const receipt = await settleCoreOperation({ scope, sessionId: input.sessionId, operationId: input.operationId, kind: 'main', sources, signal: input.signal, modelOptions: { config: input.config, promptModules: input.promptModules } }, deps);
    if (receipt.status === 'cancelled') return cancelled();
    if (receipt.status === 'conflict') throw Error(`CORE2_SETTLEMENT_CONFLICT: ${receipt.reason}`);
    const saved = await repo.readOperation(scope, input.operationId);
    return { kind: saved?.stage?.review.some(row => row.status === 'pending' || row.status === 'disputed') ? 'pending' : 'committed', operationId: input.operationId, narrativeRef: narrative.ref, receipt };
  } catch (error) {
    if (input.signal?.aborted) { await repo.cancelOperation(scope, input.operationId); return cancelled(); }
    let detail = sanitizeApiErrorReportText(error instanceof Error ? error.message : String(error));
    const code = detail.startsWith('CORE2_') ? detail.split(':')[0]! : stage === 'generation' ? 'CORE2_NARRATIVE_FAILED' : 'CORE2_SETTLEMENT_FAILED';
    if (stage === 'generation') try {
      const stored = await repo.readOperation(scope, input.operationId);
      if (stored?.status === 'draft') {
        const { stage: _stage, receipt: _receipt, ...draft } = stored;
        await repo.prepareOperation({ ...draft, failure: { code, detail } });
      }
    } catch (recordError) { detail += `；失败详情未能保存：${sanitizeApiErrorReportText(recordError instanceof Error ? recordError.message : String(recordError))}`; }
    return { kind: 'failed', operationId: input.operationId, stage, code, detail, ...(narrative ? { narrativeRef: narrative.ref } : {}) };
  }
}
