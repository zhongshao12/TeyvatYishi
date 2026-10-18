import type { EventDraft, FactCandidate } from '../contracts/event';
import type { StateChange } from '../contracts/operation';
import type { CoreSnapshot, NpcState, TravelerState } from '../contracts/state';
import type { Talent } from '@/models/teyvat/character';
import { validateCoreDto } from '../contracts/validation';
import { 每日同行好感加成 } from '@/utils/gameplayRules';
import { RuleContext, projectChanges } from './ruleContext';
import { buildCoreActions, coreCandidateReviewId, type CoreAction } from './actions';
import type { ActionGroup } from './dependencyGroups';
import { applyWorldRule } from './worldRules';
import { applyCharacterRule } from './characterRules';
import { applyPlayerAction } from './playerActions';
import { fixedCoreAffinity } from './relationshipRules';
import { dateTriggerFromText } from '../knowledge/commitmentTriggers';
import { stableJson } from '../persistence/repositoryValidation';
import { sharedExperienceProblem } from './sharedExperience';
import type { RecordRef } from '../contracts/identity';
import { applyCoreStoryRule } from './storyRules';
import { coreNewItemName, createCoreQuestBaseline } from './resourceRegistration';

export interface CoreRulePolicy {
  ruleVersion: string;
  /** Host-owned current main turn, not a model-provided timestamp. */
  operationTurn?: number;
  storyNodes: readonly { seriesId: string; chapterId: string; nodeId: string; prerequisites: readonly string[] }[];
  storyContent?: readonly import('../content/storyCatalog').CoreStoryNode[];
  questPrerequisites?: Readonly<Record<string, readonly string[]>>;
  talents?: readonly Talent[];
  maximumHealth?: number;
  allowLevel?: (traveler: TravelerState, next: number) => boolean;
  createNpc?: (candidate: FactCandidate, state: CoreSnapshot) => NpcState | undefined;
  fixedAffinity?: (candidate: FactCandidate, state: CoreSnapshot) => number | undefined;
}
export type ActionResult = { ok: true; changes: StateChange[]; eventDrafts: EventDraft[]; readSet: RecordRef[] } | { ok: false; reason: string };

export function applyCoreAction(state: CoreSnapshot, action: CoreAction, policy: CoreRulePolicy): ActionResult {
  try {
    if (!validateCoreDto('snapshot', state).ok || !policy.ruleVersion || !action.actionId) throw Error('当前状态或规则身份无效。');
    const source = action.kind === 'player' ? action.source : null;
    const candidate = action.kind === 'narrative' ? action.candidate : null;
    const scope = source?.scope ?? candidate?.scope;
    if (!scope || scope.journeyId !== state.head.scope.journeyId || scope.branchId !== state.head.scope.branchId) throw Error('操作不属于当前存档。');
    if (candidate && (!validateCoreDto('candidate', candidate).ok || candidate.status !== 'verified')) throw Error('候选没有通过审核。');
    if (source && !validateCoreDto('source', source).ok) throw Error('玩家操作来源无效。');
    if (action.kind === 'player' && action.command.type === 'review_fact') {
      const command = action.command;
      if (source?.kind !== 'manual' || source.blocks.length !== 1 || source.blocks[0]!.kind !== 'configuration' || source.blocks[0]!.text !== JSON.stringify(action.command)) throw Error('审核操作缺少完整玩家来源。');
      const members = command.groupCandidates ?? [command.candidate];
      if (!members.length || new Set(members.map(member => member.candidateId)).size !== members.length || !members.some(member => member.candidateId === command.candidate.candidateId)
        || members.some(member => !validateCoreDto('candidate', member).ok || member.scope.journeyId !== scope.journeyId || member.scope.branchId !== scope.branchId || member.operationId !== command.originOperationId)) throw Error('审核对象不属于当前档案或同一回合。');
      const applied = action.command.decision === 'accept' ? applyCoreGroups(state, buildCoreActions({ verified: members.map(member => ({ ...member, status: 'verified' })), pending: [], disputed: [], rejected: [] }, state).groups, policy)
        : { changes: [], readSet: [], pending: [] };
      if (applied.pending.length) return { ok: false, reason: applied.pending[0]!.reason ?? '同组变化未通过当前状态校验。' };
      const moment = state.records.find(row => row.domain === 'world')?.value.moment;
      const player = state.records.find(row => row.domain === 'traveler');
      if (!moment || !player) throw Error('当前世界或旅人缺失。');
      const block = source.blocks[0]!;
      // A decision happened NOW. It does not assert that ambiguous old prose was historical truth.
      const eventDrafts: EventDraft[] = members.map((reviewed, index) => ({ eventId: `event:${coreCandidateReviewId(scope, command.originOperationId, reviewed.candidateId)}`, journeyId: scope.journeyId, branchId: scope.branchId, operationId: source.operationId, turn: moment.turn, type: `player.review_${command.decision}`, actorIds: [player.entityId], targetIds: [reviewed.candidateId], evidenceRefs: [{ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text }], occurredMoment: { ...moment, settlementId: source.operationId }, ruleVersion: policy.ruleVersion, committedChanges: index === 0 ? applied.changes : [], visibility: { kind: 'private', npcIds: [] }, recordedAt: source.createdAt }));
      return { ok: true, changes: applied.changes, readSet: applied.readSet, eventDrafts };
    }
    const ctx = new RuleContext(state, `effect:${action.actionId}`, policy.operationTurn);
    for (const id of candidate?.actors ?? []) {
      const record = state.records.find(r => r.entityId === id && (r.domain === 'npc' || r.domain === 'traveler'));
      if (record) ctx.get(record.domain, record.entityId);
    }
    const p = candidate?.proposal;
    if (action.kind === 'player') applyPlayerAction(ctx, action, policy);
    else if (p?.kind === 'inventory') {
      const existing = state.records.find(row => row.domain === 'inventory' && row.entityId === p.itemId);
      const name = existing ? null : coreNewItemName(p, state);
      const item = existing ? ctx.get('inventory', p.itemId) : name ? { scope: state.head.scope, domain: 'inventory' as const, entityId: p.itemId, version: 1, value: { kind: 'item' as const, name, category: 'gadget' as const, rarity: 1 as const, description: '正文明确获得的物品；类别暂按道具归档，未推测效果或品质。', quantity: 0, status: 'owned' as const } } : null;
      if (!item) throw Error('物品尚未可靠建立。');
      if (item.value.kind !== 'item') throw Error('这不是库存物品。');
      const quantity = item.value.quantity + (p.action === 'gain' ? p.quantity : -p.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw Error('库存数量不足或超出安全范围。');
      if ((p.action === 'give' || p.action === 'transfer') && (!p.recipientId || !state.records.some(r => (r.domain === 'npc' || r.domain === 'traveler') && r.entityId === p.recipientId))) throw Error('交付对象未唯一确定。');
      item.value.quantity = quantity; item.value.status = quantity ? 'owned' : 'depleted'; ctx.put(item);
    } else if (p?.kind === 'currency') {
      const wallet = state.records.find(r => r.domain === 'inventory' && r.value.kind === 'wallet');
      if (!wallet || wallet.domain !== 'inventory' || wallet.value.kind !== 'wallet') throw Error('摩拉账户缺失。');
      const record = structuredClone(wallet), mora = wallet.value.mora + p.delta;
      if (record.value.kind !== 'wallet' || !Number.isSafeInteger(mora) || mora < 0) throw Error('摩拉不足或数值无效。');
      record.value.mora = mora; ctx.put(record);
    } else if (p?.kind === 'time' || p?.kind === 'location' || p?.kind === 'weather') applyWorldRule(ctx, p, candidate!.evidenceRefs.map(r => r.quote).join('\n'), 每日同行好感加成);
    else if (p?.kind === 'quest') {
      const existing = state.records.find(row => row.domain === 'quest' && row.entityId === p.questId);
      const quest = existing ? ctx.get('quest', p.questId) : createCoreQuestBaseline(candidate!, state, ctx.get('world').value.moment.turn);
      if (!quest) throw Error('任务尚未可靠建立。');
      for (const id of policy.questPrerequisites?.[p.questId] ?? []) if (ctx.get('quest', id).value.status !== 'completed') throw Error('任务前置未完成。');
      if (p.action === 'complete') {
        if (quest.value.status !== 'active' || quest.value.objectives.some(o => !o.completed || o.currentCount < o.targetCount)) throw Error('任务目标还没有全部完成。');
        quest.value.status = 'completed'; quest.value.completedAtTurn = ctx.get('world').value.moment.turn ?? 0;
      } else if (p.action === 'start') {
        if (quest.value.status !== 'not_started') throw Error('任务不能重复开始。'); quest.value.status = 'active';
      } else if (p.action === 'fail') {
        if (quest.value.status !== 'active') throw Error('任务不在进行中。'); quest.value.status = 'failed';
      } else {
        const objective = quest.value.objectives.find(o => o.id === p.objectiveId);
        if (quest.value.status !== 'active' || !objective || !Number.isSafeInteger(p.amount) || p.amount! <= 0) throw Error('任务目标或进度量无效。');
        objective.currentCount = Math.min(objective.targetCount, objective.currentCount + p.amount!); objective.completed = objective.currentCount >= objective.targetCount;
      }
      quest.value.updatedAt = ctx.get('world').value.moment.turn ?? 0; ctx.put(quest);
    } else if (p?.kind === 'story') {
      applyCoreStoryRule(ctx, candidate!, policy);
    } else if (p?.kind === 'experience') {
      const problem = sharedExperienceProblem(candidate!, state);
      if (problem) throw Error(problem);
      // Evidence is the change: no invented inventory, affinity, or elapsed time.
    } else if (p?.kind === 'commitment') {
      if (!p.text.trim() || !p.participantIds.every(id => state.records.some(r => (r.domain === 'npc' || r.domain === 'traveler') && r.entityId === id))) throw Error('约定参与者或内容不完整。');
      if (p.action === 'create') {
        const proof = candidate!.evidenceRefs.map(ref => ref.quote).join('\n');
        if (!proof.includes(p.text)) throw Error('约定内容不在明确引用里。');
        const dateTrigger = dateTriggerFromText(p.text, ctx.get('world').value.moment);
        if (!p.trigger && !dateTrigger) throw Error('约定履行条件尚不清楚，需要待确认。');
        if (dateTrigger) ctx.normalizedFact = { ...p, trigger: p.trigger ?? dateTrigger };
        if (p.trigger?.kind === 'date' && stableJson(p.trigger) !== stableJson(dateTrigger)) throw Error('约定日期与原文不一致。');
        if (p.trigger?.kind === 'location') {
          const location = ctx.get('map', p.trigger.locationId);
          if (!p.text.includes(location.value.name) || !/抵达|到达|来到|返回/u.test(p.text)) throw Error('约定地点条件没有明确依据。');
        }
        if (p.trigger?.kind === 'event') {
          if (p.trigger.eventType !== 'quest.complete' || !p.trigger.targetId) throw Error('尚未注册该类事件约定条件。');
          const quest = ctx.get('quest', p.trigger.targetId);
          if (!p.text.includes(quest.value.title) || !/完成/u.test(p.text)) throw Error('约定任务条件不明确。');
        }
      }
      // M01 projects the commitment skeleton with the event, in the same core commit.
    } else if (candidate) applyCharacterRule(ctx, candidate, policy);
    else throw Error('未注册的操作。');
    const operationId = source?.operationId ?? candidate!.operationId;
    const evidenceRefs = candidate?.evidenceRefs ?? source!.blocks.map(b => ({ ref: source!.ref, blockId: b.blockId, start: 0, end: b.text.length, quote: b.text }));
    const afterWorld = ctx.changes.find(c => c.after?.domain === 'world')?.after;
    const world = afterWorld?.domain === 'world' ? afterWorld : ctx.get('world');
    const occurredMoment = { ...structuredClone(world.value.moment), settlementId: operationId };
    const actorIds = candidate?.actors ?? [ctx.get('traveler').entityId];
    const targetIds = [...new Set([...(candidate?.targets ?? []), ...ctx.changes.map(c => c.ref.entityId), ...(p?.kind === 'commitment' ? p.participantIds : [])])];
    const type = p ? `${p.kind}${'action' in p ? `.${p.action}` : ''}` : action.kind === 'player' ? `player.${action.command.type}` : 'unknown';
    const eventDraft: EventDraft = { eventId: `event:${action.actionId}`, journeyId: scope.journeyId, branchId: scope.branchId, operationId, turn: occurredMoment.turn ?? 0, type, actorIds, targetIds, evidenceRefs: structuredClone(evidenceRefs), occurredMoment, ruleVersion: policy.ruleVersion, committedChanges: ctx.changes, visibility: { kind: source ? 'private' : 'participants', npcIds: actorIds.filter(id => state.records.some(r => r.domain === 'npc' && r.entityId === id)) }, recordedAt: source?.createdAt ?? 0 };
    if (p) eventDraft.fact = structuredClone(ctx.normalizedFact ?? p);
    const cardChange = ctx.changes.find(change => change.after?.domain === 'doudizhu');
    const finished = cardChange?.after?.domain === 'doudizhu' ? cardChange.after.value.currentGame : null;
    const previousGame = cardChange?.before?.domain === 'doudizhu' ? cardChange.before.value.currentGame : null;
    if (source && finished?.phase === 'finished' && finished.result && finished.settled && previousGame && !previousGame.settled) {
      const player = ctx.get('traveler'), people = finished.npcIds.map(id => ctx.get('npc', id));
      eventDraft.type = 'game.doudizhu.completed'; eventDraft.actorIds = [player.entityId, ...finished.npcIds];
      eventDraft.visibility = { kind: 'participants', npcIds: [...finished.npcIds] };
      eventDraft.fact = { kind: 'experience', participantIds: [...eventDraft.actorIds], description: `${player.value.姓名}与${people.map(row => row.value.姓名).join('、')}完成一局斗地主；${finished.result.winningSide === 'landlord' ? '地主' : '农民'}方获胜，双方同伴各获得最多5点好感。` };
    }
    if (action.kind === 'player' && action.command.type === 'correct_event') eventDraft.correctionOf = action.command.originalEventId;
    if (!validateCoreDto('eventDraft', eventDraft).ok) throw Error('规则事件格式无效。');
    return { ok: true, changes: ctx.changes, eventDrafts: [eventDraft], readSet: [...ctx.readSet.values()] };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '领域规则执行失败。' }; }
}
export function applyCoreGroups(state: CoreSnapshot, groups: ActionGroup[], policy: CoreRulePolicy): { state: CoreSnapshot; changes: StateChange[]; events: EventDraft[]; pending: ActionGroup[]; readSet: RecordRef[] } {
  let projection = structuredClone(state);
  const changes: StateChange[] = [], events: EventDraft[] = [], pending: ActionGroup[] = [];
  const reads = new Map<string, RecordRef>();
  for (const group of groups) {
    if (group.status === 'pending') { pending.push(structuredClone(group)); continue; }
    let tentative = projection;
    const localChanges: StateChange[] = [], localEvents: EventDraft[] = [];
    const localReads: RecordRef[] = [];
    const fixedWinners = new Map<string, { actionId: string; delta: number }>();
    for (const action of group.actions) if (action.kind === 'narrative' && action.candidate.proposal.kind === 'relationship') {
      const delta = policy.fixedAffinity?.(action.candidate, projection) ?? fixedCoreAffinity(action.candidate, projection);
      if (delta !== undefined) {
        const id = action.candidate.proposal.npcId, previous = fixedWinners.get(id);
        if (!previous || delta > previous.delta) fixedWinners.set(id, { actionId: action.actionId, delta });
      }
    }
    let reason: string | undefined;
    for (const action of group.actions) {
      const effectivePolicy = { ...policy, fixedAffinity: (candidate: FactCandidate, snapshot: CoreSnapshot) => {
        if (candidate.proposal.kind !== 'relationship') return policy.fixedAffinity?.(candidate, snapshot);
        const winner = fixedWinners.get(candidate.proposal.npcId);
        if (!winner) return policy.fixedAffinity?.(candidate, snapshot);
        if (action.actionId === winner.actionId) return winner.delta;
        const fixed = policy.fixedAffinity?.(candidate, snapshot) ?? fixedCoreAffinity(candidate, snapshot);
        if (fixed !== undefined) return 0;
        const winningAction = group.actions.find(a => a.actionId === winner.actionId);
        if (winningAction?.kind === 'narrative' && candidate.evidenceRefs.some(a => winningAction.candidate.evidenceRefs.some(b => a.ref.sourceId === b.ref.sourceId && a.ref.sourceVersion === b.ref.sourceVersion && a.blockId === b.blockId && a.start < b.end && b.start < a.end))) return 0;
        return undefined;
      } };
      const result = applyCoreAction(tentative, action, effectivePolicy);
      if (!result.ok) { reason = result.reason; break; }
      tentative = projectChanges(tentative, result.changes); localChanges.push(...result.changes); localEvents.push(...result.eventDrafts);
      localReads.push(...result.readSet);
    }
    if (reason) pending.push({ ...structuredClone(group), status: 'pending', reason });
    else {
      projection = tentative; changes.push(...localChanges); events.push(...localEvents);
      for (const ref of localReads) {
        const key = `${ref.domain}:${ref.entityId}`;
        if (!reads.has(key)) reads.set(key, { ...ref, version: state.records.find(r => r.domain === ref.domain && r.entityId === ref.entityId)?.version ?? state.tombstones?.find(r => r.domain === ref.domain && r.entityId === ref.entityId)?.version ?? 0 });
      }
    }
  }
  return { state: projection, changes, events, pending, readSet: [...reads.values()] };
}
