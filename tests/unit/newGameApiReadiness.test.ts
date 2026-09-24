import { describe, expect, it } from 'vitest';
import { 创建默认游戏设置, type API配置项, type API设置 } from '@/models/settings';
import { evaluateNewGameApiReadiness } from '@/utils/newGameApiReadiness';

const configuredMain: API配置项 = {
  id: 'main', name: '主模型', provider: 'openai_compatible',
  baseUrl: 'http://localhost:1234/v1', apiKey: 'SUPER_SECRET_KEY', model: 'model-a',
  createdAt: 1, updatedAt: 1,
};
const api = (config: API配置项 | null, activeConfigId = config?.id ?? null): API设置 => ({
  activeConfigId, configs: config ? [config] : [],
});

describe('evaluateNewGameApiReadiness', () => {
  it('warns locally when no main model exists without exposing credentials', () => {
    const readiness = evaluateNewGameApiReadiness(api(null), 创建默认游戏设置());
    expect(readiness.main.status).toBe('warning');
    expect(readiness.variable.status).toBe('warning');
    expect(readiness.image.status).toBe('disabled');
  });

  it('uses the first configured model when the active ID was deleted', () => {
    const readiness = evaluateNewGameApiReadiness(api(configuredMain, 'deleted'), 创建默认游戏设置());
    expect(readiness.main.status).toBe('ready');
    expect(readiness.main.detail).toContain('尚未测试连接');
    expect(readiness.variable.status).toBe('ready');
    expect(JSON.stringify(readiness)).not.toContain(configuredMain.apiKey);
    expect(JSON.stringify(readiness)).not.toContain(configuredMain.baseUrl);
  });

  it('identifies incomplete or unsafe local fields but accepts localhost HTTP', () => {
    const defaults = 创建默认游戏设置();
    expect(evaluateNewGameApiReadiness(api({ ...configuredMain, baseUrl: 'javascript:alert(1)' }), defaults).main.status).toBe('warning');
    expect(evaluateNewGameApiReadiness(api({ ...configuredMain, baseUrl: '/v1' }), defaults).main.status).toBe('warning');
    expect(evaluateNewGameApiReadiness(api({ ...configuredMain, model: ' ' }), defaults).main.detail).toContain('模型');
    expect(evaluateNewGameApiReadiness(api({ ...configuredMain, apiKey: ' ' }), defaults).main.detail).toContain('密钥');
    expect(evaluateNewGameApiReadiness(api(configuredMain), defaults).main.status).toBe('ready');
  });

  it('inherits blank variable override fields from the main model', () => {
    const settings = 创建默认游戏设置();
    settings.variableApi.baseUrl = '';
    settings.variableApi.apiKey = '';
    settings.variableApi.model = '';
    expect(evaluateNewGameApiReadiness(api(configuredMain), settings).variable.status).toBe('ready');
    settings.variableApi.baseUrl = 'not-a-url';
    expect(evaluateNewGameApiReadiness(api(configuredMain), settings).variable.status).toBe('warning');
  });

  it('checks optional image settings according to backend requirements', () => {
    const settings = 创建默认游戏设置();
    settings.文生图系统.enabled = true;
    settings.文生图系统.普通接口 = {
      ...settings.文生图系统.普通接口, enabled: true, backend: 'comfyui',
      baseUrl: 'http://localhost:8188', apiKey: '', model: '',
    };
    expect(evaluateNewGameApiReadiness(api(configuredMain), settings).image.status).toBe('ready');
    settings.文生图系统.普通接口.backend = 'openai_compatible';
    expect(evaluateNewGameApiReadiness(api(configuredMain), settings).image.status).toBe('warning');
    settings.文生图系统.enabled = false;
    expect(evaluateNewGameApiReadiness(api(configuredMain), settings).image.status).toBe('disabled');
  });
});
