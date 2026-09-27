import type { PromptDeliveryTarget, 提示词模块 } from '@/models/prompts';

export const PROMPT_DELIVERY_TARGETS: readonly PromptDeliveryTarget[] = [
  'main', 'variable', 'courier', 'steambird', 'codex',
  'irminsulRecall', 'irminsulArchive', 'storyWeaving',
];

export const PROMPT_DELIVERY_LABELS: Record<PromptDeliveryTarget, string> = {
  main: '主剧情', variable: '变量', courier: '手机', steambird: '蒸汽鸟报',
  codex: '图鉴', irminsulRecall: '世界树召回',
  irminsulArchive: '世界树归档', storyWeaving: '剧情编织',
};

/** One-way migration mapping for known pre-target module IDs. Never applies over an explicit target. */
export function legacyTargetForId(id: string): PromptDeliveryTarget[] {
  if (/^(builtin|custom|st_import)_steambird_/u.test(id)) return ['steambird'];
  if (/^(builtin|custom|st_import)_courier_/u.test(id)) return ['courier'];
  if (/^(builtin|custom|st_import)_codex_/u.test(id)) return ['codex'];
  if (id === 'builtin_irminsul_recall' || /^(custom|st_import)_irminsul_recall_/u.test(id)) return ['irminsulRecall'];
  if (/^(builtin|custom|st_import)_irminsul_archive_/u.test(id)) return ['irminsulArchive'];
  if (/^builtin_canon_/u.test(id) || /^custom_storyWeaving_/u.test(id) || /^st_import_story_weaving_/u.test(id)) return ['storyWeaving'];
  if (/^builtin_(variable_|domain_command_)/u.test(id) || id === 'builtin_companion_archive_worldbook'
    || /^custom_(variable_|companionArchive_)/u.test(id)
    || /^st_import_(variable_|companion_archive_)/u.test(id)) return ['variable'];
  return [];
}

export function resolvePromptDeliveryTargets(module: 提示词模块): PromptDeliveryTarget[] {
  if (module.deliveryTargets) return [...new Set(module.deliveryTargets)];
  if (!module.scope?.includes('calibration')) return ['main'];
  return legacyTargetForId(module.id);
}

export function migratePromptDeliveryTargets(modules: 提示词模块[]): 提示词模块[] {
  return modules.map((module) => module.deliveryTargets !== undefined
    ? module
    : { ...module, deliveryTargets: resolvePromptDeliveryTargets(module) });
}
