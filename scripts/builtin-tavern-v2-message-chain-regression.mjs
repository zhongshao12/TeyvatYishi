/**
 * Built-in Tavern V2 runtime message-chain regression.
 *
 * Registry checks are not enough: when a built-in preset is selected, the
 * runtime builder must actually produce API messages that include preset
 * content plus the project's final format/action guards.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const tempDir = path.join(root, '.tmp-builtin-tavern-v2-message-chain-regression');

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
      resolveJsonModule: true,
      skipLibCheck: true,
    },
  }).outputText
    .replace(/@\/(data|models|services|prompts|utils|hooks)\//g, (_match, folder) => {
      let relative = path.posix.relative(sourceDir, folder);
      if (!relative.startsWith('.')) relative = `./${relative}`;
      return `${relative}/`;
    })
    .replace(/from\s+['"]((?:\.\/|\.\.\/)[^'"]+\.json)['"]/g, (_match, specifier) =>
      `from '${specifier}.mjs'`)
    .replace(/from\s+['"]((?:\.\/|\.\.\/)[^'"]+)['"]/g, (match, specifier) =>
      specifier.endsWith('.mjs') || specifier.endsWith('.json') ? match : `from '${specifier}.mjs'`);
  const outputPath = path.join(tempDir, sourcePath.replace(/\.ts$/, '.mjs'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBuiltInMessages(entry, expectedNameFragment) {
  const messages = buildTavernMessageChain({
    settings,
    preset: entry.preset,
    characterId: entry.characterId,
    chatHistory: [],
    latestUserInput: '检查当前预设是否进入真实 API messages。',
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
  const joined = messages.map((msg) => msg.content).join('\n\n');

  assert(messages.length > 0, `${entry.name} should produce runtime messages`);
  assert(joined.includes(expectedNameFragment), `${entry.name} should include recognizable built-in preset content`);
  assert(joined.includes('检查当前预设是否进入真实 API messages。'), `${entry.name} should inject latest user input`);
  assert(joined.includes('项目 NarrativeTurn 格式保护'), `${entry.name} should keep project response-format guard`);
  assert(joined.includes('项目 choices 保护'), `${entry.name} should keep project action-options guard`);
  assert((joined.match(/项目原生主叙事保护/g) ?? []).length === 1, `${entry.name} should include native main exactly once in standalone Tavern mode`);
}

cleanTempDir();
transpileModule('utils/macroEngine.ts');
transpileModule('models/prompts.ts');
transpileModule('data/builtinPresets/builtinPreset.ts');
transpileModule('data/builtinPresets/index.ts');
transpileModule('hooks/useGame/tavernFormatGuard.ts');
transpileModule('hooks/useGame/tavernMessageChainBuilder.ts');

// 内置酒馆预设改为运行时按需 fetch（public/data/builtin-presets/），
// 回归环境用本地文件服务模拟该请求。
const resourceDir = path.join(root, 'public/data/builtin-presets');
globalThis.fetch = async (input) => {
  const url = String(input);
  const id = path.basename(new URL(url, 'http://localhost').pathname, '.json');
  const filePath = path.join(resourceDir, `${id}.json`);
  if (!fs.existsSync(filePath)) return new Response('missing', { status: 404 });
  return new Response(fs.readFileSync(filePath, 'utf8'), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const presetsUrl = pathToFileURL(path.join(tempDir, 'data/builtinPresets/index.mjs')).href;
const builderUrl = pathToFileURL(path.join(tempDir, 'hooks/useGame/tavernMessageChainBuilder.mjs')).href;
const { getBuiltinPresetsV2, loadAllBuiltinTavernPresets } = await import(presetsUrl);
await loadAllBuiltinTavernPresets();
const { buildTavernMessageChain } = await import(builderUrl);

const settings = {
  stPostProcessMode: '未选择',
  promptModules: [
    { id: 'builtin_world_prompt', content: '项目世界观保护' },
    { id: 'builtin_narrative_main', content: '项目原生主叙事保护' },
    { id: 'builtin_response_format', content: '项目 NarrativeTurn 格式保护' },
    { id: 'builtin_action_options', content: '项目 choices 保护' },
    { id: 'builtin_no_control', content: '项目防抢话保护' },
    { id: 'builtin_narrator_persona', content: '项目叙述人格保护' },
    { id: 'builtin_dev_mode', content: '' },
    { id: 'builtin_writing_style', content: '项目文风保护' },
  ],
};
const presets = getBuiltinPresetsV2();
const shuangren = presets.find((entry) => entry.id === 'builtin_shuangrenchenghang_v2');
const izumi = presets.find((entry) => entry.id === 'builtin_izumi_v2');
const sanrennixing = presets.find((entry) => entry.id === 'builtin_sanrennixing_v2');

assert(shuangren, 'Shuangrenchenghang V2 builtin must be available');
assert(izumi, 'Izumi V2 builtin must be available');
assert(sanrennixing, 'Sanrennixing V2 builtin must be available');
assertBuiltInMessages(shuangren, 'living_character_action_baseline');
assertBuiltInMessages(izumi, '剧情无聊的时候**直接跳过时间**');
assertBuiltInMessages(sanrennixing, '谢谢你。你说得对');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('builtin Tavern V2 runtime message-chain regression ok');
