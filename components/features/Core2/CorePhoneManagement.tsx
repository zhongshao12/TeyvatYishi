import { useState, type FormEvent } from 'react';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { CoreRepository } from '@/core/contracts/storage';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CoreAvatar, coreCourierName } from './CoreAvatar';

interface ManagementProps { repo: CoreRepository; snapshot: CoreSnapshot; currentId?: string; disabled?: boolean; onCommand(command: BasicPlayerCommand): Promise<unknown>; onOpen(id: string): void }
export function CorePhoneManagement({ repo, snapshot, currentId, disabled = false, onCommand, onOpen }: ManagementProps) {
  const [query, setQuery] = useState(''), [groupName, setGroupName] = useState('同行小队'), [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const contacts = snapshot.records.flatMap(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.available ? [{ id: row.entityId, ...row.value }] : []);
  const current = snapshot.records.find(row => row.domain === 'courier' && row.entityId === currentId);
  const group = current?.domain === 'courier' && current.value.kind === 'conversation' && current.value.conversationType === 'group' && !current.value.dissolved ? current : null;
  const locked = disabled || busy;
  const run = async (command: BasicPlayerCommand, openId?: string) => {
    if (locked) return; setBusy(true); setError('');
    try { await onCommand(command); if (openId) onOpen(openId); }
    catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); }
    finally { setBusy(false); }
  };
  const createGroup = (event: FormEvent) => {
    event.preventDefault(); const id = `group-${crypto.randomUUID()}`;
    void run({ type: 'conversation_create', conversationId: id, name: groupName, conversationType: 'group', memberIds: members.filter(npcId => contacts.some(contact => contact.npcId === npcId)) }, id);
  };
  return <details className="core2-phone-management"><summary>联系人与群聊管理</summary>
    <label>查找联系人<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="core2-contact-scroll" aria-label="手机联系人">{contacts.filter(contact => `${contact.name} ${contact.remark}`.includes(query.trim())).map(contact => <article className="core2-contact-row" key={contact.id}>
      <CoreAvatar repo={repo} snapshot={snapshot} entityId={contact.npcId} /><strong>{coreCourierName(snapshot, contact.npcId)}</strong>
      <button disabled={locked} onClick={() => {
        const existing = snapshot.records.find(row => row.domain === 'courier' && row.value.kind === 'conversation' && row.value.conversationType === 'private' && !row.value.dissolved && row.value.memberIds.length === 1 && row.value.memberIds[0] === contact.npcId);
        if (existing) { onOpen(existing.entityId); return; }
        const id = `private-${crypto.randomUUID()}`; void run({ type: 'conversation_create', conversationId: id, name: contact.name, conversationType: 'private', memberIds: [contact.npcId] }, id);
      }}>与{contact.name}私聊</button>
      <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run({ type: 'contact_remark', contactId: contact.id, remark: String(data.get('remark') ?? '') }); }}><label>备注<input name="remark" defaultValue={contact.remark} disabled={locked} maxLength={80} /></label><button disabled={locked} type="submit">保存备注</button></form>
    </article>)}</div>
    <form onSubmit={createGroup}><h3>组建群聊</h3><label>群名称<input value={groupName} onChange={event => setGroupName(event.target.value)} required maxLength={80} disabled={locked} /></label>
      <fieldset className="core2-contact-scroll" disabled={locked}><legend>邀请已有联系人</legend>{contacts.map(contact => <label key={contact.id} className="core2-member-choice"><input type="checkbox" data-group-member={contact.npcId} checked={members.includes(contact.npcId)} onChange={event => setMembers(before => event.target.checked ? [...new Set([...before, contact.npcId])] : before.filter(id => id !== contact.npcId))} />{coreCourierName(snapshot, contact.npcId)}</label>)}</fieldset>
      <button disabled={locked || members.filter(id => contacts.some(contact => contact.npcId === id)).length < 2 || !groupName.trim()} type="submit">组建群聊</button>
    </form>
    {group?.value.kind === 'conversation' && <section aria-label="当前群管理"><h3>{group.value.name} · {group.value.memberIds.length}位成员</h3>
      <form key={group.entityId} onSubmit={event => { event.preventDefault(); void run({ type: 'group', action: 'rename', conversationId: group.entityId, name: String(new FormData(event.currentTarget).get('name') ?? '') }); }}><label>修改群名称<input name="name" defaultValue={group.value.name} required disabled={locked} maxLength={80} /></label><button disabled={locked}>保存群名称</button></form>
      <div className="core2-contact-scroll">{group.value.memberIds.map(id => <div key={id}><span>{coreCourierName(snapshot, id)}</span><button disabled={locked} onClick={() => void run({ type: 'group', action: 'remove', conversationId: group.entityId, npcId: id })}>请出{coreCourierName(snapshot, id)}</button></div>)}
        {contacts.filter(contact => group.value.kind === 'conversation' && !group.value.memberIds.includes(contact.npcId)).map(contact => <button key={contact.id} disabled={locked} onClick={() => void run({ type: 'group', action: 'add', conversationId: group.entityId, npcId: contact.npcId })}>邀请{coreCourierName(snapshot, contact.npcId)}</button>)}
      </div><button disabled={locked} onClick={() => void run({ type: 'group', action: 'dissolve', conversationId: group.entityId })}>解散这个群聊</button>
    </section>}{error && <p role="alert">{error}</p>}
  </details>;
}
