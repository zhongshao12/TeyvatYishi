/**
 * ST V2 消息链构建器回归测试。
 *
 * 只验证旁路纯函数，不接入主剧情发送链路。
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const tempDir = path.join(root, '.tmp-tavern-message-chain-regression');

function cleanTempDir() {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
}

function transpileModule(sourcePath) {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
  const sourceDir = path.posix.dirname(sourcePath.replaceAll('\\', '/'));
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  }).outputText
    .replace(/@\/(data|models|services|prompts|utils|hooks)\//g, (_match, folder) => {
      let relative = path.posix.relative(sourceDir, folder);
      if (!relative.startsWith('.')) relative = `./${relative}`;
      return `${relative}/`;
    })
    .replace(/from\s+['"]((?:\.\/|\.\.\/)[^'"]+)['"]/g, (match, specifier) =>
      specifier.endsWith('.mjs') ? match : `from '${specifier}.mjs'`);
  const outputPath = path.join(tempDir, sourcePath.replace(/\.ts$/, '.mjs'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countIncludes(messages, text) {
  return messages.filter((msg) => msg.content.includes(text)).length;
}

cleanTempDir();
transpileModule('utils/macroEngine.ts');
transpileModule('models/prompts.ts');
transpileModule('hooks/useGame/tavernFormatGuard.ts');
transpileModule('hooks/useGame/tavernMessageChainBuilder.ts');

const builderUrl = pathToFileURL(path.join(tempDir, 'hooks/useGame/tavernMessageChainBuilder.mjs')).href;
const { buildTavernMessageChain } = await import(builderUrl);

const settings = {
  stPostProcessMode: '未选择',
  promptModules: [
    { id: 'builtin_world_prompt', content: '世界观片段' },
    { id: 'builtin_narrative_main', content: '原生主叙事唯一标记' },
    { id: 'builtin_response_format', content: 'NarrativeTurn格式' },
    { id: 'builtin_action_options', content: 'choices格式' },
    { id: 'builtin_no_control', content: '项目防抢话规则' },
    { id: 'builtin_narrator_persona', content: '叙述人格' },
    { id: 'builtin_dev_mode', content: '' },
    { id: 'builtin_writing_style', content: '文风片段' },
  ],
};

const basePreset = {
  prompts: [
    { identifier: 'worldInfoBefore', role: 'system', content: '' },
    { identifier: 'main', role: 'system', content: '你好 {{user}}，角色是 {{char}}。' },
    { identifier: 'chatHistory', role: 'system', content: '' },
    { identifier: 'personaDescription', role: 'system', content: '' },
    { identifier: 'userInput', role: 'user', content: '' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'main', enabled: true },
      { identifier: 'chatHistory', enabled: true },
      { identifier: 'personaDescription', enabled: true },
      { identifier: 'userInput', enabled: true },
    ],
  }],
};

const messages1 = buildTavernMessageChain({
  settings,
  preset: basePreset,
  characterId: 100001,
  chatHistory: [{
    role: 'assistant',
    content: '上一回合原始内容',
    parsedResponse: {
      body: [{ kind: 'narration', text: '上一回合正文：旅行者抵达枫丹廷' }],
      choices: [],
      factCandidates: [{ domain: 'world', fact: '旅行者抵达枫丹廷', evidence: '旅行者抵达枫丹廷' }],
      continuation: { summary: '上一回合记忆', unresolved: [] },
    },
  }],
  latestUserInput: '继续',
  playerName: '洛葵',
  playerRole: {
    姓名: '洛葵',
    别名: '绘图师',
    性别: '未知',
    年龄: 25,
    生日: '',
    身高: '',
    身份: '来自璃月的民间绘图师',
    外貌: '灰发金瞳',
    性格: '行动派',
    背景: '',
    专长知识: ['地图绘制'],
    头像: '',
  },
});

assert(countIncludes(messages1, '原生主叙事唯一标记') === 1, '未使用 {{cot}} 时原生主叙事应只压轴注入一次');
assert(countIncludes(messages1, 'NarrativeTurn格式') === 1, '未使用 {{format}} 时格式应只压轴注入一次');
assert(countIncludes(messages1, 'choices格式') === 1, '行动选项应压轴注入一次');
assert(
  messages1.some((msg) => msg.content.includes('你好 洛葵，角色是 当前剧情中的主要互动对象')),
  '应替换 {{user}}，并把 {{char}} 替换为项目内置兼容语义',
);
assert(messages1.some((msg) => msg.role === 'user' && msg.content === '继续'), '应注入最新用户输入');
assert(messages1.some((msg) => msg.content.includes('上一回合正文') && msg.content.includes('旅行者抵达枫丹廷')), 'assistant 历史应优先使用 parsedResponse 结构化正文');
assert(messages1.some((msg) => msg.content.includes('# 玩家档案') && msg.content.includes('身份：来自璃月的民间绘图师')), 'personaDescription 应注入完整玩家档案');

const placeholderPreset = {
  prompts: [
    { identifier: 'main', role: 'system', content: '正文\n{{cot}}\n{{format}}' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [{ identifier: 'main', enabled: true }],
  }],
};

const messages2 = buildTavernMessageChain({
  settings,
  preset: placeholderPreset,
  characterId: 100001,
  chatHistory: [],
  latestUserInput: '',
  playerName: '洛葵',
  playerRole: null,
});

assert(countIncludes(messages2, '原生主叙事唯一标记') === 1, '使用 {{cot}} 时原生主叙事只在占位符处注入一次');
assert(countIncludes(messages2, 'NarrativeTurn格式') === 1, '使用 {{format}} 时只在占位符处注入一次');

const combinedSystemPrompt = '系统底座\n原生主叙事唯一标记';
const combinedMessages = buildTavernMessageChain({
  settings,
  preset: placeholderPreset,
  characterId: 100001,
  chatHistory: [],
  latestUserInput: '',
  playerName: '洛葵',
  playerRole: null,
  includeNativeNarrative: false,
});
const combinedRequestText = [combinedSystemPrompt, ...combinedMessages.map((message) => message.content)].join('\n');
assert((combinedRequestText.match(/原生主叙事唯一标记/g) ?? []).length === 1, 'systemPrompt + Tavern API messages 组合请求中的原生主叙事语义必须恰好一次');

const noControlPreset = {
  prompts: [
    { identifier: 'worldInfoBefore', role: 'system', content: '' },
    { identifier: 'boundary', role: 'system', content: '禁止代写玩家言行，不替玩家发言。' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'boundary', enabled: true },
    ],
  }],
};

const messages3 = buildTavernMessageChain({
  settings,
  preset: noControlPreset,
  characterId: 100001,
  chatHistory: [],
  latestUserInput: '',
  playerName: '洛葵',
  playerRole: null,
});

assert(countIncludes(messages3, '项目防抢话规则') === 0, '预设已有防抢话时应跳过项目 noControl 嫁接');
assert(messages3.some((msg) => msg.content.includes('禁止代写玩家言行')), '预设自带防抢话内容应保留');

const macroPreset = {
  prompts: [
    { identifier: 'macroSet', role: 'system', content: '{{setvar::mood::晴朗}}' },
    { identifier: 'macroRead', role: 'system', content: '今日心情：{{getvar::mood}}。{{if getvar::mood == 晴朗}}可以出发{{/if}}' },
    { identifier: 'macroDisabled', role: 'system', content: '{{setvar::mood::阴沉}}' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'macroSet', enabled: true },
      { identifier: 'macroDisabled', enabled: false },
      { identifier: 'macroRead', enabled: true },
    ],
  }],
};
const messages4 = buildTavernMessageChain({
  settings,
  preset: macroPreset,
  characterId: 100001,
  chatHistory: [],
  latestUserInput: '',
  playerName: '洛葵',
  playerRole: null,
});
assert(messages4.some((msg) => msg.content.includes('今日心情：晴朗。可以出发')), '宏应按启用顺序项共享上下文执行');
assert(!messages4.some((msg) => msg.content.includes('阴沉')), '禁用顺序项不应执行宏');

const worldInfoPreset = {
  prompts: [
    { identifier: 'worldInfoBefore', role: 'system', content: '' },
    { identifier: 'main', role: 'system', content: '主提示词' },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'main', enabled: true },
    ],
  }],
  world_info: [
    {
      uid: 1,
      comment: '枫丹廷条目',
      key: ['枫丹廷'],
      content: '白露巷与钟表匠委托需要维持连续性。',
      enabled: true,
      order: 20,
    },
    {
      uid: 2,
      comment: '未触发条目',
      key: ['贝洛伯格'],
      content: '这段不应进入当前消息链。',
      enabled: true,
      order: 10,
    },
  ],
};
const messages5 = buildTavernMessageChain({
  settings,
  preset: worldInfoPreset,
  characterId: 100001,
  chatHistory: [],
  latestUserInput: '继续调查枫丹廷的旧航海图。',
  playerName: '洛葵',
  playerRole: null,
});
assert(messages5.some((msg) => msg.content.includes('# 预设世界书')), '命中的 ST world_info 应进入世界书嫁接文本');
assert(messages5.some((msg) => msg.content.includes('白露巷与钟表匠委托需要维持连续性')), '命中的 ST world_info 内容应注入消息链');
assert(!messages5.some((msg) => msg.content.includes('这段不应进入当前消息链')), '未命中的 ST world_info 不应注入消息链');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('✓ ST V2 消息链构建器回归测试通过');
