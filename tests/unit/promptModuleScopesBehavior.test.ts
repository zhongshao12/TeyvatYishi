import { describe, expect, it } from 'vitest';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import type { 提示词模块 } from '@/models/prompts';
import { buildVariablePromptModulesSection } from '@/services/ai/variableModel';
import { filterIndependentPromptModules } from '@/services/promptModuleScopes';
import { buildStoryWeavingPromptModulesSection } from '@/services/storyWeaving';

function customModule(id: string): 提示词模块 {
  return {
    id,
    title: id,
    description: '',
    category: 'custom',
    content: `content:${id}`,
    enabled: true,
    builtin: false,
    order: 500,
    scope: ['calibration'],
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('independent prompt module scopes', () => {
  it('routes all native domain-command modules into the variable model', () => {
    const selected = filterIndependentPromptModules(createBuiltinPromptModules(), 'variable');

    expect(selected.map((module) => module.id)).toEqual(expect.arrayContaining([
      'builtin_variable_worldbook',
      'builtin_domain_command_rules',
      'builtin_domain_command_output_format',
      'builtin_companion_archive_worldbook',
    ]));
  });

  it('routes all native canon modules into Story Weaving', () => {
    const selected = filterIndependentPromptModules(createBuiltinPromptModules(), 'storyWeaving');

    expect(selected.map((module) => module.id)).toEqual([
      'builtin_canon_worldbook',
      'builtin_canon_output_format',
      'builtin_canon_decomposition_rules',
    ]);
  });

  it('keeps user-created and imported subsystem modules on the same runtime path as the settings UI', () => {
    const modules = [
      customModule('custom_variable_custom_1'),
      customModule('st_import_variable_1'),
      customModule('custom_storyWeaving_custom_1'),
      customModule('st_import_story_weaving_1'),
    ];

    expect(filterIndependentPromptModules(modules, 'variable').map((module) => module.id)).toEqual([
      'custom_variable_custom_1',
      'st_import_variable_1',
    ]);
    expect(filterIndependentPromptModules(modules, 'storyWeaving').map((module) => module.id)).toEqual([
      'custom_storyWeaving_custom_1',
      'st_import_story_weaving_1',
    ]);
    expect(buildVariablePromptModulesSection(modules)).toContain('content:custom_variable_custom_1');
    expect(buildVariablePromptModulesSection(modules)).toContain('content:st_import_variable_1');
    expect(buildStoryWeavingPromptModulesSection(modules)).toContain('content:custom_storyWeaving_custom_1');
    expect(buildStoryWeavingPromptModulesSection(modules)).toContain('content:st_import_story_weaving_1');
  });
});
