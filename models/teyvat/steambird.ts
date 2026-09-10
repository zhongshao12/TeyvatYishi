export type SteambirdSection = 'local' | 'world' | 'investigation' | 'notice';

export type SteambirdStatus = 'upcoming' | 'ongoing' | 'published' | 'archived';

export interface SteambirdArticle {
  id: string;
  section: SteambirdSection;
  status: SteambirdStatus;
  title: string;
  body: string;
  turn: number;
  timestamp: number;
  important: boolean;
  organizationTags: string[];
  relatedSystems: string[];
  narrativeSeriesId: string;
  narrativeSegmentId: string;
  createdAt: number;
  updatedAt: number;
}

export interface SteambirdNews {
  articles: SteambirdArticle[];
}

export function createEmptySteambirdNews(): SteambirdNews {
  return { articles: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeSteambirdNews(input: unknown): SteambirdNews {
  const raw = isRecord(input) ? input : {};
  return {
    articles: Array.isArray(raw.articles) ? raw.articles.flatMap((value) => {
      if (!isRecord(value)) return [];
      const section = ['local', 'world', 'investigation', 'notice'].includes(String(value.section)) ? value.section as SteambirdSection : 'world';
      const status = ['upcoming', 'ongoing', 'published', 'archived'].includes(String(value.status)) ? value.status as SteambirdStatus : 'published';
      return [{
        id: String(value.id ?? ''), section, status, title: String(value.title ?? ''), body: String(value.body ?? ''),
        turn: Math.max(0, Math.trunc(Number(value.turn) || 0)), timestamp: Number(value.timestamp) || 0,
        important: value.important === true,
        organizationTags: Array.isArray(value.organizationTags) ? value.organizationTags.map(String) : [],
        relatedSystems: Array.isArray(value.relatedSystems) ? value.relatedSystems.map(String) : [],
        narrativeSeriesId: String(value.narrativeSeriesId ?? ''), narrativeSegmentId: String(value.narrativeSegmentId ?? ''),
        createdAt: Number(value.createdAt) || 0, updatedAt: Number(value.updatedAt) || 0,
      }];
    }) : [],
  };
}
