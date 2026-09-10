import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

execFileSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    'utils/playerSpeechGuard.ts',
    '--outDir',
    '.tmp-regression/player-speech',
    '--module',
    'ES2022',
    '--target',
    'ES2022',
    '--moduleResolution',
    'Bundler',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);

const mod = await import(pathToFileURL(`${process.cwd()}/.tmp-regression/player-speech/playerSpeechGuard.js`).href);
const { normalizeInlineSpeakerTags, normalizePlayerSpeechInBody, replaceBodyInRawResponse, shouldRenderAsNarrationForPlayerLine } = mod;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalize(body, input = '') {
  return normalizePlayerSpeechInBody({
    body,
    playerName: '凌',
    userInput: input,
  });
}

assert(
  normalize('【凌】轰隆——！！！', '我看向前方') === '【旁白】轰隆——！！！',
  '拟声词不能挂在玩家头像下。',
);

assert(
  normalize('【凌】轰隆隆——！！！', '我看向前方') === '【旁白】轰隆隆——！！！',
  '长拟声词不能挂在玩家头像下。',
);

assert(
  normalize('【凌】吼——！！！', '我后退一步') === '【旁白】吼——！！！',
  '生物/怪物吼叫不能挂在玩家头像下。',
);

assert(
  normalize('【凌】小心，右侧舱门要塌了！', '我看向三月七') === '【旁白】小心，右侧舱门要塌了！',
  '玩家未说出口的 NPC/旁白式台词不能挂玩家名。',
);

assert(
  normalize('【旁白】“我是凌，巡海游侠。”', '我说：“我是凌，巡海游侠。”') === '【凌】我是凌，巡海游侠。',
  '玩家明确说出口的旁白引号句应转为玩家气泡。',
);

assert(
  normalize('【凌】我是凌，巡海游侠。', '我说：“我是凌，巡海游侠。”') === '【凌】我是凌，巡海游侠。',
  '有玩家输入证据的玩家台词应保留玩家气泡。',
);

assert(
  normalize('【凌】“我是凌。” 你抬起手。', '我说：“我是凌。”') === '【凌】我是凌。\n【旁白】你抬起手。',
  '玩家台词后混入动作时应拆成玩家台词 + 旁白。',
);

const inlineSpeakerTags = normalizeInlineSpeakerTags('【旁白】刀锋落下。【瓦尔特】……冷静。【旁白】月台终于安静。');
assert(
  inlineSpeakerTags === '【旁白】刀锋落下。\n【瓦尔特】……冷静。\n【旁白】月台终于安静。',
  '同一行里连续出现多个【旁白】/【角色名】标签时，必须拆成多行渲染。',
);

const normalizedInlineBody = normalize('【旁白】刀锋落下。【瓦尔特】……冷静。【旁白】月台终于安静。', '');
assert(
  normalizedInlineBody === '【旁白】刀锋落下。\n【瓦尔特】……冷静。\n【旁白】月台终于安静。',
  '正文落库清洗必须先拆分行内角色标签。',
);

assert(
  shouldRenderAsNarrationForPlayerLine('轰隆——！！！', '我看向前方') === true,
  '渲染旧消息时，玩家名下拟声词应兜底改旁白。',
);

assert(
  shouldRenderAsNarrationForPlayerLine('轰隆隆——！！！', '我看向前方') === true,
  '渲染旧消息时，长环境音也应兜底改旁白。',
);

const rendererSource = fs.readFileSync('components/features/Chat/MessageRenderers.tsx', 'utf8');
assert(
  rendererSource.includes('quoted && traveler && !shouldRenderAsNarrationForPlayerLine(quoted, userInput)'),
  '旁白中的整句引号只有在玩家输入有证据时才能提升为玩家气泡。',
);
assert(
  rendererSource.includes('normalizeInlineSpeakerTags(body).split'),
  '渲染旧消息时也必须拆分同一行内的多个角色标签。',
);

assert(
  shouldRenderAsNarrationForPlayerLine('小心，右侧舱门要塌了！', '我看向三月七') === true,
  '渲染旧消息时，玩家没说出口的台词也应兜底改旁白，避免玩家夺舍 NPC。',
);

assert(
  shouldRenderAsNarrationForPlayerLine('我是凌。', '我说：“我是凌。”') === false,
  '渲染旧消息时，有证据的玩家台词仍应显示玩家头像。',
);

const sanitizedRaw = replaceBodyInRawResponse(
  '<thinking>ok</thinking>\n<正文>\n【凌】轰隆——！！！\n</正文>\n<短期记忆>空间站震动。</短期记忆>',
  '【旁白】轰隆——！！！',
);
assert(
  sanitizedRaw.includes('【旁白】轰隆——！！！') && !sanitizedRaw.includes('【凌】轰隆'),
  '保存进原始消息的 <正文> 块也必须替换成清洗后的正文。',
);
assert(
  sanitizedRaw.includes('<thinking>ok</thinking>') && sanitizedRaw.includes('<短期记忆>空间站震动。</短期记忆>'),
  '替换 rawText 正文块时不能破坏 thinking / 记忆等其他标签。',
);

const protocolRawWithoutBody = replaceBodyInRawResponse(
  '<thinking>Step0: 读取上下文</thinking>\n<短期记忆>- 空间站震动。</短期记忆>',
  '【旁白】空间站震动。',
);
assert(
  protocolRawWithoutBody.includes('<thinking>Step0: 读取上下文</thinking>') &&
    protocolRawWithoutBody.includes('<短期记忆>- 空间站震动。</短期记忆>') &&
    !protocolRawWithoutBody.startsWith('【旁白】空间站震动。'),
  'rawText 含协议标签但缺 <正文> 时，不能把原始消息压成清洗后的纯正文。',
);

const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const renderers = fs.readFileSync('components/features/Chat/MessageRenderers.tsx', 'utf8');
const chatList = fs.readFileSync('components/features/Chat/ChatList.tsx', 'utf8');
const systemPromptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const builtinPromptModules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');
const builtinWorldbookConfig = fs.readFileSync('data/builtinWorldbookConfig.ts', 'utf8');
const worldbookUtils = fs.readFileSync('utils/worldbook.ts', 'utf8');

assert(sendWorkflow.includes("from '@/utils/playerSpeechGuard'"), 'sendWorkflow 必须使用玩家发言守卫清洗正文。');
assert(sendWorkflow.includes('const finalBodyBlocks: NarrativeTurn'), 'sendWorkflow 必须把清洗后的正文重新构造成正式 NarrativeTurn body。');
assert(sendWorkflow.includes('revalidateFactCandidatesForBody(cleanedParsed.factCandidates, finalBodyBlocks)'), '正文清洗后必须重新校验 factCandidates 证据，不能保留失效证据。');
assert(sendWorkflow.includes('userInput,'), 'sendWorkflow 清洗玩家气泡时必须传入本回合玩家输入。');
assert(renderers.includes('shouldRenderAsNarrationForPlayerLine'), '渲染层必须对旧消息玩家气泡做兜底归属检查。');
assert(renderers.includes('normalizeInlineSpeakerTags'), '渲染层必须复用行内角色标签拆分工具。');
assert(!renderers.includes('该行未识别为 【旁白】/【角色名】/【心声】 任一格式'), '无前缀正文应按普通旁白显示，不应在玩家界面用暗色警告。');
assert(!renderers.includes('dimmed'), '无前缀正文渲染不得继续使用 dimmed 旁白色差。');
assert(chatList.includes('previousUserInput'), 'ChatList 必须把 AI 回复对应的上一条玩家输入传给渲染层。');
// NarrativeTurn 结构下，提示词只声明证据边界；真正的玩家发言归属由生成前核对和落库清洗共同守卫。
assert(!systemPromptBuilder.includes('buildSpeakerAttributionSection'), '硬编码发言归属段必须保持已删除状态(权威在回复格式模块)。');
assert(!systemPromptBuilder.includes('【玩家角色名】'), 'systemPromptBuilder 不得暴露输出形状的玩家角色名占位。');
assert(builtinPromptModules.includes('玩家只可复述本回合明确输入过的原话'), '回复格式模块必须把玩家台词绑定到本回合输入证据。');
assert(builtinPromptModules.includes('不得代写玩家的新决定、心理或动作'), '回复格式模块必须禁止把模型补写内容归给玩家。');
assert(sendWorkflow.includes('# 本回合生成前核对'), 'sendWorkflow 必须在生成点前注入区E执法块。');
assert(sendWorkflow.includes('只承载玩家本回合明确说出的原话'), '区E执法块必须包含发言归属兜底行。');
assert(!systemPromptBuilder.includes('.replace(/玩家姓名/g'), '提示词模块注入不能把说明性“玩家姓名”替换成真实玩家名。');
assert(!systemPromptBuilder.includes('.replace(/主角姓名/g'), '提示词模块注入不能把说明性“主角姓名”替换成真实玩家名。');
assert(!worldbookUtils.includes('.replace(/玩家姓名/g'), '世界书占位替换不能把说明性“玩家姓名”替换成真实玩家名。');
assert(!worldbookUtils.includes('.replace(/主角姓名/g'), '世界书占位替换不能把说明性“主角姓名”替换成真实玩家名。');
assert(builtinPromptModules.includes('当前互动的核心玩家角色为「{playerName}」'), '叙述者人格必须声明当前互动核心玩家角色。');
assert(builtinPromptModules.includes('NarrativeTurn JSON 回复格式'), '默认回复格式必须使用正式 NarrativeTurn JSON 合同。');
assert(builtinPromptModules.includes('body 只允许 narration、dialogue、system'), '默认回复格式必须约束可见正文块类型。');
assert(builtinPromptModules.includes('玩家只可复述本回合明确输入过的原话'), '默认回复格式必须保留玩家发言证据边界。');
assert(!builtinPromptModules.includes('【玩家角色名】'), '默认提示词模块不得继续暴露输出形状的玩家角色名占位。');
assert(!builtinPromptModules.includes('我是凌，巡海游侠'), '默认提示词示例不能把凌作为主角名写死。');
assert(builtinWorldbookConfig.includes('自定义旅行者是玩家主角'), '默认世界书必须明确自定义旅行者的玩家主角身份。');
assert(!builtinWorldbookConfig.includes('【玩家角色名】'), '默认世界书模板不得继续暴露输出形状的玩家角色名占位。');

console.log('player speech guard regression ok');
