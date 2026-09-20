export type RegionId = 'mondstadt' | 'liyue' | 'inazuma' | 'sumeru' | 'fontaine' | 'natlan' | 'nod_krai';

const REGION_IDS: readonly RegionId[] = ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'nod_krai'];

export interface RuntimePeriod {
  id: string;
  名称: string;
  年代: string;
  描述: string;
  氛围: string;
  关键事件: string[];
  科技水平: string;
  社会规范: string;
  派系: Array<{ id: string; 名称: string; 描述: string; 影响力: number }>;
  人物: RuntimeActor[];
}

export interface OpeningSetup {
  来源?: string;
  主线启用?: boolean;
  地区ID?: string;
  地区名称?: string;
  章节锚点ID?: string;
  章节锚点名称?: string;
  章节参考说明?: string;
  参考性质?: string;
  官方预设ID?: string;
  创意工坊模板ID?: string;
  玩家介入原文?: string;
  防回退规则: string[];
}

export interface RuntimeActor { id: string; 姓名: string; 角色: string; 性格: string; 外貌: string; 与玩家关系: string; 记忆: string[] }

export interface TeyvatWorld {
  当前地区: RegionId | '';
  当前地点: string;
  当前日期: string;
  当前时间: string;
  当前天气: string;
  已访问地区: RegionId[];
  世界事件: string[];
  氛围: string;
  当前时段: RuntimePeriod | null;
  已访问时段: string[];
  纪年名称: string;
  旅程天数: number;
  活跃人物: RuntimeActor[];
  难度: string;
  叙事模式: string;
  开局设定: OpeningSetup | null;
  起始场景ID: string;
  自定义开局: string;
  原著旅行者: '荧' | '空' | '空荧双主角' | '无主角' | '';
  元素回响邀请: string;
  进行中元素回响: string;
  /** Task-3 compatibility accessors. They are non-enumerable and never persisted. */
  readonly currentRegion: RegionId | '';
  readonly currentLocation: string;
  readonly currentDate: string;
  readonly currentTime: string;
  readonly weather: string;
  readonly visitedRegions: RegionId[];
  readonly worldEvents: string[];
  readonly atmosphere: string;
}

type PersistedTeyvatWorld = Omit<TeyvatWorld,
  'currentRegion' | 'currentLocation' | 'currentDate' | 'currentTime' |
  'weather' | 'visitedRegions' | 'worldEvents' | 'atmosphere'>;

function withCompatibilityAccessors(world: PersistedTeyvatWorld): TeyvatWorld {
  return Object.defineProperties(world, {
    currentRegion: { enumerable: false, get: () => world.当前地区 },
    currentLocation: { enumerable: false, get: () => world.当前地点 },
    currentDate: { enumerable: false, get: () => world.当前日期 },
    currentTime: { enumerable: false, get: () => world.当前时间 },
    weather: { enumerable: false, get: () => world.当前天气 },
    visitedRegions: { enumerable: false, get: () => world.已访问地区 },
    worldEvents: { enumerable: false, get: () => world.世界事件 },
    atmosphere: { enumerable: false, get: () => world.氛围 },
  }) as TeyvatWorld;
}

export function createEmptyTeyvatWorld(): TeyvatWorld {
  return withCompatibilityAccessors({
    当前地区: '', 当前地点: '', 当前日期: '', 当前时间: '', 当前天气: '',
    已访问地区: [], 世界事件: [], 氛围: '', 当前时段: null, 已访问时段: [],
    纪年名称: '', 旅程天数: 1, 活跃人物: [], 难度: '', 叙事模式: '', 开局设定: null,
    起始场景ID: '', 自定义开局: '', 原著旅行者: '', 元素回响邀请: '', 进行中元素回响: '',
  });
}

const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];

const regionList = (value: unknown): RegionId[] => stringList(value)
  .filter((entry): entry is RegionId => REGION_IDS.includes(entry as RegionId));

export function normalizeTeyvatWorld(input: unknown): TeyvatWorld {
  const raw = isRecord(input) ? input : {};
  const base = createEmptyTeyvatWorld();
  const region = String(raw.当前地区 ?? raw.currentRegion ?? '');
  return withCompatibilityAccessors({
    ...base,
    当前地区: REGION_IDS.includes(region as RegionId) ? region as RegionId : '',
    当前地点: String(raw.当前地点 ?? raw.currentLocation ?? ''),
    当前日期: String(raw.当前日期 ?? raw.currentDate ?? ''),
    当前时间: String(raw.当前时间 ?? raw.currentTime ?? ''),
    当前天气: String(raw.当前天气 ?? raw.weather ?? ''),
    已访问地区: regionList(raw.已访问地区 ?? raw.visitedRegions),
    世界事件: stringList(raw.世界事件 ?? raw.worldEvents),
    氛围: String(raw.氛围 ?? raw.atmosphere ?? ''),
    当前时段: isRecord(raw.当前时段) ? {
      id: String(raw.当前时段.id ?? ''), 名称: String(raw.当前时段.名称 ?? ''), 年代: String(raw.当前时段.年代 ?? ''),
      描述: String(raw.当前时段.描述 ?? ''), 氛围: String(raw.当前时段.氛围 ?? ''),
      关键事件: Array.isArray(raw.当前时段.关键事件) ? raw.当前时段.关键事件.map(String) : [],
      科技水平: String(raw.当前时段.科技水平 ?? ''), 社会规范: String(raw.当前时段.社会规范 ?? ''),
      派系: Array.isArray(raw.当前时段.派系) ? raw.当前时段.派系.flatMap((entry) => isRecord(entry) ? [{ id: String(entry.id ?? ''), 名称: String(entry.名称 ?? ''), 描述: String(entry.描述 ?? ''), 影响力: Number(entry.影响力) || 0 }] : []) : [],
      人物: Array.isArray(raw.当前时段.人物) ? raw.当前时段.人物.flatMap(normalizeRuntimeActor) : [],
    } : null,
    已访问时段: stringList(raw.已访问时段),
    纪年名称: String(raw.纪年名称 ?? ''),
    旅程天数: Math.max(1, Math.trunc(Number(raw.旅程天数) || 1)),
    活跃人物: Array.isArray(raw.活跃人物) ? raw.活跃人物.flatMap(normalizeRuntimeActor) : [],
    难度: String(raw.难度 ?? ''),
    叙事模式: String(raw.叙事模式 ?? ''),
    开局设定: isRecord(raw.开局设定) ? {
      ...(typeof raw.开局设定.来源 === 'string' ? { 来源: raw.开局设定.来源 } : {}),
      ...(typeof raw.开局设定.主线启用 === 'boolean' ? { 主线启用: raw.开局设定.主线启用 } : {}),
      ...(typeof raw.开局设定.地区ID === 'string' ? { 地区ID: raw.开局设定.地区ID } : {}),
      ...(typeof raw.开局设定.地区名称 === 'string' ? { 地区名称: raw.开局设定.地区名称 } : {}),
      ...(typeof raw.开局设定.章节锚点ID === 'string' ? { 章节锚点ID: raw.开局设定.章节锚点ID } : {}),
      ...(typeof raw.开局设定.章节锚点名称 === 'string' ? { 章节锚点名称: raw.开局设定.章节锚点名称 } : {}),
      ...(typeof raw.开局设定.章节参考说明 === 'string' ? { 章节参考说明: raw.开局设定.章节参考说明 } : {}),
      ...(typeof raw.开局设定.参考性质 === 'string' ? { 参考性质: raw.开局设定.参考性质 } : {}),
      ...(typeof raw.开局设定.官方预设ID === 'string' ? { 官方预设ID: raw.开局设定.官方预设ID } : {}),
      ...(typeof raw.开局设定.创意工坊模板ID === 'string' ? { 创意工坊模板ID: raw.开局设定.创意工坊模板ID } : {}),
      ...(typeof raw.开局设定.玩家介入原文 === 'string' ? { 玩家介入原文: raw.开局设定.玩家介入原文 } : {}),
      防回退规则: Array.isArray(raw.开局设定.防回退规则) ? raw.开局设定.防回退规则.map(String) : [],
    } : null,
    起始场景ID: String(raw.起始场景ID ?? ''),
    自定义开局: String(raw.自定义开局 ?? ''),
    原著旅行者: ['荧', '空', '空荧双主角', '无主角'].includes(String(raw.原著旅行者)) ? raw.原著旅行者 as TeyvatWorld['原著旅行者'] : '',
    元素回响邀请: String(raw.元素回响邀请 ?? ''),
    进行中元素回响: String(raw.进行中元素回响 ?? ''),
  });
}

function normalizeRuntimeActor(value: unknown): RuntimeActor[] {
  if (!isRecord(value)) return [];
  return [{ id: String(value.id ?? ''), 姓名: String(value.姓名 ?? ''), 角色: String(value.角色 ?? ''), 性格: String(value.性格 ?? ''), 外貌: String(value.外貌 ?? ''), 与玩家关系: String(value.与玩家关系 ?? ''), 记忆: Array.isArray(value.记忆) ? value.记忆.map(String) : [] }];
}
import { isRecord } from '@/utils/valueGuards';
