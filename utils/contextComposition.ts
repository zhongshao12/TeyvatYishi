import { estimateTextTokens } from '@/utils/tokenEstimate';

export interface 提示词构成段 {
  key: string;
  chars: number;
  tokens: number;
}

export interface 提示词构成 {
  sections: 提示词构成段[];
  totalChars: number;
  totalTokens: number;
}

const CATEGORIES: Array<{ key: string; keywords: string[] }> = [
  { key: "剧情任务", keywords: ["当前剧情任务", "任务清单", "任务更新"] },
  { key: "信使通讯", keywords: ["信使通讯", "主动来信", "已压缩摘要"] },
  { key: "蒸汽鸟报", keywords: ["蒸汽鸟报", "近期报道", "报道"] },
  { key: "背包", keywords: ["背包"] },
  { key: "记忆", keywords: ["长期记忆", "短期记忆", "即时记忆", "记忆"] },
  { key: "图鉴", keywords: ["图鉴"] },
  { key: "世界书", keywords: ["世界书"] },
  { key: "NPC 档案", keywords: ["伙伴档案", "NPC", "同行记忆"] },
];

function classifyBlock(block: string): string {
  for (const category of CATEGORIES) {
    if (category.keywords.some((keyword) => block.includes(keyword))) return category.key;
  }
  return "其他";
}

/** 按分隔块对最终 system prompt 做构成统计（关键词分类，Token 用估算）。 */
export function 分析提示词构成(prompt: string): 提示词构成 {
  const blocks = (prompt || "").split(/\n---\n/).map((block) => block.trim()).filter(Boolean);
  const grouped = new Map<string, { chars: number; tokens: number }>();
  let totalChars = 0;
  let totalTokens = 0;
  for (const block of blocks) {
    const key = classifyBlock(block);
    const chars = block.length;
    const tokens = estimateTextTokens(block);
    const entry = grouped.get(key) ?? { chars: 0, tokens: 0 };
    entry.chars += chars;
    entry.tokens += tokens;
    grouped.set(key, entry);
    totalChars += chars;
    totalTokens += tokens;
  }
  return {
    sections: Array.from(grouped.entries())
      .map(([key, value]) => ({ key, chars: value.chars, tokens: value.tokens }))
      .sort((a, b) => b.chars - a.chars),
    totalChars,
    totalTokens,
  };
}
