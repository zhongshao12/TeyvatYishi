import { expect, it, vi } from 'vitest';
import { ownCoreImageRequest } from '@/core/jobs/imagePlan';
import { projectCoreFailure } from '@/core/retrieval/viewModels';
import { createCore2ImagePort } from '@/services/ai/core2ImageModel';
import { 创建默认游戏设置 } from '@/models/settings';
import { makeSeed } from './fixtures';
it('rejects unregistered nested character facts instead of persisting hidden relationship data in an image plan', () => {
  expect(() => ownCoreImageRequest({ title: 'photo', kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber', negative: '', size: '512x512', characters: [{ language: 'en', name: 'Amber', appearanceDetails: { 七维: { value: 'PRIVATE_SENTINEL', source: 'manual' } } } as never] })).toThrow('CORE2_IMAGE_CHARACTER_INVALID');
});
it('keeps a cancelled image task independently retryable in the actual failure projection', () => {
  const seed = makeSeed();
  expect(projectCoreFailure({ jobId: 'cancelled-image', scope: seed.head.scope, sessionId: seed.head.sessionId, kind: 'image', operationId: 'image-request', sourceRefs: [seed.sources[0]!.ref], status: 'cancelled', leaseId: null, configFingerprint: 'fixture', attempts: 1, steps: [], version: 2 })).toMatchObject({ canRetry: true, canStop: false, gameplaySaved: true });
});
it('rejects a disabled selected image backend before translating or preparing any prompt', async () => {
  const seed = makeSeed(), settings = 创建默认游戏设置().文生图系统; settings.enabled = true; settings.普通接口.enabled = false;
  const translate = vi.fn();
  await expect(createCore2ImagePort(settings, null, vi.fn(), translate).prepare!({ head: seed.head, records: seed.records, contentRefs: [] }, { title: 'photo', kind: 'scene', npcId: null, userInput: 'Windrise', positive: [], negative: [], size: '512x512' })).rejects.toThrow('接口未启用');
  expect(translate).not.toHaveBeenCalled();
});
