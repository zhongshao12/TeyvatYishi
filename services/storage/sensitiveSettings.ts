import { isRecord } from '@/utils/valueGuards';

const GITHUB_CLOUD_SAVE_KEY = 'githubCloudSaveConfig';
let githubCloudSessionToken = '';

/**
 * 敏感设置策略。
 *
 * - `session-only`：只在内存里保留，落盘一律清空（GitHub PAT 走这条）。
 * - `device-local`：确实携带供应商密钥，但产品要求跨会话/跨设备可用，
 *   因此按「本机持久化」处理：落盘保留 + 导出/备份边界剥离 + 明确的残留风险记录。
 *
 * 这里把策略显式化，替代原来「只认一个 key 的隐式白名单」——
 * 后者让 `apiSettings` 这类明显含密钥的设置落在分支外，既不脱敏也不被审计。
 *
 * 注意：`apiSettings` 目前**有意**不是 `session-only`（落盘清空会让重启后所有供应商 Key 失效，
 * 而这正是主剧情/变量/记忆的唯一凭证）。若将来真要把它改成 `session-only`，
 * 必须同时处理 `apiProfileSlots` 与 `gameSettings` 里的同一批 Key，并把
 * `tests/unit/sensitiveSettings.test.ts` 的 `does not alter unrelated settings` 换成一个真正无关的 key。
 */
export type SensitiveSettingPolicy = 'session-only' | 'device-local';

const SENSITIVE_SETTING_POLICIES: Record<string, SensitiveSettingPolicy> = {
  githubCloudSaveConfig: 'session-only',
  apiSettings: 'device-local',
  apiProfileSlots: 'device-local',
};

export function getSensitiveSettingPolicy(key: string): SensitiveSettingPolicy | null {
  return SENSITIVE_SETTING_POLICIES[key] ?? null;
}

export function isSensitiveSettingKey(key: string): boolean {
  return getSensitiveSettingPolicy(key) !== null;
}

/** 承载供应商 API Key 的字段名（apiKey / api_key / APIKEY …）。 */
const API_KEY_FIELD_PATTERN = /^api[_-]?keys?$/iu;

function isApiKeyFieldName(key: string): boolean {
  return API_KEY_FIELD_PATTERN.test(key);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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

/** 收集一个设置/存档值里出现的全部非空供应商密钥。 */
export function collectApiKeySecrets(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectApiKeySecrets(item, found);
    return found;
  }
  if (!isRecord(value)) return found;
  for (const [key, item] of Object.entries(value)) {
    if (isApiKeyFieldName(key)) {
      if (isNonEmptyText(item)) found.push(item);
      continue;
    }
    collectApiKeySecrets(item, found);
  }
  return found;
}

/** 列出仍然携带非空字符串的 apiKey 字段路径，用于校验产物里没有漏网的密钥字段。 */
export function findApiKeyFieldPaths(value: unknown, prefix = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findApiKeyFieldPaths(item, `${prefix}[${index}]`));
  }
  if (!isRecord(value)) return [];
  const paths: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (isApiKeyFieldName(key)) {
      if (isNonEmptyText(item)) paths.push(path);
      continue;
    }
    paths.push(...findApiKeyFieldPaths(item, path));
  }
  return paths;
}

/**
 * 深拷贝并清空所有 apiKey 字段；原对象保持不变（运行时仍然持有密钥）。
 * 写时复制：整棵树里没有需要清空的密钥时直接返回原引用，避免每次导出都整份深拷贝。
 */
export function redactApiKeysDeep<T>(value: T): T {
  return redactApiKeysInValue(value) as T;
}

function redactApiKeysInValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = redactApiKeysInValue(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? mapped : value;
  }
  if (!isRecord(value)) return value;
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isApiKeyFieldName(key)) {
      const nextValue = isNonEmptyText(item) ? '' : item;
      if (nextValue !== item) changed = true;
      result[key] = nextValue;
      continue;
    }
    const next = redactApiKeysInValue(item);
    if (next !== item) changed = true;
    result[key] = next;
  }
  return changed ? result : value;
}

/** 返回给定文本里仍然能找到的密钥（用于导出产物的真实检测）。 */
export function findLeakedSecrets(texts: readonly string[], secrets: readonly string[]): string[] {
  const candidates = secrets.map((secret) => secret.trim()).filter((secret) => secret.length > 0);
  if (!candidates.length) return [];
  return candidates.filter((secret) => texts.some((text) => text.includes(secret)));
}
