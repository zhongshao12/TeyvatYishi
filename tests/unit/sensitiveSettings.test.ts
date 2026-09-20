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
