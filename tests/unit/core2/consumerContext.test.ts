import { expect, it } from 'vitest';
import { buildCoreConsumerContext, buildCoreMainContext, buildCoreReplyRequests } from '@/core/retrieval/consumerContext';
import { 创建默认游戏设置 } from '@/models/settings';
import { recallFixture } from './recallFixture';
import type { StateRecord } from '@/core/contracts/state';
import { createCore2NarrativeModel } from '@/services/ai/core2NarrativeModel';
import { vi } from 'vitest';
import { createCoreCodexCatalog } from '@/core/content/codexCatalog';

it('delivers imported preset and original input alongside distinct author and character memory bundles', async () => {
  const f = await recallFixture(), snapshot = await f.repo.readState(f.seed.head.scope), settings = 创建默认游戏设置();
  settings.promptModules = []; settings.enableStPreset = true; settings.currentStPresetIdV2 = 'delivery-test';
  settings.stPresetsV2 = [{ id: 'delivery-test', name: 'test', importedAt: 0, updatedAt: 0, preset: { prompts: [{ identifier: 'style', role: 'system', content: '温暖文风，至少3000字，{{user}}。' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'style', enabled: true }, { identifier: 'userInput', enabled: true }] }] } }];
  const context = await buildCoreMainContext({ snapshot, userInput: '  保留我的原始输入。  ', history: [], commitments: [] }, settings, { repo: f.repo });
  expect(JSON.stringify(context.messages)).toContain('温暖文风'); expect(JSON.stringify(context.messages)).toContain('3000');
  expect(context.messages.find(row => row.role === 'user')?.content).toBe('  保留我的原始输入。  ');
  expect(context.memoryDelivery?.npcBundles[0]?.selectedLeafIds).not.toContain(f.batches[1]!.events[0]!.eventId);
  expect(context.memoryDelivery?.authorBundle.selectedLeafIds).toContain(f.batches[1]!.events[0]!.eventId);
  expect(context.systemPrompt).toContain(context.memoryDelivery!.authorBundle.bundleId);
  const complete = vi.fn().mockResolvedValue(JSON.stringify({ body: [{ kind: 'narration', text: '安柏' + '文'.repeat(3100) }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  await createCore2NarrativeModel(complete)({ context, snapshot, config: { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'not-a-real-key', model: 'test', createdAt: 0, updatedAt: 0 } });
  expect(complete.mock.calls[0]![1].systemPrompt).toContain(context.memoryDelivery!.authorBundle.bundleId);
  expect(complete.mock.calls[0]![1].messages.find((row: { role: string }) => row.role === 'user').content).toBe('  保留我的原始输入。  ');
});

it('builds separate group requests, retaining @all and mentioned-plus-two selection', async () => {
  const f = await recallFixture(), snapshot = await f.repo.readState(f.seed.head.scope), amber = snapshot.records.find((r): r is StateRecord<'npc'> => r.domain === 'npc')!;
  for (const [id, name] of [['npc-lisa', '丽莎'], ['npc-jean', '琴'], ['npc-eula', '优菈']]) {
    snapshot.records.push({ ...structuredClone(amber), entityId: id!, value: { ...structuredClone(amber.value), id: id!, 姓名: name! } });
    snapshot.records.push({ scope: snapshot.head.scope, domain: 'courier', entityId: `contact-${id}`, version: 1, value: { kind: 'contact', npcId: id!, name: name!, remark: '', available: true } });
  }
  const memberIds = ['npc-amber', 'npc-lisa', 'npc-jean', 'npc-eula'];
  snapshot.records.push({ scope: snapshot.head.scope, domain: 'courier', entityId: 'test-group', version: 1, value: { kind: 'conversation', name: '群', memberIds, conversationType: 'group', unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  const first = await buildCoreReplyRequests({ snapshot, conversationId: 'test-group', messageId: 'm1', text: '@安柏 你们好' }, { repo: f.repo });
  expect(first.requests).toHaveLength(3); expect(first.requests.map(row => row.npcId)).toContain('npc-amber');
  const all = await buildCoreReplyRequests({ snapshot, conversationId: 'test-group', messageId: 'm2', text: '@全体成员 你们好' }, { repo: f.repo });
  expect(all.requests).toHaveLength(4); expect(new Set(all.requests.map(row => row.bundle.bundleId)).size).toBe(4);
  expect(all.requests.find(row => row.npcId === 'npc-amber')!.bundle.selectedLeafIds).not.toContain(f.batches[1]!.events[0]!.eventId);
  expect(all.requests.find(row => row.npcId === 'npc-lisa')!.bundle.selectedLeafIds).toContain(f.batches[1]!.events[0]!.eventId);
});

it('news requests only confirmed public facts; image requests project only approved English visual fields', async () => {
  const f = await recallFixture(), snapshot = await f.repo.readState(f.seed.head.scope), base = { snapshot, userInput: 'take a portrait', npcIds: ['npc-amber'] };
  const news = await buildCoreConsumerContext({ ...base, target: 'news', userInput: 'PRIVATE_INPUT_SENTINEL' }, { repo: f.repo });
  expect(news.bundle.selectedLeafIds).not.toContain(f.batches[1]!.events[0]!.eventId);
  expect(news.prompt).not.toContain('PRIVATE_INPUT_SENTINEL');
  const image = await buildCoreConsumerContext({ ...base, target: 'image', imageFacts: { language: 'en', name: 'Amber', gender: 'female', appearance: 'brown hair, amber eyes', appearanceDetails: { 发色: { value: 'brown', source: 'manual' } } }, positive: ['anime', 'fantasy'], negative: ['blurry'] }, { repo: f.repo });
  expect(image.prompt).toContain('Amber'); expect(image.prompt).toContain('brown hair'); expect(image.prompt).toContain('take a portrait');
  expect(image.prompt).not.toMatch(/七维|好感|affinity|memory-bundle|eventId|旅行历/);
  expect(image.bundle.selectedLeafIds).toEqual([]);
});
it('delivers selected codex references into actual main and per-person phone contexts without treating them as memories', async () => {
  const f = await recallFixture(), snapshot = await f.repo.readState(f.seed.head.scope);
  const catalog = createCoreCodexCatalog(async () => ({ 条目: [
    { id: 'test-static-lore', 标题: '风车', 分类: 'term', 摘要: 'CODEX_AUTHOR_REFERENCE 风车利用风能。', 原文: '', 关键词: ['风车'] },
    { id: 'test-static-amber', 标题: '安柏', 分类: 'character', 摘要: '侦察骑士。', 原文: '', 关键词: ['安柏'], 注入内容: { 类型: 'character', 独立人格与行为: 'CODEX_AMBER_BACKGROUND 热情爽朗。' } },
  ] }));
  const deps = { repo: f.repo, contentCatalog: catalog };
  const author = await buildCoreMainContext({ snapshot, userInput: '我们看看风车。', history: [], commitments: [] }, 创建默认游戏设置(), deps);
  expect(author.systemPrompt).toContain('CODEX_AUTHOR_REFERENCE'); expect(author.systemPrompt).toContain('CODEX_AMBER_BACKGROUND');
  const phone = await buildCoreConsumerContext({ snapshot, target: 'private', npcIds: ['npc-amber'], userInput: '我们看看风车。' }, deps);
  expect(phone.prompt).toContain('CODEX_AMBER_BACKGROUND'); expect(phone.prompt).not.toContain('CODEX_AUTHOR_REFERENCE');
  expect(phone.bundle.selectedLeafIds).not.toContain('test-static-amber'); expect((await f.repo.readHead(snapshot.head.scope)).coreSeq).toBe(snapshot.head.coreSeq);
});
