import type { SteambirdNews } from '@/models/teyvat/steambird';
import { buildSteambirdGenerationRequest, type SteambirdPublicFact } from '@/services/ai/steambirdModel';

export function buildSteambirdWorkflowRequest(publicFacts: readonly SteambirdPublicFact[]) {
  return buildSteambirdGenerationRequest({ publicFacts });
}

export function replaceSteambirdNews(current: SteambirdNews, next: SteambirdNews): SteambirdNews {
  if (JSON.stringify(current.articles) === JSON.stringify(next.articles)) return current;
  return { articles: next.articles.map((article) => ({ ...article, organizationTags: [...article.organizationTags], relatedSystems: [...article.relatedSystems] })) };
}

export interface SteambirdGenerationStepResult {
  steambird: SteambirdNews;
  changed: boolean;
  summary?: string;
}

/** 把公开事实压成报纸导语，避免把模型正文或变量原文整段复制进报纸。 */
export function summarizeSteambirdPublicFacts(publicFacts: readonly SteambirdPublicFact[], maxLength = 180): string {
  const sentences = publicFacts
    .flatMap((fact) => fact.detail.replace(/\s+/g, ' ').trim().split(/(?<=[。！？!?；;])/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const selected: string[] = [];
  for (const sentence of sentences) {
    const candidate = [...selected, sentence].join(' ');
    if (candidate.length > maxLength) break;
    selected.push(sentence);
    if (selected.length >= 3) break;
  }
  const summary = selected.join(' ') || publicFacts.find((fact) => fact.detail.trim())?.detail.trim() || '暂无可刊载详情。';
  return summary.length <= maxLength ? summary : `${summary.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function runSteambirdGenerationStep(params: {
  current: SteambirdNews;
  publicFacts: readonly SteambirdPublicFact[];
  turnCount: number;
  now?: number;
}): SteambirdGenerationStepResult | null {
  const request = buildSteambirdWorkflowRequest(params.publicFacts);
  const first = request.publicFacts.find((fact) => fact.title.trim() || fact.detail.trim());
  if (!first) return null;
  const now = params.now ?? Date.now();
  const article = {
    id: `steambird_${params.turnCount}_${now}`,
    section: 'world' as const,
    status: 'published' as const,
    title: first.title.trim() || `第 ${params.turnCount} 回见闻`,
    body: summarizeSteambirdPublicFacts(request.publicFacts),
    turn: Math.max(0, Math.trunc(params.turnCount)),
    timestamp: now,
    important: false,
    organizationTags: [],
    relatedSystems: [],
    narrativeSeriesId: '',
    narrativeSegmentId: '',
    createdAt: now,
    updatedAt: now,
  };
  const steambird = replaceSteambirdNews(params.current, { articles: [article, ...params.current.articles] });
  return { steambird, changed: steambird !== params.current, summary: article.title };
}
