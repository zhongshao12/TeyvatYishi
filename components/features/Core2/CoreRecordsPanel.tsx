import { useState, type FormEvent } from 'react';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { CoreRepository } from '@/core/contracts/storage';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CoreAvatar } from './CoreAvatar';

export type CoreRecordsPage = 'profile' | 'companions' | 'inventory';
const TRAVELER_FIELDS = ['姓名', '别名', '性别', '年龄', '生日', '身高', '身份', '外貌', '性格', '背景'] as const;
const NPC_FIELDS = { appearance: '外貌', clothing: '常用穿着', personality: '性格', speechStyle: '说话方式', playerAddress: '对玩家的称呼' } as const;

/** A dirty field is not reset by unrelated background refreshes. Each save is an explicit atomic command. */
function RecordField({ label, value, disabled, onSave }: { label: string; value: string | number; disabled: boolean; onSave(value: string | number): Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (disabled || busy || draft === null) return;
    setBusy(true); setError('');
    try { await onSave(typeof value === 'number' ? Number(draft) : draft); setDraft(null); }
    catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); }
    finally { setBusy(false); }
  };
  return <form className="core2-record-field" onSubmit={event => void submit(event)}><label>{label}<input aria-label={label} type={typeof value === 'number' ? 'number' : 'text'} value={draft ?? String(value)} disabled={disabled || busy} onChange={event => setDraft(event.target.value)} /></label>
    <button type="submit" disabled={disabled || busy || draft === null}>{busy ? '保存中…' : `保存${label}`}</button>{draft !== null && <button type="button" disabled={busy} onClick={() => setDraft(null)}>撤销未保存修改</button>}{error && <p role="alert">{error}</p>}
  </form>;
}

export function CoreRecordsPanel({ page, repo, snapshot, disabled, onCommand, onCompleteProfile }: { page: CoreRecordsPage; repo: CoreRepository; snapshot: CoreSnapshot; disabled: boolean; onCommand(command: BasicPlayerCommand): Promise<unknown>; onCompleteProfile?(npcId: string): Promise<unknown> }) {
  const [search, setSearch] = useState(''), [archived, setArchived] = useState(false), [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (command: BasicPlayerCommand) => { setBusy(true); setError(''); try { await onCommand(command); } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); } };
  const locked = disabled || busy;
  if (page === 'profile') {
    const player = snapshot.records.find(row => row.domain === 'traveler');
    return <section className="core2-card" aria-label="旅人档案"><h2>旅人档案</h2>{player?.domain === 'traveler' && <><CoreAvatar repo={repo} snapshot={snapshot} entityId={player.entityId} />
      <p>等级 {player.value.level} · 生命 {player.value.health} · 经验 {player.value.experience}</p>
      {TRAVELER_FIELDS.map(field => <RecordField key={`${player.entityId}:${field}`} label={field} value={player.value[field]} disabled={locked} onSave={value => onCommand({ type: 'edit_traveler', field, value })} />)}</>}
    </section>;
  }
  if (page === 'inventory') return <section className="core2-card" aria-label="背包"><h2>背包</h2>
    {snapshot.records.flatMap(row => row.domain === 'inventory' ? row.value.kind === 'wallet' ? [<p key={row.entityId}>摩拉：{row.value.mora}</p>] : row.value.status === 'owned' && row.value.quantity > 0 ? [<article className="core2-record-entry" key={row.entityId}><h3>{row.value.name} × {row.value.quantity}</h3><p>{row.value.description || '尚无详细说明。'}</p>
      <button disabled={locked} onClick={() => void run({ type: 'inventory', action: 'consume', itemId: row.entityId, quantity: 1 })}>使用1件</button><button disabled={locked} onClick={() => void run({ type: 'inventory', action: 'discard', itemId: row.entityId, quantity: 1 })}>丢弃1件</button></article>] : [] : [])}
    {error && <p role="alert">{error}</p>}</section>;
  const npcs = snapshot.records.filter(row => row.domain === 'npc' && !!row.value.archived === archived && `${row.value.姓名} ${row.value.地区} ${row.value.身份}`.includes(search.trim()));
  const person = npcs.find(row => row.entityId === selected) ?? npcs[0];
  const contact = person && snapshot.records.find(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === person.entityId);
  return <section className="core2-card" aria-label="同伴"><h2>{archived ? '归档角色' : '同伴'}</h2><div className="core2-panel-actions"><label>查找同伴<input aria-label="查找同伴" value={search} onChange={event => setSearch(event.target.value)} /></label><button onClick={() => setArchived(value => !value)}>{archived ? '返回同伴' : '查看已归档'}</button></div>
    <nav className="core2-person-list" aria-label="同伴列表">{npcs.map(row => <button key={row.entityId} aria-pressed={person?.entityId === row.entityId} onClick={() => setSelected(row.entityId)}>{row.domain === 'npc' ? row.value.姓名 : ''}</button>)}</nav>
    {person?.domain === 'npc' ? <article key={person.entityId}><CoreAvatar repo={repo} snapshot={snapshot} entityId={person.entityId} /><h3>{person.value.姓名}</h3><p>{person.value.地区} · {person.value.身份} · {person.value.relationship}</p>
      {onCompleteProfile && <button disabled={locked || archived || !person.value.canonical} onClick={() => { setBusy(true); setError(''); void onCompleteProfile(person.entityId).catch(failure => setError(sanitizeApiErrorReportText(String(failure)))).finally(() => setBusy(false)); }}>补齐空白的公开资料</button>}
      {person.value.appearanceFacts && <dl>{Object.entries(person.value.appearanceFacts).map(([key, fact]) => fact && <div key={key}><dt>{key}</dt><dd>{fact.value} · {fact.source === 'ai_estimate' ? 'AI推测' : fact.source === 'manual' ? '玩家编辑' : '已登记资料'}</dd></div>)}</dl>}
      <RecordField label="姓名" value={person.value.姓名} disabled={locked || person.value.canonical === true} onSave={value => onCommand({ type: 'edit_npc', npcId: person.entityId, field: '姓名', value })} />
      <RecordField label="好感度" value={person.value.affinity} disabled={locked} onSave={value => onCommand({ type: 'edit_npc', npcId: person.entityId, field: 'affinity', value })} />
      {(Object.keys(NPC_FIELDS) as (keyof typeof NPC_FIELDS)[]).map(field => <RecordField key={field} label={NPC_FIELDS[field]} value={person.value[field]} disabled={locked} onSave={value => onCommand({ type: 'edit_npc', npcId: person.entityId, field, value })} />)}
      <button disabled={locked} onClick={() => void run({ type: 'edit_npc', npcId: person.entityId, field: 'archived', value: !archived })}>{archived ? '恢复此角色' : '归档此角色'}</button>
      <button disabled={locked || !(person.value.firstSeenTurn > 0 || person.value.travelingTogether || person.value.affinity > 0)} onClick={() => void run({ type: 'contact', npcId: person.entityId, action: contact?.domain === 'courier' && contact.value.kind === 'contact' && contact.value.available ? 'remove' : 'add' })}>{contact?.domain === 'courier' && contact.value.kind === 'contact' && contact.value.available ? '移出手机联系人' : '加入手机联系人'}</button>
    </article> : <p>没有符合条件的角色。</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
