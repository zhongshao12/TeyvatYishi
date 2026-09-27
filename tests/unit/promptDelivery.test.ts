import { describe, expect, it } from 'vitest';
import { explainPromptDelivery, migratePromptDeliveryTargets, resolvePromptDeliveryTargets, togglePromptTarget } from '@/services/promptDelivery';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import type { 提示词模块 } from '@/models/prompts';

const sample = (id: string, deliveryTargets?: 提示词模块['deliveryTargets']) => ({
  id,
  deliveryTargets,
  scope: ['calibration'],
  enabled: true,
}) as 提示词模块;

describe('prompt delivery', () => {
  it('uses an explicit target instead of an ID prefix', () => {
    expect(resolvePromptDeliveryTargets(sample('unrelated', ['courier']))).toEqual(['courier']);
    expect(resolvePromptDeliveryTargets(sample('custom_courier_wrong', ['variable']))).toEqual(['variable']);
  });

  it('does not guess a target for an unknown calibration module', () => {
    expect(resolvePromptDeliveryTargets(sample('custom_unknown'))).toEqual([]);
  });

  it('routes the source-controlled domain command rules to variable', () => {
    const builtin = createBuiltinPromptModules().find((module) => module.id === 'builtin_domain_command_rules');
    expect(builtin && resolvePromptDeliveryTargets(builtin)).toEqual(['variable']);
  });

  it('migrates an old custom courier ID exactly once', () => {
    expect(migratePromptDeliveryTargets([sample('custom_courier_1')])[0]?.deliveryTargets).toEqual(['courier']);
  });

  it('keeps explicit target authoritative after migration', () => {
    expect(migratePromptDeliveryTargets([sample('custom_courier_1', ['variable'])])[0]?.deliveryTargets).toEqual(['variable']);
  });

  it('explains disabled, wrong-target, and unassigned modules', () => {
    expect(explainPromptDelivery({ ...sample('x', ['courier']), enabled: false }, 'courier')).toBe('disabled');
    expect(explainPromptDelivery(sample('x', ['variable']), 'courier')).toBe('wrong-target');
    expect(explainPromptDelivery(sample('x'), 'courier')).toBe('unassigned');
  });

  it('toggles explicit targets without duplicating them', () => {
    expect(togglePromptTarget(['courier'], 'courier')).toEqual([]);
    expect(togglePromptTarget(['courier'], 'variable')).toEqual(['courier', 'variable']);
  });
});
