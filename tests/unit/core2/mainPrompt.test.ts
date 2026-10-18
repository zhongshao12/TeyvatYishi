import { describe, expect, it } from 'vitest';
import { assembleCore2MainPrompt } from '@/core/settlement/mainPrompt';
import { 创建默认游戏设置 } from '@/models/settings';
import { makeSeed } from './fixtures';
import { 创建空世界书, 创建空世界书条目 } from '@/models/worldbook';

describe('core2 existing preset delivery', () => {
  it('delivers selected worldbook rules and depth entries using journey-local cooldown state', () => {
    const seed = makeSeed(), settings = 创建默认游戏设置(); settings.promptModules = []; settings.enableStPreset = false; settings.enableWorldbookInjection = true;
    const books = [创建空世界书({ entries: [
      创建空世界书条目({ id: 'custom-rule', type: 'system_rule', content: 'WORLD_RULE {{user}}', cooldown: 3, scope: ['all'] }),
      创建空世界书条目({ id: 'depth-entry', content: 'DEPTH_REFERENCE', injectAtDepth: true, depth: 1, scope: ['all'] }),
    ] })];
    const input = { snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, userInput: '原始输入', history: [], commitments: [] };
    const result = assembleCore2MainPrompt(input, settings, books);
    expect(result.systemPrompt).toContain('WORLD_RULE'); expect(JSON.stringify(result.messages)).toContain('DEPTH_REFERENCE');
    expect(result.worldbookEntryIds).toEqual(expect.arrayContaining(['custom-rule', 'depth-entry']));
    const world = seed.records.find(row => row.domain === 'world'); if (world?.domain !== 'world') throw Error('fixture');
    world.value.completedMainTurns = 1; world.value.worldbookTriggers = { 'custom-rule': 1 };
    expect(assembleCore2MainPrompt(input, settings, books).systemPrompt).not.toContain('WORLD_RULE');
    world.value.completedMainTurns = 3;
    expect(assembleCore2MainPrompt(input, settings, books).systemPrompt).toContain('WORLD_RULE');
    settings.enableWorldbookInjection = false;
    const disabled = assembleCore2MainPrompt(input, settings, books);
    expect(disabled.worldbookEntryIds).toEqual([]); expect(JSON.stringify(disabled)).not.toContain('DEPTH_REFERENCE');
  });
  it('keeps selected style, word count, macros and message order without passing a legacy root', () => {
    const seed = makeSeed(), settings = 创建默认游戏设置();
    settings.promptModules = [];
    settings.enableStPreset = true; settings.currentStPresetIdV2 = 'test-preset';
    settings.stPresetsV2 = [{ id: 'test-preset', name: '测试预设', importedAt: 0, updatedAt: 0, characterId: 100001, preset: { prompts: [{ identifier: 'style', role: 'system', content: '使用温暖细腻的手账文风，正文至少3000字，称呼玩家{{user}}。' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'style', enabled: true }, { identifier: 'chatHistory', enabled: true }, { identifier: 'userInput', enabled: true }] }] } }];
    const result = assembleCore2MainPrompt({ snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, userInput: '问候安柏', history: [], commitments: [] }, settings);
    const text = JSON.stringify(result);
    expect(text).toContain('温暖细腻的手账文风'); expect(text).toContain('3000'); expect(text).toContain('称呼玩家云');
    expect(result.messages.some(message => message.role === 'user' && message.content.includes('问候安柏'))).toBe(true);
    expect(text).toContain('body'); expect(text).not.toContain('至少500字');
  });
  it('does not activate an unselected/disabled preset or leak other NPC private notes', () => {
    const seed = makeSeed(), settings = 创建默认游戏设置(); settings.promptModules = [];
    const npc = seed.records.find(r => r.domain === 'npc'); if (npc?.domain === 'npc') npc.value.notes = ['PRIVATE_SENTINEL'];
    settings.enableStPreset = false; settings.currentStPresetIdV2 = 'disabled'; settings.stPresetsV2 = [{ id: 'disabled', name: 'disabled', importedAt: 0, updatedAt: 0, preset: { prompts: [{ identifier: 'x', role: 'system', content: 'DISABLED_SENTINEL' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'x', enabled: true }] }] } }];
    const result = assembleCore2MainPrompt({ snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, userInput: '问候', history: [], commitments: [] }, settings);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SENTINEL|DISABLED_SENTINEL/);
    expect(result.systemPrompt).toContain('蒙德城');
  });
});
