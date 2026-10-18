import type { CoreSnapshot, StoryContentField } from '../contracts/state';
import type { CoreStoryNode } from './storyCatalog';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';

export const STORY_CONTENT_FIELDS: readonly StoryContentField[] = ['seriesTitle', 'chapterTitle', 'title', 'location', 'goal', 'completionEvidence', 'referenceText'];
export function storyFieldFingerprint(value: string | string[]): string { return checksumUtf8(stableJson(value)); }
export function validStoryFieldValue(field: StoryContentField, value: unknown): value is string | string[] {
  return field === 'completionEvidence' ? Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && !!item.trim() && item.length <= 2000)
    : typeof value === 'string' && value.length <= 40000 && (!['seriesTitle', 'chapterTitle', 'title', 'goal'].includes(field) || !!value.trim());
}
/** Overlay only explicit edits. Untouched fields always use the current resource. */
export function projectCoreStoryCatalog(nodes: readonly CoreStoryNode[], snapshot?: CoreSnapshot): CoreStoryNode[] {
  const story = snapshot?.records.find(row => row.domain === 'story'), edits = story?.domain === 'story' ? story.value.resourceEdits ?? [] : [];
  return nodes.map(node => {
    const result = structuredClone(node);
    result.baseFingerprints = Object.fromEntries(STORY_CONTENT_FIELDS.map(field => [field, storyFieldFingerprint(node[field] ?? '')]));
    const seen = new Set<StoryContentField>();
    for (const edit of edits.filter(row => row.seriesId === node.seriesId && row.nodeId === node.nodeId)) {
      if (seen.has(edit.field) || !STORY_CONTENT_FIELDS.includes(edit.field) || !validStoryFieldValue(edit.field, edit.value)) throw Error('CORE2_STORY_EDIT_INVALID');
      seen.add(edit.field); if (edit.field === 'completionEvidence') result.completionEvidence = [...edit.value as string[]]; else result[edit.field] = edit.value as string;
    }
    return result;
  });
}
