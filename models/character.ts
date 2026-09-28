import type { NPC角色锚点档案 } from './npc';
import type { Talent } from './teyvat/character';
import type { ElementalAttunement, ElementId } from './teyvat/elements';

export interface 六维属性 {
  力量: number;
  智慧: number;
  敏捷: number;
  体质: number;
  运气: number;
}

export const ATTRIBUTE_KEYS: (keyof 六维属性)[] = ['力量', '智慧', '敏捷', '体质', '运气'];

export const ATTRIBUTE_LABELS: Record<keyof 六维属性, string> = {
  力量: '力量',
  智慧: '智慧',
  敏捷: '敏捷',
  体质: '体质',
  运气: '运气',
};

export function 创建空属性(): 六维属性 {
  return { 力量: 0, 智慧: 0, 敏捷: 0, 体质: 0, 运气: 0 };
}

export interface 角色数据结构 {
  id: string;
  姓名: string;
  别名: string;
  性别: string;
  年龄: number;
  生日: string;
  身高: string;
  身份: string;
  外貌: string;
  性格: string;
  背景: string;
  专长知识: string[];
  头像: string;
  图像档案?: {
    头像?: string;
    正文头像?: string;
    手机头像?: string;
    立绘?: string;
    角色锚点?: NPC角色锚点档案;
  };
  属性: 六维属性;
  主元素: ElementId | '';
  元素共鸣: ElementalAttunement[];
  能力: string[];
  天赋: Talent[];
}

export function 创建空角色(): 角色数据结构 {
  return {
    id: '', 姓名: '', 别名: '', 性别: '', 年龄: 25, 生日: '', 身高: '', 身份: '',
    外貌: '', 性格: '', 背景: '', 专长知识: [], 头像: '', 图像档案: {}, 属性: 创建空属性(),
    主元素: '', 元素共鸣: [], 能力: [], 天赋: [],
  };
}

export function 确保元素共鸣(traveler: 角色数据结构): 角色数据结构 {
  return Array.isArray(traveler.元素共鸣) ? traveler : { ...traveler, 元素共鸣: [] };
}

/** 仅校验可手动编辑的旅人基本资料；等级、元素等派生字段不由此入口修改。 */
export function validateTravelerProfileDraft(draft: 角色数据结构): string | null {
  if (!draft.姓名.trim()) return '旅人姓名不能为空。';
  if (!Number.isInteger(draft.年龄) || draft.年龄 < 0) return '年龄须为非负整数。';
  if (typeof draft.身高 !== 'string') return '身高须为文本。';
  return null;
}
