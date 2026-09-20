import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { readWorkflowSources } from './lib/workflowSources.mjs';

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

const phoneService = await importBundled('services/ai/courierService.ts');
const phoneModel = await importBundled('services/ai/courierLetterModel.ts');

assert.equal(typeof phoneService.buildCourierSenderProfile, 'function', '必须提供统一的人物手机上下文构建器');
assert.equal(typeof phoneService.appendPhoneExchangeMemory, 'function', '必须提供手机交流回写同行记忆的方法');

const npc = {
  id: 'amber',
  姓名: '安柏',
  好感度: 63,
  亲密关系: false,
  性格: '热情、直率、关心朋友',
  说话方式: '轻快，会用鼓励式短句',
  对玩家称呼: '荣誉骑士',
  同行记忆: [
    { id: 'm1', 回合: 8, 摘要: '一起在风起地放飞风之翼。', 原文: '安柏教旅行者调整风之翼。', 来源: '正文' },
  ],
  总结记忆: [{ id: 's1', 摘要: '旅行者答应陪她参加下一次飞行冠军赛。' }],
  最近互动: '分别前约好下次一起吃蜜酱胡萝卜煎肉。',
  对玩家长期印象: '可靠、偶尔会逞强的搭档。',
  共同经历: ['清理丘丘人营地', '风起地飞行训练'],
  未完成事项: ['一起参加飞行冠军赛'],
  未解决冲突: [],
  必须记得: ['旅行者怕高但不愿承认'],
};
const conversation = {
  id: 'phone_amber',
  title: '安柏',
  participantIds: ['amber'],
  messages: [
    { id: 'p1', senderId: 'player', senderName: '旅行者', role: 'player', content: '我到璃月港了，风之翼没有忘。', turn: 9, timestamp: 9, readBy: [] },
    { id: 'p2', senderId: 'amber', senderName: '安柏', role: 'contact', content: '那就好！记得我们的比赛。', turn: 9, timestamp: 10, readBy: [] },
  ],
  unread: 0,
  type: 'private',
  typingMemberIds: [],
  updatedAt: 10,
};
const profile = phoneService.buildCourierSenderProfile(npc, conversation);
assert.match(profile.recentMemories.join('\n'), /风起地放飞风之翼/);
assert.match(profile.summaryMemories.join('\n'), /飞行冠军赛/);
assert.match(profile.sharedExperiences.join('\n'), /飞行训练/);
assert.match(profile.unfinishedBusiness.join('\n'), /冠军赛/);
assert.match(profile.mustRemember.join('\n'), /怕高/);
assert.match(profile.recentMessages.join('\n'), /璃月港/);

const canonicalFallback = phoneService.buildCourierSenderProfile(undefined, conversation, '安柏');
assert.match(canonicalFallback.personality, /热情外向|行动力强/,
  '手工添加原著角色联系人时也必须获得基础人设，不能只把名字交给模型猜');
assert.match(canonicalFallback.background, /兔兔伯爵|西风骑士团/,
  '原著联系人缺少 NPC 账本时应注入基础身份与外貌锚点');

const autoRegistered = phoneService.ensureCourierContactNpcRecord([], {
  contactId: 'contact_amber',
  name: '安柏',
  turn: 10,
});
assert.equal(autoRegistered.length, 1, '首次手机聊天必须自动建立 NPC 记忆账本');
assert.equal(autoRegistered[0].id, 'contact_amber');
assert.equal(autoRegistered[0].阶位, 'companion', '原著角色手机联系人应进入伙伴档案');
const autoRemembered = phoneService.appendPhoneExchangeMemory(autoRegistered, {
  npcId: 'contact_amber', conversationId: conversation.id, exchangeId: 'auto-memory', turn: 10,
  playerText: '一起去飞行训练。', replyTexts: ['交给我吧！'],
});
assert.match(autoRemembered[0].同行记忆.at(-1).摘要, /飞行训练/,
  '自动建档后第一次手机交流就必须能写入同行记忆');

const seed = {
  id: 'seed1', senderId: 'amber', reason: '问候近况', turn: 10, source: 'system',
  triggerType: 'relationship', priority: 'normal', targetType: 'private', targetId: 'phone_amber',
  title: '消息', context: '旅行者已经抵达璃月港', relatedNpcIds: ['amber'], status: 'pending',
};
const prompt = phoneModel.buildCourierLetterPrompt({ seed, sender: profile, travelerName: '旅行者' });
assert.match(prompt, /风起地放飞风之翼/);
assert.match(prompt, /一起参加飞行冠军赛/);
assert.match(prompt, /旅行者怕高但不愿承认/);
assert.match(prompt, /我到璃月港了/);
assert.doesNotMatch(prompt, /含称呼与落款|写一封简短来信|信使系统/);
assert.match(prompt, /手机消息|不要写落款/);

const localMessage = phoneService.composeCourierLetterLocally({ seed, sender: profile, travelerName: '旅行者' });
assert.doesNotMatch(localMessage, /见信|盼复|提笔|回信|写信|落款/,
  '无 API 时的本地兜底也必须是手机聊天口吻，不能退化成书信模板');
const localReply = phoneService.composeCourierReplyLocally({
  conversation,
  playerMessage: conversation.messages[0],
  sender: profile,
  travelerName: '旅行者',
});
assert.doesNotMatch(localReply, /来信|你的信|回信|见字|盼复/,
  '本地回复不应使用书信套话');
assert.doesNotMatch(localReply, /我到璃月港了，风之翼没有忘/,
  '本地回复不应逐字复述玩家消息');

const quoteAwareLines = phoneService.splitLetterIntoLines(
  '「刚才在石桥上牵你手的时候，你明明脸红了。等进城后还愿意陪我一起去飞行训练吗？」……当然愿意！等你进城，我们就去。',
);
assert.equal(quoteAwareLines.length, 2, '中文引号内的句号和问号不能被错误拆成独立气泡');
assert.match(quoteAwareLines[0], /^「.*？」……当然愿意！$/u);
assert.equal(quoteAwareLines[1], '等你进城，我们就去。');

const modelSource = fs.readFileSync('services/ai/courierLetterModel.ts', 'utf8');
assert.doesNotMatch(modelSource, /letter\.length < 12/, '手机短回复不应因少于 12 字而静默回退');
assert.doesNotMatch(modelSource, /META_PATTERN = \/投递\|种子/, '元信息过滤不能误杀角色自然说出的普通词语');
assert.doesNotMatch(modelSource, /sendChatMessage/, '手机模型不能经过只接受主剧情 JSON 的响应解析器');
assert.match(modelSource, /chatCompletion\(/, '手机模型应直接使用原始文本补全通道');
assert.match(modelSource, /onFinishReason/, '手机模型必须识别输出截断，不能把半句话作为消息发送');
assert.match(modelSource, /4096/, '思考模型截断后应允许一次更高 token 上限的重试');

const resolved = phoneModel.resolveCourierApiConfig({
  provider: 'deepseek', baseUrl: 'https://phone.example/v1', apiKey: 'phone-key', model: 'phone-model',
  maxTokens: 321, temperature: 0.42, retryCount: 5,
}, {
  id: 'main', name: 'main', provider: 'openai', baseUrl: 'https://main.example/v1', apiKey: 'main-key',
  model: 'main-model', maxTokens: 1000, temperature: 0.8, retryCount: 1, createdAt: 1, updatedAt: 1,
});
assert.equal(resolved.provider, 'deepseek', '手机独立 API 的 provider 必须生效');
assert.equal(resolved.retryCount, 5, '手机独立 API 的 retryCount 必须生效');

const first = phoneService.appendPhoneExchangeMemory([npc], {
  npcId: 'amber', conversationId: conversation.id, exchangeId: 'exchange-10', turn: 10,
  playerText: '我到璃月港了，风之翼没有忘。',
  replyTexts: ['那就好！', '记得我们的飞行比赛。'],
});
assert.equal(first[0].同行记忆.at(-1).来源, '手机');
assert.match(first[0].同行记忆.at(-1).原文, /我到璃月港了/);
assert.match(first[0].同行记忆.at(-1).原文, /记得我们的飞行比赛/);
assert.equal(first[0].最近回合, 10);
const repeated = phoneService.appendPhoneExchangeMemory(first, {
  npcId: 'amber', conversationId: conversation.id, exchangeId: 'exchange-10', turn: 10,
  playerText: '我到璃月港了，风之翼没有忘。', replyTexts: ['那就好！', '记得我们的飞行比赛。'],
});
assert.equal(repeated[0].同行记忆.length, first[0].同行记忆.length, '同一次手机交流不得重复写入记忆');

const stateSource = fs.readFileSync('models/teyvat/state.ts', 'utf8');
const settingsSource = fs.readFileSync('models/settings.ts', 'utf8');
const uiSource = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
const workflowSource = readWorkflowSources();
assert.match(stateSource, /手机: CourierSystem/);
assert.doesNotMatch(stateSource, /信使: CourierSystem/);
assert.match(settingsSource, /手机系统: 手机系统设置/);
assert.doesNotMatch(settingsSource, /信使系统: 信使系统设置/);
assert.match(uiSource, /提瓦特手机/);
assert.match(uiSource, />发送</);
assert.doesNotMatch(uiSource, /信使收件箱|写回信|>投递</);
assert.match(workflowSource, /本回合没有待处理的手机消息/,
  '手机任务即使无消息也要在处理队列明确结算，不能永远显示尚未运行');

console.log('phone persona memory regression passed');
