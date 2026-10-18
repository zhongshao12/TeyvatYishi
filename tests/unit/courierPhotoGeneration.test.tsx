// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { 创建NPC记录 } from '@/models/npc';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { resolveCourierPhotoTarget } from '@/services/courierPhoto';
import { CourierPhotoComposer, type CourierPhotoComposerProps } from '@/components/features/Courier/CourierPhotoComposer';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import { CourierPanel } from '@/components/features/Courier/CourierPanel';
import { normalizeJourneyAlbum } from '@/models/teyvat/runtimeSlices';
import { useCourierPhotoGeneration } from '@/components/features/Courier/useCourierPhotoGeneration';
import { readSourceImageCharacterFacts } from '@/utils/imageCharacterFacts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const imageApi = vi.hoisted(() => vi.fn());
const { translationApi, translationStore } = vi.hoisted(() => ({ translationApi: vi.fn(), translationStore: new Map<string, unknown>() }));
vi.mock('@/services/ai/imageGeneration', () => ({ generateImage: imageApi }));
vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream: translationApi }));
vi.mock('@/services/dbService', async importOriginal => ({ ...await importOriginal<object>(),
  loadSetting: async (key: string) => translationStore.get(key) ?? null,
  saveSetting: async (key: string, value: unknown) => { translationStore.set(key, value); },
}));
const npc = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 性别: '女' as const, 外貌: '棕发，红色兔耳发饰', 外貌档案: { 发色: { value: '棕色', source: 'manual' as const } } };
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host?.remove(); imageApi.mockReset(); translationApi.mockReset(); translationStore.clear(); vi.unstubAllGlobals(); });

async function mount() {
  translationApi.mockResolvedValue(JSON.stringify({ name: 'Amber', gender: 'female', appearance: 'brown hair, red rabbit-ear accessory', appearanceDetails: { 发色: { value: 'brown' } } }));
  let game = createEmptyTeyvatGameState();
  game.NPC = [{ ...normalizeTeyvatNpcRecords([{ id: 'amber', name: '测试同伴' }])[0]!,
    姓名: npc.姓名, gender: npc.性别, appearance: npc.外貌, appearanceFacts: npc.外貌档案,
    clothing: npc.穿着 ?? '', 说明: npc.介绍 ?? '', notes: npc.备注,
  }];
  game.手机 = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact', npcId: 'amber', name: '备注', available: true }], conversations: [{ id: 'chat', title: '群聊', type: 'group', participantIds: ['player', 'contact'], unread: 0, typingMemberIds: [], updatedAt: 1, messages: [
    { id: 'ask', senderId: 'player', senderName: '云', role: 'user', content: '拍张城门的照片给我看看', turn: 2, timestamp: 1, readBy: [] },
    { id: 'reply', senderId: 'contact', senderName: '安柏', role: 'contact', content: '我站在城门前，身后是鲜花。', turn: 2, timestamp: 2, readBy: [] },
  ] }] };
  let album = 创建空相册系统();
  let session = 1;
  const settings = 创建默认游戏设置().文生图系统;
  settings.enabled = true;
  settings.普通接口 = { ...settings.普通接口, enabled: true, baseUrl: 'https://invalid.example', model: 'test', apiKey: 'unused', retryCount: 0 };
  const target = resolveCourierPhotoTarget(game.手机, [npc], 'chat', 'reply')!.target;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const props: CourierPhotoComposerProps = { target, courier: game.手机, album, npcRecords: [npc], imageSettings: settings,
    apiSettings: { activeConfigId: 'text', configs: [{ id: 'text', name: 'test', provider: 'openai', model: 'test', baseUrl: '', apiKey: '', createdAt: 1, updatedAt: 1 } as API配置项] },
    getGameSessionId: () => session,
    onAlbumChange: update => { album = typeof update === 'function' ? update(album) : update; game = { ...game, 相册: normalizeJourneyAlbum({ ...game.相册, assets: album.assets, generationTasks: album.tasks }) }; },
    onCommitPhoto: (update, expectedSession) => { if (expectedSession !== session) return false; const next = update(game); const accepted = next !== game; game = next; return accepted; },
    onClose: vi.fn(),
  };
  const render = async () => act(async () => { root!.render(createElement(CourierPhotoComposer, props)); });
  await render();
  return { props, render, game: () => game, album: () => album, switchSession: () => { session++; }, removeTarget: () => { game.手机.conversations = []; }, setGame: (next: TeyvatGameState) => { game = next; } };
}
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === label)!;

describe('confirmed phone photos', () => {
  it('uses the NPC saved English identity for phone pictures after the global translation cache was cleared', async () => {
    const ui = await mount();
    const englishFacts = { schemaVersion: 1 as const, sourceKey: JSON.stringify(readSourceImageCharacterFacts(npc)), preparedAt: 1, facts: { language: 'en' as const, name: 'Amber', gender: 'female', appearance: 'brown hair, red rabbit-ear accessory', appearanceDetails: { 发色: { value: 'brown', source: 'manual' as const } } } };
    ui.props.npcRecords = [{ ...npc, 图像档案: { englishFacts } }];
    ui.setGame({ ...ui.game(), NPC: ui.game().NPC.map(row => ({ ...row, visualArchive: { ...row.visualArchive, englishFacts } })) });
    translationStore.clear(); translationApi.mockReset(); translationApi.mockRejectedValue(Error('MUST_NOT_RETRANSLATE_SAVED_IDENTITY')); imageApi.mockResolvedValue({ src: 'https://example.invalid/saved.webp' });
    await act(async () => { root!.unmount(); }); root = createRoot(host); await ui.render();
    await act(async () => { button('确认生成').click(); });
    expect(translationApi).not.toHaveBeenCalled(); expect(imageApi).toHaveBeenCalledTimes(1);
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('character name: Amber');
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('gender: female');
    expect(ui.game().手机.conversations[0]?.messages[1]?.photo?.assetId).toBeTruthy();
    expect(ui.game().NPC[0]?.visualArchive.englishFacts?.facts.name).toBe('Amber');
  });
  it('photo_preview_is_a_separate_dialog_and_escape_closes_only_the_preview', async () => {
    const ui = await mount();
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('手机照片预览');
    expect(imageApi).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(ui.props.onClose).toHaveBeenCalledTimes(1);
  });
  it('opens the photo preview for a visible chat beyond the first page of conversation rows', async () => {
    const ui = await mount();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const conversation = ui.props.courier.conversations[0]!;
    let courier = { ...ui.props.courier, conversations: Array.from({ length: 80 }, (_, i) => ({ ...conversation, id: i === 0 ? conversation.id : `other-${i}`, updatedAt: i + 1 })) };
    await act(async () => root!.render(createElement(CourierPanel, { ...ui.props, courier, travelerName: '云',
      onCourierChange: update => { courier = typeof update === 'function' ? update(courier) : update; } })));
    const photo = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === '手机照片')!;
    expect(photo.disabled).toBe(false);
    await act(async () => { photo.click(); await vi.dynamicImportSettled(); });
    expect(document.querySelector('[role="dialog"][aria-label="手机照片预览"]')).not.toBeNull();
    expect(imageApi).not.toHaveBeenCalled();
  });
  it('does not show a private photo action when the group filter has no matching conversation', async () => {
    const ui = await mount(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
    let courier: typeof ui.props.courier = { ...ui.props.courier, conversations: ui.props.courier.conversations.map(item => ({ ...item, type: 'private' as const })) };
    await act(async () => root!.render(createElement(CourierPanel, { ...ui.props, courier, travelerName: '云',
      onCourierChange: update => { courier = typeof update === 'function' ? update(courier) : update; } })));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '群组')!.click());
    expect(document.querySelector('[aria-label="手机照片"]')).toBeNull();
    expect(imageApi).not.toHaveBeenCalled();
  });
  it.each(['外貌', '穿着'] as const)('invalidates an open preview when recorded %s changes', async field => {
    const ui = await mount();
    let generation!: ReturnType<typeof useCourierPhotoGeneration>;
    function Harness() { generation = useCourierPhotoGeneration(ui.props); return null; }
    await act(async () => root!.render(createElement(Harness)));
    const previous = generation.draft.prompt;
    ui.props.npcRecords = [{ ...npc, [field]: field === '外貌' ? '银发，蓝眼睛' : 'green coat',
      外貌档案: field === '外貌' ? { 发色: { value: '银色', source: 'manual' } } : npc.外貌档案 }];
    await act(async () => root!.render(createElement(Harness)));
    expect(generation.disabledReason).toContain('资料已变化');
    expect(generation.draft.prompt).toBe(previous);
    await act(async () => generation.generate());
    expect(imageApi).not.toHaveBeenCalled();
    await act(async () => generation.rebuild());
    expect(generation.disabledReason).toBe('');
  });
  it.each(['unknown', 'known'] as const)('blocks paying for a stale preview after editing an %s photo requirement', async kind => {
    const ui = await mount();
    if (kind === 'unknown') {
      ui.props.courier.conversations[0]!.messages[0]!.content = '你好';
      ui.props.target = resolveCourierPhotoTarget(ui.props.courier, [npc], 'chat', 'reply')!.target;
    }
    let generation!: ReturnType<typeof useCourierPhotoGeneration>;
    function Harness() { generation = useCourierPhotoGeneration(ui.props); return null; }
    await act(async () => root!.render(createElement(Harness)));
    const previousPrompt = generation.draft.prompt;
    await act(async () => generation.setDescription('拍张雪山夕阳的照片'));
    expect(generation.disabledReason).toContain('更新提示词');
    expect(generation.draft.prompt).toBe(previousPrompt);
    await act(async () => generation.generate());
    expect(imageApi).not.toHaveBeenCalled();
  });
  it('confirms the explicitly rebuilt new requirement while preserving later manual prompt edits', async () => {
    const ui = await mount();
    let generation!: ReturnType<typeof useCourierPhotoGeneration>;
    function Harness() { generation = useCourierPhotoGeneration(ui.props); return null; }
    await act(async () => root!.render(createElement(Harness)));
    await act(async () => generation.setDescription('拍张雪山夕阳的照片'));
    await act(async () => generation.rebuild());
    expect(generation.disabledReason).toBe('');
    expect(generation.draft.prompt).toContain('雪山夕阳');
    expect(generation.draft.prompt).not.toContain('城门');
    await act(async () => generation.setDraft(previous => ({ ...previous, prompt: `low camera angle, ${previous.prompt}` })));
    imageApi.mockResolvedValue({ src: 'https://example.invalid/rebuilt.webp' });
    await act(async () => generation.generate());
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('雪山夕阳');
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('low camera angle');
    expect(imageApi.mock.calls[0]?.[1].prompt).not.toContain('城门');
  });
  it('shows an editable empty requirement and blocks confirmation when the request is unknown', async () => {
    const ui = await mount();
    ui.props.courier.conversations[0]!.messages[0]!.content = '今天过得怎么样？';
    ui.props.target = resolveCourierPhotoTarget(ui.props.courier, [npc], 'chat', 'reply')!.target;
    await act(async () => { root!.unmount(); }); root = createRoot(host);
    await ui.render();
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="照片描述"]')!.value).toBe('');
    expect(document.body.textContent).toContain('未能确定');
    expect(button('确认生成').disabled).toBe(true);
    expect(imageApi).not.toHaveBeenCalled();
  });
  it('excludes contaminated profile text and recorded detail metadata from the short preview', async () => {
    const ui = await mount();
    ui.props.npcRecords = [{ ...npc, 外貌: '棕发。好感度90。NSFW档案: 秘密。', 外貌档案: { 发色: { value: '棕色, 关系标签: 内部秘密', source: 'manual' } } }];
    await act(async () => { root!.unmount(); }); root = createRoot(host);
    await ui.render();
    const prompt = document.querySelector<HTMLTextAreaElement>('[aria-label="照片正面提示词"]')!.value;
    expect(prompt).toContain('棕色');
    expect(prompt).not.toMatch(/好感|NSFW|秘密|关系标签/);
  });
  it('keeps both final prompt fields within 2000 characters after a long manual edit', async () => {
    const ui = await mount();
    let generation!: ReturnType<typeof useCourierPhotoGeneration>;
    function Harness() { generation = useCourierPhotoGeneration(ui.props); return null; }
    await act(async () => root!.render(createElement(Harness)));
    imageApi.mockResolvedValue({ src: 'https://example.invalid/limited.webp' });
    await act(async () => generation.setDraft(previous => ({ ...previous, prompt: 'lake sunset, ' + 'tree '.repeat(900), negative: 'bad anatomy '.repeat(900) })));
    await act(async () => generation.generate());
    expect(imageApi.mock.calls[0]?.[1].prompt.length).toBeLessThanOrEqual(2000);
    expect(imageApi.mock.calls[0]?.[1].negativePrompt.length).toBeLessThanOrEqual(2000);
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('Amber');
  });
  it('sanitizes manual prompt edits at final send without erasing the requested scene', async () => {
    const ui = await mount();
    let generation!: ReturnType<typeof useCourierPhotoGeneration>;
    function Harness() { generation = useCourierPhotoGeneration(ui.props); return null; }
    await act(async () => root!.render(createElement(Harness)));
    imageApi.mockResolvedValue({ src: 'https://example.invalid/safe.webp' });
    await act(async () => generation.setDraft(previous => ({ ...previous, prompt: 'lake sunset, 好感度: 88, 七维关系: 内部, NSFW档案: 私密', negative: 'bad anatomy' })));
    await act(async () => generation.generate());
    const request = imageApi.mock.calls[0]?.[1];
    expect(request.prompt).toContain('lake sunset');
    expect(request.prompt).toContain('Amber');
    expect(request.prompt).not.toMatch(/好感|七维|NSFW|私密|内部/);
    expect(request.prompt.length).toBeLessThanOrEqual(2000);
    expect(request.negativePrompt.length).toBeLessThanOrEqual(2000);
  });
  it('previews named NPC facts without network cost, then commits only after explicit confirmation', async () => {
    imageApi.mockResolvedValue({ src: 'https://example.invalid/generated.webp', backend: 'openai_compatible' });
    const ui = await mount();
    expect(imageApi).not.toHaveBeenCalled();
    expect(translationApi).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="照片正面提示词"]')?.value).toContain('安柏');
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="照片描述"]')?.value).toBe('拍张城门的照片给我看看');
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="照片正面提示词"]')?.value).not.toMatch(/鲜花|official|portrait|personality|关系|七维/);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="照片正面提示词"]')!.value.length).toBeLessThan(700);
    await act(async () => { button('确认生成').click(); });
    expect(imageApi).toHaveBeenCalledTimes(1);
    expect(imageApi.mock.calls[0]?.[1]).toMatchObject({ nsfw: false });
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('brown');
    expect(imageApi.mock.calls[0]?.[1].prompt).not.toContain('character name: 安柏');
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('城门');
    expect(imageApi.mock.calls[0]?.[1].prompt).toContain('phone photo');
    expect(imageApi.mock.calls[0]?.[1].prompt.match(/character name:/gu)).toHaveLength(1);
    expect(ui.game().手机.conversations[0]?.messages[1]?.photo?.assetId).toBe(ui.game().相册.assets[0]?.id);
    expect(ui.game().相册.entries[0]?.slot).toBe('misc');
    expect(ui.game().手机.conversations[0]?.messages[1]?.content).toBe('我站在城门前，身后是鲜花。');
  });

  it('cancels on unmount and does not accept a late image from an API ignoring abort', async () => {
    let finish!: (value: { src: string }) => void;
    imageApi.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const ui = await mount();
    await act(async () => { button('确认生成').click(); });
    const signal = imageApi.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => { root!.unmount(); }); root = undefined;
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ src: 'https://example.invalid/late.webp' }); });
    expect(ui.game().相册.entries).toHaveLength(0);
    expect(ui.album().tasks[0]?.status).toBe('cancelled');
  });

  it.each(['session', 'target'] as const)('discards late results after %s changes', async kind => {
    let finish!: (value: { src: string }) => void;
    imageApi.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const ui = await mount();
    await act(async () => { button('确认生成').click(); });
    if (kind === 'session') ui.switchSession(); else ui.removeTarget();
    await act(async () => { finish({ src: 'https://example.invalid/late.webp' }); });
    expect(ui.game().相册.entries).toHaveLength(0);
  });

  it.each(['correlation', 'request-content', 'request-deletion'] as const)('freezes explicit batch requests and rejects late results after %s changes', async kind => {
    const ui = await mount();
    const chat = ui.props.courier.conversations[0]!;
    chat.messages[1]!.id = 'courier_group_reply_ask_contact';
    chat.messages[1]!.replyToMessageIds = ['ask'];
    chat.messages[1]!.expectedReplyIds = [chat.messages[1]!.id];
    ui.props.target = resolveCourierPhotoTarget(ui.props.courier, [npc], 'chat', chat.messages[1]!.id)!.target;
    await act(async () => root!.unmount()); root = createRoot(host); await ui.render();
    let finish!: (value: { src: string }) => void;
    imageApi.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button('确认生成').click());
    if (kind === 'correlation') chat.messages[1]!.replyToMessageIds = ['missing'];
    else if (kind === 'request-content') chat.messages[0]!.content = '拍张另一地点的照片';
    else chat.messages.shift();
    await act(async () => finish({ src: 'https://example.invalid/rebound.webp' }));
    expect(ui.game().相册.entries).toHaveLength(0);
    expect(ui.props.onClose).not.toHaveBeenCalled();
  });

  it('reports a failed request, allows deliberate retry, and blocks duplicate clicks', async () => {
    imageApi.mockRejectedValueOnce(new Error('测试失败')).mockResolvedValueOnce({ src: 'https://example.invalid/retry.webp' });
    const ui = await mount();
    await act(async () => { button('确认生成').click(); button('确认生成').click(); });
    expect(imageApi).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('测试失败');
    await act(async () => { button('重试生成').click(); });
    expect(imageApi).toHaveBeenCalledTimes(2);
    expect(ui.game().相册.entries).toHaveLength(1);
  });

  it('invalidates an old preview when the same message/contact is rebound to another NPC', async () => {
    imageApi.mockResolvedValue({ src: 'https://example.invalid/wrong.webp' });
    const ui = await mount();
    ui.props.courier.contacts[0]!.npcId = 'lisa';
    ui.props.npcRecords = [{ ...npc, id: 'lisa', 姓名: '丽莎' }];
    ui.props.target = { ...ui.props.target, npcId: 'lisa' };
    await ui.render();
    await act(async () => { button('确认生成').click(); });
    expect(imageApi).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/变化|失效/);
  });

  it('marks a rejected live-root commit cancelled instead of pretending success', async () => {
    let finish!: (value: { src: string }) => void;
    imageApi.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const ui = await mount();
    await act(async () => { button('确认生成').click(); });
    ui.setGame({ ...ui.game(), 手机: { ...ui.game().手机, conversations: [] } });
    await act(async () => { finish({ src: 'https://example.invalid/stale.webp' }); });
    expect(ui.game().相册.entries).toHaveLength(0);
    expect(ui.game().相册.generationTasks[0]?.status).toBe('cancelled');
    expect(ui.props.onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/变化|未写入/);
  });

  it.each(['rendered', 'root-only'] as const)('rejects old character photos after %s appearance changes', async change => {
    let finish!: (value: { src: string }) => void;
    imageApi.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const ui = await mount();
    await act(async () => button('确认生成').click());
    ui.setGame({ ...ui.game(), NPC: ui.game().NPC.map(item => ({ ...item, appearance: '银发，红色兔耳发饰', appearanceFacts: { 发色: { value: '银色', source: 'manual' } } })) });
    if (change === 'rendered') {
      ui.props.npcRecords = [{ ...npc, 外貌: '银发，红色兔耳发饰', 外貌档案: { 发色: { value: '银色', source: 'manual' } } }];
      await ui.render();
    }
    await act(async () => finish({ src: 'https://example.invalid/old-appearance.webp' }));
    expect(ui.game().相册.entries).toHaveLength(0);
    expect(ui.props.onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/变化|未写入/);
  });

  it('does not call a disabled image API', async () => {
    const ui = await mount(); ui.props.imageSettings.enabled = false; await ui.render();
    expect(document.body.textContent).toContain('未开启');
    expect(button('确认生成').disabled).toBe(true);
    expect(imageApi).not.toHaveBeenCalled();
  });

  it('opens the preview from a real contact message and resolves saved photos after reload', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    imageApi.mockResolvedValue({ src: 'https://example.invalid/generated.webp' });
    const ui = await mount();
    const renderPhone = async () => act(async () => root!.render(createElement(CourierModal, {
      courier: JSON.parse(JSON.stringify(ui.game().手机)), album: { ...ui.album(), assets: ui.game().相册.assets,
        entries: ui.game().相册.entries.map(entry => ({ ...entry, assetId: entry.assetId!, title: entry.title!, targetType: entry.targetType!, slot: entry.slot!, nsfw: entry.nsfw!, tags: entry.tags!, referenceTargets: entry.referenceTargets! })) },
      npcRecords: [npc], imageSettings: ui.props.imageSettings, apiSettings: ui.props.apiSettings, getGameSessionId: ui.props.getGameSessionId,
      onAlbumChange: ui.props.onAlbumChange, onCommitPhoto: ui.props.onCommitPhoto, onCourierChange: vi.fn(), onClose: vi.fn(),
    })));
    await renderPhone();
    expect(document.querySelectorAll('[aria-label="手机照片"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-phone-message-row] button')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-label="生成 云 的照片"]')).toHaveLength(0);
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="手机照片"]')!.click(); });
    expect(document.querySelector('[aria-label="照片正面提示词"]')).toBeTruthy();
    expect(imageApi).not.toHaveBeenCalled();
    await act(async () => { button('确认生成').click(); });
    await renderPhone();
    expect(document.querySelector<HTMLImageElement>('img[alt="安柏 的手机照片"]')?.src).toBe('https://example.invalid/generated.webp');
    expect(document.body.textContent).toContain('我站在城门前，身后是鲜花。');
    expect(ui.game().相册.generationTasks[0]?.status).toBe('success');
  });

  it('keeps old message rows memoized with photo tools enabled when a new message arrives', async () => {
    const ui = await mount();
    const phone = ui.props.courier;
    let reads = 0;
    Object.defineProperty(phone.conversations[0]!.messages[1]!, 'content', { enumerable: true, get: () => { reads++; return '站在城门前'; } });
    const phoneProps = { courier: phone, album: ui.props.album, npcRecords: [npc], imageSettings: ui.props.imageSettings,
      getGameSessionId: ui.props.getGameSessionId, onAlbumChange: ui.props.onAlbumChange, onCommitPhoto: ui.props.onCommitPhoto, onCourierChange: vi.fn(), onClose: vi.fn() };
    await act(async () => root!.render(createElement(CourierModal, phoneProps)));
    reads = 0;
    const next = { ...phone, conversations: phone.conversations.map(chat => ({ ...chat, messages: [...chat.messages, { id: 'new', senderId: 'player', senderName: '云', content: '谢谢', role: 'user', turn: 3, timestamp: 3, readBy: [] }] })) };
    await act(async () => root!.render(createElement(CourierModal, { ...phoneProps, courier: next })));
    expect(reads).toBe(0);
  });
});
