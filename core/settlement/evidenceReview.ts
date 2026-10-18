import type { FactCandidate, SourceRecord } from '../contracts/event';
import type { CoreSnapshot, NpcState, StateRecord } from '../contracts/state';
import { validateCoreDto } from '../contracts/validation';
import { validateEvidence } from '../sources/sourceRecords';
import { coreEntityNames, coreEntityNamePattern, resolveCoreEntity } from './entityResolution';
import { parseNarrativeNumber } from '@/utils/narrativeNumbers';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';
import { sharedExperienceProblem } from './sharedExperience';
import { hasCoreStoryCompletionEvidence } from './storyRules';
import { normalizeCoreRegistration, coreNewItemName, coreQuestDefinitionProblem } from './resourceRegistration';
import { provenCoreMoraDelta } from './currencyEvidence';
import { coreIntimacyMatch, fixedCoreAffinity } from './relationshipRules';

export interface FactReviewPolicy { check?: (candidate: FactCandidate, snapshot: CoreSnapshot) => string | null }
export interface FactReviewInput { candidates: FactCandidate[]; sources: SourceRecord[]; snapshot: CoreSnapshot; policy: FactReviewPolicy }
export interface FactReviewResult { verified: FactCandidate[]; pending: FactCandidate[]; disputed: FactCandidate[]; rejected: FactCandidate[]; sourceOrder?: string[] }
const unrealized = /(?:如果|假如|倘若|要是|假设|可能|或许|也许|打算|准备|计划|想要|试图|没有|并未|未曾|不曾|尚未|拒绝|明天|将会|回忆|曾经|曾送)/u;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Include complete containing sentences, so quoting after “没有” cannot evade review. */
export function evidenceContext(candidate: FactCandidate, sources: SourceRecord[]): string {
  return candidate.evidenceRefs.map(ref => {
    const source = sources.find(s => s.ref.sourceId === ref.ref.sourceId && s.ref.sourceVersion === ref.ref.sourceVersion);
    const text = source?.blocks.find(block => block.blockId === ref.blockId)?.text ?? '';
    let start = ref.start, end = ref.end;
    while (start > 0 && !/[。！？!?；;\n]/u.test(text[start - 1]!)) start--;
    while (end < text.length && !/[。！？!?；;\n]/u.test(text[end - 1]!)) end++;
    return text.slice(start, end);
  }).join('\n');
}
function reviewOne(candidate: FactCandidate, input: FactReviewInput): { status: 'verified' | 'pending' | 'disputed' | 'rejected'; reason: string } {
  const stop = (status: 'pending' | 'disputed' | 'rejected', reason: string) => ({ status, reason });
  const { snapshot, sources } = input;
  if (!validateCoreDto('candidate', candidate).ok || candidate.scope.journeyId !== snapshot.head.scope.journeyId || candidate.scope.branchId !== snapshot.head.scope.branchId) return stop('rejected', '候选格式或存档范围不相符。');
  for (const ref of candidate.evidenceRefs) {
    const matches = sources.filter(s => s.ref.sourceId === ref.ref.sourceId && s.ref.sourceVersion === ref.ref.sourceVersion);
    if (matches.length !== 1) return stop('rejected', '证据来源缺失或重复。');
    const source = matches[0]!;
    if (!validateEvidence(ref, source).ok || source.operationId !== candidate.operationId || source.scope.journeyId !== candidate.scope.journeyId || source.scope.branchId !== candidate.scope.branchId) return stop('rejected', '证据位置、版本或操作归属不相符。');
    if (source.kind !== 'narrative') return stop('pending', '玩家意图、手机说法或系统文字需要专门的操作权限，不能直接成为世界事实。');
  }
  const text = evidenceContext(candidate, sources);
  const proposal = candidate.proposal;
  const formedPromise = proposal.kind === 'commitment' && proposal.action === 'create' && /约定|承诺|答应/u.test(text)
    && !/(?:没有|并未|准备|打算|回忆|曾经|假如|可能)/u.test(text);
  if (unrealized.test(text) && !formedPromise) return stop('pending', '引用含否定、计划、推测或回忆，不能证明本次已经完成。');
  if (!candidate.actors.length && !['weather', 'time'].includes(proposal.kind)) return stop('pending', '高影响变化必须明确行动主体。');
  for (const actor of candidate.actors) {
    const record = snapshot.records.find((r): r is StateRecord<'npc' | 'traveler'> => (r.domain === 'npc' || r.domain === 'traveler') && r.entityId === actor);
    if (!record) {
      if (proposal.kind === 'npc' && proposal.action === 'meet' && actor === proposal.npcId && resolveCoreEntity({ name: proposal.name, evidenceRefs: candidate.evidenceRefs, sources }, snapshot).kind === 'new') continue;
      return stop('pending', '行动主体未唯一定位。');
    }
    const speaker = candidate.evidenceRefs.some(ref => sources.some(s => s.ref.sourceId === ref.ref.sourceId && s.ref.sourceVersion === ref.ref.sourceVersion && s.blocks.some(b => b.blockId === ref.blockId && b.speakerId === actor)));
    const names = coreEntityNamePattern(record, snapshot) + (record.domain === 'traveler' ? '|玩家|你|我' : '');
    if (!speaker && !new RegExp(names, 'iu').test(text)) return stop('rejected', '原文没有指向所提议的行动主体。');
  }
  const targetNpc = 'npcId' in proposal ? snapshot.records.find((r): r is StateRecord<'npc'> => r.domain === 'npc' && r.entityId === proposal.npcId) : undefined;
  if ('npcId' in proposal && !targetNpc) {
    if (proposal.kind !== 'npc' || proposal.action !== 'meet') return stop('pending', '目标人物尚未可靠建档。');
    const resolution = resolveCoreEntity({ id: proposal.npcId, name: proposal.name, evidenceRefs: candidate.evidenceRefs, sources }, snapshot);
    if (resolution.kind !== 'new') return stop(resolution.kind === 'rejected' ? 'rejected' : 'pending', resolution.kind === 'matched' ? '请使用已存在的人物 ID。' : resolution.reason);
  }
  if (targetNpc && !new RegExp(coreEntityNamePattern(targetNpc, snapshot), 'iu').test(text)) return stop('rejected', '证据未指向目标人物。');
  if (proposal.kind === 'experience') {
    if (candidate.evidenceRefs.some(ref => sources.some(source => source.ref.sourceId === ref.ref.sourceId && source.blocks.some(block => block.blockId === ref.blockId && block.kind !== 'narration')))) return stop('pending', '人物话语不能直接成为共同经历事实。');
    const problem = sharedExperienceProblem(candidate, snapshot);
    if (problem) return stop('pending', problem);
  } else if (proposal.kind === 'inventory') {
    const item = snapshot.records.find(r => r.domain === 'inventory' && r.entityId === proposal.itemId);
    const itemName = item?.domain === 'inventory' && item.value.kind === 'item' ? item.value.name : coreNewItemName(proposal, snapshot);
    if (!itemName) return stop('pending', '物品缺少可靠名称，或尚未由明确获得事件建立。');
    if (proposal.itemName && proposal.itemName !== itemName) return stop('disputed', '物品名称与已有身份不一致。');
    const amount = text.match(new RegExp(`([零〇一二两三四五六七八九十百千]+|\\d+|几|数)\\s*(?:个|枚|份|瓶|块|件|颗|串|袋|盒)?\\s*${escape(itemName)}`, 'u'))?.[1];
    if (!amount || /几|数/u.test(amount)) return stop('pending', '缺少确定数量，不默认为一件。');
    if (parseNarrativeNumber(amount) !== proposal.quantity) return stop('disputed', '提议数量与正文不相符。');
    const player = snapshot.records.find(r => r.domain === 'traveler');
    const playerNames = ['玩家', '你', ...(player?.domain === 'traveler' ? coreEntityNames(player) : [])].map(escape).join('|');
    if (proposal.action === 'gain' && !new RegExp(`(?:放入|放进|装入|放到)(?:${playerNames})(?:的)?(?:背包|包里)|(?:交给|递给|送给|赠给)(?:${playerNames})|(?:${playerNames})(?:接过|收到|获得|拾取)`, 'u').test(text)) return stop('pending', '没有明确由玩家接收该物品的证据。');
    if (proposal.action !== 'gain') {
      if (/(?:看着|看见|目睹|望着).{0,20}(?:使用|服用|喝下|吃下|吃掉|交给|递给)/u.test(text)) return stop('rejected', '观望他人的行为不能扣除玩家物品。');
      if (!new RegExp(`(?:${playerNames}).{0,20}(?:使用|服用|喝下|吃下|吃掉|交给|递给|赠给|送给|交付|上交|归还|转交)`, 'u').test(text)) return stop('pending', '没有明确由玩家使用或交出该物品的证据。');
    }
  } else if (proposal.kind === 'quest' && !snapshot.records.some(row => row.domain === 'quest' && row.entityId === proposal.questId)) {
    const problem = coreQuestDefinitionProblem(proposal, text);
    if (problem) return stop('pending', problem);
  } else if (proposal.kind === 'npc') {
    const expected = proposal.action === 'leave' ? /离开(?:了)?队伍|退出(?:了)?队伍|不再同行/u : proposal.action === 'join' ? /加入(?:了)?队伍|开始同行|随行/u : /见到|遇见|自我介绍|我叫/u;
    if (!expected.test(text)) return stop('pending', '未发现明确的会面或队伍变化。');
  } else if (proposal.kind === 'relationship') {
    if (proposal.relationship && !text.includes(proposal.relationship)) return stop('pending', '关系称谓变化需要明确双方关系的证据。');
    // Completed, uniquely attributed interactions use the same fixed-affinity rules as settlement.
    // Do not merely add keywords: the existing participant and adult checks must still pass.
    if (!coreIntimacyMatch(candidate, snapshot, text)
      && !/好感|喜欢|感谢|感激|厌恶|愤怒|生气|信任|亲吻|牵手|拥抱/u.test(text)) return stop('pending', '普通表情不足以证明关系数值变化。');
  } else if (proposal.kind === 'story' && proposal.action === 'complete') {
    if (!hasCoreStoryCompletionEvidence(text)) return stop('pending', '节点仍在进行、仅有计划或缺少已完成的明确叙述。');
  } else if (proposal.kind === 'currency') {
    const delta = provenCoreMoraDelta(text, snapshot);
    if (delta === null) return stop('pending', '摩拉变化缺少唯一的玩家收支、方向和确切数量依据。');
    if (delta !== proposal.delta) return stop('disputed', '摩拉收支方向或数量与正文不相符，未自动结算。');
  } else if (proposal.kind === 'profile') {
    const npc: NpcState | undefined = targetNpc?.value;
    if (!npc || !text.includes(proposal.value)) return stop('pending', '档案新值没有明确依据。');
    if (['appearance', 'clothing', 'personality'].includes(proposal.field)) return stop('rejected', '角色基础资料固定，仅允许玩家明确手动编辑；剧情中的临时外观不是基础档案变更。');
  } else {
    const words = { currency: /摩拉/u, traveler: /生命|健康|受伤|恢复|经验|等级|升级/u, time: /分钟|小时|天后|日后|翌日|次日|第二天|\d{1,2}[:：]\d{2}/u, location: /到达|抵达|来到|进入|返回/u, weather: /晴|雨|雪|风|阴|雾|雷/u, quest: /任务|目标|完成|进度/u, commitment: /约定|承诺|答应|赴约|履约|取消/u, element: /觉醒|共鸣|元素/u, talent: /天赋|技能|学会|掌握/u, story: /篇章|章节|主线|剧情|节点/u };
    if (!words[proposal.kind].test(text)) return stop('pending', '缺少该类状态变化的明确依据。');
  }
  const policyReason = input.policy.check?.(candidate, snapshot);
  return policyReason ? stop('rejected', policyReason) : { status: 'verified', reason: '来源、主体、数量及完成语境通过核对；仍须通过领域规则。' };
}
export function reviewCoreFacts(input: FactReviewInput): FactReviewResult {
  const sourceOrder = input.sources.flatMap(source => source.blocks.map(block => JSON.stringify([source.ref.sourceId, source.ref.sourceVersion, block.blockId])));
  const position = (candidate: FactCandidate) => {
    const ref = candidate.evidenceRefs[0];
    return ref ? sourceOrder.indexOf(JSON.stringify([ref.ref.sourceId, ref.ref.sourceVersion, ref.blockId])) : -1;
  };
  const result: FactReviewResult = { verified: [], pending: [], disputed: [], rejected: [], sourceOrder };
  for (const original of [...input.candidates].sort((a, b) => position(a) - position(b) || (a.evidenceRefs[0]?.start ?? 0) - (b.evidenceRefs[0]?.start ?? 0))) {
    const candidate = structuredClone(original);
    const p = candidate.proposal;
    if (validateCoreDto('candidate', candidate).ok) normalizeCoreRegistration(candidate, input.snapshot);
    if (validateCoreDto('candidate', candidate).ok && p.kind === 'npc' && p.action === 'meet') {
      const resolution = resolveCoreEntity({ id: p.npcId, name: p.name, evidenceRefs: candidate.evidenceRefs, sources: input.sources }, input.snapshot);
      const oldId = p.npcId;
      if (resolution.kind === 'matched') p.npcId = resolution.entityId;
      if (resolution.kind === 'new') { p.name = resolution.name; p.npcId = `npc-${checksumUtf8(stableJson([input.snapshot.head.scope, resolution.name]))}`; }
      candidate.actors = candidate.actors.map(id => id === oldId ? p.npcId : id);
      candidate.targets = candidate.targets.map(id => id === oldId ? p.npcId : id);
    }
    const review = reviewOne(candidate, input);
    if (review.status === 'verified' && candidate.proposal.kind === 'relationship') {
      const delta = fixedCoreAffinity(candidate, input.snapshot);
      if (delta !== undefined) candidate.proposal.affinityDelta = delta;
    }
    result[review.status].push({ ...structuredClone(candidate), ...review });
  }
  return result;
}
