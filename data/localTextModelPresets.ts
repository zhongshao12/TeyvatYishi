import type { API配置项 } from '@/models/settings';

/** Ollama's context window is set by Modelfile-128k, not by /v1 request fields. */
export const LOCAL_GEMMA4_128K_PROFILE = {
  name: '本地 Gemma4 · 128k',
  provider: 'openai_compatible',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: 'ollama', // Non-secret placeholder required by the shared API editor.
  model: 'gemma4-heretic-128k:latest',
  maxContext: 131072,
  maxTokens: 8192,
  temperature: 0.9,
  topP: 0.95,
  retryCount: 0,
} as const satisfies Partial<API配置项>;
