import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function importBundled(entryPoint) {
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    alias: { '@': process.cwd() },
    logLevel: 'silent',
  });
  const source = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${source}`);
}

const parser = await importBundled('utils/stPresetParser.ts');
const chainBuilder = await importBundled('hooks/useGame/tavernMessageChainBuilder.ts');

const raw = JSON.stringify({
  temperature: 0.7,
  top_p: 0.93,
  frequency_penalty: -0.2,
  prompts: [
    { identifier: 'main', role: 'system', content: '保持角色连贯。' },
    { identifier: 'worldInfoBefore', role: 'system', content: '', marker: true },
    { identifier: 'personaDescription', role: 'system', content: '', marker: true },
    { identifier: 'chatHistory', role: 'system', content: '', marker: true },
    { identifier: 'userInput', role: 'user', content: '', marker: true },
  ],
  prompt_order: [{
    character_id: 100001,
    order: [
      { identifier: 'main', enabled: true },
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'personaDescription', enabled: true },
      { identifier: 'chatHistory', enabled: true },
      { identifier: 'userInput', enabled: true },
    ],
  }],
});

const parsed = parser.parseSTPresetV2(raw);
assert.ok(parsed.preset, 'V2 预设应成功解析');
assert.equal(parsed.preset.temperature, 0.7, 'temperature 小数必须原样保留');
assert.equal(parsed.preset.top_p, 0.93, 'top_p 小数必须原样保留');
assert.equal(parsed.preset.frequency_penalty, -0.2, 'frequency_penalty 负小数必须原样保留');
for (const identifier of ['worldInfoBefore', 'personaDescription', 'chatHistory', 'userInput']) {
  assert.ok(
    parsed.preset.prompts.some((prompt) => prompt.identifier === identifier && prompt.marker === true),
    `运行时占位项 ${identifier} 必须保留`,
  );
}

const messages = chainBuilder.buildTavernMessageChain({
  settings: { promptModules: [], stPostProcessMode: '未选择' },
  preset: parsed.preset,
  characterId: 100001,
  chatHistory: [
    { id: 'h1', role: 'user', content: '历史用户消息·独有', timestamp: 1 },
    { id: 'h2', role: 'assistant', content: '历史助手消息·独有', timestamp: 2 },
  ],
  latestUserInput: '本轮输入·独有',
  playerName: '测试旅行者',
  playerRole: { 姓名: '测试旅行者', 性格: '谨慎而温柔' },
  includeNativeContextInWorldbook: false,
});
const combined = messages.map((message) => message.content).join('\n');
assert.match(combined, /姓名：测试旅行者/, 'personaDescription 槽位必须注入玩家档案');
assert.match(combined, /历史用户消息·独有/, 'chatHistory 槽位必须注入用户历史');
assert.match(combined, /历史助手消息·独有/, 'chatHistory 槽位必须注入助手历史');
assert.match(combined, /本轮输入·独有/, 'userInput 槽位必须注入本轮输入');

console.log('ST preset import runtime regression passed');
