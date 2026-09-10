import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEmptyCourierSystem, normalizeCourierSystem, type CourierConversation, type CourierDeliverySeed } from '@/models/teyvat/courier';
import { createEmptyIrminsulMemory, normalizeIrminsulMemory } from '@/models/teyvat/irminsul';
import { normalizeSteambirdNews } from '@/models/teyvat/steambird';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { normalizeBackgroundQueueState, normalizeConversationLog } from '@/models/teyvat/runtimeSlices';
import { appendCourierMessage, buildCourierSenderNpcRecords, calculateCourierUnread, composeCourierGroupReplyLocally, composeCourierLetterLocally, composeCourierReplyLocally, consumeCourierSeed, findCourierReplyCandidates, selectGroupReplyMembers, splitLetterIntoLines } from '@/services/ai/courierService';
import { runCourierReplyPass } from '@/hooks/useGame/courierBackgroundJobs';
import { processScheduledCourierSeeds } from '@/hooks/useGame/courierWorkflow';
import { buildIrminsulArchiveEntry } from '@/services/irminsulArchive';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';
import { buildSteambirdGenerationRequest, normalizeSteambirdGeneration } from '@/services/ai/steambirdModel';
import { buildCodexEntryInjectionPreview, retrieveCodexEntries } from '@/services/codexRetrieval';
import { buildCodexAiCandidateIndex, compileCodexAiSelection } from '@/services/codexAiRetrievalIndex';
import { applyStoryArchiveCodexRuntimeUnlock } from '@/services/codexRuntimeUnlock';
import { restorePreTurnSnapshot } from '@/hooks/useGame/turnSnapshot';
import { 创建默认游戏设置, 归一化提示词模块ID, 归一化记忆系统设置 } from '@/models/settings';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import { parseVariableFacts } from '@/utils/variableFacts';
import { 归一化NPC记录列表 } from '@/models/npc';
import { 创建图鉴条目 } from '@/models/codex';
import { 归一化任务系统 } from '@/models/quest';
import { parseWorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/utils/notifications';
import { KEYBOARD_SHORTCUT_ACTIONS, KEYBOARD_SHORTCUT_DEFAULTS } from '@/data/keyboardShortcutDefaults';
import * as notificationProtocol from '@/utils/notifications';
import * as shortcutProtocol from '@/data/keyboardShortcutDefaults';
import { 创建空角色 } from '@/models/character';
import { LeftPanel } from '@/components/layout/LeftPanel';
import { buildCodexKeywordRecallQuery } from '@/hooks/useGame/historyWindow';
import { getCodexNpcNamesForTurn } from '@/hooks/useGame/npcPresence';
import { buildCourierModelLookupConfig } from '@/components/features/Settings/CourierSystemSettingsTab';
import { buildSteambirdModelLookupConfig } from '@/components/features/Settings/SteambirdSystemSettingsTab';
import { buildCodexModelLookupConfig } from '@/components/features/Settings/CodexSettingsTab';

describe('Teyvat extension systems', () => {
  it('creates and normalizes a Courier system without old runtime keys or input mutation', () => {
    const empty = createEmptyCourierSystem();
    expect(empty).toEqual({ contacts: [], letters: [], conversations: [], deliverySeeds: [], unreadTotal: 0, wallpapers: {} });
    expect(JSON.stringify(empty)).not.toMatch(/手机|phone/iu);

    const dirty = { conversations: [{ id: 'c-1', title: '安柏', participantIds: ['amber'], messages: [], unread: 1, type: 'private', typingMemberIds: [], updatedAt: 1, unknown: true }], unknown: true };
    const normalized = normalizeCourierSystem(dirty);
    expect(normalized).toEqual(expect.objectContaining({ conversations: [expect.not.objectContaining({ unknown: expect.anything() })] }));
    expect(dirty.conversations[0]).toHaveProperty('unknown', true);
  });

  it('handles private, group, and system correspondence with deterministic unread and immutable seed updates', () => {
    const conversations: CourierConversation[] = [
      { id: 'private', title: '安柏', participantIds: ['amber'], messages: [], unread: 2, type: 'private', typingMemberIds: [], updatedAt: 1 },
      { id: 'group', title: '骑士团', participantIds: ['amber', 'kaeya'], messages: [], unread: 1, type: 'group', typingMemberIds: [], updatedAt: 1 },
      { id: 'system', title: '协会公告', participantIds: [], messages: [], unread: 0, type: 'system', typingMemberIds: [], updatedAt: 1 },
    ];
    const system = { ...createEmptyCourierSystem(), conversations, deliverySeeds: [{ id: 'seed-1', senderId: 'amber', reason: '巡逻结束', turn: 2, source: 'system' as const, triggerType: 'custom' as const, priority: 'normal' as const, targetType: 'private' as const, targetId: 'private', title: '来信', context: '安柏完成巡逻', relatedNpcIds: ['amber'], status: 'pending' as const }] };
    const message = { id: 'm-1', senderId: 'amber', senderName: '安柏', role: 'contact', content: '巡逻结束。', turn: 2, timestamp: 2, readBy: [] };
    const appended = appendCourierMessage(system, 'group', message);
    const consumed = consumeCourierSeed(appended, 'seed-1');

    expect(calculateCourierUnread(consumed)).toBe(4);
    expect(appended).not.toBe(system);
    expect(appended.conversations[1]).not.toBe(system.conversations[1]);
    expect(appended.conversations[1].messages).toEqual([message]);
    expect(system.conversations[1].messages).toEqual([]);
    expect(consumed.deliverySeeds[0].status).toBe('generated');
    expect(appended.deliverySeeds[0].status).toBe('pending');
  });

  it('delivers each due Courier seed as sentence-split messages and one conversation unread', () => {
    const system = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', name: '安柏', available: true }],
      conversations: [{
        id: 'amber', title: '安柏', participantIds: ['amber'], messages: [], unread: 0,
        type: 'private' as const, typingMemberIds: [], updatedAt: 1,
      }],
      deliverySeeds: [{
        id: 'seed-due', senderId: 'amber', reason: '巡逻结束', turn: 2,
        source: 'system' as const, triggerType: 'custom' as const, priority: 'normal' as const,
        targetType: 'private' as const, targetId: 'amber', title: '巡逻来信',
        context: '鹰翔海滩的巡逻已经结束。', relatedNpcIds: ['amber'], status: 'pending' as const,
      }],
    };

    const delivered = processScheduledCourierSeeds(system, 2, 2000);

    expect(delivered.due.map((seed) => seed.id)).toEqual(['seed-due']);
    const messages = delivered.next.conversations[0].messages;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.every((message) => message.senderId === 'amber' && message.senderName === '安柏')).toBe(true);
    expect(messages.every((message) => message.sourceSeedId === 'seed-due' && message.deliveredAtTurn === 2)).toBe(true);
    // 主动消息必须由种子改写成聊天口吻，而不是照抄种子原文。
    const joined = messages.map((message) => message.content).join('\n');
    expect(joined).not.toBe('鹰翔海滩的巡逻已经结束。');
    expect(joined).not.toContain('—— 安柏');
    expect(joined.length).toBeGreaterThan(12);
    // 未读按「一封来信」计 1，不按拆分条数膨胀。
    expect(delivered.next.conversations[0].unread).toBe(1);
    expect(delivered.next.deliverySeeds[0].status).toBe('generated');
    expect(system.conversations[0].messages).toEqual([]);
    expect(system.conversations[0].unread).toBe(0);
  });

  it('auto-creates contacts for unknown senders and keeps one conversation window per character', () => {
    const system = {
      ...createEmptyCourierSystem(),
      deliverySeeds: [
        {
          id: 'seed-a', senderId: 'paimon', reason: '好久不见', turn: 3,
          source: 'main_story' as const, triggerType: 'relationship' as const, priority: 'normal' as const,
          targetType: 'private' as const, targetId: 'paimon', title: '派蒙的来信',
          context: '派蒙想起之前一起吃过的料理想念旅行者。', relatedNpcIds: ['paimon'], status: 'pending' as const,
        },
        {
          id: 'seed-b', senderId: 'paimon', reason: '再次来信', turn: 4,
          source: 'main_story' as const, triggerType: 'custom' as const, priority: 'normal' as const,
          targetType: 'private' as const, targetId: 'paimon', title: '派蒙的跟进来信',
          context: '派蒙又在惦记下顿饭了。', relatedNpcIds: ['paimon'], status: 'pending' as const,
        },
      ],
    };

    const first = processScheduledCourierSeeds(system, 3, 3000);
    expect(first.next.contacts).toEqual([expect.objectContaining({ id: 'paimon', name: '派蒙' })]);
    expect(first.next.conversations).toHaveLength(1);
    expect(first.next.conversations[0].participantIds).toContain('paimon');

    // 同一人物始终复用同一个窗口，不另开新会话。
    const second = processScheduledCourierSeeds(first.next, 4, 4000);
    expect(second.next.conversations).toHaveLength(1);
    expect(second.next.conversations[0].messages.length).toBeGreaterThanOrEqual(2);
    expect(second.next.conversations[0].messages.every((message) => message.senderName === '派蒙')).toBe(true);
  });

  it('replies only to conversations whose last message is from the player, once per round-trip', () => {
    const system = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', name: '安柏', available: true }],
      conversations: [{
        id: 'amber', title: '安柏', participantIds: ['amber', 'player'],
        messages: [{
          id: 'player-msg', senderId: 'player', senderName: '旅人', role: 'user',
          content: '安柏，蒙德城最近有什么委托吗？', turn: 5, timestamp: 5000, readBy: ['player'],
        }],
        unread: 0, type: 'private' as const, typingMemberIds: [], updatedAt: 5000,
      }],
    };

    const candidates = findCourierReplyCandidates(system, 2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].contactId).toBe('amber');
    expect(candidates[0].playerMessage.id).toBe('player-msg');

    // 本地回复：自然回应，但不重复联系人署名，也不摘抄玩家原文。
    const reply = composeCourierReplyLocally({
      conversation: system.conversations[0],
      playerMessage: system.conversations[0].messages[0],
      sender: { name: '安柏' },
      travelerName: '旅人',
    });
    expect(reply.length).toBeGreaterThan(5);
    expect(reply).not.toContain('蒙德城最近有什么委托吗？'.slice(0, 12));
    expect(reply).not.toMatch(/见信|回信|盼复|落款/);

    // 回信写入后，该会话最后一条变为联系人消息，不再命中回信候选。
    const replied = appendCourierMessage(system, 'amber', {
      id: 'reply-1', senderId: 'amber', senderName: '安柏', role: 'contact',
      content: reply, turn: 6, timestamp: 6000, readBy: [],
    });
    expect(findCourierReplyCandidates(replied, 2)).toHaveLength(0);

    // 系统会话与空会话不参与回信。
    const silent = {
      ...createEmptyCourierSystem(),
      conversations: [
        { id: 'sys', title: '协会公告', participantIds: [], messages: [], unread: 0, type: 'system' as const, typingMemberIds: [], updatedAt: 1 },
      ],
    };
    expect(findCourierReplyCandidates(silent, 2)).toHaveLength(0);
  });

  it('archives and retrieves only explicit Irminsul entry fields without retaining unknown nested keys', () => {
    expect(createEmptyIrminsulMemory()).toEqual({ entries: [] });
    const entry = buildIrminsulArchiveEntry({ id: 'i-1', title: '风起之忆', summary: '旅行者抵达蒙德。', sourceTurns: [1], keywords: ['蒙德'], recordedAt: '1', archiveType: 'refined', sourceText: '正文', turn: 1, privateAlias: 'drop' });
    const normalized = normalizeIrminsulMemory({ entries: [entry] });
    expect(normalized.entries[0]).toEqual({ id: 'i-1', title: '风起之忆', summary: '旅行者抵达蒙德。', sourceTurns: [1], keywords: ['蒙德'], recordedAt: '1', archiveType: 'refined', sourceText: '正文', turn: 1 });
    expect(retrieveIrminsulEntries(normalized, '蒙德', 3).map((item) => item.id)).toEqual(['i-1']);
  });

  it('normalizes private Steambird output to null and constructs generation input from public facts only', () => {
    const normalized = normalizeSteambirdNews({ articles: [{ id: 's-1', section: 'world', status: 'published', title: '公开报道', body: '风起地出现异动', turn: 1, timestamp: 1, important: false, organizationTags: [], relatedSystems: [], narrativeSeriesId: '', narrativeSegmentId: '', createdAt: 1, updatedAt: 1, privateAlias: 'drop' }] });
    expect(normalized.articles[0]).not.toHaveProperty('privateAlias');
    expect(normalizeSteambirdGeneration({ publicArticles: normalized.articles, privateArticles: [{ title: '秘密' }] })).toEqual(null);
    const untrustedInput = { publicFacts: [{ title: '风起地异动', detail: '风场紊乱' }], privateFacts: [{ title: '深渊线索' }] } as unknown as { publicFacts: readonly { title: string; detail: string }[] };
    expect(buildSteambirdGenerationRequest(untrustedInput)).toEqual({ publicFacts: [{ title: '风起地异动', detail: '风场紊乱' }] });
  });

  it('deep-normalizes partial Steambird AI articles without leaking unknown or private state', () => {
    const partial = {
      publicArticles: [{
        id: 'partial-1',
        title: '枫丹廷新闻',
        body: '蒸汽鸟报记录了一场公开展览。',
        organizationTags: undefined,
        relatedSystems: { privateRoute: '不应泄露' },
        privateFacts: [{ detail: '秘密' }],
        fullState: { traveler: { secret: true } },
        unknownNested: { privateAlias: '丢弃' },
      }],
    };

    const normalized = normalizeSteambirdGeneration(partial);

    expect(normalized).toEqual([{
      id: 'partial-1', section: 'world', status: 'published', title: '枫丹廷新闻',
      body: '蒸汽鸟报记录了一场公开展览。', turn: 0, timestamp: 0, important: false,
      organizationTags: [], relatedSystems: [], narrativeSeriesId: '', narrativeSegmentId: '',
      createdAt: 0, updatedAt: 0,
    }]);
    expect(JSON.stringify(normalized)).not.toMatch(/private|fullState|unknownNested|不应泄露|秘密/iu);
    expect(partial.publicArticles[0]).toHaveProperty('fullState');
    expect(normalizeSteambirdGeneration({ publicArticles: 'invalid' })).toBeNull();
  });

  it('retrieves formal Codex entries, preserves unlock and injection behavior, and excludes unknown fields', () => {
    const codex = normalizeArchiveCodex({ entries: [{ id: 'c-1', category: 'organization', name: '西风骑士团', description: '蒙德守护者', unlockedAtTurn: 1, tags: ['蒙德'], summary: '守护蒙德', sourceText: '骑士团负责蒙德城防务。', source: 'builtin', keywords: ['骑士团'], triggerKeywords: ['西风骑士团'], injection: { publicText: '骑士团守护蒙德。', hidden: 'drop' }, runtimeUnlock: { status: 'unlocked', note: '已会面' }, usage: { narrative: true, courier: true, news: true, variables: false }, relatedEntryIds: [], importance: 4, linkable: true, builtin: true, createdAt: 1, updatedAt: 1, unknown: true }], unlockedEntryIds: ['c-1'], unknown: true });
    const recalled = retrieveCodexEntries(codex, '西风骑士团', 3);
    expect(recalled.entries.map((entry) => entry.id)).toEqual(['c-1']);
    expect(buildCodexEntryInjectionPreview(recalled.entries[0])).toContain('骑士团守护蒙德。');
    expect(codex.entries[0]).not.toHaveProperty('unknown');
    expect(codex.entries[0].injection).not.toHaveProperty('hidden');
    const index = buildCodexAiCandidateIndex(codex, recalled.entries);
    expect(compileCodexAiSelection(index, { selectedIds: ['c-1'] }).entries.map((entry) => entry.id)).toEqual(['c-1']);
  });

  it('does not recommit or announce an exactly unlocked Codex entry', () => {
    const codex = normalizeArchiveCodex({
      entries: [{
        id: 'dragon-entry', name: '风魔龙', updatedAt: 17,
        runtimeUnlock: { status: 'unlocked', note: '已解锁', condition: '龙灾告终' },
      }],
      unlockedEntryIds: ['dragon-entry'],
    });
    const storyWeaving = {
      系列列表: [{
        id: 'series-1', 标题: '序章', 激活注入: true, 当前分段组号: 1,
        分段列表: [{ id: 'segment-1', 组号: 1, 标题: '龙灾告终', 运行状态: '当前' }],
      }],
      当前系列ID: 'series-1',
      当前进度: {
        当前系列ID: 'series-1', 当前分段ID: 'segment-1', 当前分段组号: 1,
        历史归档: [{
          id: 'archive-1', 分段ID: 'segment-1', 分段组号: 1, 分段标题: '龙灾告终',
          归档状态: '已完成', 摘要: '龙灾已经告终。', 切换说明: '', 判定理由: [], createdAt: 5,
        }],
      },
    } as never;

    const result = applyStoryArchiveCodexRuntimeUnlock({ codex, storyWeaving });

    expect(result.changed).toBe(false);
    expect(result.unlocked).toEqual([]);
    expect(result.codex.entries[0].updatedAt).toBe(17);
    expect(result.codex).toEqual(codex);
  });

  it('restores only formal extension slices present in a pre-turn snapshot', () => {
    const set信使 = vi.fn();
    const set世界树 = vi.fn();
    const set蒸汽鸟报 = vi.fn();
    const set图鉴 = vi.fn();
    const state = {
      set旅人: vi.fn(), set背包: vi.fn(), set世界: vi.fn(), set记忆: vi.fn(),
      set手机: set信使, set世界树, set蒸汽鸟报, set图鉴,
      setNPC: vi.fn(), set相册: vi.fn(), set剧情: vi.fn(), set剧情编织: vi.fn(),
      setVariableBatches: vi.fn(), setQueueTasks: vi.fn(), setTurnCount: vi.fn(), setPendingOpeningTrigger: vi.fn(),
      相册: { assets: [], entries: [], tasks: [] }, 剧情编织: { 系列列表: [] },
    } as never;
    const courier = createEmptyCourierSystem();
    const codex = normalizeArchiveCodex({ entries: [], unlockedEntryIds: [] });
    restorePreTurnSnapshot(state, {
      旅人: {}, 世界: {}, 记忆: {}, NPC: [], 剧情: [], variableBatches: [], turnCount: 4,
      手机: courier, 图鉴: codex,
    });

    expect(set信使).toHaveBeenCalledWith(courier);
    expect(set图鉴).toHaveBeenCalledWith(codex);
    expect(set世界树).not.toHaveBeenCalled();
    expect(set蒸汽鸟报).not.toHaveBeenCalled();
  });

  it('emits only formal extension setting keys while reading historical settings once', () => {
    const defaults = 创建默认游戏设置();
    expect(defaults).toHaveProperty('蒸汽鸟报系统');
    expect(defaults).toHaveProperty('手机系统');
    expect(defaults).toHaveProperty('图鉴系统');
    expect(defaults).not.toHaveProperty('新闻系统');
    expect(defaults).not.toHaveProperty('信使系统');
    expect(defaults).not.toHaveProperty('智库系统');

    const memory = 归一化记忆系统设置({
      忆庭启用: false,
      忆庭召回最早触发回合: 12,
      忆庭召回条数: 4,
      忆庭召回API: { provider: 'openai', baseUrl: 'legacy', apiKey: '', model: 'legacy-model' },
    } as never);
    expect(memory.世界树启用).toBe(false);
    expect(memory.世界树召回最早触发回合).toBe(12);
    expect(memory.世界树召回条数).toBe(4);
    expect(memory.世界树召回API.model).toBe('legacy-model');
    expect(memory).not.toHaveProperty('忆庭启用');
    expect(memory).not.toHaveProperty('忆庭召回API');
  });

  it('uses Courier prompt IDs and maps persisted phone IDs only at the settings read boundary', () => {
    const courierModules = createBuiltinPromptModules().filter((module) => module.id.startsWith('builtin_courier_'));
    expect(courierModules.map((module) => module.id)).toEqual([
      'builtin_courier_worldbook',
      'builtin_courier_style',
      'builtin_courier_dialogue_rules',
      'builtin_courier_output_format',
    ]);
    expect(courierModules.some((module) => /手机/iu.test(`${module.title}\n${module.description}\n${module.content}`))).toBe(true);
    expect(归一化提示词模块ID('builtin_phone_cot')).toBe('builtin_courier_dialogue_rules');
    expect(归一化提示词模块ID('custom_phone_letters')).toBe('custom_courier_letters');
    expect(归一化提示词模块ID('st_import_phone_style')).toBe('st_import_courier_style');
    expect(归一化提示词模块ID('builtin_courier_cot')).toBe('builtin_courier_dialogue_rules');
  });

  it('uses only formal Steambird, Codex, and Irminsul prompt modules while migrating persisted old IDs', () => {
    const modules = createBuiltinPromptModules();
    const formalModules = modules.filter((module) => /^builtin_(steambird|codex|irminsul)_/u.test(module.id));

    expect(formalModules.map((module) => module.id)).toEqual([
      'builtin_steambird_editorial_rules',
      'builtin_steambird_worldbook',
      'builtin_steambird_output_format',
      'builtin_codex_retrieval_rules',
      'builtin_codex_output_format',
      'builtin_irminsul_recall',
      'builtin_irminsul_archive_format',
    ]);
    expect(modules.some((module) => /^builtin_(news|zhiku|yiting)_/u.test(module.id))).toBe(false);
    expect(formalModules.every((module) => !/新闻系统|智库|忆庭/u.test(`${module.title}\n${module.description}\n${module.content}`))).toBe(true);
    expect(归一化提示词模块ID('builtin_news_cot')).toBe('builtin_steambird_editorial_rules');
    expect(归一化提示词模块ID('builtin_zhiku_output_format')).toBe('builtin_codex_output_format');
    expect(归一化提示词模块ID('builtin_yiting_recall')).toBe('builtin_irminsul_recall');
    expect(归一化提示词模块ID('builtin_steambird_cot')).toBe('builtin_steambird_editorial_rules');
  });

  it('keeps the historical Codex desktop sidecar read-only behind the compatibility boundary', () => {
    const hookSource = readFileSync(resolve('hooks/useGameState.ts'), 'utf8');
    const desktopMirrorSource = readFileSync(resolve('services/desktop/desktopSettingsMirror.ts'), 'utf8');
    const compatibilitySource = readFileSync(resolve('compat/legacy-hsr/readOnly.ts'), 'utf8');

    expect(hookSource).not.toContain("saveSetting('zhikuSystem'");
    expect(desktopMirrorSource).toContain('getLegacyDesktopSettingPath');
    expect(compatibilitySource).toMatch(/key === 'codexSystem' \? 'zhiku\/system\.json'/u);
    expect(desktopMirrorSource).not.toMatch(/const SPECIAL_SETTING_PATHS[^=]*=\s*\{[^}]*zhikuSystem/u);
  });

  it('emits courier_seed facts while accepting phone_seed only as untrusted parser input', () => {
    const formal = parseVariableFacts('<变量事实>{"facts":[{"type":"courier_seed","title":"巡逻来信","context":"安柏已结束巡逻"}]}</变量事实>');
    const historical = parseVariableFacts('<变量事实>{"facts":[{"type":"phone_seed","title":"旧档来信","context":"历史输入"}]}</变量事实>');
    expect(formal.parseErrors).toEqual([]);
    expect(formal.facts).toEqual([expect.objectContaining({ type: 'courier_seed', title: '巡逻来信' })]);
    expect(historical.parseErrors).toEqual([]);
    expect(historical.facts).toEqual([expect.objectContaining({ type: 'courier_seed', title: '旧档来信' })]);
    expect(JSON.stringify([...formal.facts, ...historical.facts])).not.toContain('phone_seed');
  });

  it('normalizes historical NPC channels and emits only formal Codex channel flags', () => {
    const [npc] = 归一化NPC记录列表([{
      id: 'npc_amber', 姓名: '安柏',
      图像档案: { 头像槽位: { 手机: 'legacy-avatar.png' } },
      同行记忆: [{ id: 'memory-1', 回合: 1, 摘要: '公开报道', 来源: '新闻' }],
    }]);
    expect(npc.图像档案?.头像槽位).toEqual({ 手机: 'legacy-avatar.png' });
    expect(npc.同行记忆?.[0]?.来源).toBeUndefined();
    expect(JSON.stringify(npc)).toContain('手机');
    expect(JSON.stringify(npc)).not.toContain('新闻');

    const entry = 创建图鉴条目({
      标题: '西风骑士团',
      可否信使使用: true,
      可否蒸汽鸟报使用: true,
    });
    expect(entry).toHaveProperty('可否信使使用', true);
    expect(entry).toHaveProperty('可否蒸汽鸟报使用', true);
    expect(entry).not.toHaveProperty('可否手机使用');
    expect(entry).not.toHaveProperty('可否新闻使用');
  });

  it('normalizes historical recovery phases and quest rewards without emitting retired values', () => {
    const journal = parseWorkflowRecoveryJournal({
      version: 2,
      workflowId: 'workflow-1',
      startedAt: 1,
      updatedAt: 2,
      input: '继续旅途',
      turnAtStart: 3,
      phase: 'phone_seed',
      phaseStartedAt: 1,
    });
    expect(journal?.phase).toBe('settlement_committed');

    const quests = 归一化任务系统({
      进行中: [{ id: 'quest-1', 标题: '报刊委托', 状态: '进行中', 奖励: [{ 类型: '新闻', 内容: '刊登报道' }] }],
    });
    expect(quests.进行中[0].奖励).toEqual([{ 类型: '蒸汽鸟报', 内容: '刊登报道', 数量: undefined }]);
    expect(JSON.stringify(quests)).not.toContain('新闻');
  });

  it('normalizes historical runtime protocol IDs and emits only formal system IDs', () => {
    const recovery = parseWorkflowRecoveryJournal({
      version: 2,
      workflowId: 'workflow-steambird',
      startedAt: 1,
      updatedAt: 2,
      input: '继续旅途',
      turnAtStart: 3,
      phase: 'news',
      phaseStartedAt: 1,
    });
    expect(recovery?.phase).toBe('settlement_committed');

    const courier = normalizeCourierSystem({
      deliverySeeds: [{
        id: 'seed-legacy', senderId: 'charlotte', reason: '旧报刊事件', turn: 2,
        source: 'news', triggerType: 'news', priority: 'normal', targetType: 'private',
        targetId: 'charlotte', title: '来信', context: '公开报道', relatedNpcIds: ['charlotte'],
        status: 'pending', fromEvent: 'news',
      }],
    });
    expect(courier.deliverySeeds[0]).toEqual(expect.objectContaining({
      source: 'steambird',
      triggerType: 'steambird',
      fromEvent: 'steambird',
    }));
    const parsedSeed = parseVariableFacts('<变量事实>{"facts":[{"type":"courier_seed","title":"旧报刊来信","context":"公开报道","triggerType":"news"}]}</变量事实>');
    expect(parsedSeed.facts[0]).toEqual(expect.objectContaining({ type: 'courier_seed', triggerType: 'steambird' }));

    const [npc] = normalizeTeyvatNpcRecords([{
      id: 'charlotte',
      name: '夏洛蒂',
      sharedMemories: [{ id: 'memory-1', turn: 2, summary: '公开报道', sourceText: '正文', source: 'news', relatedNpcIds: [] }],
    }]);
    expect(npc.sharedMemories[0]?.source).toBe('steambird');

    const codex = normalizeArchiveCodex({
      entries: [{ id: 'entry-1', usage: { narrative: true, courier: true, news: true, variables: false } }],
    });
    expect(codex.entries[0].usage).toEqual({ narrative: true, courier: true, steambird: true, variables: false });

    const queue = normalizeBackgroundQueueState({
      tasks: [
        { id: 'news', title: '旧报刊队列', status: 'pending' },
        { id: 'yiting', title: '旧记忆队列', status: 'pending' },
        { id: 'zhiku', title: '旧图鉴队列', status: 'pending' },
        { id: 'phone', title: '旧来信队列', status: 'pending' },
      ],
    });
    expect(queue.tasks.map((task) => task.id)).toEqual(['steambird', 'irminsul', 'codex', 'courier']);

    expect(DEFAULT_NOTIFICATION_SETTINGS.events).toEqual({ courier: true, steambird: true, image: true, quest: true });
    expect(KEYBOARD_SHORTCUT_ACTIONS).toContain('courier');
    expect(KEYBOARD_SHORTCUT_ACTIONS).not.toContain('phone');
    // 默认键位使用 Alt 组合，避免与浏览器 Ctrl+R/Ctrl+S 原生快捷键冲突。
    expect(KEYBOARD_SHORTCUT_DEFAULTS.courier).toEqual({ key: 'm', alt: true });

    const normalizeNotifications = (notificationProtocol as typeof notificationProtocol & {
      归一化通知设置?: (input: unknown) => unknown;
    }).归一化通知设置;
    expect(normalizeNotifications?.({ enabled: true, events: { phone: false, news: false, image: true, quest: true } })).toEqual({
      enabled: true,
      events: { courier: false, steambird: false, image: true, quest: true },
      quietStartHour: 23,
      quietEndHour: 8,
    });

    const normalizeShortcuts = (shortcutProtocol as typeof shortcutProtocol & {
      归一化快捷键绑定表?: (input: unknown) => unknown;
    }).归一化快捷键绑定表;
    expect(normalizeShortcuts?.({ phone: { key: 'p', ctrl: true } })).toEqual(expect.objectContaining({
      courier: { key: 'p', ctrl: true },
    }));
    expect(normalizeShortcuts?.({ phone: { key: 'p', ctrl: true } })).not.toHaveProperty('phone');

    const conversation = normalizeConversationLog({
      entries: [{
        id: 'legacy-turn', role: 'assistant', content: '旧回合', timestamp: 1,
        tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, source: 'api', system: 'news' },
        debugMetadata: {
          systemPrompt: 'prompt', messages: [], deepSeekProtocolIssues: [],
          yitingRecallPreview: '旧世界树摘要', zhikuRecallPreview: '旧图鉴摘要',
        },
      }],
    });
    expect(conversation.entries[0].tokenUsage?.system).toBe('steambird');
    expect(conversation.entries[0].debugMetadata).toEqual(expect.objectContaining({
      irminsulRecallPreview: '旧世界树摘要',
      codexRecallPreview: '旧图鉴摘要',
    }));
    expect(conversation.entries[0].debugMetadata).not.toHaveProperty('yitingRecallPreview');
    expect(conversation.entries[0].debugMetadata).not.toHaveProperty('zhikuRecallPreview');
  });

  it('exposes formal Codex workflow names and a functional Courier launcher prop', () => {
    expect(buildCodexKeywordRecallQuery({ userInput: '风魔龙', history: [] })).toContain('风魔龙');
    expect(getCodexNpcNamesForTurn({
      world: { 当前地点: '蒙德城' } as never,
      npcs: [], history: [], userInput: '安柏正在城门等候。', turnCount: 3,
    })).toContain('安柏');

    const markup = renderToStaticMarkup(createElement(LeftPanel, {
      traveler: 创建空角色(),
      onOpenCourier: () => undefined,
    } as never));
    expect(markup).toMatch(/<button(?=[^>]*title="打开手机")(?![^>]*disabled="")[^>]*>/u);
  });

  it('builds only formal temporary model lookup IDs for active system tabs', () => {
    const input = {
      provider: 'openai' as const,
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'secret',
      model: 'model-a',
      retryCount: 2,
      enableClaudeMode: false,
    };
    expect(buildCourierModelLookupConfig(input)).toEqual(expect.objectContaining({ id: '__courier_override__', name: '手机消息', model: 'model-a' }));
    expect(buildSteambirdModelLookupConfig(input)).toEqual(expect.objectContaining({ id: '__steambird_override__', name: '蒸汽鸟报', model: 'model-a' }));
    expect(buildCodexModelLookupConfig(input)).toEqual(expect.objectContaining({ id: '__codex_override__', name: '图鉴', model: 'model-a' }));
  });
});

describe('courier sender registration and reply pass', () => {
  const seed = {
    id: 'seed_new', senderId: 'npc_charlotte', reason: '想采访旅行者', turn: 3,
    source: 'main_story' as const, triggerType: 'relationship' as const, priority: 'normal' as const,
    targetType: 'private' as const, targetId: 'npc_charlotte', title: '夏洛蒂的采访邀约',
    context: '夏洛蒂想采访旅行者。', relatedNpcIds: ['npc_charlotte'], status: 'pending' as const,
  };

  it('registers unknown letter senders as extra NPC records exactly once', () => {
    const records = buildCourierSenderNpcRecords({
      dueSeeds: [seed, seed],
      contacts: [{ id: 'npc_charlotte', name: '夏洛蒂', available: true }],
      npcs: [],
      turn: 4,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'npc_charlotte', 姓名: '夏洛蒂', 阶位: 'extra', 同行: false, 初见回合: 4, 最近回合: 4,
    });
    expect(records[0].介绍).toContain('通过手机消息结识');
  });

  it('skips senders that already have an NPC record', () => {
    const existing = {
      id: 'npc_charlotte', 姓名: '夏洛蒂', 阶位: 'extra' as const, 好感度: 0, 关系: 'stranger' as const,
      同行: false, 初见回合: 1, 最近回合: 2, 备注: [],
    };
    const records = buildCourierSenderNpcRecords({
      dueSeeds: [seed],
      contacts: [{ id: 'npc_charlotte', name: '夏洛蒂', available: true }],
      npcs: [existing],
      turn: 4,
    });
    expect(records).toHaveLength(0);
  });

  it('replies to player-authored conversations locally without an API config', async () => {
    const system: ReturnType<typeof createEmptyCourierSystem> = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'npc_charlotte', name: '夏洛蒂', available: true }],
      conversations: [{
        id: 'conv_charlotte', title: '夏洛蒂', participantIds: ['npc_charlotte', 'player'],
        messages: [{
          id: 'player_msg_1', senderId: 'player', senderName: '旅人', role: 'user',
          content: '可以，明天在咖啡馆见。', turn: 4, timestamp: 4000, readBy: ['player'],
        }],
        unread: 0, type: 'private' as const, typingMemberIds: [], updatedAt: 4000,
      }],
    };
    const result = await runCourierReplyPass({
      courier: system,
      npcs: [],
      letterApiConfig: null,
      turn: 5,
      travelerName: '旅人',
    });
    expect(result.replied).toBe(1);
    const conversation = result.courier.conversations[0];
    // 玩家 1 条 + 回信拆成 1~多条。
    expect(conversation.messages.length).toBeGreaterThanOrEqual(2);
    const replyMessages = conversation.messages.slice(1);
    expect(replyMessages.every((message) => message.senderId === 'npc_charlotte' && message.role === 'contact')).toBe(true);
    expect(replyMessages.every((message) => message.content.trim().length > 0)).toBe(true);
    expect(replyMessages.map((message) => message.content).join('\n').length).toBeGreaterThan(10);
    // 回信后再次运行不应重复回信（最后一条已是联系人消息）。
    const second = await runCourierReplyPass({
      courier: result.courier, npcs: [], letterApiConfig: null, turn: 6, travelerName: '旅人',
    });
    expect(second.replied).toBe(0);
  });

  it('splits letters into sentence-level messages without losing content', () => {
    const letter = '亲爱的旅行者：\n今天在鹰翔海滩巡逻的时候，发现了一些奇怪的足迹。我已经上报给骑士团了，你路上小心。盼复。\n—— 安柏';
    const lines = splitLetterIntoLines(letter);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toBe('亲爱的旅行者：');
    expect(lines[lines.length - 1]).toBe('—— 安柏');
    // 拆条不得丢字：拼回去（去空白）应包含原信全部内容。
    const rejoin = lines.join('');
    for (const piece of ['鹰翔海滩', '奇怪的足迹', '骑士团', '盼复']) {
      expect(rejoin).toContain(piece);
    }
  });

  it('selects a deterministic, bounded set of group reply members excluding the player', () => {
    const conversation = { id: 'group_x', participantIds: ['player', 'amber', 'kaeya', 'lisa', 'barbara'] };
    const playerMessage = { id: 'player_msg' };
    const members = selectGroupReplyMembers(conversation, playerMessage, 3);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members.length).toBeLessThanOrEqual(3);
    expect(members).not.toContain('player');
    for (const member of members) expect(conversation.participantIds).toContain(member);
    // 同一玩家消息得到的成员组合可复现（打字指示与回帖保持一致）。
    expect(selectGroupReplyMembers(conversation, playerMessage, 3)).toEqual(members);
    // 只有玩家自己时无成员可回帖。
    expect(selectGroupReplyMembers({ id: 'solo', participantIds: ['player'] }, playerMessage)).toEqual([]);
  });

  it('replies to a group conversation with multiple members, each signing their own message', async () => {
    const system = {
      ...createEmptyCourierSystem(),
      contacts: [
        { id: 'amber', name: '安柏', available: true },
        { id: 'kaeya', name: '凯亚', available: true },
        { id: 'lisa', name: '丽莎', available: true },
      ],
      conversations: [{
        id: 'group_mondstadt', title: '蒙德伙伴', participantIds: ['player', 'amber', 'kaeya', 'lisa'],
        messages: [{
          id: 'player_group_msg', senderId: 'player', senderName: '旅人', role: 'user',
          content: '今晚要不要一起去酒馆聚聚？', turn: 8, timestamp: 8000, readBy: ['player'],
        }],
        unread: 0, type: 'group' as const, typingMemberIds: [], updatedAt: 8000,
      }],
    };
    const result = await runCourierReplyPass({ courier: system, npcs: [], letterApiConfig: null, turn: 9, travelerName: '旅人' });
    expect(result.replied).toBeGreaterThanOrEqual(1);
    const conversation = result.courier.conversations[0];
    const replies = conversation.messages.slice(1);
    expect(replies.length).toBeGreaterThanOrEqual(1);
    // 每条跟帖都来自群内某位成员、署名各自联系人、内容非空。
    const memberIds = new Set(['amber', 'kaeya', 'lisa']);
    expect(replies.every((message) => memberIds.has(message.senderId) && message.role === 'contact')).toBe(true);
    expect(replies.every((message) => message.content.trim().length > 0)).toBe(true);
    // 跟帖至少出现了两位不同成员时，消息署名不应全相同；若只有一位也应成立。
    const distinctSenders = new Set(replies.map((message) => message.senderId));
    expect(distinctSenders.size).toBeGreaterThanOrEqual(1);
    // 回完后最后一条不再是玩家消息，第二轮不应重复回帖。
    const second = await runCourierReplyPass({ courier: result.courier, npcs: [], letterApiConfig: null, turn: 10, travelerName: '旅人' });
    expect(second.replied).toBe(0);
  });

  it('varies local letter warmth by affinity stage so letters do not read one-size-fits-all', () => {
    const seed: CourierDeliverySeed = {
      id: 'seed_letter_affinity', senderId: 'amber', reason: '关心', turn: 5,
      source: 'main_story', triggerType: 'relationship', priority: 'normal', targetType: 'private',
      targetId: 'amber', title: '安柏的来信', context: '旅行者抵达了蒙德城。', relatedNpcIds: [], status: 'pending',
    };
    const base = { seed, environment: { location: '蒙德城' }, travelerName: '旅行者' } as const;
    const devoted = composeCourierLetterLocally({ ...base, sender: { name: '安柏', affinity: 120 } });
    const hostile = composeCourierLetterLocally({ ...base, sender: { name: '安柏', affinity: -40 } });
    expect(devoted).not.toContain('—— 安柏');
    expect(hostile).not.toContain('—— 安柏');
    // 同一事件、同一联系人，挚友与敌对写出的消息应当不同（称呼/语气随好感变化）。
    expect(devoted).not.toBe(hostile);
  });

  it('composes short chat-style group follow-ups without a letter signature', () => {
    const conversation = {
      id: 'group_mondstadt', title: '蒙德伙伴', participantIds: ['player', 'amber'],
      messages: [], unread: 0, type: 'group' as const, typingMemberIds: [], updatedAt: 1,
    } satisfies CourierConversation;
    const longMessage = '今晚天气这么好，要不要大家一起去蒙德城的酒馆聚一聚，顺便聊聊最近冒险里遇到的那些有趣的事情呢？';
    const playerMessage: import('@/models/teyvat/courier').CourierMessage = {
      id: 'player_msg', senderId: 'player', senderName: '旅人', role: 'user',
      content: longMessage, turn: 8, timestamp: 8000, readBy: ['player'],
    };
    const reply = composeCourierGroupReplyLocally({ conversation, playerMessage, sender: { name: '安柏', affinity: 60 }, travelerName: '旅行者' });
    expect(reply.trim().length).toBeGreaterThan(0);
    // 群聊跟帖是口语短句：不带书信落款，只截取片段引用而不整段复读玩家原话。
    expect(reply).not.toContain('——');
    expect(reply).not.toContain(longMessage);
    expect(reply).toContain(longMessage.slice(0, 20));
  });
});
