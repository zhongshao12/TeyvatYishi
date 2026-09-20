import type { API配置项 } from '@/models/settings';
import { testConnection } from './apiTools';

const CONNECTION_TEST_PREFIX = 'KT-';

export function createConnectionTestChallenge(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前浏览器不支持安全随机数，无法执行可靠的连接测试。');
  }
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return `${CONNECTION_TEST_PREFIX}${(values[0] ?? 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

export function normalizeConnectionTestResponse(response: unknown): string {
  return typeof response === 'string' ? response.trim() : '';
}

export function matchesConnectionTestChallenge(response: unknown, challenge: string): boolean {
  return normalizeConnectionTestResponse(response) === challenge;
}

/**
 * W17 模型快捷切换：切换前快速跑一次连接测试。
 * 通过返回 true；失败返回 false（调用方保持原档案）。
 */
export async function quickTestApiConfig(config: API配置项, enableClaudeMode = false): Promise<boolean> {
  const result = await testConnection({
    ...config,
    enableClaudeMode,
    retryCount: config.retryCount ?? 1,
  });
  return result.ok === true;
}
