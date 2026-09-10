import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '../../models/teyvat';
import { classifyAndMigrateDbSaveRecord } from '../../compat/legacy-hsr/migrate';
import { updateTeyvatState } from '../../hooks/useTeyvatRuntime';
import * as saveLoadWorkflow from '../../hooks/useGame/saveLoadWorkflow';

describe('updateTeyvatState', () => {
  it('returns a normalized next root without mutating the current root', () => {
    const initial = createEmptyTeyvatGameState();

    const next = updateTeyvatState(initial, (current) => ({
      ...current,
      世界: { ...current.世界, 当前地点: '蒙德城' },
    }));

    expect(next.世界.当前地点).toBe('蒙德城');
    expect(initial.世界.当前地点).not.toBe('蒙德城');
    expect(next.universe).toBe('teyvat');
    expect(next.schemaVersion).toBe(2);
  });

  it('creates the neutral runtime slices required by the current game loop', () => {
    const state = createEmptyTeyvatGameState();

    expect(state.旅行者.attributes).toEqual({});
    expect(state.旅行者.capabilities).toEqual([]);
    expect(state.世界).toMatchObject({
      当前地点: '',
      当前时段: null,
      开局设定: null,
      叙事模式: '',
    });
    expect(state.手机).toMatchObject({ conversations: [], deliverySeeds: [] });
    expect(state.对话.entries).toEqual([]);
    expect(state.记忆.failedDrafts).toEqual([]);
    expect(state.叙事).toEqual({
      plotNodes: [],
      storyWeaving: null,
      variableBatches: [],
      元素场面: { auraElement: '', updatedTurn: 0, lastSummary: '' },
      元素事件: [],
    });
  });

  it('classifies and maps a partial Teyvat DB record without persisting old root aliases', () => {
    const result = classifyAndMigrateDbSaveRecord({
      universe: 'partial-teyvat',
      schemaVersion: 1,
      turnCount: 4,
      旅人: {
        姓名: '荧',
        主元素: 'anemo',
        属性: { 体魄: 6 },
        能力: ['风元素感知'],
        背包: [{
          id: 'item-1', 类别: 'food', 名称: '提瓦特煎蛋', 描述: '恢复体力', 数量: 2,
          品质: '紫', 可堆叠: true, 获得回合: 2, 叙事效果: ['香气扑鼻'],
          使用效果: [{ 目标属性: '恢复体力', 数值: 20, 依据: '热食' }],
          价值: 200, 来源: '商店', 来源描述: '猎鹿人餐馆', 获得时间: '新历 1 日',
        }],
      },
      世界: {
        当前地点: '蒙德城',
        当前日期: '新历 1 日',
        当前时间: '08:00',
        当前时段: { id: 'morning', 名称: '清晨' },
        开局档案: { 章节锚点ID: 'mondstadt-prologue' },
        剧情模式: 'canon-divergent',
        全局事件: ['风魔龙危机'],
      },
      chatHistory: [{
        id: 'turn-1', role: 'assistant', content: '欢迎来到蒙德。', timestamp: 1,
        parsedResponse: { body: '欢迎来到蒙德。', actionOptions: ['前往骑士团'] },
        preTurnSnapshot: { turnCount: 3 },
        tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, source: 'api' },
        debugContext: { systemPrompt: 'test', messages: [] },
      }],
      记忆: {
        即时记忆: ['抵达蒙德'], 短期记忆: [], 中期记忆: [], 长期记忆: [],
        失败草稿: [{ id: 'draft-1', status: 'pending', fallbackSummary: '待恢复' }],
      },
      手机: {
        contacts: [], unreadTotal: 0,
        chats: [{ id: 'chat-1', title: '骑士团', participantIds: [], messages: [], unread: 0 }],
        messageSeeds: [{ id: 'seed-1', senderId: 'amber', reason: '邀请' }],
      },
      忆庭: { 回忆档案: [{
        id: 'memory-1', 名称: '风起之忆', 类型: '精炼纪要', 摘要: '初到蒙德',
        原文: '旅行者穿过城门。', 检索关键词: ['蒙德'], 来源回合: [1], 回合: 1, 时间戳: '08:00',
      }] },
      智库: { 条目: [{
        id: 'codex-1', 标题: '西风骑士团', 分类: '角色', 摘要: '蒙德守护者', 原文: '骑士团资料原文',
        注入内容: { 公开: '可公开内容' }, 来源: '内置资料', 关键词: ['蒙德'], 触发关键词: ['骑士团'],
        解锁状态: '已解锁', 运行时解锁状态: '可用', 运行时解锁备注: '已会面',
        可否主剧情注入: true, 可否信使使用: true, 可否蒸汽鸟报使用: true, 可否变量参考: true,
        关联条目ID: [], 重要度: 8, 可用于联动: true, builtin: true, createdAt: 1, updatedAt: 2,
      }] },
      新闻: [{
        id: 'news-1', 类目: 'chronicle', 状态: 'ongoing', 回合: 4, 时间戳: 4,
        标题: '风魔龙再现', 正文: '城门进入戒备。', 组织标签: ['knights'], 关联系统: ['canon'],
        关联剧情系列ID: 'mondstadt', 关联剧情分段ID: 'prologue', 重要: true, 创建时间: 3, 更新时间: 4,
      }],
      剧情: [{ id: 'plot-1', 标题: '风起之章' }],
      剧情编织: {
        系列列表: [{
          id: 'mondstadt', 标题: '序章', 作品名: '原神', 来源类型: 'canon', 来源图鉴条目ID: [], 章节列表: [],
          分段列表: [{
            id: 'prologue', 组号: 1, 标题: '捕风的异乡人', 章节范围: '1', 章节标题: [], 是否开局组: true,
            起始章序号: 1, 结束章序号: 1, 启用注入: true, 原文内容: '', 字数: 0, 原文摘要: '', 本段概括: '',
            时间线起点: '', 时间线终点: '', 开局已成立事实: [], 前段延续事实: [], 本段结束状态: [], 给后续参考: [],
            原著硬约束: [{ 内容: '温迪隐藏身份', 信息可见性: { 谁知道: ['温迪'], 谁不知道: ['旅行者'], 是否仅读者视角可见: false, hiddenVisibilityAlias: true }, hiddenConstraintAlias: true }],
            可提前铺垫: [], 登场角色: ['温迪'], 涉及地点: ['蒙德'], 涉及派系: [],
            角色档案: [{ 名称: '温迪', 身份: '吟游诗人', 所属势力: '蒙德', 初始立场: '友好', 关系摘要: [], 状态摘要: [], 首次出现: '序章', 重要性: '核心', hiddenProfileAlias: true }],
            势力档案: [], 地图地点档案: [],
            关键事件: [{ 事件名: '相遇', 事件说明: '风起地相遇', 前置条件: [], 触发条件: [], 阻断条件: [], 事件结果: [], 对后续影响: [], 信息可见性: { 谁知道: ['温迪'], 谁不知道: [], 是否仅读者视角可见: false }, hiddenEventAlias: true }],
            时间线: [{ 标题: '初遇', 时间锚点: '序章', 描述: '风起地', 涉及角色: ['温迪'], hiddenTimelineAlias: true }],
            角色推进: [{ 角色名: '温迪', 本段前状态: [], 本段变化: ['结识旅行者'], 本段后状态: [], 对后续影响: [], hiddenProgressAlias: true }],
            处理状态: '已完成', 运行状态: '当前', updatedAt: 4, hiddenSegmentAlias: true,
          }],
          每段章数: 1, 激活注入: true, 当前分段组号: 1, 当前阶段概括: '', 核心角色摘要: [], 核心角色: ['温迪'],
          涉及地点索引: ['蒙德'], 涉及派系索引: [], createdAt: 1, updatedAt: 4,
        }],
        当前系列ID: 'mondstadt',
        当前进度: {
          当前系列ID: 'mondstadt', 当前分段ID: 'prologue', 当前分段组号: 1, 推进状态: '推进中',
          已完成摘要: [], 当前待解问题: ['温迪是谁'], 切换说明: [], 历史归档: [], 最近门禁结果: 'strong',
          最近判定理由: ['满足条件'], 最近一次推进判定回合: 4, 推进证据: ['已抵达蒙德'], 连续推进证据回合: 1,
          卡段回合数: 0, updatedAt: 4, hiddenStoryProgressAlias: true,
        },
      },
      variableBatches: [{ id: 'batch-1', turn: 4, commands: [] }],
    }, {});

    expect(result, result.kind === 'needs-input' ? JSON.stringify(result.issues) : undefined).toMatchObject({ kind: 'teyvat' });
    if (result.kind !== 'teyvat') return;
    expect(result.state.旅行者).toMatchObject({
      姓名: '荧',
      主元素: 'anemo',
      attributes: { 体魄: 6 },
      capabilities: ['风元素感知'],
    });
    expect(result.state.世界).toMatchObject({
      当前地点: '蒙德城',
      当前时段: { id: 'morning', 名称: '清晨' },
      开局设定: { 章节锚点ID: 'mondstadt-prologue' },
      叙事模式: 'canon-divergent',
      世界事件: ['风魔龙危机'],
    });
    expect(result.state.对话.entries[0]).toMatchObject({
      structuredResponse: {
        body: [{ kind: 'narration', text: '欢迎来到蒙德。' }],
        choices: [{ id: 'legacy-choice-1', label: '前往骑士团' }],
        factCandidates: [],
        continuation: { summary: '', unresolved: [] },
      },
      preTurnState: { turnCount: 3 },
      tokenUsage: { totalTokens: 30 },
      debugMetadata: { systemPrompt: 'test' },
    });
    expect(result.state.记忆.failedDrafts).toEqual([expect.objectContaining({ id: 'draft-1' })]);
    expect(result.state.手机.conversations).toEqual([expect.objectContaining({ id: 'chat-1' })]);
    expect(result.state.手机.deliverySeeds).toEqual([expect.objectContaining({ id: 'seed-1' })]);
    expect(result.state.背包.items).toEqual([expect.objectContaining({
      id: 'item-1', name: '提瓦特煎蛋', rarity: 4, narrativeEffects: ['香气扑鼻'],
      useEffects: [{ target: '恢复体力', value: 20, basis: '热食' }], value: 200,
      sourceDetail: '猎鹿人餐馆', obtainedAt: '新历 1 日',
    })]);
    expect(result.state.世界树.entries).toEqual([expect.objectContaining({
      id: 'memory-1', title: '风起之忆', archiveType: 'refined', sourceText: '旅行者穿过城门。',
      sourceTurns: [1], recordedAt: '08:00',
    })]);
    expect(result.state.图鉴.entries).toEqual([expect.objectContaining({
      id: 'codex-1', name: '西风骑士团', sourceText: '骑士团资料原文',
      injection: { publicText: '可公开内容' }, runtimeUnlock: { status: '可用', note: '已会面' },
      usage: { narrative: true, courier: true, steambird: true, variables: true },
    })]);
    expect(result.state.蒸汽鸟报.articles).toEqual([expect.objectContaining({
      id: 'news-1', title: '风魔龙再现', body: '城门进入戒备。', organizationTags: ['knights'],
      relatedSystems: ['canon'], narrativeSeriesId: 'mondstadt', narrativeSegmentId: 'prologue',
      createdAt: 3, updatedAt: 4,
    })]);
    expect(result.state.叙事).toMatchObject({
      plotNodes: [expect.objectContaining({ id: 'plot-1' })],
      storyWeaving: expect.objectContaining({ activeSeriesId: 'mondstadt' }),
      variableBatches: [expect.objectContaining({ id: 'batch-1' })],
    });
    const story = result.state.叙事.storyWeaving;
    expect(story?.series[0].segments[0]).toMatchObject({
      canonConstraints: [{ content: '温迪隐藏身份', visibility: { knownBy: ['温迪'], unknownBy: ['旅行者'], readerOnly: false } }],
      characterProfiles: [{ name: '温迪', importance: 'core' }],
      keyEvents: [{ name: '相遇' }],
      timeline: [{ title: '初遇' }],
      characterProgress: [{ characterName: '温迪', changes: ['结识旅行者'] }],
    });
    expect(story?.progress).toMatchObject({
      seriesId: 'mondstadt', segmentId: 'prologue', status: 'progressing', gate: 'strong', evidence: ['已抵达蒙德'],
    });
    expect(story?.series[0].segments[0]).not.toHaveProperty('hiddenSegmentAlias');
    expect(story?.series[0].segments[0].canonConstraints[0]).not.toHaveProperty('hiddenConstraintAlias');
    expect(story?.series[0].segments[0].canonConstraints[0].visibility).not.toHaveProperty('hiddenVisibilityAlias');
    expect(story?.progress).not.toHaveProperty('hiddenStoryProgressAlias');
    expect(result.state).not.toHaveProperty('旅人');
    expect(result.state).toHaveProperty('手机');
    expect(result.state).not.toHaveProperty('信使');
    expect(result.state).not.toHaveProperty('剧情');
    expect(result.state).not.toHaveProperty('variableBatches');
  });

  it('drops unknown root and slice fields during normalization', () => {
    const normalized = normalizeTeyvatGameState({
      ...createEmptyTeyvatGameState(),
      hiddenSidecar: { writable: true },
      世界: { 当前地点: '璃月港', hiddenWorldAlias: 'nope' },
      旅行者: { ...createEmptyTeyvatGameState().旅行者, hiddenTravelerAlias: 'nope' },
      手机: { ...createEmptyTeyvatGameState().手机, hiddenCourierAlias: 'nope' },
      原著轨道: { ...createEmptyTeyvatGameState().原著轨道, hiddenCanonAlias: 'nope' },
      对话: { entries: [], hiddenConversationAlias: 'nope' },
      记忆: { ...createEmptyTeyvatGameState().记忆, hiddenMemoryAlias: 'nope' },
      相册: { ...createEmptyTeyvatGameState().相册, hiddenAlbumAlias: 'nope' },
      任务: { ...createEmptyTeyvatGameState().任务, hiddenQuestAlias: 'nope' },
      后台队列: { tasks: [], hiddenQueueAlias: 'nope' },
      叙事: { ...createEmptyTeyvatGameState().叙事, hiddenNarrativeAlias: 'nope' },
      背包: { items: [{
        id: 'item-2', category: 'food', name: '烤吃虎鱼', description: '', quantity: 1,
        rarity: 2, obtainedAtTurn: 1, hiddenItemAlias: 'nope',
      }], mora: 0, hiddenInventoryAlias: 'nope' },
    });

    expect(normalized).not.toHaveProperty('hiddenSidecar');
    expect(normalized.世界).not.toHaveProperty('hiddenWorldAlias');
    expect(normalized.旅行者).not.toHaveProperty('hiddenTravelerAlias');
    expect(normalized.手机).not.toHaveProperty('hiddenCourierAlias');
    expect(normalized.原著轨道).not.toHaveProperty('hiddenCanonAlias');
    expect(normalized.对话).not.toHaveProperty('hiddenConversationAlias');
    expect(normalized.记忆).not.toHaveProperty('hiddenMemoryAlias');
    expect(normalized.相册).not.toHaveProperty('hiddenAlbumAlias');
    expect(normalized.任务).not.toHaveProperty('hiddenQuestAlias');
    expect(normalized.后台队列).not.toHaveProperty('hiddenQueueAlias');
    expect(normalized.叙事).not.toHaveProperty('hiddenNarrativeAlias');
    expect(normalized.背包).not.toHaveProperty('hiddenInventoryAlias');
    expect(normalized.背包.items[0]).not.toHaveProperty('hiddenItemAlias');
  });

  it('drops unknown keys from nested runtime records', () => {
    const visitedRegions = ['mondstadt', 'celestia', { id: 'liyue' }];
    const worldEvents = ['风魔龙危机', { event: '对象事件' }, 7, null];
    const visitedPeriods = ['蒙德序章', { id: 'prologue' }, 8, null];
    const normalized = normalizeTeyvatGameState({
      ...createEmptyTeyvatGameState(),
      世界: {
        ...createEmptyTeyvatGameState().世界,
        已访问地区: visitedRegions,
        世界事件: worldEvents,
        已访问时段: visitedPeriods,
      },
      NPC: [{
        id: 'npc-1', 姓名: '安柏', 地区: 'mondstadt', 身份: '侦察骑士', 元素: 'abyss',
        天赋: [{ id: 'talent-1', 名称: '爆弹玩偶', 类别: 'forbidden', 等级: '3.8', 说明: '投掷兔兔伯爵', hiddenTalentAlias: true }],
        说明: '', aliases: [],
        roleTier: 'companion', affinity: 20, relationship: 'friend', intimate: false, travelingTogether: true,
        firstSeenTurn: 1, lastSeenTurn: 2, gender: '女', playerAddress: '旅行者', appearance: '', clothing: '',
        speechStyle: '', personality: '', equipmentSummary: '',
        sharedMemories: [{ id: 'shared-1', turn: 1, summary: '初遇', hiddenSharedAlias: true }],
        relationshipLedger: {
          recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [],
          unresolvedConflicts: [], mustRemember: [], protectedFacts: [],
          summaries: [{ id: 'summary-1', summary: '同行', hiddenSummaryAlias: true }],
        },
        notes: [], playerCorrections: [], canonical: true, avatar: '',
        visualArchive: { profileImage: 'amber.png', hiddenVisualAlias: true }, matureArchive: null,
        hiddenNpcAlias: true,
      }],
      手机: {
        contacts: [{ id: 'amber', name: '安柏', available: true, hiddenContactAlias: true }],
        letters: [],
        conversations: [{
          id: 'chat-1', type: 'private', title: '安柏', participantIds: ['amber'], unread: 0, updatedAt: 1,
          messages: [{ id: 'phone-1', senderId: 'amber', senderName: '安柏', role: 'contact', content: '你好', turn: 1, timestamp: 1, hiddenMessageAlias: true }],
          hiddenConversationAlias: true,
        }],
        deliverySeeds: [{ id: 'seed-1', senderId: 'amber', reason: '问候', turn: 1, source: 'system', triggerType: 'custom', priority: 'normal', targetType: 'private', targetId: 'amber', title: '', context: '问候', relatedNpcIds: [], status: 'pending', hiddenSeedAlias: true }],
        unreadTotal: 0, wallpapers: {}, hiddenCourierAlias: true,
      },
      对话: { entries: [{
        id: 'turn-1', role: 'assistant', content: '你好', timestamp: 1,
        structuredResponse: { body: '你好', thinking: '', memory: '', commands: [], worldEvents: [], actionOptions: [], variableDraft: '', storyPlan: '', awakenInvite: '', awakenQuestions: '', awakenJudgement: '', awakenPathId: '', rawText: '', hiddenResponseAlias: true },
        preTurnState: { turnCount: 0, pendingOpeningTrigger: null, hiddenSnapshotAlias: true },
        tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'api', hiddenTokenAlias: true },
        debugMetadata: { systemPrompt: 'prompt', messages: [], hiddenDebugAlias: true },
        narrativeImages: [{ id: 'image-1', dataUrl: 'data:', type: 'scene', prompt: '', status: 'done', hiddenImageAlias: true }],
        hiddenConversationEntryAlias: true,
      }] },
      记忆: {
        immediate: [], shortTerm: [], mediumTerm: [], longTerm: [],
        recoveryLog: [{ id: 'recovery-1', sourceTurns: { start: 1, end: 2, hiddenRangeAlias: true }, summary: '', status: 'pending', createdAt: 1, updatedAt: 1, hiddenRecoveryAlias: true }],
        failedDrafts: [{ id: 'draft-1', kind: 'short', status: 'pending', sourceTurns: { start: 1, end: 2 }, sourceSnapshot: { encoding: 'plain-json', payload: '{}', checksum: 'x', itemCount: 0, uncompressedBytes: 2 }, targetLayer: '短期记忆', fallbackSummary: '', failureCode: 'request_failed', failureMessage: '', attemptCount: 1, createdAt: 1, updatedAt: 1, hiddenDraftAlias: true }],
      },
      相册: {
        assets: [{ id: 'asset-1', source: 'generated', nsfw: false, createdAt: 1, status: 'ready', hiddenAssetAlias: true }],
        entries: [{ id: 'album-1', kind: 'scene', url: '', prompt: '', description: '', turn: 1, createdAt: 1, hiddenAlbumEntryAlias: true }],
        generationTasks: [{ id: 'task-1', targetType: 'scene', slot: 'scene', source: 'manual', status: 'queued', backend: 'openai_compatible', nsfw: false, prompt: '', retryCount: 0, createdAt: 1, hiddenGenerationAlias: true }],
      },
      任务: { active: [{ id: 'quest-1', title: '', description: '', source: 'main', status: 'active', objectives: [{ id: 'objective-1', type: 'reach', description: '', targetCount: 1, currentCount: 0, completed: false, hiddenObjectiveAlias: true }], rewards: [], createdAtTurn: 1, updatedAt: 1, hiddenQuestAlias: true }], completed: [], abandoned: [], lastUpdates: [] },
      后台队列: { tasks: [{ id: 'memory', title: '', turn: 1, timestamp: 1, status: 'pending', hiddenQueueTaskAlias: true }] },
      叙事: {
        plotNodes: [{ id: 'plot-1', title: '风起', summary: '', status: 'active', createdAtTurn: 1, updatedAtTurn: 1, hiddenPlotAlias: true }],
        storyWeaving: { series: [{ id: 'series-1', title: '序章', workTitle: '序章', sourceType: 'canon', chapters: [], segments: [], active: true, currentSegmentGroup: 1, createdAt: 1, updatedAt: 1, hiddenSeriesAlias: true }], hiddenStoryAlias: true },
        variableBatches: [{ id: 'batch-1', turn: 1, timestamp: 1, source: 'main', results: [{ command: { action: 'set', key: '世界.当前地点', value: '蒙德城', hiddenCommandAlias: true }, ok: true, hiddenResultAlias: true }], hiddenBatchAlias: true }],
      },
    });

    expect(normalized.NPC[0]).not.toHaveProperty('hiddenNpcAlias');
    expect(normalized.NPC[0].sharedMemories[0]).not.toHaveProperty('hiddenSharedAlias');
    expect(normalized.NPC[0].relationshipLedger.summaries[0]).not.toHaveProperty('hiddenSummaryAlias');
    expect(normalized.NPC[0].visualArchive).not.toHaveProperty('hiddenVisualAlias');
    expect(normalized.NPC[0].元素).toBeUndefined();
    expect(normalized.NPC[0].天赋).toEqual([{ id: 'talent-1', 名称: '爆弹玩偶', 类别: 'normal_attack', 关联元素: '', 等级: 3, 说明: '投掷兔兔伯爵' }]);
    expect(normalized.NPC[0].天赋[0]).not.toHaveProperty('hiddenTalentAlias');
    expect(normalized.世界.已访问地区).toEqual(['mondstadt']);
    expect(normalized.世界.世界事件).toEqual(['风魔龙危机']);
    expect(normalized.世界.已访问时段).toEqual(['蒙德序章']);
    expect(normalized.世界.已访问地区).not.toBe(visitedRegions);
    expect(normalized.世界.世界事件).not.toBe(worldEvents);
    expect(normalized.世界.已访问时段).not.toBe(visitedPeriods);
    expect(normalized.手机.contacts[0]).not.toHaveProperty('hiddenContactAlias');
    expect(normalized.手机.conversations[0]).not.toHaveProperty('hiddenConversationAlias');
    expect(normalized.手机.conversations[0].messages[0]).not.toHaveProperty('hiddenMessageAlias');
    expect(normalized.手机.deliverySeeds[0]).not.toHaveProperty('hiddenSeedAlias');
    expect(normalized.对话.entries[0]).not.toHaveProperty('hiddenConversationEntryAlias');
    expect(normalized.对话.entries[0].structuredResponse).toEqual({
      body: [{ kind: 'narration', text: '你好' }],
      choices: [],
      factCandidates: [],
      continuation: { summary: '', unresolved: [] },
    });
    expect(normalized.对话.entries[0].structuredResponse).not.toHaveProperty('hiddenResponseAlias');
    expect(normalized.对话.entries[0].preTurnState).not.toHaveProperty('hiddenSnapshotAlias');
    expect(normalized.对话.entries[0].tokenUsage).not.toHaveProperty('hiddenTokenAlias');
    expect(normalized.对话.entries[0].debugMetadata).not.toHaveProperty('hiddenDebugAlias');
    expect(normalized.对话.entries[0].narrativeImages?.[0]).not.toHaveProperty('hiddenImageAlias');
    expect(normalized.记忆.recoveryLog[0]).not.toHaveProperty('hiddenRecoveryAlias');
    expect(normalized.记忆.failedDrafts[0]).not.toHaveProperty('hiddenDraftAlias');
    expect(normalized.相册.assets[0]).not.toHaveProperty('hiddenAssetAlias');
    expect(normalized.相册.entries[0]).not.toHaveProperty('hiddenAlbumEntryAlias');
    expect(normalized.相册.generationTasks[0]).not.toHaveProperty('hiddenGenerationAlias');
    expect(normalized.任务.active[0]).not.toHaveProperty('hiddenQuestAlias');
    expect(normalized.任务.active[0].objectives[0]).not.toHaveProperty('hiddenObjectiveAlias');
    expect(normalized.后台队列.tasks[0]).not.toHaveProperty('hiddenQueueTaskAlias');
    expect(normalized.叙事.plotNodes[0]).not.toHaveProperty('hiddenPlotAlias');
    expect(normalized.叙事.storyWeaving?.series[0]).not.toHaveProperty('hiddenSeriesAlias');
    expect(normalized.叙事.variableBatches[0]).not.toHaveProperty('hiddenBatchAlias');
    expect(normalized.叙事.variableBatches[0].results[0]).not.toHaveProperty('hiddenResultAlias');
    expect(normalized.叙事.variableBatches[0].results[0].command).not.toHaveProperty('hiddenCommandAlias');
  });
});

describe('executeTeyvatSaveLoadTransaction', () => {
  type ExecuteTransaction = (
    raw: unknown,
    dependencies: {
      classify: (raw: unknown) => unknown;
      beforeReplace?: (next: ReturnType<typeof createEmptyTeyvatGameState>) => Promise<void>;
      replaceGameState: (next: ReturnType<typeof createEmptyTeyvatGameState>) => void;
    },
  ) => Promise<ReturnType<typeof createEmptyTeyvatGameState>>;

  const execute = (saveLoadWorkflow as unknown as { executeTeyvatSaveLoadTransaction?: ExecuteTransaction }).executeTeyvatSaveLoadTransaction;

  it.each([
    ['legacy-hsr', { kind: 'legacy-hsr' }],
    ['needs-input', { kind: 'needs-input', issues: [{ path: '旅行者.主元素' }] }],
    ['invalid', { kind: 'invalid', errors: ['INVALID_SAVE'] }],
  ])('does not replace state for %s classification', async (_label, classification) => {
    expect(typeof execute).toBe('function');
    let replaceCount = 0;
    await expect(execute?.({}, {
      classify: () => classification,
      replaceGameState: () => { replaceCount += 1; },
    })).rejects.toThrow();
    expect(replaceCount).toBe(0);
  });

  it('does not replace state when pre-commit cleanup rejects', async () => {
    expect(typeof execute).toBe('function');
    let replaceCount = 0;
    await expect(execute?.({}, {
      classify: () => ({ kind: 'teyvat', state: createEmptyTeyvatGameState() }),
      beforeReplace: async () => { throw new Error('cleanup failed'); },
      replaceGameState: () => { replaceCount += 1; },
    })).rejects.toThrow('cleanup failed');
    expect(replaceCount).toBe(0);
  });

  it('normalizes and replaces exactly once on success', async () => {
    expect(typeof execute).toBe('function');
    let replaceCount = 0;
    let replaced: ReturnType<typeof createEmptyTeyvatGameState> | null = null;
    const dirty = {
      ...createEmptyTeyvatGameState(),
      hiddenRootAlias: true,
      世界: { 当前地点: '蒙德城', hiddenWorldAlias: true },
    };
    const result = await execute?.(dirty, {
      classify: () => ({ kind: 'teyvat', state: dirty }),
      beforeReplace: async (next) => {
        expect(next.世界.当前地点).toBe('蒙德城');
        expect(next).not.toHaveProperty('hiddenRootAlias');
      },
      replaceGameState: (next) => { replaceCount += 1; replaced = next; },
    });
    expect(replaceCount).toBe(1);
    expect(replaced).toBe(result);
    expect(replaced).not.toHaveProperty('hiddenRootAlias');
    expect(result?.世界).not.toHaveProperty('hiddenWorldAlias');
  });

  it('aligns a loaded canon story to the opening archive before the single atomic replacement', async () => {
    expect(typeof execute).toBe('function');
    const raw = {
      ...createEmptyTeyvatGameState(),
      turnCount: 7,
      世界: {
        ...createEmptyTeyvatGameState().世界,
        当前地点: '璃月港',
        开局设定: {
          来源: 'official',
          主线启用: true,
          地区ID: 'liyue',
          地区名称: '璃月',
          章节锚点ID: 'liyue_ritual_incident',
          章节锚点名称: '请仙典仪',
          防回退规则: [],
        },
      },
      叙事: {
        plotNodes: [],
        variableBatches: [],
        storyWeaving: {
          activeSeriesId: 'story_canon_teyvat_mondstadt_prologue_act1',
          series: [
            {
              id: 'story_canon_teyvat_mondstadt_prologue_act1', title: '蒙德序章', workTitle: '原神', sourceType: 'canon',
              chapters: [], segments: [{ id: 'mondstadt-1', group: 1, title: '捕风的异乡人', processingStatus: 'completed', runtimeStatus: 'current' }],
              active: true, currentSegmentGroup: 1, createdAt: 1, updatedAt: 1,
            },
            {
              id: 'story_canon_teyvat_liyue_chapter1', title: '璃月其一', workTitle: '原神', sourceType: 'canon',
              chapters: [], segments: [{ id: 'liyue-1', group: 1, title: '请仙典仪', processingStatus: 'completed', runtimeStatus: 'not_started' }],
              active: true, currentSegmentGroup: 1, createdAt: 1, updatedAt: 1,
            },
          ],
        },
      },
    };
    const before = structuredClone(raw);
    const replacements: ReturnType<typeof createEmptyTeyvatGameState>[] = [];

    await execute?.(raw, {
      classify: () => ({ kind: 'teyvat', state: raw }),
      replaceGameState: (next) => { replacements.push(next); },
    });

    expect(replacements).toHaveLength(1);
    expect(replacements[0].叙事.storyWeaving?.activeSeriesId).toBe('story_canon_teyvat_liyue_chapter1');
    expect(raw).toEqual(before);
  });

  it('does not reactivate or replay a loaded opening series blocked by player-established facts', async () => {
    expect(typeof execute).toBe('function');
    const raw = {
      ...createEmptyTeyvatGameState(),
      turnCount: 7,
      原著轨道: {
        currentAnchor: 'teyvat_prologue_mondstadt_act1',
        deviations: [{
          anchorId: 'teyvat_prologue_mondstadt_act1',
          turn: 7,
          evidence: ['玩家已让请仙典仪无法按原著结果重演'],
          affectedCharacters: ['钟离'],
          worldEffects: ['璃月主线转入玩家建立的新事实'],
          blockedAnchorIds: ['teyvat_chapter_liyue_act1'],
          status: 'active',
          returnability: 'none',
        }],
        notes: [],
      },
      世界: {
        ...createEmptyTeyvatGameState().世界,
        当前地点: '璃月港',
        开局设定: {
          来源: 'official',
          主线启用: true,
          地区ID: 'liyue',
          地区名称: '璃月',
          章节锚点ID: 'liyue_ritual_incident',
          章节锚点名称: '请仙典仪',
          防回退规则: [],
        },
      },
      叙事: {
        plotNodes: [],
        variableBatches: [],
        storyWeaving: {
          activeSeriesId: 'story_canon_teyvat_mondstadt_prologue_act1',
          series: [
            {
              id: 'story_canon_teyvat_mondstadt_prologue_act1', title: '蒙德序章', workTitle: '原神', sourceType: 'canon',
              chapters: [], segments: [{ id: 'mondstadt-1', group: 1, title: '捕风的异乡人', processingStatus: 'completed', runtimeStatus: 'current' }],
              active: true, currentSegmentGroup: 1, createdAt: 1, updatedAt: 1,
            },
            {
              id: 'story_canon_teyvat_liyue_chapter1', title: '璃月其一', workTitle: '原神', sourceType: 'canon',
              chapters: [], segments: [{ id: 'liyue-1', group: 1, title: '请仙典仪', processingStatus: 'completed', runtimeStatus: 'not_started' }],
              active: true, currentSegmentGroup: 1, createdAt: 1, updatedAt: 1,
            },
          ],
        },
      },
    };
    const before = structuredClone(raw);
    const replacements: ReturnType<typeof createEmptyTeyvatGameState>[] = [];

    await execute?.(raw, {
      classify: () => ({ kind: 'teyvat', state: raw }),
      replaceGameState: (next) => { replacements.push(next); },
    });

    expect(replacements).toHaveLength(1);
    const committed = replacements[0].叙事.storyWeaving;
    const blockedSeries = committed?.series.find((candidate) => candidate.id === 'story_canon_teyvat_liyue_chapter1');
    expect(committed?.activeSeriesId).not.toBe('story_canon_teyvat_liyue_chapter1');
    expect(blockedSeries?.active).toBe(false);
    expect(blockedSeries?.segments.some((segment) => segment.runtimeStatus === 'current')).toBe(false);
    expect(raw).toEqual(before);
  });
});
