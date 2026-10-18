import type { CoreRepository } from '../contracts/storage';
import type { CoreScope, RecordRef } from '../contracts/identity';
import type { CoreSnapshot } from '../contracts/state';
import type { SourceRecord } from '../contracts/event';
import type { OperationKind, OperationRecord, CommitReceipt, PreparedCommit } from '../contracts/operation';
import type { FactExtractionInput, FactExtractionResult } from './factExtraction';
import { extractCoreFacts } from './factExtraction';
import { validateCoreDto } from '../contracts/validation';
import { refKey, sameData, sameScope, sourceRefKey, stableJson } from '../persistence/repositoryValidation';
import { reviewCoreFacts, type FactReviewPolicy } from './evidenceReview';
import { buildCoreActions } from './actions';
import { applyCoreGroups, type CoreRulePolicy } from './domainRules';
import { foldCoreChanges, mainTurnCompletion } from './settlementBatch';
import { projectCoreKnowledge } from '../knowledge/knowledgeProjection';
import { projectCoreCommitments } from '../knowledge/commitments';
import { createCoreNpcBaseline } from './npcBaseline';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import type { CommitmentRecord } from '../contracts/knowledge';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import type { CoreAction } from './actions';
import { groupCoreActions } from './dependencyGroups';
import { projectCoreInteraction, projectCoreDialogue, projectCoreNarration, assertCoreDeliverySource, readCoreReplyAnchor, type CoreInteractionDescriptor } from './interactionProjection';
import type { MemorySettings } from '../contracts/memory';
import { coreSummaryFingerprint, freezeCoreSummarySettings } from '../jobs/summaryPlan';
import { buildCorePhoneJobs } from '../jobs/phonePlan';
import type { JobRecord } from '../contracts/memory';
import { buildCoreMomentJobs } from '../jobs/momentPlan';
import { readCoreMomentOrigin } from './momentSources';
import type { CoreCodexCatalog } from '../content/codexCatalog';
import { reserveCoreProactiveTask } from '../jobs/proactivePlan';
import { buildCoreNewsJob } from '../jobs/newsPlan';
import { buildCoreProfileJob } from '../jobs/profilePlan';
import { coreIntimacyMatch, deriveCoreRelationshipCandidates } from './relationshipRules';

export interface SettleOperationInput { scope: CoreScope; sessionId: string; operationId: string; kind: OperationKind; sources: SourceRecord[]; signal?: AbortSignal; modelOptions?: Pick<FactExtractionInput, 'config' | 'promptModules'>; playerActions?: Extract<CoreAction, { kind: 'player' }>[]; interaction?: CoreInteractionDescriptor }
export interface SettlementDependencies {
  repo: CoreRepository; factModel?: (input: FactExtractionInput) => Promise<FactExtractionResult>;
  preparePolicy?(input: { snapshot: CoreSnapshot; kind: OperationKind; playerActions?: Extract<CoreAction, { kind: 'player' }>[]; signal?: AbortSignal }): Promise<void>;
  rulePolicy: CoreRulePolicy; reviewPolicy?: FactReviewPolicy;
  getActiveSession?: () => { scope: CoreScope; sessionId: string } | null;
  summarySettings?: MemorySettings;
  courierModelIdentity?(): string;
  newsSchedule?: { intervalTurns: number; modelIdentity: string };
  jobGuard?: PreparedCommit['jobGuard'];
  contentCatalog?: CoreCodexCatalog;
  completePublicProfiles?: boolean;
}
export async function settleCoreOperation(input: SettleOperationInput, deps: SettlementDependencies): Promise<CommitReceipt> {
  const { repo } = deps;
  if (!validateCoreDto('scope', input.scope).ok || !input.sources.length || input.sources.some(source => !validateCoreDto('source', source).ok || !sameScope(source.scope, input.scope) || source.operationId !== input.operationId)) throw Error('CORE2_SETTLEMENT_INPUT_INVALID');
  const scope = structuredClone(input.scope), sources = structuredClone(input.sources), sourceRefs = sources.map(source => source.ref);
  const jobGuard = deps.jobGuard ? structuredClone(deps.jobGuard) : undefined;
  const summarySettings = freezeCoreSummarySettings(input.kind === 'main' || input.interaction || input.playerActions?.some(action => action.command.type === 'moment' || action.command.type.startsWith('doudizhu_')) ? deps.summarySettings : undefined);
  const playerActions = input.playerActions ? structuredClone(input.playerActions) : undefined;
  const interaction = input.interaction ? structuredClone(input.interaction) : undefined;
  if (interaction) {
    if (!['courier', 'moment'].includes(input.kind) || sources.length !== 2 || playerActions) throw Error('CORE2_INTERACTION_AUTHORITY');
    assertCoreDeliverySource(sources[1], interaction, sources[0]!);
  }
  if (playerActions && (input.kind !== 'manual' || playerActions.length !== 1 || playerActions.some(action => action.kind !== 'player' || !sources.some(source => sameData(source, action.source))))) throw Error('CORE2_PLAYER_ACTION_AUTHORITY');
  if (new Set(sourceRefs.map(sourceRefKey)).size !== sourceRefs.length) throw Error('CORE2_DUPLICATE_SOURCE');
  const prior = await repo.readOperation(scope, input.operationId);
  if (prior && prior.status !== 'cancelled' && !sameData(prior.sourceRefs, sourceRefs)) throw Error('CORE2_OPERATION_SOURCE_MISMATCH');
  if (prior?.receipt && ['committed', 'already_committed'].includes(prior.receipt.status)) return { ...prior.receipt, status: 'already_committed' };
  const cancelled = async (reason: string): Promise<CommitReceipt> => ({ status: 'cancelled', scope, operationId: input.operationId, coreSeq: (await repo.readHead(scope)).coreSeq, eventIds: [], jobIds: [], reason });
  const current = async () => {
    const head = await repo.readHead(scope), active = deps.getActiveSession?.();
    return !input.signal?.aborted && head.sessionId === input.sessionId && (deps.getActiveSession === undefined || !!active && sameScope(active.scope, scope) && active.sessionId === input.sessionId);
  };
  if (prior?.status === 'cancelled' || !await current()) return cancelled('session_changed_or_cancelled');
  let cancellation: Promise<void> | undefined;
  const abort = () => { cancellation = repo.cancelOperation(scope, input.operationId); void cancellation.catch(() => undefined); };
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  try {
    const base = await repo.readState(scope);
    if (deps.preparePolicy) {
      await deps.preparePolicy({ snapshot: base, kind: input.kind, ...(playerActions ? { playerActions } : {}), signal: input.signal });
      if (!await current()) return cancelled('session_changed_or_cancelled');
    }
    const communication = interaction ? projectCoreInteraction(base, sources[0]!, interaction, deps.rulePolicy.ruleVersion, await readCoreReplyAnchor(repo, base, interaction), await readCoreMomentOrigin(repo, base, interaction))
      : input.kind === 'main' ? { ...projectCoreDialogue(base, sources, deps.rulePolicy.ruleVersion), readSet: [] } : { events: [], knowledge: [], readSet: [] };
    if (!await current()) return cancelled('session_changed_or_cancelled');
    for (const source of sources) {
      await repo.putSource(source);
      if (!await current()) { if (cancellation) await cancellation; return cancelled('session_changed_or_cancelled'); }
    }
    const capturedReads = base.records.map(record => ({ domain: record.domain, entityId: record.entityId, version: record.version }));
    let operation: OperationRecord = prior ?? { scope, operationId: input.operationId, kind: input.kind, status: 'draft', sourceRefs, readSet: capturedReads, candidateRefs: [], effects: [], attempts: 0 };
    if (!prior) await repo.prepareOperation(operation);
    const candidates = operation.stage?.candidates;
    let facts = playerActions ? [] : candidates;
    if (!facts) {
      if (!await current()) return cancelled('session_changed_or_cancelled');
      const result = await (deps.factModel ?? extractCoreFacts)({ ...input.modelOptions, source: sources.find(source => source.kind === 'narrative') ?? sources[0]!, snapshot: base, signal: input.signal });
      if (!await current()) { if (cancellation) await cancellation; return cancelled('session_changed_or_cancelled'); }
      operation = { ...operation, attempts: operation.attempts + result.attempts };
      if (result.kind === 'failed') {
        const { stage: _stage, receipt: _receipt, ...preparation } = operation;
        await repo.prepareOperation({ ...preparation, status: 'failed', failure: { code: result.code, detail: sanitizeApiErrorReportText(result.detail) } });
        throw Error(`${result.code}: ${result.detail}`);
      }
      facts = result.candidates;
    }
    const review = reviewCoreFacts({ candidates: facts, sources, snapshot: base, policy: deps.reviewPolicy ?? {} });
    if (input.kind === 'main') {
      // Fill model omissions, not a second competing proposal for an already verified interaction.
      const missing = deriveCoreRelationshipCandidates(sources, base).filter(derived => !review.verified.some(existing =>
        existing.proposal.kind === 'relationship' && derived.proposal.kind === 'relationship'
        && existing.proposal.npcId === derived.proposal.npcId && existing.proposal.affinityDelta === derived.proposal.affinityDelta
        && coreIntimacyMatch(existing, base) && existing.evidenceRefs.some(a => derived.evidenceRefs.some(b =>
          sameData(a.ref, b.ref) && a.blockId === b.blockId && a.start < b.end && b.start < a.end))));
      const automatic = reviewCoreFacts({ candidates: missing, sources, snapshot: base, policy: deps.reviewPolicy ?? {} });
      for (const status of ['verified', 'pending', 'disputed', 'rejected'] as const) review[status].push(...automatic[status]);
    }
    const reviewed = [...review.verified, ...review.pending, ...review.disputed, ...review.rejected];
    if (!await current()) return cancelled('session_changed_or_cancelled');
    const stage = { scope, sessionId: input.sessionId, operationId: input.operationId, sourceRefs, candidates: reviewed, review: reviewed.map(candidate => ({ candidateId: candidate.candidateId, status: candidate.status, reason: candidate.reason ?? '' })), stageVersion: (operation.stage?.stageVersion ?? 0) + 1 };
    await repo.stageOperation(stage);
    const world = base.records.find(record => record.domain === 'world');
    const operationTurn = input.kind === 'main' && world?.domain === 'world' ? world.value.completedMainTurns + 1 : undefined;
    const createNpc = deps.rulePolicy.createNpc ?? createCoreNpcBaseline;
    const traveler = base.records.find(row => row.domain === 'traveler');
    const talents = [...new Map([...(traveler?.domain === 'traveler' ? traveler.value.天赋 : []), ...(deps.rulePolicy.talents ?? [])].map(talent => [talent.id, talent])).values()];
    const policy = { ...deps.rulePolicy, talents, operationTurn, createNpc: (candidate: import('../contracts/event').FactCandidate, snapshot: import('../contracts/state').CoreSnapshot) => {
      const npc = createNpc(candidate, snapshot);
      return npc && operationTurn !== undefined ? { ...npc, firstSeenTurn: operationTurn, lastSeenTurn: operationTurn } : npc;
    } };
    const applied = applyCoreGroups(base, playerActions ? groupCoreActions(playerActions) : buildCoreActions(review, base).groups, policy);
    if (playerActions && applied.pending.length) {
      const { stage: _stage, receipt: _receipt, ...failed } = operation;
      const detail = applied.pending[0]?.reason ?? '玩家操作未通过校验。';
      await repo.prepareOperation({ ...failed, status: 'failed', failure: { code: 'CORE2_PLAYER_ACTION_REJECTED', detail } });
      throw Error(`CORE2_PLAYER_ACTION_REJECTED: ${detail}`);
    }
    for (const group of applied.pending) for (const action of group.actions) if (action.kind === 'narrative') {
      const candidate = reviewed.find(row => row.candidateId === action.candidate.candidateId);
      if (candidate) { candidate.status = 'pending'; candidate.reason = group.reason ?? '依赖组暂缓。'; }
    }
    if (!await current()) { if (cancellation) await cancellation; return cancelled('session_changed_or_cancelled'); }
    await repo.stageOperation({ ...stage, candidates: reviewed, review: reviewed.map(candidate => ({ candidateId: candidate.candidateId, status: candidate.status, reason: candidate.reason ?? '' })), stageVersion: stage.stageVersion + 1 });
    const events = [...applied.events, ...communication.events, ...(input.kind === 'main' ? projectCoreNarration(sources, reviewed, policy.ruleVersion) : [])];
    for (const event of events) event.recordedAt = Math.max(...sources.filter(source => event.evidenceRefs.some(ref => sourceRefKey(ref.ref) === sourceRefKey(source.ref))).map(source => source.createdAt));
    const proactive = { jobs: [] as JobRecord[], readSet: [] as RecordRef[] };
    if (input.kind === 'main') {
      const completion = mainTurnCompletion(base, applied.state, sources.find(source => source.kind === 'narrative') ?? sources[0]!, policy.ruleVersion);
      Object.assign(proactive, reserveCoreProactiveTask(applied.state, completion, sourceRefs, input.sessionId, summarySettings, deps.courierModelIdentity?.() ?? 'unconfigured'));
      events.push(completion);
    }
    const folded = foldCoreChanges(base, events);
    const reads = new Map<string, RecordRef>(applied.readSet.map(ref => [refKey(ref), ref]));
    for (const ref of communication.readSet) reads.set(refKey(ref), ref);
    for (const ref of proactive.readSet) if (!reads.has(refKey(ref))) reads.set(refKey(ref), ref);
    for (const change of folded.changes) reads.set(refKey(change.ref), change.ref);
    const readSet = [...reads.values()];
    for (const ref of readSet) {
      const captured = operation.readSet.find(read => refKey(read) === refKey(ref));
      if (captured ? captured.version !== ref.version : ref.version !== 0) return { status: 'conflict', scope, operationId: input.operationId, coreSeq: base.head.coreSeq, eventIds: [], jobIds: [], reason: 'state_read_version_changed' };
    }
    const existingCommitments: CommitmentRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.queryCommitments({ scope, cutoffSeq: base.head.coreSeq, limit: 50, ...(cursor ? { cursor } : {}) });
      existingCommitments.push(...page.items.map(row => ({ ...row, scope })));
      cursor = page.nextCursor;
    } while (cursor);
    const commitments = projectCoreCommitments(folded.events, existingCommitments, (folded.events.at(-1)?.occurredMoment ?? sources[0]!.moment)).filter(row => !existingCommitments.some(old => sameData(old, row)));
    const knowledge = [...projectCoreKnowledge(folded.events.filter(event => event.type !== 'turn.complete' && !event.type.startsWith('communication.')), applied.state), ...communication.knowledge];
    const jobs: JobRecord[] = input.kind === 'main' || interaction || folded.events.some(event => event.type === 'game.doudizhu.completed') ? [{ jobId: `job-summary-${checksumUtf8(stableJson([scope, input.operationId]))}`, scope, sessionId: input.sessionId, kind: 'turn_summary', sourceRefs, operationId: input.operationId, status: 'pending', leaseId: null, configFingerprint: coreSummaryFingerprint(scope, input.operationId, summarySettings), attempts: 0, steps: [], version: 1 }] : [];
    jobs.push(...proactive.jobs);
    if (deps.completePublicProfiles) for (const change of folded.changes) if (!change.before && change.after?.domain === 'npc' && change.after.value.canonical) jobs.push(buildCoreProfileJob({ scope, sessionId: input.sessionId, operationId: input.operationId, sourceRefs, npcId: change.after.entityId }));
    const mainTurn = folded.events.find(event => event.type === 'turn.complete')?.turn;
    if (input.kind === 'main' && mainTurn && deps.newsSchedule && Number.isSafeInteger(deps.newsSchedule.intervalTurns) && deps.newsSchedule.intervalTurns > 0
      && mainTurn % deps.newsSchedule.intervalTurns === 0) jobs.push(buildCoreNewsJob({ scope, sessionId: input.sessionId, operationId: input.operationId, sourceRefs, modelIdentity: deps.newsSchedule.modelIdentity }));
    if (interaction?.responsePlan) jobs.push(...buildCorePhoneJobs({ scope, sessionId: input.sessionId, sourceRefs, event: communication.events[0]!, response: interaction.responsePlan, settings: summarySettings }));
    for (const action of playerActions ?? []) if (action.command.type === 'moment' && action.command.action !== 'delete') {
      const command = action.command;
      const post = folded.changes.find(change => change.after?.domain === 'courier' && change.after.entityId === command.momentId)?.after;
      if (post?.domain === 'courier' && post.value.kind === 'moment') jobs.push(...buildCoreMomentJobs({ post, sessionId: input.sessionId, operationId: input.operationId, modelIdentity: deps.courierModelIdentity?.() ?? 'unconfigured', settings: summarySettings }));
    }
    const { stage: _stage, receipt: _receipt, failure: _failure, ...prepared } = operation;
    if (!await current()) { if (cancellation) await cancellation; return cancelled('session_changed_or_cancelled'); }
    await repo.prepareOperation({ ...prepared, status: 'prepared', readSet, candidateRefs: reviewed.map(candidate => candidate.candidateId), effects: folded.changes.map(change => change.effectKey) });
    if (!await current()) { if (cancellation) await cancellation; return cancelled('session_changed_or_cancelled'); }
    return await repo.commit({ scope, sessionId: input.sessionId, operationId: input.operationId, sourceRefs, readSet, changes: folded.changes, events: folded.events, knowledge, commitments, jobs, ...(jobGuard ? { jobGuard } : {}) });
  } catch (error) {
    if (input.signal?.aborted) {
      if (cancellation) await cancellation;
      const saved = await repo.readOperation(scope, input.operationId);
      if (saved?.receipt && ['committed', 'already_committed'].includes(saved.receipt.status)) return saved.receipt;
      return cancelled('session_changed_or_cancelled');
    }
    throw error;
  } finally { input.signal?.removeEventListener('abort', abort); }
}
