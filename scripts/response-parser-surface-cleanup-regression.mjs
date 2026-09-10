import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const tempDir = path.join(root, '.tmp-response-parser-surface-cleanup-regression');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
    .replace(/@\/(models|compat)\//g, (_match, folder) => {
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

cleanTempDir();
transpileModule('models/teyvat/narrativeTurn.ts');
transpileModule('services/ai/narrativeTurnParser.ts');
transpileModule('services/ai/responseParser.ts');
const compatStubPath = path.join(tempDir, 'compat/legacy-hsr/readOnly.mjs');
fs.mkdirSync(path.dirname(compatStubPath), { recursive: true });
fs.writeFileSync(compatStubPath, 'export function getLegacyElementalEchoTagAliases() { return { invite: [], questions: [], judgement: [] }; }\n', 'utf8');

const parserUrl = pathToFileURL(path.join(tempDir, 'services/ai/responseParser.mjs')).href;
const { parseResponse, parseStoredLegacyResponse } = await import(parserUrl);

const liveTurn = parseResponse(JSON.stringify({
  body: [{ kind: 'narration', text: '车厢里的点心香气逐渐铺开。' }],
  choices: [{ id: 'taste', label: '尝一口点心' }],
  factCandidates: [{ domain: 'world', fact: '点心已经送到车厢', evidence: '点心香气' }],
  continuation: { summary: '众人准备分享点心。', unresolved: [] },
}));
assert(liveTurn.body[0].text.includes('点心香气'), 'live parser must retain formal visible body blocks.');
assert(liveTurn.choices[0].id === 'taste', 'live parser must retain formal choices.');

const stStyleOutput = `<thinking>
- **【问题】非传统写作**: ST 预设思维链。
</thinking>

### 正文

【旁白】车厢里的点心香气逐渐铺开。
<!-- 满足动作改写，补充道谢对白 -->
<math>抗截断占位</math>

<行动选项>
- 选项 1：尝一口点心。

<短期记忆>
- 凌跟随三月七和星前往观景车厢。

<动态世界>
- 无`;

let liveRejectedLegacy = false;
try { parseResponse(stStyleOutput); } catch (error) { liveRejectedLegacy = error?.code === 'INVALID_JSON'; }
assert(liveRejectedLegacy, 'live parser must reject tagged output without legacy fallback.');
const parsed = parseStoredLegacyResponse(stStyleOutput);
const parsedBodyText = parsed.body.map((block) => block.text).join('\n');
assert(parsedBodyText.includes('【旁白】车厢里的点心香气逐渐铺开。'), 'stored legacy narration should remain readable.');
assert(!parsedBodyText.includes('### 正文'), 'stored legacy Markdown heading must not enter formal body.');
assert(!parsedBodyText.includes('满足动作改写'), 'stored legacy HTML meta comment must not enter formal body.');
assert(!parsedBodyText.includes('<math>'), 'stored legacy truncation placeholder must not enter formal body.');
assert(parsed.choices.some((item) => item.label.includes('尝一口点心')), 'stored legacy choices should normalize to formal choices.');
assert(parsed.continuation.summary.includes('凌跟随三月七'), 'stored legacy memory should normalize to continuation summary.');
assert(!JSON.stringify(parsed).includes('ST 预设思维链'), 'stored private reasoning must not survive normalization.');

const wrappedBody = parseStoredLegacyResponse(`<正文>
正文：
【旁白】有效正文。
<Q>抗空回占位</WF>
\`\`\`
</正文>`);
assert(wrappedBody.body[0].text === '【旁白】有效正文。', 'stored body wrappers and placeholders should be cleaned.');

const multiFeatureBody = parseStoredLegacyResponse(`<正文>
【旁白】正文开始。
<tucao>吐槽不应进入正文</tucao>
<danmu>弹幕不应进入正文</danmu>
<htmlcontent><div>HTML 不应进入正文</div></htmlcontent>
<current_event>当前事件卡片</current_event>
<progress>进度卡片</progress>
<details><summary>摘要</summary>摘要卡片</details>
【旁白】正文结束。
</正文>

<行动选项>
- 选项 1：继续正常行动。
</行动选项>

<短期记忆>
- 正常记忆保留。
</短期记忆>`);
const multiBodyText = multiFeatureBody.body.map((block) => block.text).join('\n');
assert(multiBodyText.includes('【旁白】正文开始。') && multiBodyText.includes('【旁白】正文结束。'), 'stored cleanup must retain narration.');
assert(!/吐槽|弹幕|HTML|当前事件卡片|进度卡片|摘要卡片/.test(multiBodyText), 'stored helper blocks must not contaminate formal body.');
assert(multiFeatureBody.choices.some((item) => item.label.includes('继续正常行动')), 'stored choices must survive formal normalization.');
assert(multiFeatureBody.continuation.summary.includes('正常记忆保留'), 'stored memory must survive as continuation summary.');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('response parser surface cleanup regression ok');
