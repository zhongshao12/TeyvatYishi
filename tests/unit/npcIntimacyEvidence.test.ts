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

  it('requires a trusted adult even for lower intimacy tiers', () => {
    const unknown = normalizeTeyvatNpcRecords([{ id: 'npc_custom', 姓名: '阿岚', gender: '女' }])[0]!;
    expect(deriveNarrativeIntimacyFacts('阿岚亲吻了云。', [unknown], options)).toEqual([]);
    const protectedNpc = normalizeTeyvatNpcRecords([{ id: 'npc_klee', 姓名: '可莉', gender: '女' }])[0]!;
    expect(deriveNarrativeIntimacyFacts('可莉亲吻了云。', [protectedNpc], options)).toEqual([]);
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
