import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import { 归一化提示词模块ID } from '@/models/settings';
import {
  buildNpcImagePrompt,
  normalizeImageRules,
  默认文生图规则中心,
} from '@/utils/imagePromptRules';

const BANNED_SETTING_TERMS = /崩坏：星穹铁道|\bHSR\b|Honkai|Star Rail|黑塔空间站|帕姆|三月七|丹恒|星核|星际|星海|命途|光锥|开拓者|列车/iu;
const HIDDEN_REASONING_OR_SIDECARS = /<\/?thinking>|思维链|内部处理步骤|变量草稿|<\/?变量更新>/iu;

const NATIVE_IDS = [
  'builtin_domain_command_rules',
  'builtin_domain_command_output_format',
  'builtin_steambird_editorial_rules',
  'builtin_steambird_output_format',
  'builtin_courier_worldbook',
  'builtin_courier_style',
  'builtin_courier_dialogue_rules',
  'builtin_courier_output_format',
  'builtin_irminsul_recall',
  'builtin_irminsul_archive_format',
  'builtin_codex_retrieval_rules',
  'builtin_codex_output_format',
  'builtin_canon_worldbook',
  'builtin_canon_decomposition_rules',
  'builtin_canon_output_format',
] as const;

const LEGACY_TO_NATIVE_IDS = {
  builtin_variable_cot: 'builtin_domain_command_rules',
  builtin_variable_output_format: 'builtin_domain_command_output_format',
  builtin_steambird_cot: 'builtin_steambird_editorial_rules',
  builtin_courier_cot: 'builtin_courier_dialogue_rules',
  builtin_codex_cot: 'builtin_codex_retrieval_rules',
  builtin_story_weaving_worldbook: 'builtin_canon_worldbook',
  builtin_story_weaving_cot: 'builtin_canon_decomposition_rules',
  builtin_story_weaving_output_format: 'builtin_canon_output_format',
} as const;

const RETIRED_PROMPT_FILES = [
  'prompts/cot/variableCot.ts',
  'prompts/cot/variableOutputFormat.ts',
  'prompts/cot/steambirdCot.ts',
  'prompts/cot/courierCot.ts',
  'prompts/cot/courierOutputFormat.ts',
  'prompts/cot/courierStyle.ts',
  'prompts/cot/irminsulCot.ts',
  'prompts/cot/codexCot.ts',
  'prompts/cot/storyWeavingCot.ts',
  'prompts/cot/storyWeavingOutputFormat.ts',
] as const;

function activeSubsystemText(): string {
  const wanted = new Set<string>(NATIVE_IDS);
  return createBuiltinPromptModules()
    .filter((module) => wanted.has(module.id))
    .map((module) => `${module.title}\n${module.description}\n${module.content}`)
    .join('\n');
}

describe('native Teyvat subsystem prompt boundary', () => {
  it('registers every native subsystem module once and only normalizes historical IDs toward native IDs', () => {
    const modules = createBuiltinPromptModules();
    const ids = modules.map((module) => module.id);

    for (const nativeId of NATIVE_IDS) {
      expect(ids.filter((id) => id === nativeId), nativeId).toHaveLength(1);
    }
    for (const [legacyId, nativeId] of Object.entries(LEGACY_TO_NATIVE_IDS)) {
      expect(归一化提示词模块ID(legacyId)).toBe(nativeId);
      expect(ids).not.toContain(legacyId);
      expect(归一化提示词模块ID(nativeId)).toBe(nativeId);
    }
  });

  it('anchors every independent subsystem in Teyvat without HSR examples or hidden reasoning sidecars', () => {
    const text = activeSubsystemText();

    expect(text).not.toMatch(BANNED_SETTING_TERMS);
    expect(text).not.toMatch(HIDDEN_REASONING_OR_SIDECARS);
    for (const anchor of ['蒸汽鸟报', '手机', '世界树', '图鉴', 'CanonDeviation', '原著轨道']) {
      expect(text).toContain(anchor);
    }
    for (const example of ['风起地', '璃月港', '安柏', '凯瑟琳', '提瓦特煎蛋', '丘丘人营地']) {
      expect(text).toContain(example);
    }
  });

  it('keeps formal domain facts evidenced, protected, continuous, gender-neutral, and archive-isolated', () => {
    const modules = createBuiltinPromptModules();
    const text = modules
      .filter((module) => module.id.startsWith('builtin_domain_command_') || module.id === 'builtin_variable_worldbook')
      .map((module) => module.content)
      .join('\n');

    expect(text).toMatch(/正文.*证据|evidence.*正文/iu);
    expect(text).toMatch(/旅行者.*(?:只读|不得修改)|traveler_profile.*(?:禁止|不得)/iu);
    expect(text).toMatch(/原著角色.*性格.*(?:不得|不能|保护)|canonical NPC.*personality/iu);
    expect(text).toMatch(/不因.*男性.*女性|性别中性|gender-neutral/iu);
    expect(text).toMatch(/weapon.*artifact.*food.*material.*gadget.*quest.*furnishing/iu);
    expect(text).toMatch(/memory.*recentInteraction.*sharedExperiences/iu);
    expect(text).toMatch(/NSFW.*(?:隔离|独立)|archive isolation/iu);
    expect(text).toContain('TeyvatDomainCommand');
  });

  it('retires all replaced prompt entry files and leaves no production imports of them', () => {
    for (const file of RETIRED_PROMPT_FILES) {
      expect(existsSync(resolve(file)), file).toBe(false);
    }

    const productionRoots = ['data', 'services', 'hooks', 'components', 'utils', 'models', 'prompts', 'compat'];
    const source = productionRoots.flatMap((root) => readSourceTree(resolve(root))).join('\n');
    for (const file of RETIRED_PROMPT_FILES) {
      const importPath = file.replace(/\.ts$/u, '').replaceAll('\\', '/');
      expect(source, importPath).not.toContain(importPath);
    }
  });

  it('normalizes and generates with native journal-fantasy image rule fields only', () => {
    const rules = normalizeImageRules(默认文生图规则中心);
    const record = rules as unknown as Record<string, unknown>;

    expect(record).toHaveProperty('journalFantasyBaseStyle');
    expect(record).toHaveProperty('teyvatCharacterAnchorRule');
    expect(record).not.toHaveProperty('hsrBaseStyle');
    expect(record).not.toHaveProperty('hsrCharacterAnchorRule');
    expect(record.journalFantasyBaseStyle).toMatch(/warm watercolor fantasy travel journal/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/hand-painted environment/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/parchment texture/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/aged brass ornament/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/restrained cel shading/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/original costume details/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/no logo/iu);
    expect(record.journalFantasyBaseStyle).toMatch(/no game screenshot/iu);

    const migrated = normalizeImageRules({
      hsrBaseStyle: 'custom legacy base style',
      hsrCharacterAnchorRule: 'custom legacy anchor rule',
    } as never) as unknown as Record<string, unknown>;
    expect(migrated.journalFantasyBaseStyle).toBe('custom legacy base style');
    expect(migrated.teyvatCharacterAnchorRule).toBe('custom legacy anchor rule');
    expect(migrated).not.toHaveProperty('hsrBaseStyle');
    expect(migrated).not.toHaveProperty('hsrCharacterAnchorRule');

    const generated = buildNpcImagePrompt({
      npc: {
        id: 'npc_amber',
        姓名: '安柏',
        原著角色: true,
        性别: '女',
        外貌: '棕色长发，红色发带，明亮的琥珀色眼睛',
        穿着: '西风骑士团侦察骑士制服与护目镜',
      } as never,
      mode: 'portrait',
      rules,
    });
    expect(generated.prompt).toMatch(/Genshin|Teyvat/iu);
    expect(generated.prompt).not.toMatch(/Honkai|Star Rail|HSR/iu);
  });
});

function readSourceTree(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = resolve(root, name);
    if (statSync(path).isDirectory()) return readSourceTree(path);
    return /\.(?:ts|tsx)$/u.test(name) ? [readFileSync(path, 'utf8')] : [];
  });
}
