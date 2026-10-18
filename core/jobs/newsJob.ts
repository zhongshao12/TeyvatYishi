import type { CoreRepository } from '../contracts/storage';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import type { CoreScope } from '../contracts/identity';
import type { SourceRecord } from '../contracts/event';
import type { MemoryContextBundle } from '../retrieval/recallTypes';
import type { ValidatedSteambirdDraft } from '@/services/ai/steambirdModel';
import { readCoreJob, runCoreJob, type CoreJobRunInput } from './jobRunner';
import { readCoreNewsPlan, serializeCoreNewsPlan } from './newsPlan';
import { freezeSource } from '../sources/sourceRecords';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { sameScope, sameData, stableJson } from '../persistence/repositoryValidation';
import { commitHostPublication, hostPublicationEvent } from '../settlement/commitHostPublication';

export interface CoreNewsOutput { kind: 'empty' | 'generated'; articles: ValidatedSteambirdDraft[]; bundle: MemoryContextBundle }
export interface CoreNewsModels { generate(snapshot: CoreSnapshot, signal: AbortSignal): Promise<CoreNewsOutput>; getModelIdentity(): string; getAutomaticInterval?(): number | undefined }
export interface CoreNewsDependencies { repo: CoreRepository; models: CoreNewsModels; getActiveSession(): { scope: CoreScope; sessionId: string } | null }
export async function requestCoreNews(input: { scope: CoreScope; sessionId: string; operationId: string }, deps: CoreNewsDependencies) {
  const key = checksumUtf8(stableJson([input.scope, input.operationId])), sourceRef = { sourceId: 'news-request-' + key, sourceVersion: 1 };
  const prior = await deps.repo.readOperation(input.scope, input.operationId);
  if (prior?.receipt && prior.status === 'committed') {
    const jobId = 'news-job-' + key, job = await readCoreJob(deps.repo, input.scope, jobId), frozen = await deps.repo.readSource(sourceRef);
    if (prior.kind !== 'manual' || !sameData(prior.sourceRefs, [sourceRef]) || !prior.receipt.jobIds.includes(jobId)
      || !job || !frozen || frozen.operationId !== input.operationId || frozen.kind !== 'manual' || frozen.blocks[0]?.text !== job.configFingerprint) throw Error('CORE2_NEWS_OPERATION_ID_REUSED');
    readCoreNewsPlan(job);
    return { ...prior.receipt, status: 'already_committed' as const };
  }
  const snapshot = await deps.repo.readState(input.scope), world = snapshot.records.find(row => row.domain === 'world');
  if (world?.domain !== 'world' || snapshot.head.sessionId !== input.sessionId || !sameData(deps.getActiveSession(), { scope: input.scope, sessionId: input.sessionId })) throw Error('CORE2_NEWS_SESSION_CHANGED');
  const plan = { version: 1 as const, scope: input.scope, anchorOperationId: input.operationId, publicationOperationId: 'news-publication-' + key, issueId: 'issue-' + key, outputSourceRef: { sourceId: 'news-output-' + key, sourceVersion: 1 }, modelIdentity: deps.models.getModelIdentity() };
  const fingerprint = serializeCoreNewsPlan(plan), saved = await deps.repo.readSource(sourceRef);
  const source = saved ?? { ...freezeSource({ scope: input.scope, operationId: input.operationId, kind: 'manual', moment: world.value.moment, blocks: [{ blockId: 'news-request', kind: 'configuration', text: fingerprint }] }), ref: sourceRef };
  if (source.blocks[0]?.text !== fingerprint) throw Error('CORE2_NEWS_REQUEST_CHANGED');
  const job = { jobId: 'news-job-' + key, scope: input.scope, sessionId: input.sessionId, kind: 'news' as const, operationId: input.operationId, sourceRefs: [source.ref], status: 'pending' as const, leaseId: null, configFingerprint: fingerprint, attempts: 0, steps: [], version: 1 };
  return commitHostPublication(deps.repo, source, { sessionId: input.sessionId, readSet: [], changes: [], events: [], jobs: [job] });
}
/** Display data contains no internal evidence JSON; citations stay in typed metadata. */
export function readCoreNewsArticles(source: SourceRecord): { title: string; lead: string; body: string; eventIds: string[] }[] {
  if (source.kind !== 'news') throw Error('CORE2_NEWS_SOURCE_INVALID');
  if (source.blocks.length === 1 && source.blocks[0]?.blockId === 'empty' && source.blocks[0]?.text === '没有已确认公开的事实可供报道。' && !source.publicCitations?.length) return [];
  if (!source.publicCitations || source.publicCitations.length !== source.blocks.length || source.blocks.length > 5) throw Error('CORE2_NEWS_SOURCE_INVALID');
  return source.blocks.map(block => {
    const data: unknown = JSON.parse(block.text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 3 || !Object.keys(data).every(key => ['title', 'lead', 'body'].includes(key))) throw Error('CORE2_NEWS_ARTICLE_INVALID');
    const row = data as { title: string; lead: string; body: string };
    for (const [key, limit] of [['title', 40], ['lead', 180], ['body', 600]] as const) if (typeof row[key] !== 'string' || !row[key].trim() || Array.from(row[key]).length > limit) throw Error('CORE2_NEWS_ARTICLE_INVALID');
    const citations = source.publicCitations!.filter(row => row.blockId === block.blockId);
    if (citations.length !== 1 || !citations[0]!.eventIds.length) throw Error('CORE2_NEWS_CITATION_MISSING');
    return { ...row, eventIds: [...new Set(citations[0]!.eventIds)] };
  });
}
export async function runCoreNewsJob(input: CoreJobRunInput, deps: CoreNewsDependencies) {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId); if (!job) throw Error('CORE2_NEWS_JOB_MISSING');
  const plan = readCoreNewsPlan(job);
  const current = async (signal: AbortSignal, requireModel = false) => {
    const head = await deps.repo.readHead(input.scope), live = await readCoreJob(deps.repo, input.scope, input.jobId);
    if (signal.aborted || head.sessionId !== input.sessionId || !sameData(deps.getActiveSession(), { scope: input.scope, sessionId: input.sessionId }) || !live || live.status === 'cancelled') throw Error('CORE2_NEWS_CANCELLED');
    if (requireModel && plan.modelIdentity !== deps.models.getModelIdentity()) throw Error('简报模型已改变；请显式重试，未混用旧结果。');
  };
  const citations = async (source: SourceRecord) => {
    if (!sameScope(source.scope, input.scope) || source.operationId !== plan.publicationOperationId || !sameData(source.ref, plan.outputSourceRef)) throw Error('CORE2_NEWS_OUTPUT_BINDING');
    const articles = readCoreNewsArticles(source), ids = [...new Set(articles.flatMap(row => row.eventIds))];
    const head = await deps.repo.readHead(input.scope);
    const found = ids.length ? (await deps.repo.queryEvents({ scope: input.scope, cutoffSeq: head.coreSeq, eventIds: ids, limit: 200 })).items : [];
    if (found.length !== ids.length || found.some(event => event.visibility.kind !== 'public' || /^(?:communication\.|player\.|publication\.)/u.test(event.type) || event.type === 'turn.complete')) throw Error('CORE2_NEWS_NON_PUBLIC_CITATION');
    return { articles, ids };
  };
  return runCoreJob(input, { repo: deps.repo, getActiveSession: deps.getActiveSession, handlers: { news: { fingerprint: job.configFingerprint,
    steps: [{ stepId: 'generate-news-v1', run: async ({ signal }) => {
      if ((await deps.repo.readOperation(input.scope, plan.publicationOperationId))?.status === 'committed') return [];
      const saved = await deps.repo.readSource(plan.outputSourceRef); if (saved) { await citations(saved); return []; }
      await current(signal, true); const snapshot = await deps.repo.readState(input.scope), world = snapshot.records.find(row => row.domain === 'world'); if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
      const output = await deps.models.generate(snapshot, signal); await current(signal, true);
      if ((output.kind === 'empty') !== (output.articles.length === 0) || output.articles.length > 5) throw Error('CORE2_NEWS_RESULT_INVALID');
      const source = { ...freezeSource({ scope: input.scope, operationId: plan.publicationOperationId, kind: 'news', moment: world.value.moment,
        blocks: output.articles.length ? output.articles.map((row, index) => ({ blockId: 'article-' + index, kind: 'message' as const, text: stableJson({ title: row.title, lead: row.lead, body: row.body }) })) : [{ blockId: 'empty', kind: 'message', text: '没有已确认公开的事实可供报道。' }],
        publicCitations: output.articles.map((row, index) => ({ blockId: 'article-' + index, eventIds: row.sourceFactIds })),
        delivery: { version: 1, bundles: [{ bundleId: output.bundle.bundleId, target: 'news', npcIds: [], selectedLeafIds: output.bundle.selectedLeafIds }], worldbookEntryIds: [] },
      }), ref: plan.outputSourceRef };
      await citations(source); await current(signal, true); await deps.repo.putSource(source); return [];
    } }], finalize: async ({ signal, job: owned }) => {
      if ((await deps.repo.readOperation(input.scope, plan.publicationOperationId))?.status === 'committed') return;
      const source = await deps.repo.readSource(plan.outputSourceRef); if (!source) throw Error('CORE2_NEWS_OUTPUT_MISSING');
      const content = await citations(source); await current(signal); if (!content.articles.length) return;
      const record: StateRecord<'news'> = { scope: input.scope, domain: 'news', entityId: plan.issueId, version: 1, value: { issueId: plan.issueId, sourceRef: source.ref, eventIds: content.ids, moment: source.moment } };
      const change = { ref: { domain: 'news' as const, entityId: plan.issueId, version: 0 }, before: null, after: record, effectKey: 'effect-' + plan.issueId };
      const receipt = await commitHostPublication(deps.repo, source, { sessionId: input.sessionId, readSet: [change.ref], changes: [change], events: [hostPublicationEvent(source, 'publication.news', [change])], jobs: [], jobGuard: { jobId: owned.jobId, leaseId: owned.leaseId!, expectedVersion: owned.version, sourceRefs: owned.sourceRefs } });
      if (receipt.status !== 'committed' && receipt.status !== 'already_committed') throw Error('CORE2_NEWS_PUBLICATION_' + receipt.status);
    },
  } } });
}
