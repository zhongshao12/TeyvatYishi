import { describe, expect, it } from 'vitest';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { 创建默认游戏设置 } from '@/models/settings';
import { resolveNarrativeImageGenerationApi } from '@/hooks/useGame/narrativeImageWorkflow';

describe('narrative image workflow boundary', () => {
  it('resolves the image API only when the normal image endpoint is enabled', () => {
    const settings = 创建默认游戏设置();
    const state = { gameSettings: settings } as UseGameStateReturn;
    expect(resolveNarrativeImageGenerationApi(state)).toBeNull();

    settings.文生图系统.普通接口.enabled = true;
    settings.文生图系统.普通接口.baseUrl = 'https://image.example/v1';
    settings.文生图系统.普通接口.model = 'image-model';
    expect(resolveNarrativeImageGenerationApi(state)).toMatchObject({
      enabled: true,
      baseUrl: 'https://image.example/v1',
      model: 'image-model',
    });
  });
});
