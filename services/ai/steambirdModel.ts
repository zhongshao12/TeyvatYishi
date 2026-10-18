import { normalizeSteambirdNews, normalizeConfirmedSteambirdFacts, type SteambirdArticle } from '@/models/teyvat/steambird';
import type { 提示词模块 } from '@/models/prompts';
import type { API配置项, 蒸汽鸟报API覆盖 } from '@/models/settings';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';
import { chatCompletionNonStream } from './chatCompletionClient';
import { STEAMBIRD_EDITORIAL_RULES_PROMPT } from '@/prompts/subsystems/steambirdPrompt';
import { isRecord } from '@/utils/valueGuards';

export type SteambirdRequestPhase = 'connecting' | 'receiving' | 'validating';
export interface ValidatedSteambirdDraft { title: string; lead: string; body: string; sourceFactIds: string[] }
export function resolveSteambirdApiConfig(override: 蒸汽鸟报API覆盖 | undefined, main: API配置项 | null): API配置项 | null {
  const baseUrl = override?.baseUrl.trim() || main?.baseUrl || '';
  const model = override?.model.trim() || main?.model || '';
  if (!baseUrl.trim() || !model.trim()) return null;
  const now = Date.now();
  return { ...(main ?? { id: '__steambird_api__', name: '蒸汽鸟报独立接口', createdAt: now, updatedAt: now }),
    provider: override?.provider ?? main?.provider ?? 'openai_compatible', baseUrl, model, apiKey: override?.apiKey.trim() || main?.apiKey || '',
    ...(override?.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
    ...(override?.temperature !== undefined ? { temperature: override.temperature } : {}),
    ...(override?.retryCount !== undefined ? { retryCount: override.retryCount } : {}),
  };
}
export async function generateSteambirdArticles(config: API配置项, input: {
  publicFacts: readonly unknown[]; promptModules?: 提示词模块[]; signal?: AbortSignal; maxEntries: number;
  onPhase?: (phase: SteambirdRequestPhase) => void;
}, complete = chatCompletionNonStream): Promise<ValidatedSteambirdDraft[]> {
  if (!config.baseUrl.trim() || !config.model.trim()) throw new Error('蒸汽鸟报未配置有效 API');
  const facts = normalizeConfirmedSteambirdFacts([...input.publicFacts]);
  if (!facts.length) throw new Error('没有已确认公开的事实');
  if (!Number.isSafeInteger(input.maxEntries) || input.maxEntries < 1) throw new Error('报纸条数设置无效');
  const phase = (value: SteambirdRequestPhase) => { try { input.onPhase?.(value); } catch { /* diagnostic observers do not own transport */ } };
  const text = await complete(config, {
    systemPrompt: [STEAMBIRD_EDITORIAL_RULES_PROMPT, buildSteambirdPromptModulesSection(input.promptModules)].filter(Boolean).join('\n\n'),
    messages: [{ role: 'user', content: JSON.stringify({ confirmedPublicFacts: facts, maxEntries: input.maxEntries }) }],
    signal: input.signal, purpose: 'steambird', deepSeekRecovery: 'disabled', onRequestPhase: phase,
  });
  phase('validating');
  const raw: unknown = JSON.parse(text.trim());
  if (!isRecord(raw) || Object.keys(raw).some(key => key !== 'publicArticles') || !Array.isArray(raw.publicArticles) || !raw.publicArticles.length || raw.publicArticles.length > input.maxEntries) throw new Error('蒸汽鸟报输出格式无效');
  const ids = new Set(facts.map(fact => fact.id));
  return raw.publicArticles.map(article => {
    if (!isRecord(article) || Object.keys(article).some(key => !['title', 'lead', 'body', 'sourceFactIds'].includes(key))) throw new Error('报道含非法字段');
    for (const [key, limit] of [['title', 40], ['lead', 180], ['body', 600]] as const) {
      if (typeof article[key] !== 'string' || !article[key].trim() || Array.from(article[key]).length > limit) throw new Error(`报道 ${key} 为空或超过 ${limit} 字`);
    }
    if (!Array.isArray(article.sourceFactIds) || !article.sourceFactIds.length || article.sourceFactIds.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('报道引用了未知或空来源');
    return { title: String(article.title).trim(), lead: String(article.lead).trim(), body: String(article.body).trim(), sourceFactIds: [...new Set(article.sourceFactIds as string[])] };
  });
}

export function buildSteambirdPromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'steambird');
}

export interface SteambirdPublicFact {
  title: string;
  detail: string;
}

export interface SteambirdGenerationRequest {
  publicFacts: SteambirdPublicFact[];
}

export function buildSteambirdGenerationRequest(input: { publicFacts: readonly SteambirdPublicFact[] }): SteambirdGenerationRequest {
  return { publicFacts: input.publicFacts.map((fact) => ({ title: String(fact.title), detail: String(fact.detail) })) };
}

export function normalizeSteambirdGeneration(input: unknown): SteambirdArticle[] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if ('privateArticles' in raw || 'privateFacts' in raw || 'fullState' in raw) return null;
  if (!Array.isArray(raw.publicArticles)) return null;
  return normalizeSteambirdNews({ articles: raw.publicArticles }).articles;
}
