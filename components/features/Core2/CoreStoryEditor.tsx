import { useState } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreSnapshot, StoryContentField } from '@/core/contracts/state';
import type { CoreStoryNode } from '@/core/content/storyCatalog';
import { STORY_CONTENT_FIELDS } from '@/core/content/storyEdits';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

const labels: Record<StoryContentField, string> = { seriesTitle: '系列标题（此节点）', chapterTitle: '章节标题（此节点）', title: '场景标题', location: '场景地点', goal: '本节点目标', completionEvidence: '完成依据（每行一项）', referenceText: '背景、事实锚点与可偏离分支' };
export function CoreStoryEditor({ controller, snapshot, node, disabled, onClose }: { controller: CoreController; snapshot: CoreSnapshot; node: CoreStoryNode; disabled: boolean; onClose(): void }) {
  const [field, setField] = useState<StoryContentField>('goal'), [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const story = snapshot.records.find(row => row.domain === 'story'), current = node[field] ?? '', edited = story?.domain === 'story' && story.value.resourceEdits?.some(row => row.seriesId === node.seriesId && row.nodeId === node.nodeId && row.field === field);
  const save = async (action: 'set' | 'reset') => {
    if (disabled || busy || !story || !node.baseFingerprints?.[field]) return;
    setBusy(true); setError('');
    try {
      const text = draft ?? (Array.isArray(current) ? current.join('\n') : current);
      await controller.command({ type: 'story_content', action, seriesId: node.seriesId, nodeId: node.nodeId, field, expectedVersion: story.version, baseFingerprint: node.baseFingerprints[field]!,
        ...(action === 'set' ? { value: field === 'completionEvidence' ? text.split('\n').map(line => line.trim()).filter(Boolean) : text } : {}) });
      onClose();
    } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  return <section className="core2-record-entry" aria-label="剧情资料编辑"><h3>编辑剧情资料</h3><p>仅修改本旅程的参考资料，不会把目标或背景记作已经发生的经历。未编辑字段跟随内置更新；已编辑字段保留，直到你恢复内置值。</p>
    <label>剧情资料字段<select aria-label="剧情资料字段" value={field} disabled={disabled || busy} onChange={event => { setField(event.target.value as StoryContentField); setDraft(null); setError(''); }}>{STORY_CONTENT_FIELDS.map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
    <label>剧情资料内容<textarea aria-label="剧情资料内容" rows={8} value={draft ?? (Array.isArray(current) ? current.join('\n') : current)} disabled={disabled || busy} onChange={event => setDraft(event.target.value)} /></label>
    <button disabled={disabled || busy || draft === null} onClick={() => void save('set')}>保存这个字段</button><button disabled={disabled || busy || !edited} onClick={() => void save('reset')}>恢复这个字段的内置值</button><button disabled={busy} onClick={onClose}>关闭编辑</button>{error && <p role="alert">{error}</p>}
  </section>;
}
