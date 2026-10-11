import type { ConfirmedSteambirdFact, SteambirdArticle, SteambirdNews } from '@/models/teyvat/steambird';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { API配置项 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import { generateSteambirdArticles } from '@/services/ai/steambirdModel';
import { normalizeConfirmedSteambirdFacts, type SteambirdGenerationTask } from '@/models/teyvat/steambird';
import { steambirdIdentity } from '@/services/steambirdPublicFacts';
export interface SteambirdTaskInput { sessionId: number; settlementId: string; turn: number; worldMoment: WorldMoment; facts: readonly ConfirmedSteambirdFact[]; config: API配置项 | null; promptModules?: 提示词模块[]; maxEntries: number; signal?: AbortSignal }
export interface SteambirdTaskResult { status: 'success' | 'skipped' | 'failed'; articles: SteambirdArticle[]; reason?: string }
const attempts = new Map<string, Promise<SteambirdTaskResult>>();
export function steambirdTaskId(input: Pick<SteambirdTaskInput, 'settlementId' | 'facts'>): string {
  return `news_${steambirdIdentity(JSON.stringify([input.settlementId, input.facts.map(fact => fact.id).sort()]))}`;
}
export function mergeSteambirdArticles(current: SteambirdNews, articles: readonly SteambirdArticle[]): SteambirdNews {
  const ids = new Set(current.articles.map(article => article.id));
  return { ...current, articles: [...articles.filter(article => !ids.has(article.id)), ...current.articles] };
}
/** Apply a local recovery/retry result without replacing evidence added while the model awaited. */
export function mergeSteambirdTaskResult(current: SteambirdNews, base: SteambirdNews, result: SteambirdNews): SteambirdNews {
  const mergeById = <T extends { id: string }>(live: readonly T[], before: readonly T[], after: readonly T[]): T[] => {
    const baseIds = new Set(before.map(item => item.id));
    const liveIds = new Set(live.map(item => item.id));
    return [...live, ...after.filter(item => !liveIds.has(item.id) && !baseIds.has(item.id))];
  };
  const liveTasks = new Map((current.generationTasks ?? []).map(task => [task.id, task]));
  const baseTasks = new Map((base.generationTasks ?? []).map(task => [task.id, task]));
  for (const task of result.generationTasks ?? []) {
    const live = liveTasks.get(task.id), before = baseTasks.get(task.id);
    if (!before || live && JSON.stringify(live) === JSON.stringify(before)) liveTasks.set(task.id, task);
  }
  return { ...current,
    articles: mergeById(current.articles, base.articles, result.articles),
    confirmedFacts: normalizeConfirmedSteambirdFacts(mergeById(current.confirmedFacts ?? [], base.confirmedFacts ?? [], result.confirmedFacts ?? [])),
    generationTasks: [...liveTasks.values()],
  };
}
export async function runPostTurnSteambirdTask(input: SteambirdTaskInput): Promise<SteambirdTaskResult> {
  const frozen = { ...input, worldMoment: structuredClone(input.worldMoment), facts: normalizeConfirmedSteambirdFacts([...input.facts]) };
  if (!frozen.facts.length) return { status: 'skipped', articles: [], reason: '没有尚未报道的已确认公开事实。' };
  if (frozen.worldMoment.settlementId !== frozen.settlementId || frozen.worldMoment.turn !== frozen.turn) return { status: 'failed', articles: [], reason: '报纸任务时刻与结算不一致。' };
  const id = steambirdTaskId(frozen), key = `${input.sessionId}:${id}`;
  const existing = attempts.get(key); if (existing) return structuredClone(await existing);
  const attempt = (async (): Promise<SteambirdTaskResult> => {
    try {
      if (!frozen.config) throw new Error('蒸汽鸟报未配置有效 API');
      const drafts = await generateSteambirdArticles(frozen.config, { publicFacts: frozen.facts, promptModules: frozen.promptModules, signal: frozen.signal, maxEntries: frozen.maxEntries });
      const now = Date.now();
      return { status: 'success', articles: drafts.map((draft, index) => ({ ...draft, id: `${id}_${index}`, section: 'world', status: 'published', turn: frozen.turn, timestamp: now, worldMoment: frozen.worldMoment, important: false, organizationTags: [], relatedSystems: [], narrativeSeriesId: '', narrativeSegmentId: '', createdAt: now, updatedAt: now })) };
    } catch (error) { return { status: 'failed', articles: [], reason: error instanceof Error ? error.message : '蒸汽鸟报生成失败' }; }
  })();
  attempts.set(key, attempt);
  const result = await attempt;
  if (result.status === 'failed') attempts.delete(key);
  else if (attempts.size > 128) attempts.delete(attempts.keys().next().value!);
  return structuredClone(result);
}
export async function executeSteambirdTaskForSession(input: SteambirdTaskInput, owner: { read: () => SteambirdNews; update: (updater: (current: SteambirdNews) => SteambirdNews) => void; isCurrent: () => boolean }): Promise<SteambirdTaskResult> {
  if (!owner.isCurrent()) return { status: 'skipped', articles: [], reason: '存档已切换，旧报纸任务已丢弃。' };
  const frozen = { ...input, facts: normalizeConfirmedSteambirdFacts([...input.facts]), worldMoment: structuredClone(input.worldMoment) }, id = steambirdTaskId(input);
  if (!frozen.facts.length) return { status: 'skipped', articles: [], reason: '没有尚未报道的已确认公开事实。' };
  if (owner.read().generationTasks?.some(task => task.id === id && task.status === 'success')) return { status: 'skipped', articles: [], reason: '同一事实任务已经完成。' };
  const record: SteambirdGenerationTask = { id, settlementId: frozen.settlementId, turn: frozen.turn, worldMoment: frozen.worldMoment, facts: frozen.facts, status: 'pending' };
  const updateRecord = (current: SteambirdNews, next: SteambirdGenerationTask): SteambirdNews => ({ ...current, confirmedFacts: normalizeConfirmedSteambirdFacts([...(current.confirmedFacts ?? []), ...frozen.facts]), generationTasks: [...(current.generationTasks ?? []).filter(task => task.id !== id), next] });
  owner.update(current => owner.isCurrent() ? updateRecord(current, record) : current);
  const result = await runPostTurnSteambirdTask(frozen);
  if (!owner.isCurrent()) return { status: 'skipped', articles: [], reason: '存档已切换，旧报纸结果已丢弃。' };
  owner.update(current => owner.isCurrent() ? updateRecord(mergeSteambirdArticles(current, result.articles), { ...record, status: result.status === 'success' ? 'success' : 'failed', ...(result.reason ? { reason: result.reason } : {}) }) : current);
  return result;
}
