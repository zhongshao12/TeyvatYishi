// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeSeed } from './fixtures';
import { freezeSource } from '@/core/sources/sourceRecords';
import { commitCoreInteraction } from '@/core/settlement/consumerOperations';
import { CoreCourierPanel } from '@/components/features/Core2/CoreCourierPanel';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('shows messages in sent order, preserves upward reading and surfaces delayed new replies without moving world time', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-phone-view-${crypto.randomUUID()}` }), seed = makeSeed();
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'phone-view', version: 1, value: { kind: 'conversation', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'], unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  await repo.initialize(seed);
  const deps = { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted' as const, candidates: [], attempts: 1 }) };
  const send = async (id: string, text: string) => {
    const source = freezeSource({ scope: seed.head.scope, operationId: id, kind: 'courier', moment: seed.sources[0]!.moment,
      blocks: [{ blockId: 'p', kind: 'message', speakerId: seed.playerId, text: `玩家：${text}` }, { blockId: 'n', kind: 'message', speakerId: 'npc-amber', text: `安柏回复：${text}。` }] });
    await commitCoreInteraction({ scope: seed.head.scope, sessionId: seed.head.sessionId, source, target: 'private', channelId: 'phone-view', recipientIds: ['npc-amber'] }, deps);
  };
  await send('first-message', '起初问候');
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), onSend = vi.fn().mockResolvedValue(undefined);
  let snapshot = await repo.readState(seed.head.scope);
  await act(async () => root.render(<CoreCourierPanel repo={repo} snapshot={snapshot} onSend={onSend} />));
  for (let i = 0; i < 100 && node.querySelectorAll('[data-phone-message]').length < 2; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect([...node.querySelectorAll('[data-phone-message]')].map(element => element.textContent)).toEqual([expect.stringContaining('玩家：起初问候'), expect.stringContaining('安柏回复：起初问候')]);
  const scroll = node.querySelector('[aria-label="手机消息"]') as HTMLElement;
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, get: () => 2000 }, clientHeight: { configurable: true, get: () => 400 } });
  await act(async () => { scroll.scrollTop = 120; scroll.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await send('second-message', '新问候'); snapshot = await repo.readState(seed.head.scope);
  await act(async () => root.render(<CoreCourierPanel repo={repo} snapshot={snapshot} onSend={onSend} />));
  for (let i = 0; i < 150 && !node.textContent?.includes('安柏回复：新问候'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(node.textContent).toContain('安柏回复：新问候'); expect(scroll.scrollTop).toBe(120); expect(node.textContent).toMatch(/有\s*2\s*条新消息/u);
  expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'world')).toEqual(seed.records.find(row => row.domain === 'world'));
  await act(async () => root.unmount()); node.remove();
});
it('shows an avatar and red unread badge, and acknowledges only after an explicit conversation click', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-unread-view-${crypto.randomUUID()}` }), seed = makeSeed();
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'unread-phone', version: 1, value: { kind: 'conversation', name: '安柏', memberIds: ['npc-amber'], conversationType: 'private', unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  await repo.initialize(seed);
  const source = freezeSource({ scope: seed.head.scope, operationId: 'unread-arrival', kind: 'courier', moment: seed.sources[0]!.moment, blocks: [{ blockId: 'new', kind: 'message', speakerId: 'npc-amber', text: '云，风起地的花开啦。' }] });
  await commitCoreInteraction({ scope: seed.head.scope, sessionId: seed.head.sessionId, source, target: 'private', channelId: 'unread-phone', recipientIds: ['npc-amber'] }, { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }) });
  const snapshot = await repo.readState(seed.head.scope), node = document.createElement('div'); document.body.append(node); const root = createRoot(node), onRead = vi.fn().mockResolvedValue(undefined);
  try {
    await act(async () => root.render(<CoreCourierPanel repo={repo} snapshot={snapshot} onSend={vi.fn()} onRead={onRead} />));
    for (let index = 0; index < 80 && !node.querySelector('[data-phone-message]'); index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.querySelector('[data-phone-message]')).not.toBeNull();
    const conversation = node.querySelector<HTMLButtonElement>('[data-core-conversation="unread-phone"]'); expect(conversation).not.toBeNull();
    expect(conversation!.querySelector('img')).not.toBeNull(); expect(conversation!.querySelector('[aria-label="1 条未读消息"]')).not.toBeNull(); expect(onRead).not.toHaveBeenCalled();
    await act(async () => { conversation!.click(); });
    expect(onRead).toHaveBeenCalledWith('unread-phone', 2, snapshot.head.coreSeq);
  } finally { await act(async () => root.unmount()); node.remove(); }
});
