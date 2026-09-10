export type 改写模式 = 'polish' | 'expand' | 'condense' | 'rephrase';

export interface 改写模式定义 {
  id: 改写模式;
  name: string;
  description: string;
}

export const 改写模式选项: 改写模式定义[] = [
  { id: 'polish', name: '润色', description: '优化措辞与节奏，保持篇幅接近原文。' },
  { id: 'expand', name: '扩写', description: '补充细节与氛围，篇幅适当增加。' },
  { id: 'condense', name: '缩写', description: '压缩冗余，保留关键情节与信息。' },
  { id: 'rephrase', name: '换一种说法', description: '用不同表达重述同一事件。' },
];

export function buildRewritePrompt(body: string, mode: 改写模式): string {
  const modeDef = 改写模式选项.find((m) => m.id === mode) ?? 改写模式选项[0];
  return [
    '你正在协助玩家润色一段已生成的剧情正文。',
    '改写要求：',
    '1. 只输出改写后的正文本身，不要输出标题、解释或额外说明。',
    '2. 不改变任何既定事实、时间线、地点与人物关系；不得新增设定、记忆或剧情结果。',
    '3. 保持原叙事人称、风格与氛围基调。',
    '4. 当前模式：' + modeDef.name + '。' + modeDef.description,
    '5. 正文中如果有对话、内心独白或镜头描写，保留其结构与可读性。',
    '以下是要改写的正文：',
    '---',
    body,
    '---',
  ].join('\n');
}
