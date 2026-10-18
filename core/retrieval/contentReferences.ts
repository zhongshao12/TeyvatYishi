import type { ContentRef } from '../contracts/identity';
import type { Audience } from '../contracts/knowledge';

export interface CoreContentReference { ref: ContentRef; name: string; text: string; use: 'author_reference' | 'known_background'; npcIds: string[] }
/** Catalog entries are read-only references, not remembered gameplay events. */
export function selectCoreContentReferences(entries: readonly CoreContentReference[], audience: Audience): CoreContentReference[] {
  if (audience.target === 'news' || audience.target === 'image') return [];
  return entries.filter(entry => !audience.npcIds.length || entry.use === 'known_background' && audience.npcIds.every(id => entry.npcIds.includes(id))).map(entry => structuredClone(entry));
}
