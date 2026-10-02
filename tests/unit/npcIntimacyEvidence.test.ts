import { describe, expect, it } from 'vitest';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { deriveNarrativeIntimacyFacts, factsToTeyvatDomainCommands } from '@/utils/variableFacts';
import { detectNpcIntimacyEvent } from '@/utils/npcIntimacyEvidence';

const adult = () => normalizeTeyvatNpcRecords([{
  id: 'npc_amber', 姓名: '安柏', gender: '女',
  matureArchive: { ageConfirmation: 'adult', ageConfirmationSource: 'canonical' },
}])[0]!;
const options = { nsfwEnabled: true, playerName: '云', turn: 7 };

describe('玩家与 NPC 的直接亲密事件证据', () => {
  it('direct_confirmed_event_uses_highest_tier', () => {
    const npc = adult();
    const body = '安柏牵起云的手。随后安柏亲吻了云。';
    expect(detectNpcIntimacyEvent(body, npc, '云')?.tier).toBe('kiss');
    expect(deriveNarrativeIntimacyFacts(body, [npc], options)).toEqual([
      expect.objectContaining({ type: 'npc', id: npc.id, affinityDelta: 5 }),
    ]);
  });

  it.each([
    '安柏看见丽莎亲吻了云。',
    '安柏告诉云，丽莎亲吻了琴。',
    '安柏打算亲吻云。',
    '安柏没有亲吻云。',
    '安柏拒绝了云的亲吻。',
    '安柏梦见自己亲吻了云。',
    '安柏亲吻了琴，云在旁边看着。',
    '安柏与云谈起了曾经的亲吻。',
  ])('third_party_or_uncertain_event_is_ignored: %s', (body) => {
    expect(detectNpcIntimacyEvent(body, adult(), '云')).toBeNull();
    expect(deriveNarrativeIntimacyFacts(body, [adult()], options)).toEqual([]);
  });

  it('requires passing the hard gate even for lower intimacy tiers', () => {
    // 放宽后，年龄未知但未命中硬闸的角色可以正常结算亲密事件；
    // 未成年证据与受保护名单仍然全档位拦截。
    // 注意：detectNpcIntimacyEvent 要求子句长度 ≥ 8，所以用例句子必须足够长，
    // 否则会因长度被跳过、让硬闸断言「假绿」。
    const unknown = normalizeTeyvatNpcRecords([{ id: 'npc_custom', 姓名: '阿岚', gender: '女' }])[0]!;
    expect(deriveNarrativeIntimacyFacts('阿岚在窗边亲吻了云。', [unknown], options))
      .toContainEqual(expect.objectContaining({ type: 'npc', affinityDelta: 5 }));

    const minor = normalizeTeyvatNpcRecords([{ id: 'npc_minor', 姓名: '小满', gender: '女', 说明: '十岁的学徒' }])[0]!;
    expect(deriveNarrativeIntimacyFacts('小满在走廊亲吻了云。', [minor], options)).toEqual([]);
    const protectedNpc = normalizeTeyvatNpcRecords([{ id: 'npc_klee', 姓名: '可莉', gender: '女' }])[0]!;
    expect(deriveNarrativeIntimacyFacts('可莉踮起脚亲吻了云。', [protectedNpc], options)).toEqual([]);
  });

  it('does not award an ambiguous shared action to both named NPCs', () => {
    const lisa = normalizeTeyvatNpcRecords([{ id: 'npc_lisa', 姓名: '丽莎', gender: '女',
      matureArchive: { ageConfirmation: 'adult', ageConfirmationSource: 'canonical' } }])[0]!;
    expect(deriveNarrativeIntimacyFacts('安柏和丽莎一起拥抱了云。', [adult(), lisa], options)).toEqual([]);
  });

  it.each([
    ['安柏与云发生了性爱关系。', 30],
    ['安柏轻轻亲吻了云。', 5],
    ['安柏向云表白了心意。', 3],
    ['安柏牵起你的手。', 3],
  ])('records fixed tier for %s', (body, delta) => {
    expect(deriveNarrativeIntimacyFacts(body, [adult()], options))
      .toContainEqual(expect.objectContaining({ type: 'npc', affinityDelta: delta }));
  });

  it('records stable player reference and actual turn only for confirmed adult sex', () => {
    expect(deriveNarrativeIntimacyFacts('安柏与云发生了性爱关系。', [adult()], options))
      .toContainEqual(expect.objectContaining({
        type: 'nsfw_archive', npcId: 'npc_amber', virginityStatus: 'not_virgin',
        firstSexualPartnerRef: 'player', firstSexualPartnerSource: 'narrative', firstSexualPartnerTurn: 7,
      }));
  });

  it('persists a first player reference but preserves a preexisting named partner', () => {
    const state = createEmptyTeyvatGameState();
    state.旅行者.姓名 = '云';
    state.NPC = [adult()];
    const facts = deriveNarrativeIntimacyFacts('安柏与云发生了性爱关系。', state.NPC, options);
    const commands = factsToTeyvatDomainCommands(facts, state, 7).commands;
    const result = commitTeyvatTurn(state, commands, () => undefined, { lenientEvidence: true });
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.nextState.NPC[0]?.matureArchive).toEqual(expect.objectContaining({
      firstSexualPartnerRef: 'player', firstSexualPartnerSource: 'narrative', firstSexualPartnerTurn: 7,
    }));

    const withOther = createEmptyTeyvatGameState();
    withOther.旅行者.姓名 = '云';
    withOther.NPC = normalizeTeyvatNpcRecords([{
      ...adult(), matureArchive: { ...adult().matureArchive, ageConfirmation: 'adult', ageConfirmationSource: 'canonical',
        firstSexualPartner: '凯亚', firstSexualPartnerSource: 'manual' },
    }]);
    const otherCommands = factsToTeyvatDomainCommands(facts, withOther, 7).commands;
    const otherResult = commitTeyvatTurn(withOther, otherCommands, () => undefined, { lenientEvidence: true });
    expect(otherResult.status).toBe('committed');
    if (otherResult.status !== 'committed') return;
    expect(otherResult.nextState.NPC[0]?.matureArchive).toEqual(expect.objectContaining({
      firstSexualPartner: '凯亚', firstSexualPartnerSource: 'manual',
    }));
    expect(otherResult.nextState.NPC[0]?.matureArchive?.firstSexualPartnerRef).toBeUndefined();
  });
});

/**
 * 2026-09-29：识别器从「子句内共现 + 子句 ≥ 8 字」放宽到「句子内位置归属 + 代词回指」。
 *
 * 这批用例全部是**真实行文**形态；旧实现在它们上全部返回 `[]`（这就是「明明亲密却不涨好感度」），
 * 因此它们同时是本次修复的红→绿证据。旧实现的具体死因见每条的注释。
 */
describe('真实行文的亲密事件识别（2026-09-29 回归）', () => {
  const tints = (body: string, records = [adult()]) => deriveNarrativeIntimacyFacts(body, records, options);
  const delta = (body: string, records = [adult()]) => tints(body, records)
    .filter((fact) => fact.type === 'npc')
    .map((fact) => (fact.type === 'npc' ? fact.affinityDelta : undefined));

  it('短句也结算：安柏亲吻了你。（旧版死于「子句 < 8 字」）', () => {
    expect(delta('安柏亲吻了你。')).toEqual([5]);
  });

  it('跨一个逗号也结算：安柏俯下身，轻轻吻住了云。（旧版死于按逗号切子句）', () => {
    expect(delta('安柏俯下身，轻轻吻住了云。')).toEqual([5]);
  });

  it('代词回指前两句内最近点名的角色：安柏走到窗边。她轻轻吻住了云。', () => {
    expect(delta('安柏走到窗边。她轻轻吻住了云。')).toEqual([5]);
  });

  it('代词没有先行词时不猜：她轻轻吻住了云。', () => {
    expect(delta('她轻轻吻住了云。')).toEqual([]);
  });

  it('第一人称玩家主动也结算：我俯身吻住了安柏。', () => {
    expect(delta('我俯身吻住了安柏。')).toEqual([5]);
  });

  it('引号只屏蔽对白内容：动作在引号外照算', () => {
    expect(delta('“不要停……”安柏吻住了云。')).toEqual([5]);
  });

  it('补词表：相拥按肢体接触 +3', () => {
    expect(delta('安柏与云在月光下相拥了很久。')).toEqual([3]);
  });

  it('单字名的子串不算点名：琴声里的安柏仍能拿分', () => {
    const qin = normalizeTeyvatNpcRecords([{ id: 'npc_qin', 姓名: '琴', gender: '女' }])[0]!;
    expect(delta('安柏在琴声里轻轻亲吻了云。', [adult(), qin])).toEqual([5]);
  });

  it('第三方仅在旁出现不再牵连：安柏亲吻了云，丽莎在旁边看着。', () => {
    const lisa = normalizeTeyvatNpcRecords([{ id: 'npc_lisa', 姓名: '丽莎', gender: '女' }])[0]!;
    expect(delta('安柏亲吻了云，丽莎在旁边看着。', [adult(), lisa])).toEqual([5]);
  });

  it('同句共同完成仍然丢弃（归属不唯一）：安柏和丽莎一起拥抱了云。', () => {
    const lisa = normalizeTeyvatNpcRecords([{ id: 'npc_lisa', 姓名: '丽莎', gender: '女' }])[0]!;
    expect(delta('安柏和丽莎一起拥抱了云。', [adult(), lisa])).toEqual([]);
  });

  it('玩家没参与就不结算：安柏亲吻了丽莎。', () => {
    const lisa = normalizeTeyvatNpcRecords([{ id: 'npc_lisa', 姓名: '丽莎', gender: '女' }])[0]!;
    expect(delta('安柏亲吻了丽莎。', [adult(), lisa])).toEqual([]);
  });

  it('否定词只在动作前的窗口内生效：想起从前之后仍能结算后一个动作', () => {
    expect(delta('安柏想起从前的吻，随后又吻住了云。')).toEqual([5]);
  });

  it.each([
    ['安柏俯下身去轻轻吻住了云。', [5]],
    ['安柏轻轻吻住了你。', [5]],
    ['云俯身吻住了安柏。', [5]],
    ['俯身吻住了安柏。', []],
    ['安柏在云耳边低语，随后相拥而眠。', []],
  ])('真实行文矩阵 %s', (body, expected) => {
    expect(delta(body)).toEqual(expected);
  });
  // 两处**有意保持保守**的边界：
  // - 「俯身吻住了安柏。」没有主语也没有玩家指代 → 不猜归属；
  // - 「…随后相拥而眠。」玩家只出现在前一个小句，动作所在子句没有玩家指代 → 不结算。
  //   精度优先：宁可少算，也不能把旁人的动作算到玩家头上。

  it('NSFW 关闭时语义不变：性爱档为 0，亲吻仍 +5', () => {
    const noNsfw = { ...options, nsfwEnabled: false };
    expect(deriveNarrativeIntimacyFacts('安柏与云发生了性爱关系。', [adult()], noNsfw)).toEqual([]);
    expect(deriveNarrativeIntimacyFacts('安柏亲吻了你。', [adult()], noNsfw))
      .toContainEqual(expect.objectContaining({ type: 'npc', affinityDelta: 5 }));
  });
});
