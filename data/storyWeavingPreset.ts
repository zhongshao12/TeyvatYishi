import type { 图鉴条目 } from '@/models/codex';
import type { 剧情编织分段, 剧情编织系列, 剧情编织系统 } from '@/models/storyWeaving';
import { 归一化剧情编织系统, 归一化剧情编织系列 } from '@/models/storyWeaving';
import { bundledCodexPresets, loadBundledCodexPreset } from '@/data/codexPreset';
import { validateBundledStorySeries } from '@/data/storyCanonValidation';
import type { 开局档案 } from '@/models/world';
const decomposedStoryWeavingPresets: BundledStoryWeavingPreset[] = [
  {
    id: 'story_canon_teyvat_mondstadt_prologue_act1',
    title: '蒙德-捕风的异乡人',
    description: '已分解内置剧情编织：蒙德序章主线。',
    codexPresetId: 'codex_teyvat_worldview_core',
  },
  {
    id: 'story_canon_teyvat_mondstadt_prologue_act2',
    title: '蒙德-为了没有眼泪的明天',
    description: '已分解内置剧情编织：蒙德序章第二幕。',
    codexPresetId: 'codex_teyvat_worldview_core',
  },
  {
    id: 'story_canon_teyvat_mondstadt_prologue_act3',
    title: '蒙德-巨龙与自由之歌',
    description: '已分解内置剧情编织：蒙德序章第三幕。',
    codexPresetId: 'codex_teyvat_worldview_core',
  },
  {
    id: 'story_canon_teyvat_liyue_chapter1',
    title: '璃月其一-请仙典仪',
    description: '已分解内置剧情编织：璃月主线前段。',
    codexPresetId: 'codex_teyvat_location_core',
  },
  {
    id: 'story_canon_teyvat_liyue_interlude',
    title: '璃月其二-群玉阁之战',
    description: '已分解内置剧情编织：璃月主线后段。',
    codexPresetId: 'codex_teyvat_location_core',
  },
  {
    id: 'story_canon_teyvat_inazuma_chapter2',
    title: '稻妻其一-眼狩令',
    description: '已分解内置剧情编织：稻妻主线开端。',
    codexPresetId: 'codex_teyvat_location_core',
  },
  {
    id: 'story_canon_teyvat_inazuma_chapter2_storm',
    title: '稻妻其二-雷暴之眼',
    description: '已分解内置剧情编织：稻妻雷暴危机。',
    codexPresetId: 'codex_teyvat_location_core',
  },
  {
    id: 'story_canon_teyvat_inazuma_chapter2_aftermath',
    title: '稻妻其三-永恒之下',
    description: '已分解内置剧情编织：稻妻主线收束。',
    codexPresetId: 'codex_teyvat_location_core',
  },
  {
    id: 'story_canon_side_liyue_lantern',
    title: '【支线】璃月-海灯节灯影',
    description: '已分解内置剧情编织：璃月版本活动剧情。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_side_inazuma_sakura',
    title: '【支线】璃月-海灯节灯影',
    description: '已分解内置剧情编织：稻妻版本活动剧情。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_side_mondstadt_fourwinds',
    title: '【支线】蒙德-四风守护的冠冕',
    description: '已分解内置剧情编织：蒙德版本活动剧情。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_sumeru_chapter3',
    title: '须弥其一-虚空鼓动',
    description: '已分解内置剧情编织：须弥开端。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_sumeru_chapter3_dream',
    title: '须弥其二-梦境中的猫',
    description: '已分解内置剧情编织：须弥中段。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_sumeru_chapter3_worldtree',
    title: '须弥其三-世界树之下',
    description: '已分解内置剧情编织：须弥高潮段。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_sumeru_chapter3_farewell',
    title: '须弥其四-告别须弥',
    description: '已分解内置剧情编织：须弥收束段。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_sumeru_chapter3_depart',
    title: '须弥其五-从第八日启程',
    description: '已分解内置剧情编织：须弥后续启程。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_fontaine_chapter4',
    title: '枫丹-诸水之歌',
    description: '已分解内置剧情编织：枫丹主线（预言、审判与终局）。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_natlan_chapter5',
    title: '纳塔-炽烈的还魂之诗',
    description: '已分解内置剧情编织：纳塔主线（深渊战争与圣火重燃）。',
    codexPresetId: '',
  },
  {
    id: 'story_canon_teyvat_nodkrai_chapter6',
    title: '挪德卡莱-月之序章',
    description: '已分解内置剧情编织：挪德卡莱序章（月之传说与女巫集会）。',
    codexPresetId: '',
  },
];

const CANON_START_SERIES_ID = 'story_canon_teyvat_mondstadt_prologue_act1';

const OPENING_STORY_WEAVING_ANCHORS: Record<string, { seriesId: string; segmentGroup: number; note: string }> = {
  mondstadt_dragon_incident: {
    seriesId: 'story_canon_teyvat_mondstadt_prologue_act1',
    segmentGroup: 1,
    note: '蒙德序章开局，从龙灾前段注入。',
  },
  liyue_ritual_incident: {
    seriesId: 'story_canon_teyvat_liyue_chapter1',
    segmentGroup: 1,
    note: '璃月请仙典仪阶段开局，蒙德序章只作前置背景，直接从璃月港码头与玉京台注入。',
  },
  inazuma_vision_decree: {
    seriesId: 'story_canon_teyvat_inazuma_chapter2',
    segmentGroup: 1,
    note: '稻妻离岛阶段开局，蒙德与璃月主线只作前置背景。',
  },
  sumeru_dream_incident: {
    seriesId: 'story_canon_teyvat_sumeru_chapter3',
    segmentGroup: 1,
    note: '须弥梦境邀约阶段开局，此前主线只作前置背景，直接从须弥城入场与身份核验注入。',
  },
  fontaine_prophecy: {
    seriesId: 'story_canon_teyvat_sumeru_chapter3_depart',
    segmentGroup: 1,
    note: '枫丹预言传闻阶段开局，此前主线只作前置背景，直接从蒸汽鸟报的传闻与港口线索注入。',
  },
  natlan_war: {
    seriesId: 'story_canon_teyvat_sumeru_chapter3_depart',
    segmentGroup: 1,
    note: '纳塔深渊战火阶段开局，此前主线只作前置背景，直接从圣火与裂口压力注入。',
  },
};

export interface BundledStoryWeavingPreset {
  id: string;
  title: string;
  description: string;
  codexPresetId: string;
}

export const bundledStoryWeavingPresets: BundledStoryWeavingPreset[] = decomposedStoryWeavingPresets;

export function getOpeningStoryWeavingAnchor(chapterId?: string): { seriesId: string; segmentGroup: number; note: string } | undefined {
  const id = chapterId?.trim();
  return id ? OPENING_STORY_WEAVING_ANCHORS[id] : undefined;
}

export function alignStoryWeavingToOpeningArchive(system: 剧情编织系统, archive?: 开局档案): 剧情编织系统 {
  const normalized = 归一化剧情编织系统(system);
  if (!normalized.系列列表.length || !archive) return normalized;
  if (archive.主线启用 === false) {
    return 归一化剧情编织系统({
      系列列表: normalized.系列列表.map((series) => series.来源类型 === 'canon'
        ? { ...series, 激活注入: false, updatedAt: Date.now() }
        : series),
      当前系列ID: normalized.当前系列ID,
      当前进度: normalized.当前进度,
    });
  }

  const anchor = getOpeningStoryWeavingAnchor(archive.章节锚点ID);
  if (!anchor) return normalized;
  const targetSeries = normalized.系列列表.find((series) => series.id === anchor.seriesId || series.内置预设ID === anchor.seriesId);
  if (!targetSeries) return normalized;
  const targetSegment = targetSeries.分段列表.find((segment) => segment.组号 === anchor.segmentGroup)
    ?? targetSeries.分段列表.find((segment) => segment.运行状态 === '当前')
    ?? targetSeries.分段列表[0];
  if (!targetSegment) return normalized;

  const now = Date.now();
  const nextSeriesList = normalized.系列列表.map((series) => {
    if (series.id !== targetSeries.id) return series;
    return 归一化剧情编织系列({
      ...series,
      激活注入: true,
      当前分段组号: targetSegment.组号,
      当前阶段概括: archive.章节参考说明 || series.当前阶段概括,
      分段列表: series.分段列表.map((segment) => {
        if (segment.id === targetSegment.id) {
          return { ...segment, 运行状态: '当前' as const, updatedAt: now };
        }
        if (segment.组号 < targetSegment.组号 && segment.运行状态 !== '已偏离') {
          return { ...segment, 运行状态: '已跳过' as const, updatedAt: now };
        }
        return { ...segment, 运行状态: segment.运行状态 === '当前' ? '未开始' as const : segment.运行状态, updatedAt: now };
      }),
      updatedAt: now,
    });
  });

  return 归一化剧情编织系统({
    系列列表: nextSeriesList,
    当前系列ID: targetSeries.id,
    当前进度: {
      当前系列ID: targetSeries.id,
      当前分段ID: targetSegment.id,
      当前分段组号: targetSegment.组号,
      推进状态: '推进中',
      已完成摘要: [],
      当前待解问题: targetSegment.给后续参考.slice(0, 8),
      切换说明: [
        `开局章节锚点：${archive.地区名称} / ${archive.章节锚点名称}`,
        anchor.note,
      ],
      历史归档: [],
      最近门禁结果: 'soft',
      最近判定理由: [
        `新开局按章节锚点「${archive.章节锚点ID}」定位到内置剧情轨道「${targetSeries.标题}」第 ${targetSegment.组号} 段。`,
      ],
      最近一次推进判定回合: 0,
      推进证据: [archive.章节参考说明, archive.玩家介入原文].filter(Boolean).slice(0, 4),
      连续推进证据回合: 0,
      卡段回合数: 0,
      updatedAt: now,
    },
  });
}

export async function loadBundledStoryWeavingPreset(preset: BundledStoryWeavingPreset): Promise<剧情编织系列 | null> {
  const decomposed = await loadDecomposedCanonSeries(preset.id);
  if (decomposed) return decomposed;

  const codexPreset = bundledCodexPresets.find((item) => item.id === preset.codexPresetId);
  if (!codexPreset) return null;
  const system = await loadBundledCodexPreset(codexPreset);
  const storyEntries = system.条目
    .filter((entry) => entry.分类 === 'story')
    .sort(compareStoryEntries);
  if (!storyEntries.length) return null;
  return buildCanonSeriesFromCodexEntries(preset, storyEntries);
}

export async function loadAllBundledStoryWeavingPresets(): Promise<剧情编织系统> {
  const series: 剧情编织系列[] = [];
  for (const preset of bundledStoryWeavingPresets) {
    const loaded = await loadBundledStoryWeavingPreset(preset);
    if (loaded) series.push(loaded);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (series.length !== bundledStoryWeavingPresets.length) {
    throw new Error(`内置原著剧情资源不完整：${series.length}/${bundledStoryWeavingPresets.length}`);
  }
  return 归一化剧情编织系统({
    系列列表: series,
    当前系列ID: CANON_START_SERIES_ID,
  });
}

type PersistedStoryWeavingSystem = 剧情编织系统 & { persistenceVersion?: number };

export function mergeBundledStoryWeavingPresets(saved: 剧情编织系统 | null | undefined, bundled: 剧情编织系统): 剧情编织系统 {
  if (!saved?.系列列表?.length) return bundled;
  const persistenceVersion = Number((saved as PersistedStoryWeavingSystem).persistenceVersion) || 0;
  const normalizedSaved = 归一化剧情编织系统(saved);
  const savedById = new Map(normalizedSaved.系列列表.map((series) => [series.id, series]));
  const customSeries = normalizedSaved.系列列表.filter((series) => series.来源类型 !== 'canon' || !series.内置预设ID);
  const mergedCanon = bundled.系列列表.map((presetSeries) => {
    const savedSeries = savedById.get(presetSeries.id);
    if (!savedSeries) return presetSeries;
    const savedSegments = new Map(savedSeries.分段列表.map((segment) => [segment.id, segment]));
    const mergedSegments = presetSeries.分段列表.map((segment) => {
      const savedSegment = savedSegments.get(segment.id);
      if (!savedSegment) return segment;
      if (persistenceVersion === 2) {
        return {
          ...segment,
          启用注入: savedSegment.启用注入,
          处理状态: savedSegment.处理状态,
          运行状态: savedSegment.运行状态,
          updatedAt: savedSegment.updatedAt,
        };
      }
      return {
        ...segment,
        ...savedSegment,
        原文内容: segment.原文内容,
        字数: segment.字数,
      };
    });
    if (persistenceVersion === 2) {
      return 归一化剧情编织系列({
        ...presetSeries,
        激活注入: savedSeries.激活注入,
        当前分段组号: savedSeries.当前分段组号,
        当前阶段概括: savedSeries.当前阶段概括,
        分段列表: mergedSegments,
        createdAt: savedSeries.createdAt,
        updatedAt: Math.max(savedSeries.updatedAt, presetSeries.updatedAt),
      });
    }
    return 归一化剧情编织系列({
      ...presetSeries,
      ...savedSeries,
      来源图鉴条目ID: presetSeries.来源图鉴条目ID,
      来源文件名: presetSeries.来源文件名,
      原始文本: presetSeries.原始文本,
      章节列表: presetSeries.章节列表,
      分段列表: mergedSegments,
      updatedAt: Math.max(savedSeries.updatedAt, presetSeries.updatedAt),
    });
  });
  return 归一化剧情编织系统({
    系列列表: [...mergedCanon, ...customSeries],
    当前系列ID: normalizedSaved.当前系列ID || bundled.当前系列ID,
    当前进度: normalizedSaved.当前进度 ?? bundled.当前进度,
  });
}

export function buildPersistedStoryWeavingSystem(system: 剧情编织系统): 剧情编织系统 {
  const normalized = 归一化剧情编织系统(system);
  return {
    persistenceVersion: 3,
    系列列表: normalized.系列列表.map((series) => {
      if (series.来源类型 !== 'canon') return series;
      return {
        ...series,
        来源图鉴条目ID: [],
        原始文本: undefined,
        章节列表: [],
        分段列表: series.分段列表.map((segment) => {
          const { 原文内容: _originalContent, ...persistedSegment } = segment;
          return persistedSegment;
        }),
      } as unknown as 剧情编织系列;
    }),
    当前系列ID: normalized.当前系列ID,
    当前进度: normalized.当前进度,
  } as 剧情编织系统;
}

export function hydratePersistedStoryWeavingSystem(
  saved: 剧情编织系统 | null | undefined,
  bundled: 剧情编织系统,
): 剧情编织系统 {
  if (!saved?.系列列表?.length) return bundled;
  const canonBaseline = 归一化剧情编织系统({
    ...bundled,
    系列列表: bundled.系列列表.filter((series) => series.来源类型 === 'canon'),
  });
  return mergeBundledStoryWeavingPresets(saved, canonBaseline);
}

export function isSelfContainedStoryWeavingSystem(system: 剧情编织系统 | null | undefined): boolean {
  if (!system?.系列列表?.length) return false;
  const normalized = 归一化剧情编织系统(system);
  return normalized.系列列表.every((series) => series.来源类型 !== 'canon' || (
    series.章节列表.length > 0
    && series.分段列表.length > 0
    && series.分段列表.every((segment) => segment.原文内容.trim().length > 0)
  ));
}

function getCanonResourceUrl(presetId: string): string {
  const relativePath = `data/story-weaving-canon/${presetId}.json`;
  if (typeof document !== 'undefined') {
    const moduleScriptUrl = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (moduleScriptUrl) return new URL(`../${relativePath}`, moduleScriptUrl).toString();
    return new URL(`/${relativePath}`, document.location.origin).toString();
  }
  return `/${relativePath}`;
}

async function fetchDecomposedCanonSeries(presetId: string): Promise<剧情编织系列 | null> {
  let lastError: unknown;
  for (const cache of ['force-cache', 'reload'] as const) {
    try {
      const response = await fetch(getCanonResourceUrl(presetId), { cache });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as 剧情编织系列;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn(`[story-weaving] 内置原著资源加载失败：${presetId}`, lastError);
  return null;
}

async function loadDecomposedCanonSeries(presetId: string): Promise<剧情编织系列 | null> {
  const series = await fetchDecomposedCanonSeries(presetId);
  if (!series) return null;
  const rawIssues = validateBundledStorySeries(series);
  if (rawIssues.length) throw new Error(`内置剧情资源 ${presetId} 无效：${rawIssues.join('；')}`);
  const normalized = 归一化剧情编织系列({
    ...series,
    来源类型: 'canon',
    内置预设ID: presetId,
    激活注入: series.激活注入 !== false,
  });
  const normalizedIssues = validateBundledStorySeries(normalized);
  if (normalizedIssues.length) throw new Error(`内置剧情资源 ${presetId} 归一化后无效：${normalizedIssues.join('；')}`);
  return normalized;
}

function buildCanonSeriesFromCodexEntries(preset: BundledStoryWeavingPreset, entries: 图鉴条目[]): 剧情编织系列 {
  const now = 1779580800000;
  const openingFacts = buildCanonOpeningFacts(preset);
  const chapters = entries.map((entry, index) => {
    const content = entry.原文.trim() || entry.摘要.trim();
    return {
      id: `${preset.id}_chapter_${entry.章节序号 ?? index + 1}`,
      序号: entry.章节序号 ?? index + 1,
      标题: entry.标题,
      内容: content,
      字数: [...content].length,
    };
  });
  const segments: 剧情编织分段[] = entries.map((entry, index) => {
    const order = entry.章节序号 ?? index + 1;
    const raw = entry.原文.trim() || entry.摘要.trim();
    const fallbackEndStates = buildCanonFallbackEndStates(entry, index, entries);
    const fallbackEventResults = buildCanonFallbackEventResults(entry, fallbackEndStates);
    return {
      id: `${preset.id}_segment_${order}`,
      组号: order,
      标题: entry.标题,
      章节范围: `第${order}章`,
      章节标题: [entry.标题],
      是否开局组: index === 0,
      起始章序号: order,
      结束章序号: order,
      启用注入: true,
      原文内容: raw,
      字数: [...raw].length,
      原文摘要: entry.摘要,
      本段概括: entry.摘要,
      时间线起点: '',
      时间线终点: '',
      开局已成立事实: index === 0 ? openingFacts : [],
      前段延续事实: index > 0 ? [entries[index - 1]?.摘要 || '前一段剧情已经发生，当前段应承接其后果。'] : [],
      本段结束状态: fallbackEndStates,
      给后续参考: index < entries.length - 1 ? [entries[index + 1]?.摘要 || '后续剧情仍需按当前系列继续推进。'] : [],
      原著硬约束: [
        {
          内容: '这是内置原著剧情轨道，主剧情应承接其方向，但不能无视玩家已经造成的 IF 偏离。',
          信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false },
        },
      ],
      可提前铺垫: index < entries.length - 1 && entries[index + 1]?.摘要
        ? [
            {
              内容: entries[index + 1]?.摘要 ?? '',
              信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: true },
            },
          ]
        : [],
      登场角色: extractKnownNames(entry),
      涉及地点: extractKnownLocations(entry),
      涉及派系: extractKnownFactions(entry),
      角色档案: [],
      势力档案: [],
      地图地点档案: [],
      关键事件: [
        {
          事件名: entry.标题,
          事件说明: entry.摘要 || entry.标题,
          前置条件: [],
          触发条件: [],
          阻断条件: ['玩家已经历、跳过或偏离该段剧情时，不得重新作为当前剧情注入。'],
          事件结果: fallbackEventResults,
          对后续影响: index < entries.length - 1 && entries[index + 1]?.摘要 ? [entries[index + 1]?.摘要 ?? ''] : [],
          信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false },
        },
      ],
      时间线: [],
      角色推进: [],
      处理状态: '已完成',
      运行状态: index === 0 ? '当前' : '未开始',
      updatedAt: now,
    };
  });
  return 归一化剧情编织系列({
    id: preset.id,
    标题: preset.title,
    作品名: preset.title,
    来源类型: 'canon',
    来源图鉴条目ID: entries.map((entry) => entry.id),
    内置预设ID: preset.id,
    来源文件名: `${preset.codexPresetId}.json`,
    原始文本: entries.map((entry) => entry.原文).filter(Boolean).join('\n\n'),
    章节列表: chapters,
    分段列表: segments,
    每段章数: 1,
    激活注入: true,
    当前分段组号: 1,
    createdAt: now,
    updatedAt: now,
  });
}

function compareStoryEntries(a: 图鉴条目, b: 图鉴条目): number {
  const orderA = a.章节序号 ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.章节序号 ?? Number.MAX_SAFE_INTEGER;
  return orderA - orderB || a.标题.localeCompare(b.标题, 'zh-Hans-CN');
}

function buildCanonOpeningFacts(preset: BundledStoryWeavingPreset): string[] {
  if (preset.id.includes('teyvat_liyue')) {
    return ['璃月相关主线已成为当前剧情轨道；蒙德序章只作为前置背景，不作为当前开局现场。'];
  }
  if (preset.id.includes('teyvat_inazuma')) {
    return ['稻妻相关主线已成为当前剧情轨道；蒙德与璃月主线只作为前置背景，不作为当前开局现场。'];
  }
  if (preset.id.includes('teyvat_sumeru')) {
    return ['须弥相关主线已成为当前剧情轨道；此前主线只作为前置背景，不作为当前开局现场。'];
  }
  if (preset.id.includes('teyvat_mondstadt')) {
    return ['蒙德正遭遇龙灾，深渊教团正在按计划行动。'];
  }
  return ['当前内置剧情轨道已按所选系列启动；其他地区主线只作为前置背景，不作为当前开局现场。'];
}

function buildCanonFallbackEndStates(entry: 图鉴条目, index: number, entries: 图鉴条目[]): string[] {
  const title = entry.标题.trim() || `第${entry.章节序号 ?? index + 1}段`;
  const text = `${entry.标题}\n${entry.摘要}\n${entry.关键词.join(' ')}`;
  const states: string[] = [];

  const matched = [
    { pattern: /深渊魔物|boss|首领|敌人|丘丘人|深渊法师|战斗|击败|击退/u, state: `${title}的主要战斗或危机已被处理，敌对压力暂时解除` },
    { pattern: /抵达|蒙德|璃月|稻妻|须弥|启程|旅途/u, state: `${title}的抵达或启程节点已完成，剧情可进入下一国` },
    { pattern: /地脉异常|封印|植入|取出|容器/u, state: `${title}围绕地脉异常的核心操作已完成并产生后续承接事实` },
    { pattern: /会面|接见|谈判|对话|审问|交涉/u, state: `${title}的关键会面或对话已完成，双方立场与下一步目标已明确` },
    { pattern: /抵达|进入|前往|来到|登陆|停靠|空港|雪原|矿区|主控舱段|监控室/u, state: `${title}的地点转移已完成，主要角色已抵达本段目标区域` },
    { pattern: /机关|门|封印|阵基|能源|密钥|通道|栈桥|灯/u, state: `${title}的机关或通行障碍已被确认并处理到可进入下一阶段` },
    { pattern: /加入|离队|汇合|重聚|同行|引路|接渡/u, state: `${title}的队伍关系变化已成立，同行或离队状态已明确` },
    { pattern: /真相|线索|调查|发现|确认|获知|定位/u, state: `${title}的核心线索已被确认，下一步调查方向已明确` },
  ];

  for (const item of matched) {
    if (item.pattern.test(text)) states.push(item.state);
    if (states.length >= 3) break;
  }

  if (!states.length) states.push(`${title}的核心事件已在正文台前完成或被玩家明确越过`);
  states.push(`玩家已处理、跳过或偏离「${title}」时，本段只能作为历史参考，不得再次作为当前段复演`);
  if (index < entries.length - 1) {
    const nextTitle = entries[index + 1]?.标题?.trim();
    if (nextTitle) states.push(`剧情可以承接到后续分段「${nextTitle}」`);
  }
  return dedupeText(states, 4);
}

function buildCanonFallbackEventResults(entry: 图鉴条目, endStates: string[]): string[] {
  const title = entry.标题.trim() || '当前分段';
  return dedupeText([
    endStates[0] || `${title}的核心事件已完成`,
    `「${title}」的结果只作为防重复与后续承接参考，不代表强制复演原著段落`,
  ], 3);
}

function dedupeText(items: string[], maxCount: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxCount) break;
  }
  return result;
}

function extractKnownNames(entry: 图鉴条目): string[] {
  const text = `${entry.标题}\n${entry.摘要}\n${entry.关键词.join(' ')}`;
  return [
    '旅行者', '空', '荧', '安柏', '凯亚', '琴', '丽莎', '派蒙',
    '迪卢克', '温迪', '芭芭拉',
    '刻晴', '甘雨', '魈', '申鹤', '神里绫华', '宵宫', '珊瑚宫心海', '枫原万叶',
    '香菱', '北斗', '凝光', '钟离', '重云', '芭芭拉', '行秋', '胡桃', '白术', '云堇', '深渊法师',
    '那维莱特', '芙宁娜', '达达利亚', '八重神子', '玛拉妮', '雷电将军', '迪卢克', '可莉', '雷泽',
  ]
    .filter((name) => text.includes(name));
}

function extractKnownLocations(entry: 图鉴条目): string[] {
  const text = `${entry.标题}\n${entry.摘要}\n${entry.关键词.join(' ')}`;
  return [
    '蒙德', '旅途',
    '璃月', '璃月港', '码头区', '玉京台', '归离原', '层岩巨渊', '孤云阁',
    '稻妻', '离岛', '离岛码头', '稻妻城', '天守阁', '神里屋敷', '鸣神大社', '雷暴之眼',
    '须弥', '须弥城', '大巴扎', '梦境边缘', '雨林边缘', '教令院', '净善宫',
  ]
    .filter((name) => text.includes(name));
}

function extractKnownFactions(entry: 图鉴条目): string[] {
  const text = `${entry.标题}\n${entry.摘要}\n${entry.关键词.join(' ')}`;
  return [
    '深渊教团', '旅途', '深渊教团', '蒙德',
    '千岩军', '愚人众', '冒险家协会',
    '千岩军', '天守阁', '鸣神大社', '神里屋敷', '勘定奉行',
    '家族', '猎犬家系', '橡木家系', '巡海游侠',
  ]
    .filter((name) => text.includes(name));
}
