import type { CoreSnapshot } from '../contracts/state';
import type { Audience } from '../contracts/knowledge';
import type { CoreContentReference } from '../retrieval/contentReferences';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';
import { validateCoreDto } from '../contracts/validation';
import { matchCanonical } from '@/data/canonicalCharacters';
import { buildRetrievalQueryProfile, scoreRetrievalCandidate } from '@/services/retrievalScoring';

interface CodexResourceEntry {
  id: string; 标题: string; 分类: string; 摘要: string; 原文: string; 关键词: string[]; 触发关键词?: string[]; 资料版本?: number;
  注入内容?: { 类型?: string; 核心身份与阵营?: string; 独立人格与行为?: string; 说话方式?: string; 外貌锚点?: string; 演绎红线?: string };
}
export interface CoreCodexEntry { id: string; title: string; category: string; summary: string; text: string; keywords: string[]; version: string; checksum: string; characterBackground: string }
export interface CoreCodexCatalog {
  read(signal?: AbortSignal): Promise<CoreCodexEntry[]>;
  select(input: { snapshot: CoreSnapshot; query: string; audience: Audience; signal?: AbortSignal }): Promise<CoreContentReference[]>;
}
const canonicalName = (name: string) => matchCanonical(name)?.name ?? name.trim();
function adapt(resource: { 条目: readonly CodexResourceEntry[] }): CoreCodexEntry[] {
  const ids = new Set<string>();
  return resource.条目.map(entry => {
    if (!validateCoreDto('sourceRef', { sourceId: entry.id, sourceVersion: 1 }).ok || ids.has(entry.id) || !entry.标题.trim()) throw Error('CORE2_CODEX_RESOURCE_INVALID');
    ids.add(entry.id);
    const characterBackground = entry.注入内容?.类型 === 'character' ? [entry.注入内容.核心身份与阵营, entry.注入内容.独立人格与行为, entry.注入内容.说话方式, entry.注入内容.外貌锚点, entry.注入内容.演绎红线].filter(Boolean).join('\n') : '';
    const value = { id: entry.id, title: entry.标题, category: entry.分类, summary: entry.摘要, text: entry.原文, keywords: [...new Set([...entry.关键词, ...entry.触发关键词 ?? []])], version: String(entry.资料版本 ?? 1), characterBackground };
    return { ...value, checksum: checksumUtf8(stableJson(value)) };
  });
}
/** Content is immutable and shared. A caller's NPC knowledge or save is never cached here. */
export function createCoreCodexCatalog(load: () => Promise<{ 条目: readonly CodexResourceEntry[] }>): CoreCodexCatalog {
  let loading: Promise<CoreCodexEntry[]> | undefined;
  const get = async (signal?: AbortSignal) => {
    if (signal?.aborted) throw Error('CORE2_CODEX_READ_CANCELLED');
    if (!loading) { const work = load().then(adapt); loading = work; void work.catch(() => { if (loading === work) loading = undefined; }); }
    const rows = await loading; if (signal?.aborted) throw Error('CORE2_CODEX_READ_CANCELLED'); return rows;
  };
  const reference = (entry: CoreCodexEntry, text: string, use: CoreContentReference['use'], npcIds: string[]): CoreContentReference => ({ ref: { contentId: entry.id, version: entry.version, checksum: entry.checksum }, name: entry.title, text, use, npcIds });
  return {
    async read(signal) { return structuredClone(await get(signal)); },
    async select(input) {
      if (input.audience.target === 'news' || input.audience.target === 'image') return [];
      if (input.audience.npcIds.length) {
        // Group consumers must use separate per-person contexts; nobody receives
        // another person's identity/biography merely because they share a prompt.
        if (input.audience.npcIds.length !== 1) return [];
        const npc = input.snapshot.records.find(row => row.domain === 'npc' && row.entityId === input.audience.npcIds[0]);
        if (npc?.domain !== 'npc') return [];
        const identity = canonicalName(npc.value.姓名), names = new Set([identity, ...npc.value.aliases.map(canonicalName)]);
        return (await get(input.signal)).filter(entry => entry.category === 'character' && names.has(canonicalName(entry.title)) && entry.characterBackground)
          .slice(0, 1).map(entry => reference(entry, entry.characterBackground, 'known_background', [npc.entityId]));
      }
      const profile = buildRetrievalQueryProfile(input.query); if (!profile) return [];
      return (await get(input.signal)).map(entry => ({ entry, score: scoreRetrievalCandidate(profile, `${entry.title}\n${entry.summary}`, [entry.title, ...entry.keywords]) }))
        .filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, 5)
        .map(({ entry }) => reference(entry, entry.summary || entry.text, 'author_reference', []));
    },
  };
}
