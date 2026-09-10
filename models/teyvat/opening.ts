import type { RegionId } from './world';
import type { ElementId } from './elements';
import type { Talent } from './character';

export type 难度ID = 'easy' | 'normal' | 'hard' | 'extreme';
export interface 难度定义 { id: 难度ID; name: string; attributePoints: number; description: string }
export type 剧情模式 = 'normal' | 'harem' | 'romance_alt' | 'deep_single';
export type 开局来源 = 'official_preset' | 'free' | 'workshop';
export type 自由开局地点来源 = 'existing' | 'custom';
export interface 剧情模式定义 { id: 剧情模式; name: string; description: string }

export type 组织标签ID = 'none' | 'akademiya' | 'adventurers_guild' | 'eremites';
export type 阵营ID = 组织标签ID;
export interface 阵营定义 {
  id: 阵营ID;
  name: string;
  shortName: string;
  description: string;
  openingHint: string;
}

export interface 能力预设 { id: string; name: string; description: string }
export interface 起始场景 {
  id: string;
  name: string;
  description: string;
  openingHighlights?: string[];
  officialPresetId?: string;
}
export interface 开局地区 { id: string; name: string; description: string; defaultLocationHint: string }
export interface 开局章节锚点 {
  id: string;
  regionId: string;
  name: string;
  summary: string;
  officialChapterName?: string;
  officialChapterPhase?: string;
  priorStoryState?: string;
  referenceDate?: string;
  referenceTime?: string;
  defaultLocationHint?: string;
  keyNpcs: string[];
  loreKeywords: string[];
  openingPressure: string[];
}
export interface 官方开局预设 {
  id: string;
  source: 'official_preset';
  regionId: string;
  regionName: string;
  chapterId: string;
  chapterName: string;
  title: string;
  summary: string;
  referenceDate?: string;
  referenceTime?: string;
  defaultLocationHint?: string;
  keyNpcs: string[];
  loreKeywords: string[];
  openingPressure: string[];
  recommendedEntryAngles: string[];
}
export interface 自由开局写作问题 { id: string; title: string; description: string; examples: string[] }
export interface 地区自由开局引导 {
  regionId: string;
  overview: string;
  identityHints: string[];
  entryAngles: string[];
  relationshipHints: string[];
  pacingHints: string[];
  cautionNotes: string[];
  sampleTexts: string[];
}
export interface 创意工坊开局模板字段 {
  id: string;
  label: string;
  placeholder: string;
  required?: boolean;
  multiline?: boolean;
}
export interface 创意工坊开局模板 {
  id: string;
  source: 'workshop';
  title: string;
  author?: string;
  version: string;
  regionId: string;
  chapterId: string;
  summary: string;
  defaultLocationHint?: string;
  keyNpcs: string[];
  loreKeywords: string[];
  openingPressure: string[];
  tags: string[];
  playerEntryTemplate: string;
  editableFields: 创意工坊开局模板字段[];
}
export interface 创意工坊开局模板包 {
  schema: 'teyvat-opening-workshop-pack';
  version: string;
  title: string;
  author?: string;
  description?: string;
  tags: string[];
  templates: 创意工坊开局模板[];
}
export interface 开局模板 {
  id: string;
  name: string;
  source: 'official' | 'player';
  description?: string;
  难度?: 难度ID | string;
  元素?: ElementId | string;
  阵营?: 阵营ID | string;
  起始场景?: string;
  开局文本?: string;
  tags: string[];
  旅人?: {
    姓名?: string;
    别名?: string;
    性别?: string;
    年龄?: number;
    生日?: string;
    外貌?: string;
    性格?: string;
    背景?: string;
  };
  天赋?: Talent[];
  createdAt?: number;
  updatedAt?: number;
}

export function 创建空开局模板(): 开局模板 {
  return { id: '', name: '', source: 'player', tags: [] };
}

export const OFFICIAL_OPENING_PRESET_IDS = [
  'official_mondstadt_dragon',
  'official_liyue_ritual',
  'official_inazuma_decree',
  'official_sumeru_dream',
  'official_fontaine_prophecy',
  'official_natlan_war',
] as const;

export type OfficialOpeningPresetId = typeof OFFICIAL_OPENING_PRESET_IDS[number];

export interface OfficialOpeningPreset {
  id: OfficialOpeningPresetId;
  title: string;
  regionId: RegionId;
  location: string;
  identitySeed: {
    身份: string;
  };
  summary: string;
}

export const OFFICIAL_OPENING_PRESETS: readonly OfficialOpeningPreset[] = [
  {
    id: 'official_mondstadt_dragon',
    title: '蒙德 · 风魔龙之影',
    regionId: 'mondstadt',
    location: '蒙德 · 低语森林',
    identitySeed: { 身份: '异乡旅人' },
    summary: '从低语森林的龙吼与骑士团戒备中开始一段开放的蒙德旅程。',
  },
  {
    id: 'official_liyue_ritual',
    title: '璃月 · 请仙典仪',
    regionId: 'liyue',
    location: '璃月港 · 玉京台',
    identitySeed: { 身份: '异乡旅人' },
    summary: '从请仙典仪的骚动与璃月港的契约暗流中切入。',
  },
  {
    id: 'official_inazuma_decree',
    title: '稻妻 · 眼狩令',
    regionId: 'inazuma',
    location: '稻妻 · 离岛码头',
    identitySeed: { 身份: '渡海旅人' },
    summary: '从离岛盘查与眼狩令阴影下开始，不预设玩家的立场。',
  },
  {
    id: 'official_sumeru_dream',
    title: '须弥 · 虚空与梦境',
    regionId: 'sumeru',
    location: '须弥城 · 宝商街',
    identitySeed: { 身份: '远道来客' },
    summary: '从虚空终端异常与一场陌生梦境中进入须弥。',
  },
  {
    id: 'official_fontaine_prophecy',
    title: '枫丹 · 预言之水',
    regionId: 'fontaine',
    location: '枫丹廷 · 欧庇克莱歌剧院',
    identitySeed: { 身份: '外地访客' },
    summary: '从审判旁听与预言传闻中进入枫丹，不预设案件结局。',
  },
  {
    id: 'official_natlan_war',
    title: '纳塔 · 深渊战火',
    regionId: 'natlan',
    location: '纳塔 · 圣火竞技场',
    identitySeed: { 身份: '部族来客' },
    summary: '从圣火仪式与深渊威胁的背景中进入纳塔，保留自由路线。',
  },
];

export function getOfficialOpeningPreset(id: string): OfficialOpeningPreset | undefined {
  return OFFICIAL_OPENING_PRESETS.find((preset) => preset.id === id);
}
