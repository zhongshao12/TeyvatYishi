import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: [
      "export { buildStorySnapshotParsePrompt, decodeStorySnapshotResponse } from './services/ai/narrativeImageParse.ts';",
      "export { extractLocalStorySnapshot, formatStorySnapshotSceneText, resolveStorySnapshot, selectPresentStorySnapshotNpcs, trimStorySnapshotSource } from './services/ai/storySnapshotPipeline.ts';",
      "export { 默认文生图规则中心 } from './utils/imagePromptRules.ts';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'story-snapshot-regression-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const {
  buildStorySnapshotParsePrompt,
  decodeStorySnapshotResponse,
  extractLocalStorySnapshot,
  formatStorySnapshotSceneText,
  resolveStorySnapshot,
  selectPresentStorySnapshotNpcs,
  trimStorySnapshotSource,
  默认文生图规则中心,
} = await import(moduleUrl);

const editableSemanticPrompt = buildStorySnapshotParsePrompt({
  body: '安柏站在冒险家协会大厅里。',
  semanticRules: '优先选择人物形成明确视线互动的中景镜头。',
});
assert.match(editableSemanticPrompt, /优先选择人物形成明确视线互动的中景镜头/);
assert.doesNotMatch(editableSemanticPrompt, /"snapshot"/);

const repaired = decodeStorySnapshotResponse(`
<think>格式规划</think>
\`\`\`json
{
  "snapshot": {
    "title": "蒙德重逢",
    "characters": ["旅行者", "安柏"],
    "location": "冒险家协会大厅",
    "atmosphere": "明亮而轻松",
    "action": "安柏朝旅行者挥手",
    "camera": "中景双人构图",
    "avoid": "无关角色"
  },
  "prompt": "two travelers greeting in a fantasy adventurers guild hall",
  "negativePrompt": "unrelated characters",
}
\`\`\`
`);
assert.equal(repaired.ok, true, '代码块、think 标签和尾逗号不应导致故事快照解析失败。');

const schemaMismatch = decodeStorySnapshotResponse('{"snapshot":{"title":"缺少提示词"}}');
assert.equal(schemaMismatch.ok, false);
assert.equal(schemaMismatch.code, 'schema_mismatch', '合法 JSON 缺字段时必须区分为 Schema 错误。');

const structured = decodeStorySnapshotResponse(JSON.stringify({
  snapshot: {
    title: '蒙德相遇',
    characters: [
      {
        name: '安柏',
        subjectType: 'girl',
        visualPrompt: 'girl, blue hair, pink dress, waving',
        negativePrompt: 'black hair',
      },
      {
        name: '旅行者',
        subjectType: 'girl',
        visualPrompt: 'girl, silver hair, white coat, smiling',
        negativePrompt: 'blue hair',
      },
    ],
    location: '蒙德冒险家协会大厅',
    atmosphere: '温暖晨光',
    action: '安柏向旅行者挥手',
    camera: '双人中景',
    avoid: '凯亚与丽莎不在画面中',
  },
  prompt: '2girls, inside a European fantasy guild hall, greeting each other, medium shot',
  negativePrompt: 'blurry',
}));
assert.equal(structured.ok, true);
assert.deepEqual(structured.value.characters, ['安柏', '旅行者']);
assert.equal(structured.value.characterPrompts.length, 2);
assert.match(structured.value.characterPrompts[0].visualPrompt, /blue hair/);
assert.equal(structured.value.negativePrompt, 'blurry');

const trimmed = trimStorySnapshotSource([
  '<thinking>不应进入快照</thinking>',
  '<变量事实>{"测试":true}</变量事实>',
  '<变量更新>[]</变量更新>',
  '旅行者和安柏来到冒险家协会大厅。安柏笑着朝旅行者挥手。',
].join('\n'));
assert.equal(trimmed.includes('thinking'), false);
assert.equal(trimmed.includes('变量事实'), false);
assert.equal(trimmed.includes('冒险家协会大厅'), true);

const traveler = { 姓名: '旅行者', 别名: '', 图像档案: {} };
const amber = { 姓名: '安柏', 别名: '侦察骑士', 同行: false, 最近回合: 12, 图像档案: {} };
const kaeya = { 姓名: '凯亚', 别名: '', 同行: true, 最近回合: 11, 图像档案: {} };
const unrelated = { 姓名: '丽莎', 别名: '', 同行: false, 最近回合: 10, 图像档案: {} };
const presentNpcs = selectPresentStorySnapshotNpcs([unrelated, kaeya, amber], trimmed);
assert.deepEqual(presentNpcs.map((npc) => npc.姓名), ['安柏', '凯亚'], '正文点名角色优先，其次保留同行角色。');

const localSummary = extractLocalStorySnapshot(trimmed, traveler, presentNpcs);
assert.equal(localSummary.characters.includes('旅行者'), true);
assert.equal(localSummary.characters.includes('安柏'), true);
assert.match(localSummary.location, /冒险家协会|大厅/);
assert.match(localSummary.action, /来到|挥手/);
const sceneText = formatStorySnapshotSceneText(localSummary);
assert.match(sceneText, /画面标题：/);
assert.match(sceneText, /出场人物：.*旅行者/);
assert.match(sceneText, /出场人物：.*安柏/);
assert.match(sceneText, /镜头构图：/);

amber.图像档案 = {
  角色锚点: {
    正面提示词: 'girl, blue hair, pink dress',
    负面提示词: 'black hair',
  },
};
kaeya.图像档案 = {
  角色锚点: {
    正面提示词: 'boy, black hair, green coat',
    负面提示词: 'blue hair',
  },
};
const localResolution = await resolveStorySnapshot({
  apiConfig: null,
  body: trimmed,
  traveler: { ...traveler, 性别: '女', 外貌: '银色长发，金色眼睛，黑色长外套，简洁旅行装' },
  presentNpcs,
  playerAppearanceMode: 'auto',
  rules: 默认文生图规则中心,
});
assert.equal(localResolution.source, 'local');
assert.ok(localResolution.renderContext, '本地草稿必须返回与模型解析相同的紧凑渲染上下文。');
assert.deepEqual(
  localResolution.renderContext.characters.map((character) => character.name),
  ['旅行者', '安柏'],
  '最终渲染上下文只保留正文实际出现的人物，不能把未出场同行候选注入 NAI。',
);
assert.equal(localResolution.renderContext.characters.some((character) => character.name === '凯亚'), false);
assert.match(localResolution.renderContext.characters[0].visualPrompt, /silver hair/);
assert.match(localResolution.renderContext.characters[0].visualPrompt, /golden eyes/);
assert.match(localResolution.renderContext.characters[0].visualPrompt, /black long coat/);
assert.doesNotMatch(localResolution.renderContext.characters[0].visualPrompt, /[\u3040-\u30ff\u3400-\u9fff]/);
assert.match(localResolution.renderContext.characters[1].visualPrompt, /waving gesture/);
assert.match(localResolution.renderContext.scenePrompt, /Mondstadt|European fantasy city|fantasy guild hall/i);
assert.match(localResolution.renderContext.scenePrompt, /spacious fantasy guild hall|cinematic composition/i);
assert.doesNotMatch(localResolution.renderContext.scenePrompt, /[\u3040-\u30ff\u3400-\u9fff]|NovelAI|SD WebUI|ComfyUI|OpenAI|workflow|JSON|API/i);
assert.ok(localResolution.renderContext.scenePrompt.length < 800, '本地兜底场景层必须保持紧凑，避免挤掉真实画面信息。');

console.log('story snapshot pipeline regression ok');
