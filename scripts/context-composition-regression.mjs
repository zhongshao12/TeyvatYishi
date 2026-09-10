import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const composition = fs.readFileSync('utils/contextComposition.ts', 'utf8');
const builder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const viewer = fs.readFileSync('components/features/Settings/ContextViewer.tsx', 'utf8');
assert(composition.includes('分析提示词构成'), 'composition util must exist.');
assert(composition.includes('totalChars') && composition.includes('totalTokens'), 'composition util must count chars and tokens.');
assert(builder.includes('sections?: 提示词构成'), 'BuiltSystemPrompt must carry sections.');
assert(builder.includes('分析提示词构成(parts.join'), 'builders must compute sections from joined parts.');
assert(viewer.includes('上下文构成'), 'ContextViewer must render a composition section.');
assert(viewer.includes('composition.sections'), 'ContextViewer must iterate composition sections.');
console.log('context composition regression ok');
