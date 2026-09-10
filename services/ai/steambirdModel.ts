import { normalizeSteambirdNews, type SteambirdArticle } from '@/models/teyvat/steambird';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';

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
