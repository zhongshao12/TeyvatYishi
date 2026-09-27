import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建默认游戏设置, type API配置项, type 变量API覆盖 } from '@/models/settings';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { 创建空记忆系统 } from '@/models/memory';
import { mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { buildNpcIntimacyEventId } from '@/utils/variableFacts';
import { displayFirstPartner } from '@/utils/npcFirstPartner';
import {
  excludeRejectedSettlementCommands,
  markRejectedSettlementResults,
  removeDuplicateModelIntimacyAffinity,
  resolveVariableSettlementApiConfig,
  runVariableSettlementWorkflow,
} from '@/hooks/useGame/variableSettlementWorkflow';

const model = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/services/ai/variableModel', () => ({ callVariableModel: model.call }));

function createMainConfig(): API配置项 {
  return {
    id: 'main',
    name: '主模型',
    provider: 'deepseek',
    baseUrl: 'https://main.example/v1',
    apiKey: 'main-key',
    model: 'main-model',
    maxTokens: 4096,
    temperature: 0.8,
    topP: 0.9,
    retryCount: 4,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('variable settlement workflow boundaries', () => {
  it('merges only non-empty variable API overrides and preserves shared sampling settings', () => {
    const override: 变量API覆盖 = {
      provider: 'openai_compatible',
      baseUrl: '  ',
      apiKey: ' variable-key ',
      model: ' variable-model ',
      maxTokens: 2048,
      retryCount: 2,
    };

    const resolved = resolveVariableSettlementApiConfig(createMainConfig(), override);

    expect(resolved.config).toMatchObject({
      provider: 'openai_compatible',
      baseUrl: 'https://main.example/v1',
      apiKey: 'variable-key',
      model: 'variable-model',
      maxTokens: 2048,
      temperature: 0.8,
      topP: 0.9,
    });
    expect(resolved.overrodeAny).toBe(true);
  });

  it('removes every command rejected by preflight without mutating the source batch', () => {
    const commands = [{ id: 'keep-a' }, { id: 'drop-b' }, { id: 'keep-c' }, { id: 'drop-d' }];

    const filtered = excludeRejectedSettlementCommands(commands, [
      { index: 3 },
      { index: 1 },
      { index: 3 },
    ]);

    expect(filtered).toEqual([{ id: 'keep-a' }, { id: 'keep-c' }]);
    expect(commands).toHaveLength(4);
  });

  it('records rejected preflight commands as failures instead of claiming they committed', () => {
    const accepted = { command: { action: 'add' as const, key: '背包.mora', value: 1 }, ok: true, kind: 'command' as const };
    const rejected = { command: { action: 'add' as const, key: '背包.mora', value: 999 }, ok: true, kind: 'command' as const };
    const results = markRejectedSettlementResults([accepted, rejected], [{ index: 1, code: 'INVALID_NUMERIC_RESULT' }]);

    expect(results[0]).toEqual(accepted);
    expect(results[1]).toMatchObject({ ok: false, kind: 'rejected', reason: 'INVALID_NUMERIC_RESULT' });
    expect(rejected.ok).toBe(true);
  });
});

describe('intimacy settlement replay and selective model de-duplication', () => {
  const body = '安柏轻轻亲吻了云。随后安柏因云失约而生气。';
  const root = () => {
    const state = createEmptyTeyvatGameState();
    state.旅行者.姓名 = '云';
    state.NPC = normalizeTeyvatNpcRecords([{
      id: 'npc_amber', 姓名: '安柏', gender: '女',
      matureArchive: { ageConfirmation: 'adult', ageConfirmationSource: 'canonical' },
    }]);
    return state;
  };
  beforeEach(() => model.call.mockReset());

  async function settle(initial: TeyvatGameState, settlementId: string) {
    let live = initial;
    const result = await runVariableSettlementWorkflow({
      mainApiConfig: createMainConfig(), currentGame: live, settings: 创建默认游戏设置(),
      npcRecords: mapTeyvatNpcsToLegacy(live), commitGame: (next) => { live = next; return true; },
      userInput: '继续', body, turnAfter: 7, memorySystemSnapshot: 创建空记忆系统(), settlementId,
    });
    return { result, live };
  }

  it('same_settlement_replay_is_idempotent', async () => {
    model.call.mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    const first = await settle(root(), 'run-1');
    expect(first.live.NPC[0]?.affinity).toBe(5);
    const second = await settle(first.live, 'run-1');
    expect(second.live.NPC[0]?.affinity).toBe(5);
    expect(second.result?.committedGame).toBeDefined();
    expect(second.live.叙事.variableBatches).toHaveLength(1);
    expect(model.call).toHaveBeenCalledTimes(1);
  });

  it('same_name_separate_save_is_independent', async () => {
    model.call.mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    const first = await settle(root(), 'run-1');
    const separate = await settle(root(), 'run-1');
    expect(first.live.NPC[0]?.affinity).toBe(5);
    expect(separate.live.NPC[0]?.affinity).toBe(5);
    expect(model.call).toHaveBeenCalledTimes(2);
    expect(buildNpcIntimacyEventId('run-1', 7, 'npc_amber', 'kiss'))
      .not.toBe(buildNpcIntimacyEventId('run-1', 7, 'npc_lisa', 'kiss'));
  });

  it('keeps_independent_negative_model_fact', async () => {
    model.call.mockResolvedValue({ rawText: `<变量事实>${JSON.stringify({ facts: [
      { type: 'npc', id: 'npc_amber', name: '安柏', affinityDelta: 5, evidence: '安柏轻轻亲吻了云。' },
      { type: 'npc', id: 'npc_amber', name: '安柏', affinityDelta: -3, evidence: '安柏因云失约而生气。' },
    ] })}</变量事实>` });
    const { result, live } = await settle(root(), 'run-negative');
    expect(live.NPC[0]?.affinity).toBe(2);
    expect(result?.batch?.committedChanges).toContainEqual(expect.objectContaining({ kind: 'affinity', after: 2 }));
  });

  it('preserves a separately evidenced positive interaction too', () => {
    const npc = root().NPC;
    const derived = [{ type: 'npc' as const, id: 'npc_amber', name: '安柏', affinityDelta: 5, evidence: '安柏轻轻亲吻了云。' }];
    const modelFacts = [
      { type: 'npc' as const, id: 'npc_amber', name: '安柏', affinityDelta: 5, evidence: '安柏轻轻亲吻了云。' },
      { type: 'npc' as const, id: 'npc_amber', name: '安柏', affinityDelta: 2, evidence: '安柏感谢云协助完成巡逻。' },
    ];
    expect(removeDuplicateModelIntimacyAffinity(modelFacts, derived, npc).map((fact) => fact.type === 'npc' ? fact.affinityDelta : null))
      .toEqual([undefined, 2]);
  });

  it('a rejected live commit does not claim the fixed affinity was applied', async () => {
    model.call.mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    const initial = root();
    const result = await runVariableSettlementWorkflow({
      mainApiConfig: createMainConfig(), currentGame: initial, settings: 创建默认游戏设置(),
      npcRecords: mapTeyvatNpcsToLegacy(initial), commitGame: () => false,
      userInput: '继续', body, turnAfter: 7, memorySystemSnapshot: 创建空记忆系统(), settlementId: 'rejected',
    });
    expect(initial.NPC[0]?.affinity).toBe(0);
    expect(result?.committedGame).toBeUndefined();
    expect(result?.batch?.committedChanges).toBeUndefined();
    expect(result?.batch?.results.every((entry) => !entry.ok)).toBe(true);
  });

  it('reload_replay_preserves_partner_and_affinity across separate same-name saves', async () => {
    model.call.mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
    async function settleSex(initial: TeyvatGameState) {
      let live = initial;
      await runVariableSettlementWorkflow({
        mainApiConfig: createMainConfig(), currentGame: live,
        settings: { ...创建默认游戏设置(), enableNsfw: true },
        npcRecords: mapTeyvatNpcsToLegacy(live), commitGame: (next) => { live = next; return true; },
        userInput: '继续', body: '安柏与云发生了性爱关系。', turnAfter: 7,
        memorySystemSnapshot: 创建空记忆系统(), settlementId: 'first-event',
      });
      return live;
    }
    const first = root();
    first.NPC[0]!.matureArchive!.virginityStatus = 'virgin';
    const committed = await settleSex(first);
    expect(committed.NPC[0]?.affinity).toBe(30);
    expect(committed.NPC[0]?.matureArchive?.experiences).toHaveLength(1);
    const renamed = normalizeTeyvatGameState({ ...committed, 旅行者: { ...committed.旅行者, 姓名: '新名字' } });
    expect(displayFirstPartner(mapTeyvatNpcsToLegacy(renamed)[0]?.NSFW档案, renamed.旅行者.姓名)).toBe('新名字');
    const replayed = await settleSex(renamed);
    expect(replayed.NPC[0]?.affinity).toBe(30);
    expect(replayed.NPC[0]?.matureArchive?.experiences).toHaveLength(1);

    const separate = root();
    separate.NPC[0]!.matureArchive = {
      ...separate.NPC[0]!.matureArchive!, firstSexualPartner: '凯亚', firstSexualPartnerSource: 'manual',
      experiences: ['既有经历'],
    };
    const separateCommitted = await settleSex(separate);
    expect(separateCommitted.NPC[0]?.affinity).toBe(30);
    expect(separateCommitted.NPC[0]?.matureArchive?.firstSexualPartner).toBe('凯亚');
    expect(separateCommitted.NPC[0]?.matureArchive?.firstSexualPartnerSource).toBe('manual');
    expect(separateCommitted.NPC[0]?.matureArchive?.experiences).toContain('既有经历');
  });
});
