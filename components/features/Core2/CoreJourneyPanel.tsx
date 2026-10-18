import { useState } from 'react';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import type { Talent } from '@/models/teyvat/character';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

const ELEMENT_NAMES: Record<ElementId, string> = { anemo: '风', geo: '岩', electro: '雷', dendro: '草', hydro: '水', pyro: '火', cryo: '冰' };
const QUEST_STATUS = { not_started: '未开始', active: '进行中', completed: '已完成', failed: '已失败', abandoned: '已放弃' };
type Page = 'quests' | 'map' | 'elements';
interface Props { page: Page; snapshot: CoreSnapshot; disabled?: boolean; talents: readonly Talent[]; onCommand(command: BasicPlayerCommand): Promise<unknown> }

export function CoreJourneyPanel({ page, snapshot, disabled = false, talents, onCommand }: Props) {
  const player = snapshot.records.find(row => row.domain === 'traveler'), world = snapshot.records.find(row => row.domain === 'world');
  const [query, setQuery] = useState(''), [element, setElement] = useState<ElementId>(player?.domain === 'traveler' && player.value.主元素 || 'anemo');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const execute = async (command: BasicPlayerCommand) => { if (disabled || busy) return; setBusy(true); setError(''); try { await onCommand(command); } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); } };
  if (page === 'quests') return <section className="core2-card" aria-label="任务"><h2>旅途委托</h2><label>查找任务<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    {snapshot.records.flatMap(row => row.domain === 'quest' && `${row.value.title} ${row.value.description}`.includes(query.trim()) ? [<article className="core2-record-entry" key={row.entityId}><h3>{row.value.title}</h3><p>{QUEST_STATUS[row.value.status]}</p><p>{row.value.description}</p>
      <ul>{row.value.objectives.map(objective => <li key={objective.id}>{objective.description} · {objective.currentCount}/{objective.targetCount}{objective.completed ? ' · 已达成' : ''}</li>)}</ul>{row.value.rewards.length > 0 && <p>奖励：{row.value.rewards.join('、')}</p>}{row.value.notes && <p>{row.value.notes}</p>}</article>] : [])}
    {!snapshot.records.some(row => row.domain === 'quest') && <p>尚无已记录的任务。</p>}</section>;
  if (page === 'map') return <section className="core2-card" aria-label="地图"><h2>旅行地图</h2><p>当前地点：{world?.domain === 'world' ? world.value.moment.location : '未记录'}</p><label>查找地点<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    {snapshot.records.flatMap(row => row.domain === 'map' && row.value.name.includes(query.trim()) ? [<article className="core2-record-entry" key={row.entityId}><h3>{row.value.name}</h3><p>{row.value.visited ? '已到访' : '尚未探索'}</p><button disabled={disabled || busy || !row.value.visited || world?.domain === 'world' && world.value.moment.locationId === row.entityId} onClick={() => void execute({ type: 'map', locationId: row.entityId })}>前往{row.value.name}</button></article>] : [])}
    {!snapshot.records.some(row => row.domain === 'map') && <p>尚无已记录的地图位置。</p>}{error && <p role="alert">{error}</p>}</section>;
  if (player?.domain !== 'traveler') return <p role="alert">旅人资料缺失，不能修改元素或天赋。</p>;
  const awakened = player.value.元素共鸣.some(row => row.element === element && row.unlocked);
  const available = awakened ? talents.filter(row => row.关联元素 === element) : [];
  return <section className="core2-card" aria-label="元素与天赋"><h2>元素与天赋</h2><nav className="core2-panel-actions" aria-label="查看元素">{ELEMENT_IDS.map(id => <button key={id} aria-pressed={element === id} onClick={() => setElement(id)}>{ELEMENT_NAMES[id]}元素</button>)}</nav>
    <p>{awakened ? `已觉醒${ELEMENT_NAMES[element]}元素` : `尚未觉醒${ELEMENT_NAMES[element]}元素，不能切换或装备相关天赋。`}</p>
    <button disabled={disabled || busy || !awakened || player.value.主元素 === element} onClick={() => void execute({ type: 'element', element })}>切换为{ELEMENT_NAMES[element]}元素</button>
    {available.map(template => { const equipped = player.value.天赋.find(row => row.id === template.id); return <CoreTalentField key={`${player.entityId}:${template.id}`} template={template} level={equipped?.等级 ?? template.等级} equipped={!!equipped} disabled={disabled || busy} onSave={level => onCommand({ type: 'talent', talentId: template.id, element: template.关联元素, level })} />; })}
    {awakened && !available.length && <p>该元素尚无已登记的天赋资料。</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
function CoreTalentField({ template, level, equipped, disabled, onSave }: { template: Talent; level: number; equipped: boolean; disabled: boolean; onSave(level: number): Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <article className="core2-record-entry"><h3>{template.名称}</h3><p>{template.说明}</p><form className="core2-record-field" onSubmit={event => {
    event.preventDefault(); if (busy || disabled) return; setBusy(true); setError('');
    void onSave(Number(draft ?? level)).then(() => setDraft(null)).catch(failure => setError(sanitizeApiErrorReportText(String(failure)))).finally(() => setBusy(false));
  }}><label>{template.名称}等级<input aria-label={`${template.名称}等级`} type="number" min={1} max={20} step={1} value={draft ?? level} disabled={disabled || busy} onChange={event => setDraft(event.target.value)} /></label>
    <button disabled={disabled || busy || equipped && draft === null}>{equipped ? `保存${template.名称}等级` : `装备${template.名称}`}</button>{error && <p role="alert">{error}</p>}</form></article>;
}
