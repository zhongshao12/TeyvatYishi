import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NPC记录 } from '@/models/npc';
import { formatNpcLedgerForPrompt, 归一化NPC记录列表 } from '@/models/npc';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import {
  deriveNarrativeInventoryRemovalFacts,
  deriveResolvedNpcLedgerFacts,
  factsToTeyvatDomainCommands,
  parseVariableFacts,
} from '@/utils/variableFacts';
import { revealCourierMessages } from '@/hooks/useGame/courierBackgroundJobs';
import { normalizePlayerSpeechInBody } from '@/utils/playerSpeechGuard';

const legacyNpc = (name: string, patch: Partial<NPC记录> = {}): NPC记录 => ({
  id: `npc_${name}`,
  姓名: name,
  阶位: 'companion',
  好感度: 0,
  关系: 'stranger',
  同行: false,
  初见回合: 1,
  最近回合: 1,
  备注: [],
  ...patch,
});

describe('third user-reported UX regression batch', () => {
  it('keeps a sentence from a long player input attributed to the player', () => {
    const userInput = `${'我先把沿途的线索按顺序整理一遍。'.repeat(7)}今晚八点在城门集合，我们一起确认风向。`;
    const body = '【旅行者】今晚八点在城门集合，我们一起确认风向。';
    expect(normalizePlayerSpeechInBody({ body, playerName: '旅行者', userInput }))
      .toBe(body);
  });

  it('reveals every generated phone bubble at a fixed 500ms cadence', async () => {
    const waits: number[] = [];
    const revealed: string[] = [];
    await revealCourierMessages(['第一条', '第二条', '第三条'], (message) => { revealed.push(message); }, 500, async (ms) => {
      waits.push(ms);
    });
    expect(waits).toEqual([500, 500, 500]);
    expect(revealed).toEqual(['第一条', '第二条', '第三条']);
  });

  it('never turns narration or system prompt labels into companions', () => {
    const normalized = 归一化NPC记录列表([
      legacyNpc('旁白', { 备注: ['场景描述'] }),
      legacyNpc('旁白·图书馆', { 备注: ['场景描述'] }),
      legacyNpc('系统提示', { 备注: ['变量更新'] }),
      legacyNpc('系统提示（任务更新）', { 备注: ['变量更新'] }),
      legacyNpc('安柏', { 原著角色: true }),
    ]);
    expect(normalized.map((npc) => npc.姓名)).toEqual(['安柏']);
  });

  it('adds the requested virginity baseline only to adult-confirmed female companions', () => {
    const adult = enrichNpcArchives([
      legacyNpc('丽莎', { 性别: '女', NSFW档案: { enabled: true, 年龄确认: 'adult' } }),
    ], { nsfwEnabled: true, maleNsfwArchiveEnabled: false }).records[0];
    expect(adult!.NSFW档案).toMatchObject({ 是否处女: '是', 首次性行为对象: '无' });

    const unknownAge = enrichNpcArchives([
      legacyNpc('原创女性旅人', { 性别: '女', NSFW档案: { enabled: true, 年龄确认: 'unknown' } }),
    ], { nsfwEnabled: true, maleNsfwArchiveEnabled: false }).records[0];
    expect(unknownAge!.NSFW档案).not.toHaveProperty('是否处女');
    expect(unknownAge!.NSFW档案).not.toHaveProperty('首次性行为对象');
  });

  it('can update adult female sexual-history fields from an explicit mature-archive fact', () => {
    const parsed = parseVariableFacts(`<变量事实>${JSON.stringify({ facts: [{
      type: 'nsfw_archive', npcName: '丽莎', ageConfirm: 'adult', virginityStatus: 'not_virgin', firstSexualPartner: '旅行者',
      evidence: '正文明确记录双方均为成年人且自愿建立了关系。',
    }] })}</变量事实>`);
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([{ id: 'npc_lisa', 姓名: '丽莎', gender: '女', matureArchive: {
      enabled: true, ageConfirmation: 'adult', virginityStatus: 'virgin', firstSexualPartner: '无',
      preferences: [], sensitivePoints: [], taboos: [], femaleBodyProfile: {}, maleBodyProfile: {}, experiences: [], longTermFacts: [], tags: [], partImages: {},
    } }]);
    const command = factsToTeyvatDomainCommands(parsed.facts, state, 3).commands.find((item) => item.path.includes('matureArchive'));
    expect(command?.value).toMatchObject({ virginityStatus: 'not_virgin', firstSexualPartner: '旅行者' });
  });

  it('parses explicit item use/give/loss and subtracts it from the native inventory', () => {
    const parsed = parseVariableFacts(`<变量事实>${JSON.stringify({ facts: [
      { type: 'item', action: 'give', name: '日落果', quantity: 1, evidence: '旅行者将一枚日落果交给安柏。' },
    ] })}</变量事实>`);
    expect(parsed.facts).toContainEqual(expect.objectContaining({ type: 'item', action: 'give', name: '日落果', quantity: 1 }));

    const state = createEmptyTeyvatGameState();
    state.背包.items = [{ id: 'item_sunsetia', category: 'food', name: '日落果', description: '果实', quantity: 3, rarity: 1, obtainedAtTurn: 1 }];
    const result = factsToTeyvatDomainCommands(parsed.facts, state, 2);
    expect(result.commands).toContainEqual(expect.objectContaining({
      action: 'sub', root: '背包', path: 'items[id=item_sunsetia].quantity', value: 1,
    }));
  });

  it('deterministically recovers an explicit item handoff if the variable model omits it', () => {
    const facts = deriveNarrativeInventoryRemovalFacts(
      '旅行者从行囊里取出一枚日落果，郑重地交给安柏。',
      [{ id: 'item_sunsetia', category: 'food', name: '日落果', description: '', quantity: 3, rarity: 1, obtainedAtTurn: 1 }],
    );
    expect(facts).toContainEqual(expect.objectContaining({ type: 'item', action: 'give', name: '日落果', quantity: 1 }));
  });

  it('does not subtract an item when an NPC gives that item to the player', () => {
    const facts = deriveNarrativeInventoryRemovalFacts(
      '安柏从随身小包里取出一枚日落果，笑着递给旅行者。',
      [{ id: 'item_sunsetia', category: 'food', name: '日落果', description: '', quantity: 3, rarity: 1, obtainedAtTurn: 1 }],
    );
    expect(facts).toEqual([]);
  });

  it('removes explicitly completed promises from the NPC ledger', () => {
    const parsed = parseVariableFacts(`<变量事实>${JSON.stringify({ facts: [
      { type: 'npc', name: '安柏', resolvedItems: ['调查城外足迹'], evidence: '旅行者和安柏完成了城外足迹调查。' },
    ] })}</变量事实>`);
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([{
      id: 'npc_amber', 姓名: '安柏', relationshipLedger: { unfinishedBusiness: ['调查城外足迹', '明日一起巡逻'] },
    }]);
    const result = factsToTeyvatDomainCommands(parsed.facts, state, 4);
    expect(result.commands).toContainEqual(expect.objectContaining({
      action: 'set', root: 'NPC', path: '[id=npc_amber].relationshipLedger.unfinishedBusiness', value: ['明日一起巡逻'],
    }));
  });

  it('deterministically recognizes a completed agreement from the settled narrative', () => {
    const facts = deriveResolvedNpcLedgerFacts('旅行者和安柏终于完成了城外足迹调查，回到骑士团复命。', [{
      id: 'npc_amber', 姓名: '安柏', relationshipLedger: { unfinishedBusiness: ['调查城外足迹', '明日一起巡逻'] },
    }]);
    expect(facts).toContainEqual(expect.objectContaining({ name: '安柏', resolvedItems: ['调查城外足迹'] }));
  });

  it('labels every injected relationship ledger as private to its owner', () => {
    const prompt = formatNpcLedgerForPrompt({
      npc: legacyNpc('安柏'),
      score: 10,
      reasons: ['玩家点名'],
      fields: ['最近互动'],
      presentState: 'explicit',
      ledger: {
        npcId: 'npc_amber', 姓名: '安柏', 别名: '', 好感度: 10, 当前关系阶段: '朋友', 亲密关系: false, 同行: false, 初见回合: 1, 最近回合: 4,
        对玩家称呼: '旅行者', 最近互动: '共同巡逻', 对玩家长期印象: '', 共同经历: [], 未完成事项: [], 未解决冲突: [],
        必须记得: [], 禁止遗忘: [], 总结记忆: [], 最近原始记忆: [], 有账本字段: true,
      },
    });
    expect(prompt).toContain('仅安柏本人知道');
    expect(prompt).toContain('禁止其他 NPC 读取');
  });

  it('keeps phone memories, chat summaries, and pending deliveries inside their proper knowledge boundaries', () => {
    const promptBuilder = readFileSync(resolve(process.cwd(), 'hooks/useGame/systemPromptBuilder.ts'), 'utf8');
    expect(promptBuilder).toContain('${npc.姓名}本人私有手机消息');
    expect(promptBuilder).toContain('私聊·仅会话参与者知情');
    expect(promptBuilder).toContain('群聊·仅群成员知情');
    expect(promptBuilder).toContain('系统调度信息，任何 NPC 不知情');
  });

  it('keeps empty save filters selectable and improves inventory detail contrast', () => {
    const saveModal = readFileSync(resolve(process.cwd(), 'components/features/SaveLoad/SaveLoadModal.tsx'), 'utf8');
    const storageManager = readFileSync(resolve(process.cwd(), 'components/features/Settings/StorageManager.tsx'), 'utf8');
    const inventory = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/InventoryPanel.tsx'), 'utf8');
    expect(saveModal).not.toContain("if (tab !== 'all' && visibleSaves.length > 0 && visibleTreeGroups.length === 0)");
    expect(storageManager).not.toContain("if (filter !== 'all' && visibleSaves.length > 0 && visibleTreeGroups.length === 0)");
    expect(inventory).toContain('data-testid="inventory-detail-panel"');
    expect(inventory).not.toContain("color: 'linear-gradient(");
    expect(inventory).toContain("color: 'rgb(var(--tj-ui-body))'");
  });
});
