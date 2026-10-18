import type { FactCandidate } from '../contracts/event';
import type { NpcState } from '../contracts/state';
import { RuleContext } from './ruleContext';
import type { CoreRulePolicy } from './domainRules';
import { 格式化NPC关系, 限制NPC好感度 } from '@/models/npc';
import { coreIntimacyMatch, fixedCoreAffinity } from './relationshipRules';

export function applyCharacterRule(ctx: RuleContext, candidate: FactCandidate, policy: CoreRulePolicy): void {
  const p = candidate.proposal;
  if (p.kind === 'npc') {
    if (p.action === 'meet' && !ctx.state.records.some(r => r.domain === 'npc' && r.entityId === p.npcId)) {
      const value: NpcState | undefined = policy.createNpc?.(candidate, ctx.state);
      if (!value || value.id !== p.npcId || value.姓名 !== p.name) throw Error('新人物需要宿主审核后的建档资料。');
      ctx.put({ scope: ctx.state.head.scope, domain: 'npc', entityId: value.id, version: 1, value }); return;
    }
    const npc = ctx.get('npc', p.npcId);
    if (p.name !== npc.value.姓名 && !npc.value.aliases.includes(p.name)) throw Error('人物姓名与 ID 不相符。');
    if (p.action === 'join') npc.value.travelingTogether = true;
    if (p.action === 'leave') npc.value.travelingTogether = false;
    const turn = ctx.get('world').value.moment.turn;
    if (turn !== null) npc.value.lastSeenTurn = turn;
    ctx.put(npc);
  } else if (p.kind === 'relationship') {
    const npc = ctx.get('npc', p.npcId);
    const delta = policy.fixedAffinity?.(candidate, ctx.state) ?? fixedCoreAffinity(candidate, ctx.state) ?? p.affinityDelta;
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) throw Error('好感变化必须是确定整数。');
    npc.value.affinity = 限制NPC好感度(npc.value.affinity + delta);
    ctx.normalizedFact = { ...p, affinityDelta: npc.value.affinity - ctx.get('npc', p.npcId).value.affinity };
    npc.value.relationship = p.relationship ?? 格式化NPC关系(npc.value.affinity, npc.value.intimate);
    if (npc.value.gender === '女' && coreIntimacyMatch(candidate, ctx.state)?.tier === 'sex') {
      const archive = npc.value.matureArchive ?? { preferences: [], sensitivePoints: [], taboos: [], tags: [], femaleBodyProfile: {}, maleBodyProfile: {}, partImages: {} };
      const partner = archive.firstSexualPartner?.trim();
      // A confirmed occurrence is not permission to replace an already known first partner.
      if (!archive.firstSexualPartnerRef && (!partner || partner === '无') && !archive.firstSexualPartnerSource) {
        delete archive.firstSexualPartner; archive.firstSexualPartnerRef = 'player';
        archive.firstSexualPartnerSource = 'narrative'; archive.firstSexualPartnerTurn = ctx.get('world').value.moment.turn;
      }
      archive.virginityStatus = 'not_virgin'; npc.value.matureArchive = archive;
    }
    ctx.put(npc);
  } else if (p.kind === 'profile') {
    const npc = ctx.get('npc', p.npcId);
    if (['appearance', 'clothing', 'personality'].includes(p.field)) throw Error('角色基础资料已固定；请在同伴档案中明确手动编辑，不由剧情自动改写。');
    npc.value[p.field] = p.value; ctx.put(npc);
  } else if (p.kind === 'traveler') {
    const traveler = ctx.get('traveler');
    if (!Number.isSafeInteger(p.value) || p.value < 0) throw Error('旅人数值无效。');
    if (p.field === 'level' && !policy.allowLevel?.(traveler.value, p.value)) throw Error('等级变化尚未通过既有成长规则。');
    if (p.field === 'health' && p.value > (policy.maximumHealth ?? 100)) throw Error('生命超过上限。');
    traveler.value[p.field] = p.value; ctx.put(traveler);
  } else if (p.kind === 'element') {
    const traveler = ctx.get('traveler');
    const attunement = traveler.value.元素共鸣.find(a => a.element === p.element);
    if (attunement) attunement.unlocked = p.unlocked;
    else if (p.unlocked) traveler.value.元素共鸣.push({ element: p.element, source: 'traveler_resonance', mastery: 0, unlocked: true, unlockedAt: ctx.get('world').value.moment.date ?? '', notes: '' });
    if (!p.unlocked) { traveler.value.天赋 = traveler.value.天赋.filter(t => t.关联元素 !== p.element); if (traveler.value.主元素 === p.element) traveler.value.主元素 = ''; }
    ctx.put(traveler);
  } else if (p.kind === 'talent') {
    const traveler = ctx.get('traveler');
    if (p.element && !traveler.value.元素共鸣.some(a => a.element === p.element && a.unlocked)) throw Error('未觉醒相关元素，不能装备天赋。');
    const template = policy.talents?.find(t => t.id === p.talentId);
    if (!template || template.关联元素 !== p.element || !Number.isInteger(p.level) || p.level < 1 || p.level > 20) throw Error('天赋资源、元素或等级无效。');
    const talent = { ...structuredClone(template), 等级: p.level };
    traveler.value.天赋 = [...traveler.value.天赋.filter(t => t.id !== talent.id), talent]; ctx.put(traveler);
  } else throw Error('未注册的人物规则。');
}
