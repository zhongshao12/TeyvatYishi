import { isRecord } from '@/utils/valueGuards';
import type { WorldMoment } from './worldMoment';
import { normalizeWorldMoment } from '@/services/worldMoment';

export type SteambirdSection = 'local' | 'world' | 'investigation' | 'notice';

export type SteambirdStatus = 'upcoming' | 'ongoing' | 'published' | 'archived';

export interface ConfirmedSteambirdFact {
  id: string;
  settlementId: string;
  turn: number;
  title: string;
  detail: string;
  worldMoment: WorldMoment;
  channel: 'public_announcement' | 'public_event' | 'player_confirmed';
  evidence: string;
  confirmation: 'explicit_public_marker' | 'player';
}

/** Whitelist saved provenance; never substitute the current world for missing evidence. */
export function normalizeConfirmedSteambirdFacts(input: unknown): ConfirmedSteambirdFact[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap(value => {
    if (!isRecord(value)) return [];
    const worldMoment = normalizeWorldMoment(value.worldMoment);
    const stringFields = ['id', 'settlementId', 'title', 'detail', 'evidence'] as const;
    if (stringFields.some(field => typeof value[field] !== 'string' || !value[field].trim())) return [];
    if (!isRecord(value.worldMoment) || value.worldMoment.worldName !== '提瓦特' || !worldMoment?.date || !worldMoment.clock || !worldMoment.location || value.turn !== worldMoment.turn || value.settlementId !== worldMoment.settlementId) return [];
    if (!['public_announcement', 'public_event', 'player_confirmed'].includes(String(value.channel))) return [];
    if (value.confirmation !== (value.channel === 'player_confirmed' ? 'player' : 'explicit_public_marker')) return [];
    const id = String(value.id);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, settlementId: String(value.settlementId), turn: worldMoment.turn, title: String(value.title), detail: String(value.detail), evidence: String(value.evidence), worldMoment, channel: value.channel as ConfirmedSteambirdFact['channel'], confirmation: value.confirmation as ConfirmedSteambirdFact['confirmation'] }];
  });
}

export interface SteambirdArticle {
  id: string;
  section: SteambirdSection;
  status: SteambirdStatus;
  title: string;
  body: string;
  lead?: string;
  sourceFactIds?: string[];
  turn: number;
  timestamp: number;
  /** Game-world event time; timestamp/createdAt remain transport time. */
  worldMoment?: WorldMoment;
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
  confirmedFacts?: ConfirmedSteambirdFact[];
}

export function createEmptySteambirdNews(): SteambirdNews {
  return { articles: [] };
}

export function normalizeSteambirdNews(input: unknown): SteambirdNews {
  const raw = isRecord(input) ? input : {};
  return {
    ...(Array.isArray(raw.confirmedFacts) ? { confirmedFacts: normalizeConfirmedSteambirdFacts(raw.confirmedFacts) } : {}),
    articles: Array.isArray(raw.articles) ? raw.articles.flatMap((value) => {
      if (!isRecord(value)) return [];
      const section = ['local', 'world', 'investigation', 'notice'].includes(String(value.section)) ? value.section as SteambirdSection : 'world';
      const status = ['upcoming', 'ongoing', 'published', 'archived'].includes(String(value.status)) ? value.status as SteambirdStatus : 'published';
      const worldMoment = normalizeWorldMoment(value.worldMoment);
      return [{
        id: String(value.id ?? ''), section, status, title: String(value.title ?? ''), body: String(value.body ?? ''),
        turn: Math.max(0, Math.trunc(Number(value.turn) || 0)), timestamp: Number(value.timestamp) || 0,
        important: value.important === true,
        organizationTags: Array.isArray(value.organizationTags) ? value.organizationTags.map(String) : [],
        relatedSystems: Array.isArray(value.relatedSystems) ? value.relatedSystems.map(String) : [],
        narrativeSeriesId: String(value.narrativeSeriesId ?? ''), narrativeSegmentId: String(value.narrativeSegmentId ?? ''),
        createdAt: Number(value.createdAt) || 0, updatedAt: Number(value.updatedAt) || 0,
        ...(worldMoment ? { worldMoment } : {}),
        ...(typeof value.lead === 'string' ? { lead: value.lead } : {}),
        ...(Array.isArray(value.sourceFactIds) ? { sourceFactIds: [...new Set(value.sourceFactIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))] } : {}),
      }];
    }) : [],
  };
}
