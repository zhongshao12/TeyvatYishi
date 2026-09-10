import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const model = fs.readFileSync('models/teyvat/narrativeTurn.ts', 'utf8');
const parser = fs.readFileSync('services/ai/narrativeTurnParser.ts', 'utf8');
const turnItem = fs.readFileSync('components/features/Chat/TurnItem.tsx', 'utf8');
const inputArea = fs.readFileSync('components/features/Chat/InputArea.tsx', 'utf8');
const pkg = fs.readFileSync('package.json', 'utf8');

assert(model.includes('export interface PlayerChoice'), '正式回合必须定义 PlayerChoice。');
assert(model.includes('id: string;') && model.includes('label: string;'), 'PlayerChoice 必须包含稳定 id 与可见 label。');
assert(parser.includes('ids.has(id)'), '正式解析器必须按 id 确定性去重。');
assert(turnItem.includes('parsed.choices.map'), 'TurnItem 必须从正式 choices 渲染可见选项。');
assert(!turnItem.includes('parsed.actionOptions'), 'TurnItem 不得依赖旧 actionOptions 别名。');
assert(!inputArea.includes('parseActionOptionsBlock'), '输入区不得再解析旧标签块。');
assert(inputArea.includes('Array.from(new Set(source.map'), '输入区只能对正式 choice labels 做无损去重。');
assert(inputArea.includes('appendActionOptionToInput'), '点击行动选项应追加到当前输入，避免覆盖玩家已输入内容。');
assert(pkg.includes('"test:action-options"'), 'package.json 必须提供行动选项清洗回归脚本。');

console.log('structured action choices regression ok');
