import type { API配置项 } from '@/models/settings';
import type { Talent, TalentCategory } from '@/models/teyvat/character';
import type { ElementId } from '@/models/teyvat/elements';
import { chatCompletionNonStream } from './chatCompletionClient';

export interface 天赋生成上下文 {
  category: TalentCategory;
  element?: ElementId | '';
  characterSummary?: string;
  existingTalentNames?: string[];
  currentDraft?: Partial<Talent>;
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('天赋生成结果不是有效 JSON。');
  return JSON.parse(stripped.slice(start, end + 1));
}

export async function generateTalentDraft(
  config: API配置项,
  context: 天赋生成上下文,
): Promise<Talent> {
  const prompt = [
    '你是《原神》文字冒险的旅行者天赋设计助手。',
    '只输出一个 JSON 对象，字段严格为 名称、类别、等级、说明、关联元素。',
    '不要输出数值伤害、冷却、槽位或与提瓦特无关的力量体系。',
    `类别：${context.category}`,
    `关联元素：${context.element || '无特定元素'}`,
    `角色摘要：${context.characterSummary || '未提供'}`,
    `已有天赋名：${context.existingTalentNames?.join('、') || '暂无'}`,
    context.currentDraft ? `当前草稿：${JSON.stringify(context.currentDraft)}` : '',
  ].filter(Boolean).join('\n');
  const result = await chatCompletionNonStream(config, {
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: '',
    maxTokens: Math.min(config.maxTokens || 1000, 1000),
    temperature: 0.7,
  });
  const raw = extractJson(result);
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const category: TalentCategory = ['normal_attack', 'elemental_skill', 'elemental_burst', 'passive']
    .includes(String(value.类别))
    ? String(value.类别) as TalentCategory
    : context.category;
  return {
    id: `talent_${Date.now()}`,
    名称: cleanText(value.名称, '未命名天赋').slice(0, 24),
    类别: category,
    等级: Math.max(1, Math.min(15, Math.floor(Number(value.等级) || 1))),
    说明: cleanText(value.说明, '尚未补充天赋说明。').slice(0, 500),
    关联元素: context.element ?? '',
  };
}
