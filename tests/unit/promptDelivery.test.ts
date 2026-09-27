import { describe, expect, it } from 'vitest';
import { resolvePromptDeliveryTargets } from '@/services/promptDelivery';
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
});
