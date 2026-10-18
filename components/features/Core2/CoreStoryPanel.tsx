import { useEffect, useState } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { CoreStoryNode } from '@/core/content/storyCatalog';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CoreStoryEditor } from './CoreStoryEditor';

export function CoreStoryPanel({ controller, snapshot, disabled = false }: { controller: CoreController; snapshot: CoreSnapshot; disabled?: boolean }) {
  const [nodes, setNodes] = useState<CoreStoryNode[]>([]), [selected, setSelected] = useState(''), [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const story = snapshot.records.find(row => row.domain === 'story'), version = story?.version;
  useEffect(() => {
    let live = true; const abort = new AbortController(); setLoading(true); setError(''); setConfirming(false);
    void controller.readStoryCatalog(abort.signal).then(items => { if (live) setNodes(items); }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; abort.abort(); };
  }, [controller, snapshot.head.sessionId, version]);
  const chosen = nodes.find(node => node.nodeId === selected) ?? nodes.find(node => story?.domain === 'story' && node.nodeId === story.value.nodeId) ?? nodes[0];
  const commit = async () => { if (!chosen || disabled || busy) return; setBusy(true); setError('');
    try { await controller.command({ type: 'story_edit', seriesId: chosen.seriesId, chapterId: chosen.chapterId, nodeId: chosen.nodeId }); setConfirming(false); }
    catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  return <section className="core2-card" aria-label="剧情轨道"><h2>剧情轨道</h2><p>当前篇章：{controller.getCurrentStoryTitle()}</p>{loading && <p role="status">正在读取当前剧情资料……</p>}
    {chosen && <><label>选择剧情节点<select aria-label="选择剧情节点" value={chosen.nodeId} disabled={disabled || busy || loading} onChange={event => { setSelected(event.target.value); setConfirming(false); }}>{nodes.map(node => <option key={`${node.seriesId}:${node.nodeId}`} value={node.nodeId}>{node.seriesTitle} · {node.chapterTitle} · {node.title}</option>)}</select></label>
      <article className="core2-record-entry"><h3>{chosen.title}</h3><p>{chosen.goal}</p><p>地点：{chosen.location || '未指定'}</p>{chosen.completionEvidence.length > 0 && <ul>{chosen.completionEvidence.map(item => <li key={item}>{item}</li>)}</ul>}{chosen.referenceText && <details><summary>背景与分支参考（不是已发生经历）</summary><p>{chosen.referenceText}</p></details>}</article>
      <button disabled={disabled || busy || loading} onClick={() => setEditing(true)}>编辑剧情资料</button>
      {editing && <CoreStoryEditor key={`${chosen.nodeId}:${version}`} controller={controller} snapshot={snapshot} node={chosen} disabled={disabled || busy || loading} onClose={() => setEditing(false)} />}
      <button disabled={disabled || busy || loading} onClick={() => setConfirming(true)}>调整到此节点</button>
      {confirming && <div role="group" aria-label="确认剧情调整"><p>这会明确调整当前剧情位置；不会把跳过的节点记为已完成，也不会改变人物已经经历的事实。</p><button disabled={disabled || busy} onClick={() => void commit()}>确认调整剧情</button><button disabled={busy} onClick={() => setConfirming(false)}>取消</button></div>}
    </>}{!loading && !nodes.length && !error && <p>尚无可用的剧情资料。</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
