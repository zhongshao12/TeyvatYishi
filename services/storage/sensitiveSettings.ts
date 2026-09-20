const GITHUB_CLOUD_SAVE_KEY = 'githubCloudSaveConfig';
let githubCloudSessionToken = '';

export function hasPersistentSensitiveValue(key: string, value: unknown): boolean {
  return key === GITHUB_CLOUD_SAVE_KEY
    && isRecord(value)
    && typeof value.token === 'string'
    && value.token.trim().length > 0;
}

/** Capture runtime credentials, but return a representation that is safe for IndexedDB/desktop JSON. */
export function prepareSettingForPersistence(key: string, value: unknown): unknown {
  if (key !== GITHUB_CLOUD_SAVE_KEY || !isRecord(value)) return value;
  const token = typeof value.token === 'string' ? value.token.trim() : '';
  githubCloudSessionToken = token;
  return { ...value, token: '' };
}

/** Restore a session credential and migrate a legacy plaintext value into memory for immediate cleanup. */
export function restoreSettingForRuntime<T>(key: string, value: T): T {
  if (key !== GITHUB_CLOUD_SAVE_KEY || !isRecord(value)) return value;
  const legacyToken = typeof value.token === 'string' ? value.token.trim() : '';
  if (legacyToken) githubCloudSessionToken = legacyToken;
  return { ...value, token: githubCloudSessionToken } as T;
}

export function clearSessionSecretForSetting(key: string): void {
  if (key === GITHUB_CLOUD_SAVE_KEY) githubCloudSessionToken = '';
}

export function resetSessionSecretsForTests(): void {
  githubCloudSessionToken = '';
}
import { isRecord } from '@/utils/valueGuards';
