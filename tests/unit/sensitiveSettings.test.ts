import { beforeEach, describe, expect, it } from 'vitest';
import * as sensitiveSettings from '@/services/storage/sensitiveSettings';

type Prepare = (key: string, value: unknown) => unknown;
type Restore = <T>(key: string, value: T) => T;

describe('session-only sensitive settings', () => {
  beforeEach(() => {
    const reset = Reflect.get(sensitiveSettings, 'resetSessionSecretsForTests');
    if (typeof reset === 'function') reset();
  });

  it('removes GitHub tokens from the persisted representation while keeping them in this session', () => {
    const prepare = Reflect.get(sensitiveSettings, 'prepareSettingForPersistence') as Prepare | undefined;
    const restore = Reflect.get(sensitiveSettings, 'restoreSettingForRuntime') as Restore | undefined;
    expect(prepare).toBeTypeOf('function');
    expect(restore).toBeTypeOf('function');

    const runtime = { owner: 'traveler', repo: 'cloud', branch: 'main', rootPath: 'save', token: 'github-secret-token' };
    const persisted = prepare?.('githubCloudSaveConfig', runtime) as typeof runtime;
    expect(persisted.token).toBe('');
    expect(JSON.stringify(persisted)).not.toContain('github-secret-token');
    expect(restore?.('githubCloudSaveConfig', persisted).token).toBe('github-secret-token');
  });

  it('captures and marks a legacy plaintext token for one-time disk cleanup', () => {
    const restore = Reflect.get(sensitiveSettings, 'restoreSettingForRuntime') as Restore | undefined;
    const hasSecret = Reflect.get(sensitiveSettings, 'hasPersistentSensitiveValue') as undefined | ((key: string, value: unknown) => boolean);
    expect(hasSecret?.('githubCloudSaveConfig', { token: 'legacy-plaintext-token' })).toBe(true);
    expect(restore?.('githubCloudSaveConfig', { token: 'legacy-plaintext-token' }).token).toBe('legacy-plaintext-token');
  });

  it('does not alter unrelated settings', () => {
    const prepare = Reflect.get(sensitiveSettings, 'prepareSettingForPersistence') as Prepare | undefined;
    const value = { token: 'ordinary-field', enabled: true };
    expect(prepare?.('unrelatedSetting', value)).toBe(value);
  });
});

describe('sensitive settings policy registry', () => {
  it('classifies provider API key settings explicitly instead of leaving them implicit', () => {
    expect(sensitiveSettings.getSensitiveSettingPolicy('githubCloudSaveConfig')).toBe('session-only');
    expect(sensitiveSettings.getSensitiveSettingPolicy('apiSettings')).toBe('device-local');
    expect(sensitiveSettings.getSensitiveSettingPolicy('apiProfileSlots')).toBe('device-local');
    expect(sensitiveSettings.getSensitiveSettingPolicy('theme')).toBeNull();
    expect(sensitiveSettings.isSensitiveSettingKey('apiSettings')).toBe(true);
    expect(sensitiveSettings.isSensitiveSettingKey('gameSettings')).toBe(false);
  });
});

describe('provider API key redaction primitives', () => {
  const secret = 'sk-live-provider-secret-9f2b';

  it('collects every non-empty provider key carried by a settings value', () => {
    expect(sensitiveSettings.collectApiKeySecrets({
      activeConfigId: 'a',
      configs: [
        { id: 'a', apiKey: secret },
        { id: 'b', apiKey: '   ' },
        { id: 'c', apiKey: 42 },
      ],
      routes: { variableApi: { api_key: 'sk-second' } },
    })).toEqual([secret, 'sk-second']);
    expect(sensitiveSettings.collectApiKeySecrets({ apiKey: '' })).toEqual([]);
    expect(sensitiveSettings.collectApiKeySecrets('plain string')).toEqual([]);
  });

  it('deep-redacts API key fields while leaving every other value untouched', () => {
    const source = {
      theme: 'warm',
      apiSettings: { configs: [{ id: 'a', apiKey: secret, model: 'gpt-image-1' }] },
      nested: { api_key: 'sk-second', includeApiKeys: true },
    };

    const redacted = sensitiveSettings.redactApiKeysDeep(source);

    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(JSON.stringify(redacted)).not.toContain('sk-second');
    expect(redacted.theme).toBe('warm');
    expect(redacted.apiSettings.configs[0]?.model).toBe('gpt-image-1');
    expect(redacted.nested.includeApiKeys).toBe(true);
    // 原对象不得被就地修改，否则运行时持有的 Key 会被清空。
    expect(source.apiSettings.configs[0]?.apiKey).toBe(secret);
    // 写时复制：没有密钥可清时不得白拷贝一整棵设置树。
    const clean = { theme: 'warm', apiSettings: { configs: [{ id: 'a', apiKey: '' }] } };
    expect(sensitiveSettings.redactApiKeysDeep(clean)).toBe(clean);
  });

  it('reports which secrets survived into an export payload', () => {
    expect(sensitiveSettings.findLeakedSecrets(['{"traveler":"荧"}'], [secret])).toEqual([]);
    expect(sensitiveSettings.findLeakedSecrets([`{"旅行者":"${secret}"}`], [secret])).toEqual([secret]);
    expect(sensitiveSettings.findLeakedSecrets(['{}'], ['', '   '])).toEqual([]);
  });

  it('lists apiKey-shaped fields that still carry a non-empty string', () => {
    expect(sensitiveSettings.findApiKeyFieldPaths({
      a: { apiKey: secret },
      b: [{ apiKey: '' }, { apiKey: 7 }],
      deep: { nested: { API_KEY: 'sk-third' } },
      includeApiKeys: true,
    })).toEqual(['$.a.apiKey', '$.deep.nested.API_KEY']);
    expect(sensitiveSettings.findApiKeyFieldPaths({ safe: 'value' })).toEqual([]);
  });
});
