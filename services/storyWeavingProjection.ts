import type { TeyvatGameState } from '@/models/teyvat';
import { normalizeNarrativeRuntime } from '@/models/teyvat/runtimeSlices';
import { 创建空剧情编织系统, 归一化剧情编织系统, type 剧情编织系统 } from '@/models/storyWeaving';
export function fromLegacyStoryWeaving(story: 剧情编织系统): NonNullable<TeyvatGameState['叙事']['storyWeaving']> {
  const statusMap = { 待处理: 'pending', 处理中: 'processing', 已完成: 'completed', 失败: 'failed' } as const;
  const runtimeMap = { 未开始: 'not_started', 当前: 'current', 已经历: 'experienced', 已跳过: 'skipped', 已偏离: 'diverged', 暂停: 'paused' } as const;
  const normalized = normalizeNarrativeRuntime({ storyWeaving: {
    builtinBindings: story.builtinBindings, migrationWarnings: story.migrationWarnings,
    series: story.系列列表.map((series) => ({
      id: series.id, title: series.标题, workTitle: series.作品名, sourceType: series.来源类型,
      sourceCodexEntryIds: [...series.来源图鉴条目ID], builtinPresetId: series.内置预设ID,
      sourceFileName: series.来源文件名, sourceText: series.原始文本,
      chapters: series.章节列表.map((chapter) => ({ id: chapter.id, index: chapter.序号, title: chapter.标题, content: chapter.内容, characterCount: chapter.字数 })),
      segments: series.分段列表.map((segment) => ({
        id: segment.id, group: segment.组号, title: segment.标题, chapterRange: segment.章节范围, chapterTitles: [...segment.章节标题], opening: segment.是否开局组,
        startChapter: segment.起始章序号, endChapter: segment.结束章序号, injectionEnabled: segment.启用注入, sourceText: segment.原文内容, characterCount: segment.字数,
        sourceSummary: segment.原文摘要, stageSummary: segment.本段概括, timelineStart: segment.时间线起点, timelineEnd: segment.时间线终点,
        establishedFacts: [...segment.开局已成立事实], continuedFacts: [...segment.前段延续事实], endState: [...segment.本段结束状态], futureReferences: [...segment.给后续参考], characters: [...segment.登场角色], locations: [...segment.涉及地点], factions: [...segment.涉及派系],
        canonConstraints: segment.原著硬约束.map((entry) => ({ content: entry.内容, visibility: { knownBy: [...entry.信息可见性.谁知道], unknownBy: [...entry.信息可见性.谁不知道], readerOnly: entry.信息可见性.是否仅读者视角可见 } })),
        foreshadowing: segment.可提前铺垫.map((entry) => ({ content: entry.内容, visibility: { knownBy: [...entry.信息可见性.谁知道], unknownBy: [...entry.信息可见性.谁不知道], readerOnly: entry.信息可见性.是否仅读者视角可见 } })),
        characterProfiles: segment.角色档案.map((profile) => ({ name: profile.名称, identity: profile.身份, faction: profile.所属势力, initialPosition: profile.初始立场, relationshipSummary: [...profile.关系摘要], stateSummary: [...profile.状态摘要], firstAppearance: profile.首次出现, importance: profile.重要性 === '核心' ? 'core' : profile.重要性 === '重要' ? 'important' : 'ordinary' })),
        factionProfiles: segment.势力档案.map((profile) => ({ name: profile.名称, type: profile.类型, territory: profile.地盘, representatives: [...profile.代表人物], goals: profile.立场目标, currentState: profile.当前状态, relationshipSummary: [...profile.关系摘要], firstAppearance: profile.首次出现 })),
        locationProfiles: segment.地图地点档案.map((profile) => ({ name: profile.名称, level: ({ 寰宇: 'universe', 大地点: 'major', 中地点: 'medium', 小地点: 'minor', 区地点: 'district', 子地点: 'sub_location', 未知: 'unknown' } as const)[profile.层级], parentLocation: profile.上级地点, faction: profile.所属势力, function: profile.地貌功能, facilities: [...profile.关键设施], firstAppearance: profile.首次出现 })),
        keyEvents: segment.关键事件.map((event) => ({ name: event.事件名, description: event.事件说明, prerequisites: [...event.前置条件], triggers: [...event.触发条件], blockers: [...event.阻断条件], results: [...event.事件结果], laterEffects: [...event.对后续影响], visibility: { knownBy: [...event.信息可见性.谁知道], unknownBy: [...event.信息可见性.谁不知道], readerOnly: event.信息可见性.是否仅读者视角可见 } })),
        timeline: segment.时间线.map((event) => ({ title: event.标题, timeAnchor: event.时间锚点, description: event.描述, characters: [...event.涉及角色] })),
        characterProgress: segment.角色推进.map((progress) => ({ characterName: progress.角色名, beforeState: [...progress.本段前状态], changes: [...progress.本段变化], afterState: [...progress.本段后状态], laterEffects: [...progress.对后续影响] })),
        processingStatus: statusMap[segment.处理状态], runtimeStatus: runtimeMap[segment.运行状态], lastError: segment.最近错误, updatedAt: segment.updatedAt,
        sceneNodes: segment.场景节点,
      })),
      chaptersPerSegment: series.每段章数, active: series.激活注入, currentSegmentGroup: series.当前分段组号,
      currentStageSummary: series.当前阶段概括, coreCharacterSummary: [...series.核心角色摘要], coreCharacters: [...series.核心角色],
      locationIndex: [...series.涉及地点索引], factionIndex: [...series.涉及派系索引], createdAt: series.createdAt, updatedAt: series.updatedAt,
    })), activeSeriesId: story.当前系列ID,
    progress: story.当前进度 ? {
      seriesId: story.当前进度.当前系列ID, segmentId: story.当前进度.当前分段ID, segmentGroup: story.当前进度.当前分段组号,
      sceneId: story.当前进度.当前场景ID, completedSceneIds: story.当前进度.已完成场景ID, lastSceneTurn: story.当前进度.最近场景推进回合,
      status: ({ 未开始: 'not_started', 推进中: 'progressing', 已完成: 'completed', 已偏离: 'diverged', 暂停: 'paused' } as const)[story.当前进度.推进状态],
      completedSummaries: [...story.当前进度.已完成摘要], openQuestions: [...story.当前进度.当前待解问题], switchNotes: [...story.当前进度.切换说明],
      archive: story.当前进度.历史归档.map((entry) => ({ id: entry.id, seriesId: entry.系列ID, segmentId: entry.分段ID, segmentGroup: entry.分段组号, segmentTitle: entry.分段标题, archivedAtTurn: entry.归档回合, status: ({ 已经历: 'experienced', 已跳过: 'skipped', 已偏离: 'diverged', 已完成: 'completed' } as const)[entry.归档状态], summary: entry.摘要, characterProgress: [...(entry.角色推进摘要 ?? [])], switchNotes: entry.切换说明, reasons: [...entry.判定理由], createdAt: entry.createdAt })),
      gate: story.当前进度.最近门禁结果, reasons: [...story.当前进度.最近判定理由], lastDecisionTurn: story.当前进度.最近一次推进判定回合,
      evidence: [...(story.当前进度.推进证据 ?? [])], consecutiveEvidenceTurns: story.当前进度.连续推进证据回合 ?? 0, stalledTurns: story.当前进度.卡段回合数 ?? 0, updatedAt: story.当前进度.updatedAt,
    } : undefined,
  } });
  return normalized.storyWeaving ?? { series: [] };
}

export function toLegacyStoryWeaving(story: TeyvatGameState['叙事']['storyWeaving']): 剧情编织系统 {
  if (!story) return 创建空剧情编织系统();
  const statusMap = { pending: '待处理', processing: '处理中', completed: '已完成', failed: '失败' } as const;
  const runtimeMap = { not_started: '未开始', current: '当前', experienced: '已经历', skipped: '已跳过', diverged: '已偏离', paused: '暂停' } as const;
  return 归一化剧情编织系统({
    builtinBindings: story.builtinBindings, migrationWarnings: story.migrationWarnings,
    系列列表: story.series.map((series) => ({
      id: series.id, 标题: series.title, 作品名: series.workTitle, 来源类型: series.sourceType,
      来源图鉴条目ID: [...series.sourceCodexEntryIds], 内置预设ID: series.builtinPresetId, 来源文件名: series.sourceFileName, 原始文本: series.sourceText,
      章节列表: series.chapters.map((chapter) => ({ id: chapter.id, 序号: chapter.index, 标题: chapter.title, 内容: chapter.content, 字数: chapter.characterCount })),
      分段列表: series.segments.map((segment) => ({
        id: segment.id, 组号: segment.group, 标题: segment.title, 章节范围: segment.chapterRange, 章节标题: [...segment.chapterTitles], 是否开局组: segment.opening,
        起始章序号: segment.startChapter, 结束章序号: segment.endChapter, 启用注入: segment.injectionEnabled, 原文内容: segment.sourceText, 字数: segment.characterCount,
        原文摘要: segment.sourceSummary, 本段概括: segment.stageSummary, 时间线起点: segment.timelineStart, 时间线终点: segment.timelineEnd,
        开局已成立事实: [...segment.establishedFacts], 前段延续事实: [...segment.continuedFacts], 本段结束状态: [...segment.endState], 给后续参考: [...segment.futureReferences],
        原著硬约束: segment.canonConstraints.map((entry) => ({ 内容: entry.content, 信息可见性: { 谁知道: [...entry.visibility.knownBy], 谁不知道: [...entry.visibility.unknownBy], 是否仅读者视角可见: entry.visibility.readerOnly } })),
        可提前铺垫: segment.foreshadowing.map((entry) => ({ 内容: entry.content, 信息可见性: { 谁知道: [...entry.visibility.knownBy], 谁不知道: [...entry.visibility.unknownBy], 是否仅读者视角可见: entry.visibility.readerOnly } })),
        登场角色: [...segment.characters], 涉及地点: [...segment.locations], 涉及派系: [...segment.factions],
        角色档案: segment.characterProfiles.map((profile) => ({ 名称: profile.name, 身份: profile.identity, 所属势力: profile.faction, 初始立场: profile.initialPosition, 关系摘要: [...profile.relationshipSummary], 状态摘要: [...profile.stateSummary], 首次出现: profile.firstAppearance, 重要性: ({ ordinary: '一般', important: '重要', core: '核心' } as const)[profile.importance] })),
        势力档案: segment.factionProfiles.map((profile) => ({ 名称: profile.name, 类型: profile.type, 地盘: profile.territory, 代表人物: [...profile.representatives], 立场目标: profile.goals, 当前状态: profile.currentState, 关系摘要: [...profile.relationshipSummary], 首次出现: profile.firstAppearance })),
        地图地点档案: segment.locationProfiles.map((profile) => ({ 名称: profile.name, 层级: ({ universe: '寰宇', major: '大地点', medium: '中地点', minor: '小地点', district: '区地点', sub_location: '子地点', unknown: '未知' } as const)[profile.level], 上级地点: profile.parentLocation, 所属势力: profile.faction, 地貌功能: profile.function, 关键设施: [...profile.facilities], 首次出现: profile.firstAppearance })),
        关键事件: segment.keyEvents.map((event) => ({ 事件名: event.name, 事件说明: event.description, 前置条件: [...event.prerequisites], 触发条件: [...event.triggers], 阻断条件: [...event.blockers], 事件结果: [...event.results], 对后续影响: [...event.laterEffects], 信息可见性: { 谁知道: [...event.visibility.knownBy], 谁不知道: [...event.visibility.unknownBy], 是否仅读者视角可见: event.visibility.readerOnly } })),
        时间线: segment.timeline.map((event) => ({ 标题: event.title, 时间锚点: event.timeAnchor, 描述: event.description, 涉及角色: [...event.characters] })),
        角色推进: segment.characterProgress.map((progress) => ({ 角色名: progress.characterName, 本段前状态: [...progress.beforeState], 本段变化: [...progress.changes], 本段后状态: [...progress.afterState], 对后续影响: [...progress.laterEffects] })),
        处理状态: statusMap[segment.processingStatus], 运行状态: runtimeMap[segment.runtimeStatus], 最近错误: segment.lastError, updatedAt: segment.updatedAt,
        场景节点: segment.sceneNodes,
      })),
      每段章数: series.chaptersPerSegment, 激活注入: series.active, 当前分段组号: series.currentSegmentGroup,
      当前阶段概括: series.currentStageSummary, 核心角色摘要: [...series.coreCharacterSummary], 核心角色: [...series.coreCharacters],
      涉及地点索引: [...series.locationIndex], 涉及派系索引: [...series.factionIndex], createdAt: series.createdAt, updatedAt: series.updatedAt,
    })), 当前系列ID: story.activeSeriesId,
    当前进度: story.progress ? {
      当前系列ID: story.progress.seriesId, 当前分段ID: story.progress.segmentId, 当前分段组号: story.progress.segmentGroup,
      当前场景ID: story.progress.sceneId, 已完成场景ID: story.progress.completedSceneIds, 最近场景推进回合: story.progress.lastSceneTurn,
      推进状态: ({ not_started: '未开始', progressing: '推进中', completed: '已完成', diverged: '已偏离', paused: '暂停' } as const)[story.progress.status],
      已完成摘要: [...story.progress.completedSummaries], 当前待解问题: [...story.progress.openQuestions], 切换说明: [...story.progress.switchNotes],
      历史归档: story.progress.archive.map((entry) => ({ id: entry.id, 系列ID: entry.seriesId, 分段ID: entry.segmentId, 分段组号: entry.segmentGroup, 分段标题: entry.segmentTitle, 归档回合: entry.archivedAtTurn, 归档状态: ({ experienced: '已经历', skipped: '已跳过', diverged: '已偏离', completed: '已完成' } as const)[entry.status], 摘要: entry.summary, 角色推进摘要: [...entry.characterProgress], 切换说明: entry.switchNotes, 判定理由: [...entry.reasons], createdAt: entry.createdAt })),
      最近门禁结果: story.progress.gate, 最近判定理由: [...story.progress.reasons], 最近一次推进判定回合: story.progress.lastDecisionTurn,
      推进证据: [...story.progress.evidence], 连续推进证据回合: story.progress.consecutiveEvidenceTurns, 卡段回合数: story.progress.stalledTurns, updatedAt: story.progress.updatedAt,
    } : undefined,
  });
}
