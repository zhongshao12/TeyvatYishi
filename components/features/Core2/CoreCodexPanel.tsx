import { useEffect, useState } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreCodexEntry } from '@/core/content/codexCatalog';
import type { CoreSnapshot } from '@/core/contracts/state';
import { matchCanonical } from '@/data/canonicalCharacters';
import { canRevealNpcMeasurements, normalizeNpcAppearanceFacts, NPC_APPEARANCE_KEYS, npcAppearanceSourceLabel } from '@/services/npcAppearanceFacts';
import { omitNpcAppearanceMeasurements, reconcileNpcAppearanceParagraphs } from '@/utils/npcAppearanceReconciliation';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

const CATEGORY_NAMES: Record<string, string> = { character: '角色', location: '地点', term: '术语', story: '剧情', faction: '势力', event: '事件', enemy: '敌对生物' };
const identity = (value: string) => matchCanonical(value)?.name ?? value.trim();
export function CoreCodexPanel({ controller, snapshot }: { controller: CoreController; snapshot: CoreSnapshot }) {
  const [entries, setEntries] = useState<CoreCodexEntry[]>([]), [category, setCategory] = useState('all'), [query, setQuery] = useState(''), [selected, setSelected] = useState('');
  const [count, setCount] = useState(50), [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true; const abort = new AbortController(); setLoading(true); setError('');
    void controller.readCodex(abort.signal).then(items => { if (live) setEntries(items); }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; abort.abort(); };
  }, [controller, snapshot.head.sessionId, revision]);
  const categories = [...new Set(entries.map(row => row.category))];
  const filtered = entries.filter(row => (category === 'all' || row.category === category) && `${row.title}\n${row.summary}\n${row.text}\n${row.keywords.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const entry = filtered.find(row => row.id === selected) ?? filtered[0];
  const npc = entry?.category === 'character' ? snapshot.records.find(row => row.domain === 'npc' && [row.value.姓名, ...row.value.aliases].some(name => identity(name) === identity(entry.title))) : undefined;
  const measurements = npc?.domain === 'npc' && canRevealNpcMeasurements({ name: npc.value.姓名, aliases: npc.value.aliases, gender: npc.value.gender, description: `${npc.value.说明} ${npc.value.appearance}`, ageConfirmation: npc.value.matureArchive?.ageConfirmation, ageSource: npc.value.matureArchive?.ageConfirmationSource });
  const facts = npc?.domain === 'npc' ? normalizeNpcAppearanceFacts(npc.value.appearanceFacts, !!measurements) : undefined;
  const text = entry ? reconcileNpcAppearanceParagraphs(measurements ? entry.text || entry.summary : omitNpcAppearanceMeasurements(entry.text || entry.summary), facts, 'mixed') : '';
  return <section className="core2-card" aria-label="提瓦特图鉴"><h2>提瓦特图鉴</h2><label>查找图鉴<input aria-label="查找图鉴" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <nav className="core2-panel-actions" aria-label="图鉴分类"><button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>全部</button>{categories.map(key => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{CATEGORY_NAMES[key] ?? key}</button>)}</nav>
    {loading && <p role="status">正在读取图鉴资料……</p>}{error && <p role="alert">{error}<button onClick={() => setRevision(before => before + 1)}>重读图鉴资料</button></p>}
    <nav className="core2-person-list" aria-label="图鉴条目">{filtered.slice(0, count).map(row => <button key={row.id} aria-pressed={entry?.id === row.id} onClick={() => setSelected(row.id)}>{row.title}</button>)}</nav>
    {filtered.length > count && <button onClick={() => setCount(before => before + 50)}>查看更多条目</button>}
    {entry ? <article className="core2-record-entry"><h3>{entry.title}</h3>{facts && <dl className="core2-codex-facts">{NPC_APPEARANCE_KEYS.filter(key => key !== '三围' || measurements).map(key => <div key={key}><dt>{key}</dt><dd>{facts[key]?.value ?? '未记录'}{facts[key] && <small> · {npcAppearanceSourceLabel(facts[key]!.source)}</small>}</dd></div>)}</dl>}<div className="core2-codex-text">{text}</div></article> : !loading && !error && <p>没有符合条件的条目。</p>}
  </section>;
}
