import { describe, expect, it } from 'vitest';
import { applyCoreAction, applyCoreGroups, type CoreRulePolicy } from '@/core/settlement/domainRules';
import { buildCoreActions, type CoreAction } from '@/core/settlement/actions';
import type { CoreSnapshot, FactProposal } from '@/core/contracts/state';
import { makeCandidate, makeSeed, makeSource } from './fixtures';
import { 每日同行好感加成 } from '@/utils/gameplayRules';
import { reviewCoreFacts } from '@/core/settlement/evidenceReview';

const policy: CoreRulePolicy = { ruleVersion: 'test-1', storyNodes: [{ seriesId: 'mondstadt', chapterId: 'chapter-2', nodeId: 'node-2', prerequisites: ['node-1'] }] };
function fixture(text = '安柏把两枚苹果放入玩家背包。', proposal: FactProposal = { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 2 }) {
  const seed = makeSeed();
  const source = makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'body', kind: 'narration', text }] });
  const candidate = makeCandidate({ scope: source.scope, operationId: source.operationId, kind: proposal.kind, proposal, status: 'verified', evidenceRefs: [{ ref: source.ref, blockId: 'body', start: 0, end: text.length, quote: text }] });
  const state: CoreSnapshot = { head: seed.head, records: seed.records, contentRefs: [] };
  const built = buildCoreActions({ verified: [candidate], pending: [], rejected: [], disputed: [] }, state);
  return { state, candidate, source, action: built.groups[0]!.actions[0]! };
}
describe('core2 pure deterministic domain rules', () => {
  it('gains and consumes exactly, never goes negative and never mutates input', () => {
    const { state, action } = fixture();
    const before = structuredClone(state);
    const result = applyCoreAction(state, action, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes[0]?.after?.value).toMatchObject({ quantity: 3 });
    expect(state).toEqual(before);
    const invalid = fixture('玩家吃下十二枚苹果。', { kind: 'inventory', action: 'consume', itemId: 'apple', quantity: 12 });
    expect(applyCoreAction(invalid.state, invalid.action, policy).ok).toBe(false);
  });
  it('does not accept a forged verified candidate with a missing citation or a different operation', () => {
    const { state, action } = fixture();
    const forged = structuredClone(action);
    if (forged.kind !== 'narrative') throw Error('fixture');
    forged.candidate.evidenceRefs = [];
    expect(applyCoreAction(state, forged, policy).ok).toBe(false);
    const raw = fixture().candidate;
    raw.status = 'proposed';
    expect(buildCoreActions({ verified: [raw], pending: [], rejected: [], disputed: [] }, state).groups).toEqual([]);
  });
  it('accumulates three days and two hours, rejects only settling the last span and same-day regression', () => {
    const { state, action } = fixture('三天后，两个小时后，队伍到达城门。', { kind: 'time', elapsedMinutes: 4440 });
    const result = applyCoreAction(state, action, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changes.find(c => c.after?.domain === 'world')?.after?.value).toMatchObject({ moment: { date: '旅行历 1000.03.10', clock: '12:00', travelDay: 4 } });
    const wrong = fixture('三天后，两个小时后，队伍到达城门。', { kind: 'time', elapsedMinutes: 120 });
    expect(applyCoreAction(wrong.state, wrong.action, policy).ok).toBe(false);
    const backwards = fixture('现在是上午09:00。', { kind: 'time', elapsedMinutes: 0, clock: '09:00' });
    expect(applyCoreAction(backwards.state, backwards.action, policy).ok).toBe(false);
  });
  it('uses ordered team projection for daily travel rewards; an earlier departure is not rewarded', () => {
    const { state, candidate } = fixture('安柏离开了队伍。一天后，玩家抵达城门。', { kind: 'npc', npcId: 'npc-amber', name: '安柏', action: 'leave' });
    const leaveEnd = '安柏离开了队伍。'.length;
    candidate.evidenceRefs[0]!.end = leaveEnd; candidate.evidenceRefs[0]!.quote = '安柏离开了队伍。';
    const time = structuredClone(candidate); time.candidateId = 'time'; time.kind = 'time'; time.proposal = { kind: 'time', elapsedMinutes: 1440 }; time.evidenceRefs[0] = { ...time.evidenceRefs[0]!, start: leaveEnd, end: leaveEnd + 4, quote: '一天后，' };
    const groups = buildCoreActions({ verified: [time, candidate], pending: [], disputed: [], rejected: [] }, state).groups;
    const result = applyCoreGroups(state, groups, policy);
    expect(result.pending).toEqual([]);
    expect(result.state.records.find(r => r.domain === 'npc')?.value).toMatchObject({ travelingTogether: false, affinity: 10 });
  });
  it('blocks premature quest completion and unknown or premature story nodes; derives chapter from the valid resource', () => {
    const quest = fixture('任务已经完成。', { kind: 'quest', questId: 'quest-1', action: 'complete' });
    const record = quest.state.records.find(r => r.domain === 'quest')!;
    if (record.domain === 'quest') record.value.objectives = [{ id: 'o', type: 'collect', description: '', targetCount: 2, currentCount: 1, completed: false }];
    expect(applyCoreAction(quest.state, quest.action, policy).ok).toBe(false);
    const story = fixture('主线推进到新节点。', { kind: 'story', seriesId: 'mondstadt', chapterId: 'model-wrong', nodeId: 'node-2' });
    expect(applyCoreAction(story.state, story.action, policy).ok).toBe(false);
    const current = story.state.records.find(r => r.domain === 'story')!;
    if (current.domain === 'story') current.value.completedNodeIds = ['node-1'];
    const result = applyCoreAction(story.state, story.action, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changes[0]?.after?.value).toMatchObject({ chapterId: 'chapter-2', nodeId: 'node-2' });
    if (story.action.kind === 'narrative' && story.action.candidate.proposal.kind === 'story') story.action.candidate.proposal.nodeId = 'not-a-resource';
    expect(applyCoreAction(story.state, story.action, policy).ok).toBe(false);
  });

  it('records explicit completion of the active story node and refuses completing an unrelated or merely ongoing node', () => {
    const completed = fixture('当前主线节点已经完成。', { kind: 'story', action: 'complete', seriesId: 'mondstadt', chapterId: 'chapter-2', nodeId: 'node-2' });
    const story = completed.state.records.find(row => row.domain === 'story')!;
    if (story.domain !== 'story') throw Error('fixture');
    story.value = { seriesId: 'mondstadt', chapterId: 'chapter-2', nodeId: 'node-2', status: 'progressing', completedNodeIds: ['node-1'] };
    const result = applyCoreAction(completed.state, completed.action, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changes.find(row => row.ref.domain === 'story')?.after?.value).toMatchObject({ completedNodeIds: ['node-1', 'node-2'], status: 'completed' });
    story.value.nodeId = 'node-1';
    expect(applyCoreAction(completed.state, completed.action, policy).ok).toBe(false);
    story.value.nodeId = 'node-2';
    const ambiguous = fixture('当前主线节点仍在进行。', { kind: 'story', action: 'complete', seriesId: 'mondstadt', chapterId: 'chapter-2', nodeId: 'node-2' });
    const other = ambiguous.state.records.find(row => row.domain === 'story')!;
    if (other.domain === 'story') other.value = structuredClone(story.value);
    expect(applyCoreAction(ambiguous.state, ambiguous.action, policy).ok).toBe(false);
  });
  it('never enables an unawakened elemental talent or creates an unknown talent', () => {
    const { state, action } = fixture('学会风元素技能。', { kind: 'talent', talentId: 'anemo-skill', element: 'anemo', level: 1 });
    const talents: CoreRulePolicy = { ...policy, talents: [{ id: 'anemo-skill', 名称: '风涡剑', 类别: 'elemental_skill', 关联元素: 'anemo', 等级: 1, 说明: '' }] };
    expect(applyCoreAction(state, action, talents).ok).toBe(false);
    const traveler = state.records.find(r => r.domain === 'traveler')!;
    if (traveler.domain === 'traveler') traveler.value.元素共鸣 = [{ element: 'anemo', source: 'traveler_resonance', mastery: 0, unlocked: true, unlockedAt: '', notes: '' }];
    expect(applyCoreAction(state, action, talents).ok).toBe(true);
    expect(applyCoreAction(state, action, policy).ok).toBe(false);
  });
  it('keeps independent weather while failing an atomic inventory/relationship group', () => {
    const { state, candidate } = fixture('玩家给安柏十二枚苹果，安柏好感提升，天气转晴。', { kind: 'inventory', action: 'give', itemId: 'apple', quantity: 12, recipientId: 'npc-amber' });
    const affinity = structuredClone(candidate); affinity.candidateId = 'affinity'; affinity.kind = 'relationship'; affinity.proposal = { kind: 'relationship', npcId: 'npc-amber', affinityDelta: 5 };
    const weather = structuredClone(candidate); weather.candidateId = 'weather'; weather.kind = 'weather'; weather.proposal = { kind: 'weather', weather: '晴' };
    const groups = buildCoreActions({ verified: [candidate, affinity, weather], pending: [], disputed: [], rejected: [] }, state).groups;
    const result = applyCoreGroups(state, groups, policy);
    expect(result.pending).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('weather');
    expect(result.state.records.find(r => r.domain === 'npc')?.value).toMatchObject({ affinity: 10 });
  });
  it('requires a real manual source and locks canonical names without granting model manual permissions', () => {
    const { state, source } = fixture();
    const action: CoreAction = { kind: 'player', actionId: 'edit', source, command: { type: 'edit_npc', npcId: 'npc-amber', field: '姓名', value: '新名字' } };
    expect(applyCoreAction(state, action, policy).ok).toBe(false);
    action.source = { ...source, kind: 'manual', blocks: [{ blockId: 'command', kind: 'configuration', text: JSON.stringify(action.command) }] };
    expect(applyCoreAction(state, action, policy).ok).toBe(false);
    action.command = { type: 'edit_npc', npcId: 'npc-amber', field: 'appearance', value: '红棕色头发' };
    action.source.blocks[0]!.text = JSON.stringify(action.command);
    expect(applyCoreAction(state, action, policy).ok).toBe(true);
  });
  it('does not stack model daily reward proposals with the host cross-day reward', () => {
    const { state, candidate } = fixture('一天后，安柏获得每日同行奖励，好感提升10点。', { kind: 'time', elapsedMinutes: 1440 });
    const relation = structuredClone(candidate); relation.candidateId = 'relation'; relation.kind = 'relationship'; relation.proposal = { kind: 'relationship', npcId: 'npc-amber', affinityDelta: 10 };
    const groups = buildCoreActions({ verified: [candidate, relation], pending: [], disputed: [], rejected: [] }, state).groups;
    const result = applyCoreGroups(state, groups, policy);
    expect(result.pending).toEqual([]);
    expect(result.state.records.find(r => r.domain === 'npc')?.value).toMatchObject({ affinity: 10 + 每日同行好感加成 });
  });
  it('uses the existing fixed interaction reward once instead of the model’s invented number', () => {
    const { state, action } = fixture('安柏亲吻了云。', { kind: 'relationship', npcId: 'npc-amber', affinityDelta: 99 });
    const result = applyCoreAction(state, action, policy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changes[0]?.after?.value).toMatchObject({ affinity: 15 });
      expect(result.eventDrafts[0]?.fact).toMatchObject({ kind: 'relationship', affinityDelta: 5 });
    }
  });
  it('rejects wallet overdraw, missing progression policy and invalid health while keeping valid experience', () => {
    const money = fixture('玩家花了三枚摩拉。', { kind: 'currency', delta: -3 });
    money.state.records.push({ scope: money.state.head.scope, domain: 'inventory', entityId: 'wallet', version: 1, value: { kind: 'wallet', mora: 2 } });
    expect(applyCoreAction(money.state, money.action, policy).ok).toBe(false);
    const health = fixture('生命恢复到了200。', { kind: 'traveler', field: 'health', value: 200 });
    expect(applyCoreAction(health.state, health.action, policy).ok).toBe(false);
    const level = fixture('玩家升级到2级。', { kind: 'traveler', field: 'level', value: 2 });
    expect(applyCoreAction(level.state, level.action, policy).ok).toBe(false);
    const experience = fixture('玩家的经验达到了20。', { kind: 'traveler', field: 'experience', value: 20 });
    expect(applyCoreAction(experience.state, experience.action, policy).ok).toBe(true);
  });
  it('marks both new and restored archive state without changing identity and prevents arbitrary manual fields', () => {
    const { state, source } = fixture();
    const command = { type: 'edit_npc' as const, npcId: 'npc-amber', field: 'archived' as const, value: true };
    const action: CoreAction = { kind: 'player', actionId: 'archive', command, source: { ...source, kind: 'manual', blocks: [{ blockId: 'c', kind: 'configuration', text: JSON.stringify(command) }] } };
    const result = applyCoreAction(state, action, policy);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changes[0]?.after).toMatchObject({ entityId: 'npc-amber', value: { archived: true } });
    const hostile = structuredClone(action) as unknown as CoreAction;
    if (hostile.kind !== 'player' || hostile.command.type !== 'edit_npc') throw Error('fixture');
    Object.assign(hostile.command, { field: 'id', value: 'another' }); hostile.source.blocks[0]!.text = JSON.stringify(hostile.command);
    expect(applyCoreAction(state, hostile, policy).ok).toBe(false);
  });
  it('uses source block order, not alphabetic IDs or model response order, for a departure before midnight', () => {
    const { state, source, candidate } = fixture('安柏离开了队伍。', { kind: 'npc', npcId: 'npc-amber', name: '安柏', action: 'leave' });
    source.blocks = [{ blockId: 'z-first', kind: 'narration', text: '安柏离开了队伍。' }, { blockId: 'a-last', kind: 'narration', text: '一天后，玩家抵达城门。' }];
    candidate.evidenceRefs[0] = { ref: source.ref, blockId: 'z-first', start: 0, end: 8, quote: '安柏离开了队伍。' }; candidate.status = 'proposed';
    const time = structuredClone(candidate); time.candidateId = 'time'; time.kind = 'time'; time.actors = []; time.proposal = { kind: 'time', elapsedMinutes: 1440 }; time.evidenceRefs[0] = { ref: source.ref, blockId: 'a-last', start: 0, end: 11, quote: '一天后，玩家抵达城门。' };
    const review = reviewCoreFacts({ candidates: [time, candidate], sources: [source], snapshot: state, policy: {} });
    const result = applyCoreGroups(state, buildCoreActions(review, state).groups, policy);
    expect(result.pending).toEqual([]);
    expect(result.state.records.find(r => r.domain === 'npc')?.value).toMatchObject({ affinity: 10, travelingTogether: false });
  });
  it('awards the highest fixed interaction tier only once for one character in the same operation', () => {
    const { state, candidate } = fixture('安柏亲吻了云。随后安柏牵起了云的手。', { kind: 'relationship', npcId: 'npc-amber', affinityDelta: 80 });
    const kiss = structuredClone(candidate); kiss.evidenceRefs[0]!.end = 7; kiss.evidenceRefs[0]!.quote = '安柏亲吻了云。';
    const touch = structuredClone(candidate); touch.candidateId = 'touch'; touch.evidenceRefs[0]!.start = 7; touch.evidenceRefs[0]!.quote = '随后安柏牵起了云的手。';
    const result = applyCoreGroups(state, buildCoreActions({ verified: [touch, kiss], pending: [], disputed: [], rejected: [] }, state).groups, policy);
    expect(result.pending).toEqual([]);
    expect(result.state.records.find(r => r.domain === 'npc')?.value).toMatchObject({ affinity: 15 });
  });
});
