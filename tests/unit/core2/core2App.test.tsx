// @vitest-environment jsdom
import React, { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { Core2App } from '@/components/features/Core2/Core2App';
import { useCore2Game } from '@/hooks/useCore2Game';
import { makeSeed } from './fixtures';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
const nodes: HTMLElement[] = [];
afterEach(() => { for (const node of nodes.splice(0)) node.remove(); });
async function setup(withSecondContact = false) {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-ui-${crypto.randomUUID()}` });
  const seed = makeSeed();
  if (withSecondContact) {
    const amber = seed.records.find(row => row.domain === 'npc')!; if (amber.domain !== 'npc') throw Error('fixture');
    seed.records.push({ ...structuredClone(amber), entityId: 'npc-lisa', value: { ...structuredClone(amber.value), id: 'npc-lisa', 姓名: '丽莎', canonicalId: 'lisa' } });
    seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'contact-lisa', version: 1, value: { kind: 'contact', npcId: 'npc-lisa', name: '丽莎', remark: '', available: true } });
  }
  const dependencies = { assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text: '安柏向你挥手。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }), factModel: async () => ({ kind: 'extracted' as const, candidates: [], attempts: 1 }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } };
  const controller = createCoreController({ repo, turnDependencies: () => dependencies });
  await controller.initialize(seed);
  const node = document.createElement('div'); document.body.append(node); nodes.push(node);
  return { repo, seed, controller, dependencies, node, root: createRoot(node) };
}
it('restores an input that failed its first durable write and lets the player send it again', async () => {
  const f = await setup(), send = vi.spyOn(f.controller, 'send');
  vi.spyOn(f.repo, 'putSource').mockRejectedValueOnce(Error('输入保存失败'));
  try {
    await act(async () => f.root.render(<Core2App controller={f.controller} repo={f.repo} />));
    const textarea = f.node.querySelector<HTMLTextAreaElement>('#core2-input')!;
    const text = '这段尚未保存的输入必须能找回来。';
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = () => f.node.querySelector('form.core2-compose')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await act(async () => { submit(); await send.mock.results[0]!.value; });
    expect(textarea.value).toBe(text); expect(f.controller.getView().pendingOperationId).toBeNull();
    expect(f.node.textContent).toContain('输入保存失败');
    await act(async () => { submit(); await send.mock.results[1]!.value; await f.controller.waitForBackground(); });
    expect(textarea.value).toBe(''); expect(f.node.querySelectorAll('[data-chat-role="user"]')).toHaveLength(1);
  } finally { await act(async () => f.root.unmount()); f.controller.dispose(); }
});

it('does not replace a newer typed draft when an earlier send fails before being saved', async () => {
  const f = await setup(), send = vi.spyOn(f.controller, 'send');
  let fail!: () => void, entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { fail = resolve; });
  vi.spyOn(f.repo, 'putSource').mockImplementationOnce(async () => { entered(); await held; throw Error('输入保存失败'); });
  try {
    await act(async () => f.root.render(<Core2App controller={f.controller} repo={f.repo} />));
    const textarea = f.node.querySelector<HTMLTextAreaElement>('#core2-input')!;
    const type = async (text: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await type('旧输入');
    await act(async () => { f.node.querySelector('form.core2-compose')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await reached; });
    await type('已经开始写下一段，不可覆盖');
    await act(async () => { fail(); await send.mock.results[0]!.value; });
    expect(textarea.value).toBe('已经开始写下一段，不可覆盖');
  } finally { await act(async () => f.root.unmount()); f.controller.dispose(); }
});
it('renders one body after retry and shows save failures instead of an optimistic saved badge', async () => {
  const { repo, controller, seed, node, root } = await setup();
  await controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'ui-turn', text: '你好' });
  await controller.retry('ui-turn');
  await act(async () => root.render(<Core2App controller={controller} repo={repo} />));
  expect(node.querySelectorAll('[data-chat-role="assistant"]')).toHaveLength(1);
  expect(node.textContent).toContain('安柏向你挥手。');
  vi.spyOn(repo, 'publishSnapshot').mockRejectedValueOnce(Error('磁盘写入失败'));
  const save = [...node.querySelectorAll('button')].find(button => button.textContent === '保存')!;
  await act(async () => { save.click(); await vi.waitFor(() => expect(controller.getView().error).toContain('保存失败')); });
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
  expect(node.querySelector('[data-save-status]')?.textContent).not.toContain('已保存');
  await act(async () => root.unmount());
});

it('opens phone, memory and failure workspaces only on demand and routes maintenance through the controller', async () => {
  const { repo, controller, node, root } = await setup();
  await controller.command({ type: 'conversation_create', conversationId: 'app-phone', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'] });
  const memories = vi.spyOn(repo, 'queryMemories'), preview = vi.spyOn(controller, 'previewMaintenance').mockResolvedValue({ token: 'test-preview', turns: [1], modelRequests: 1, description: '压缩预览' });
  await act(async () => root.render(<Core2App controller={controller} repo={repo} />));
  expect(memories).not.toHaveBeenCalled();
  const click = async (label: string) => act(async () => { const button = [...node.querySelectorAll('button')].find(item => item.textContent === label); expect(button).toBeDefined(); button!.click(); });
  try {
    await click('手机'); expect(node.querySelector('[aria-label="手机"]')).not.toBeNull(); expect(node.querySelector('[data-core-conversation="app-phone"] img')).not.toBeNull();
    await click('旅途记忆'); await act(async () => { await vi.waitFor(() => expect(memories).toHaveBeenCalled()); });
    await click('一键压缩（先预览）'); expect(preview).toHaveBeenCalledWith('compress', []); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('压缩预览');
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent?.includes('取消'))!.click(); });
    await click('失败结算中心'); expect(node.querySelector('[aria-label="失败结算中心"]')).not.toBeNull();
    await click('冒险'); expect(node.querySelector('[aria-label="冒险对话"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it('routes profile edits, inventory removal and companion archive controls through recorded commands', async () => {
  const { repo, controller, node, root } = await setup(), command = vi.spyOn(controller, 'command');
  await act(async () => root.render(<Core2App controller={controller} repo={repo} />));
  const click = async (text: string) => act(async () => { const button = [...node.querySelectorAll('button')].find(item => item.textContent === text); expect(button).toBeDefined(); button!.click(); });
  try {
    await click('旅人档案');
    const input = node.querySelector<HTMLInputElement>('input[aria-label="姓名"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '改名后的云'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('保存姓名');
    await act(async () => { await vi.waitFor(() => expect(controller.getView().snapshot!.records.find(row => row.domain === 'traveler')?.value).toMatchObject({ 姓名: '改名后的云' })); });
    await click('背包'); await click('丢弃1件');
    await act(async () => { await vi.waitFor(() => expect(controller.getView().snapshot!.records.find(row => row.domain === 'inventory' && row.entityId === 'apple')?.value).toMatchObject({ quantity: 0, status: 'discarded' })); });
    await click('同伴'); await click('归档此角色');
    await act(async () => { await vi.waitFor(() => expect(controller.getView().snapshot!.records.find(row => row.domain === 'npc')?.value).toMatchObject({ archived: true })); });
    expect(command).toHaveBeenCalledWith({ type: 'edit_traveler', field: '姓名', value: '改名后的云' });
    expect(command).toHaveBeenCalledWith({ type: 'inventory', action: 'discard', itemId: 'apple', quantity: 1 });
    expect(command).toHaveBeenCalledWith({ type: 'edit_npc', npcId: 'npc-amber', field: 'archived', value: true });
  } finally { await act(async () => root.unmount()); }
});

it('creates a group from existing contacts, inserts @all, and allows removing members and dissolving the group', async () => {
  const { repo, controller, node, root } = await setup(true);
  await act(async () => root.render(<Core2App controller={controller} repo={repo} />));
  const click = async (text: string) => act(async () => { const button = [...node.querySelectorAll('button')].find(item => item.textContent === text); expect(button).toBeDefined(); button!.click(); });
  try {
    await click('手机');
    for (const id of ['npc-amber', 'npc-lisa']) await act(async () => { node.querySelector<HTMLInputElement>(`input[data-group-member="${id}"]`)!.click(); });
    await click('组建群聊');
    await act(async () => { await vi.waitFor(() => expect(node.textContent).toContain('2位成员')); });
    await click('@全体成员'); expect(node.querySelector<HTMLTextAreaElement>('.core2-phone textarea')!.value).toBe('@全体成员 ');
    await act(async () => { await controller.command({ type: 'contact_remark', contactId: 'contact-amber', remark: '侦察骑士' }); });
    await click('@侦察骑士'); expect(node.querySelector<HTMLTextAreaElement>('.core2-phone textarea')!.value).toBe('@全体成员 @安柏 ');
    await click('请出丽莎');
    await act(async () => { await vi.waitFor(() => expect(controller.getView().snapshot!.records.find(row => row.domain === 'courier' && row.value.kind === 'conversation')?.value).toMatchObject({ memberIds: ['npc-amber'] })); });
    await click('解散这个群聊');
    await act(async () => { await vi.waitFor(() => expect(controller.getView().snapshot!.records.find(row => row.domain === 'courier' && row.value.kind === 'conversation')?.value).toMatchObject({ dissolved: true })); });
  } finally { await act(async () => root.unmount()); }
});
it('keeps its controller alive across StrictMode effect replay, but disposes after real unmount', async () => {
  const { repo, seed, dependencies, node, root } = await setup();
  let current: ReturnType<typeof useCore2Game> | undefined;
  const phone = vi.fn(async () => ({ text: '云，收到你的问候了！' }));
  function Probe() { current = useCore2Game(repo, { turnDependencies: () => dependencies, phoneModels: { generate: phone, getModelIdentity: () => 'hook-phone-model' } }); return null; }
  await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  const attached = current!;
  await attached.attach({ scope: seed.head.scope });
  expect((await attached.read()).records.length).toBeGreaterThan(0);
  expect(typeof attached.command).toBe('function');
  await attached.send({ scope: seed.head.scope, sessionId: attached.getView().snapshot!.head.sessionId, operationId: 'hook-summary', text: '问候安柏' });
  await attached.waitForBackground();
  expect(attached.getView().snapshot!.head.memoryRevision).toBe(1);
  await attached.command({ type: 'conversation_create', conversationId: 'hook-phone', name: '安柏', conversationType: 'private', memberIds: ['npc-amber'] });
  await attached.sendPhone({ conversationId: 'hook-phone', text: '谢谢你！', operationId: 'hook-phone-message' }); await attached.waitForBackground();
  expect(phone).toHaveBeenCalledTimes(1); expect(attached.getView().snapshot!.head.memoryRevision).toBe(3);
  await act(async () => root.unmount());
  await expect(attached.read()).rejects.toThrow('CORE2_NO_ACTIVE_JOURNEY');
});
