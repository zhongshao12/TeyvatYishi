import type { API配置项 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import type { TeyvatGameState } from '@/models/teyvat/state';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { withRetries } from '@/services/ai/retry';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';
import { buildTeyvatCommandRegistryPrompt } from '@/utils/teyvatCommandRegistry';
import { extractJsonLikeText, parseJsonWithRepair } from '@/services/ai/structuredOutputRepair';
import { parseVariableFacts } from '@/utils/variableFacts';
import { COMPANION_ARCHIVE_WORLDBOOK_CONTENT } from '@/data/companionArchiveWorldbook';
import { VARIABLE_SYSTEM_WORLDBOOK_PROMPT, NSFW_ARCHIVE_SEPARATION_RULE } from '@/data/variableWorldbook';
import { DOMAIN_COMMAND_RULES_PROMPT } from '@/prompts/subsystems/domainCommandPrompt';
import { DOMAIN_COMMAND_OUTPUT_FORMAT_PROMPT } from '@/prompts/subsystems/domainCommandOutputFormat';
import { 获取地点可用天气, 天气列表, 天气名映射 } from '@/data/weatherRules';

export interface NsfwBaselineCandidate {
  npcId: string;
  npcName: string;
  gender?: string;
  appearance?: string;
  personality?: string;
  intro?: string;
  existingNsfwArchive?: Record<string, unknown>;
}

export interface NsfwBaselineResult {
  npcId: string;
  archive: Record<string, unknown> | null;
}

export interface VariableModelRequest {
  body: string;
  variableDraft?: string;
  userInput: string;
  turnCount: number;
  state: TeyvatGameState;
  nsfwEnabled?: boolean;
  maleNsfwArchiveEnabled?: boolean;
  nsfwBaselineCandidates?: NsfwBaselineCandidate[];
  signal?: AbortSignal;
  retryCount?: number;
  promptModules?: 提示词模块[];
}

export interface VariableModelResult {
  /** 兼容现有事实解析器的单一 <变量事实> 包络；模型本身只生成 JSON。 */
  rawText: string;
}

interface VariableProtocolCheck {
  ok: boolean;
  issues: string[];
  json?: string;
}

interface EmptyFactsReview {
  shouldRetry: boolean;
  cueSummary: string;
  npcNames: string[];
  nsfw: boolean;
}

function collectImportantNpcNames(state: TeyvatGameState): string[] {
  return (state.NPC ?? [])
    .filter((npc) => npc.姓名 && (npc.canonical || npc.roleTier === 'companion' || npc.travelingTogether))
    .map((npc) => npc.姓名)
    .slice(0, 12);
}

/** 从正文对白里提取尚未建档的说话人名字（新角色识别）。 */
function collectVisibleNewCharacters(body: string, state: TeyvatGameState): string[] {
  const known = new Set<string>();
  for (const npc of state.NPC ?? []) {
    if (npc.姓名?.trim()) known.add(npc.姓名.trim());
    for (const alias of npc.aliases ?? []) {
      if (alias?.trim()) known.add(alias.trim());
    }
  }
  const traveler = state.旅行者;
  for (const name of [traveler?.姓名, traveler?.别名]) {
    if (name?.trim()) known.add(name.trim());
  }
  known.add('旁白');
  known.add('心声');
  known.add('角色');
  known.add('你');
  known.add('我');

  const found = new Set<string>();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^【\s*([^】]+?)\s*】/);
    if (!match) continue;
    let name = match[1].trim().replace(/[：:].*$/, '');
    if (name === '角色') {
      const rest = line.slice(line.indexOf('】') + 1).trim();
      const nameMatch = rest.match(/^([^：:]+)[：:]/);
      if (!nameMatch) continue;
      name = nameMatch[1].trim();
    }
    if (!name || known.has(name)) continue;
    if (name.length < 2 || name.length > 10) continue;
    found.add(name);
  }
  return [...found].slice(0, 8);
}

function reviewVariableModelContent(
  normalizedRawText: string,
  request: VariableModelRequest,
): EmptyFactsReview {
  const parsed = parseVariableFacts(normalizedRawText);
  if (parsed.parseErrors.length > 0) {
    return { shouldRetry: false, cueSummary: '', npcNames: [], nsfw: false };
  }

  // 类别化复审：新角色建档缺失时，即使已有其他事实也要补审一轮。
  const newCharacters = collectVisibleNewCharacters(request.body, request.state);
  const npcFactNames = new Set(
    parsed.facts.filter((fact) => fact.type === 'npc').map((fact) => fact.name.trim()),
  );
  const missingNewCharacters = newCharacters.filter((name) => !npcFactNames.has(name));
  if (parsed.facts.length > 0) {
    if (missingNewCharacters.length === 0) {
      return { shouldRetry: false, cueSummary: '', npcNames: [], nsfw: false };
    }
    return {
      shouldRetry: true,
      cueSummary: `正文出现尚未建档的新角色，但本轮 npc 事实未覆盖：${missingNewCharacters.join('、')}`,
      npcNames: missingNewCharacters,
      nsfw: false,
    };
  }

  const visibleText = `${request.userInput}\n${request.body}`;
  const npcNames = collectImportantNpcNames(request.state).filter((name) => visibleText.includes(name));
  const dailyCue = /一起|共同行动|吃饭|喝茶|点心|训练|复盘|约定|承诺|委托|交付|道谢|认可|冲突|隐瞒|离队|同行/u.test(visibleText);
  const nsfwCue = Boolean(request.nsfwEnabled && /亲密|恋人|接吻|发生关系|成人/u.test(visibleText));
  if (!nsfwCue && newCharacters.length === 0 && !(npcNames.length > 0 && dailyCue)) {
    return { shouldRetry: false, cueSummary: '', npcNames: [], nsfw: false };
  }

  return {
    shouldRetry: true,
    cueSummary: nsfwCue
      ? '正文命中成人关系长期事实，但 facts 为空'
      : newCharacters.length > 0
        ? '正文出现尚未建档的新角色，但 facts 为空'
        : '正文命中重要 NPC 的共同日常或关系承接事实，但 facts 为空',
    npcNames: [...new Set([...newCharacters, ...npcNames])],
    nsfw: nsfwCue,
  };
}

function buildVariableContentReviewPrompt(review: EmptyFactsReview): string {
  return [
    '上一版返回了空 facts，请重新核对可见正文。',
    `复审原因：${review.cueSummary}。`,
    `相关 NPC：${review.npcNames.join('、') || '未识别'}。`,
    review.nsfw
      ? '若正文已建立成人角色的稳定长期事实，审计 nsfw_archive，并与普通档案隔离；否则仍可返回空 facts。'
      : '名单里尚未建档的名字必须先输出 npc 事实建档（name/gender/intro/recentInteraction/evidence）；已建档角色有一起吃饭、喝茶、品尝点心、训练、复盘、兑现承诺或共同完成小动作时，可形成低风险 npc 轻记忆；没有关系变化时不要强写好感。',
    '只输出完整 JSON 对象 {"facts":[...]}，每条事实必须带可逐字核对的 evidence。',
  ].join('\n');
}

export function buildVariableModelPrompt(
  state: TeyvatGameState,
  nsfwPolicy?: { enabled?: boolean; maleArchiveEnabled?: boolean; baselineCandidates?: NsfwBaselineCandidate[] },
  promptModules?: 提示词模块[],
): string {
  const world = state.世界 ?? {};
  const currentLocation = String(world.当前地点 ?? '').trim() || '未知';
  const currentWeatherId = String(world.当前天气 ?? '').trim() || 'clear';
  const currentWeatherName = 天气名映射[currentWeatherId] ?? currentWeatherId;
  const availableWeatherDesc = 获取地点可用天气(currentLocation)
    .map((id) => 天气列表.find((weather) => weather.id === id))
    .filter((weather): weather is NonNullable<typeof weather> => Boolean(weather))
    .map((weather) => `${weather.emoji} ${weather.name}`)
    .join('、');
  const modulesSection = buildVariablePromptModulesSection(promptModules, nsfwPolicy?.enabled);
  const baselineCandidates = nsfwPolicy?.baselineCandidates?.filter((candidate) => candidate.npcName) ?? [];
  const knownNpcRoster = (state.NPC ?? [])
    .map((npc) => npc.姓名?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 40);

  return [
    modulesSection || [
      DOMAIN_COMMAND_RULES_PROMPT,
      VARIABLE_SYSTEM_WORLDBOOK_PROMPT,
      COMPANION_ARCHIVE_WORLDBOOK_CONTENT,
      DOMAIN_COMMAND_OUTPUT_FORMAT_PROMPT,
    ].join('\n\n'),
    '',
    '# 当前环境校验',
    `当前地点：${currentLocation}`,
    `当前天气：${currentWeatherName}`,
    `此地可用天气：${availableWeatherDesc || '无额外天气表'}`,
    `当前 NPC 名单（共 ${knownNpcRoster.length} 人）：${knownNpcRoster.join('、') || '（空，尚未结识任何角色）'}`,
    '',
    '# 回合结算必查项（每回合必须逐项核对）',
    '1. 时间推进（默认行为）：只要旅行者发生了移动、探索、对话、战斗或任何占时间的行动，默认输出 {"type":"time","mode":"elapsed","minutes":3-10}；等待/休息/用餐按情节给更大分钟数；跨夜用 next_day。',
    '   - 过了片刻/半日 → {"type":"time","mode":"elapsed","minutes":30}；睡到天亮/次日 → {"type":"time","mode":"next_day"}；直接写出新时刻 → {"type":"time","mode":"set_time","targetTime":"14:00"}。',
    '   - 仅当整段正文发生在同一瞬间（如一句对话内）才可省略 time；省略不写会导致世界时间停摆。',
    '2. 地点变化：若正文结尾时旅行者已移动到新的地点/区域，必须输出 {"type":"location","location":"新地点全名","evidence":"正文中到达新地点的原句"}。',
    '   - 地点名称尽量带"地区 · 具体位置"格式（如「蒙德 · 低语森林」）；仅是原地移动不要改地点。',
    '3. 同行与新结识 NPC：正文中与旅行者互动的重要角色，输出 npc 事实以更新其档案、好感与同行状态。',
    '   - 新结识必建档：只要正文首次出现有名有姓的角色（说话、被介绍、被点名互动，无论原著角色还是原创角色），而档案库还没有他/她，就必须输出一条 npc 事实建档（name 必填，尽量带 gender、intro、recentInteraction、evidence）。',
    '   - 判断标准以「当前 NPC 名单」为准：名单里没有的名字一律视为新角色。',
    '4. 技能使用：旅行者在正文施展了已登记的天赋（元素战技 / 元素爆发 / 普攻招式）时，输出 {"type":"skill_used","talentName":"登记名称","evidence":"正文写明施展该技能的原句"}；未登记的技能不要输出。',
    '5. 以上核对全部无变化时，才允许输出 {"facts":[]}。',
    '',
    '## 变量事实类型（每类字段与示例）',
    '',
    '### 旅人核心档案只读',
    '- 旅人的姓名、别名、性别、年龄、生日、身份、外貌、性格、背景、头像和图像档案由玩家手写维护，变量模型不得输出 traveler_profile，也不得用旧命令改写这些字段。',
    '- 剧情中获得的临时称呼或伪装，写入 NPC 记忆、world_event 或正文承接，不改旅人档案本体。',
    '',
    '### 时间：time',
    '- 字段：mode、minutes、targetTime、evidence。',
    '- mode 可用：no_change / elapsed / set_time / overnight / next_day。',
    '- elapsed 只写分钟数，普通回合 1-5 分钟；复杂回合通常不超过 15 分钟；超过 30 分钟必须有正文明确证据。',
    '- 如果正文明确“第二天 / 次日 / 一夜过去 / 睡醒 / 跨夜后凌晨”，用 next_day 或 overnight，并可带 targetTime。',
    '- 如果同日只是“几分钟后”，用 elapsed；不要自己重算日期。',
    '- 不要直接写旧命令 set 世界.当前时间 / 世界.当前日期 / 世界.旅程天数，让代码按事实推进。',
    '- 示例：{"type":"time","mode":"elapsed","minutes":4,"evidence":"正文写到几分钟后读书结束"}',
    '- 示例：{"type":"time","mode":"next_day","targetTime":"07:30","evidence":"正文写明一夜过去，清晨在营地醒来"}',
    '',
    '### 地点：location',
    '- 字段：location、evidence。',
    '- 只有地点明显变化或正文首次明确当前地点时输出；名称尽量带“地区 · 具体位置”格式（如「蒙德 · 低语森林」）。',
    '- 示例：{"type":"location","location":"蒙德 · 风起地","evidence":"正文写明两人已抵达风起地的大树下"}',
    '',
    '### 天气：weather',
    '- 字段：weather（中文名，必须从「此地可用天气」中选择）、evidence。',
    '- 根据正文氛围和地点特征判断本回合天气是否变化；没有明显天气暗示时不输出（保持上回合天气）。',
    '- 不要频繁切换天气（至少持续 3-5 回合）。',
    '- 示例：{"type":"weather","weather":"小雨","evidence":"正文写明窗外开始飘起细雨"}',
    '',
    '### NPC：npc',
    '- 字段：id、name、alias、gender、affinityDelta、affinitySet、intimateRelationship、following、appearance、clothing、speechStyle、personality、intro、playerAddress、memory、recentInteraction、longTermImpression、sharedExperiences、openItems、resolvedItems、unresolvedConflicts、mustRemember、doNotForget、evidence。',
    '- name 是必填中文姓名；即使写了 id 也要写中文名，如 {"id":"npc_amber","name":"安柏"}。',
    '- gender 可选 男 / 女 / 其他；新建 NPC 时尽量提供。',
    '- 建档（新角色）：名字不在「当前 NPC 名单」里的角色首次登场时，必须输出 npc 事实建档：至少给 name，尽量给 gender、intro（一两句身份背景）、recentInteraction（本回合与玩家的互动）、evidence；tier/关系/阶段由系统派生，不用写。',
    '- 好感度范围 -50..150；关系阶段由前端派生，禁止输出 relation/relationshipStage。',
    '- 原著角色的长期性格不由变量模型改写；长期口吻以图鉴主体资料校准。',
    '- 单回合的沉默/紧张/冷淡不要固化为长期性格，只写进 memory / recentInteraction / openItems / unresolvedConflicts / mustRemember / doNotForget。',
    '- 重要 NPC 的低风险日常轻记忆：已入档、原著、同行、当前镜头重点或具名原创角色，只要正文写明与玩家发生了具体共同互动，就应输出 npc 事实。',
    '- 共同互动包括：一起吃饭喝茶、共同训练或调查、互相玩笑、招呼玩家参与日常、等待玩家反馈等。',
    '- 这类事实只写低风险字段：memory、recentInteraction、sharedExperiences、longTermImpression。没有明确升温/冲突时不写 affinityDelta。',
    '- 多人场景优先写 1-3 位与玩家交集最强的 NPC；纯寒暄（无对象、无共同动作、无可引用细节）可以跳过。',
    '- affinityDelta 审计一视同仁，不因性别差异只写 memory 不写好感。',
    '- 本回合明确完成、取消或失效的约定/委托必须写 resolvedItems，并从 openItems 中排除；recentInteraction 要承认已经完成，不能让角色下一回合继续催促。',
    '- 示例：{"type":"npc","name":"安柏","memory":"安柏把调查低语森林异常足迹的委托交给玩家，并约定用望远镜信号联络。","recentInteraction":"安柏在骑士团总部委托玩家调查足迹，并约定用信号联络。","sharedExperiences":["一起规划低语森林调查路线"],"openItems":["帮安柏调查低语森林异常足迹"],"mustRemember":["安柏给过玩家备用信号道具，后续联络不能写成陌生人"],"evidence":"正文写明安柏交付委托并约定联络方式"}',
    '- 示例：{"type":"npc","name":"凯亚","memory":"凯亚察觉玩家隐瞒了深渊教团线索，暂时压下质问但保留警惕。","recentInteraction":"凯亚要求玩家解释线索来源，玩家没有完全说明。","unresolvedConflicts":["玩家隐瞒深渊线索来源，凯亚尚未完全信任"],"doNotForget":["凯亚已经察觉玩家隐瞒线索，冲突解决前不能写成毫无芥蒂"],"evidence":"正文写明凯亚沉默片刻后要求玩家给出完整解释"}',
    '- 示例：{"type":"npc","name":"凯亚","gender":"男","affinityDelta":2,"memory":"凯亚在玩家按约带回线索后，认可了玩家在关键环节上的可靠性。","recentInteraction":"玩家按约带回调查线索，凯亚明确表示这次配合很稳妥。","sharedExperiences":["一起完成线索复核"],"evidence":"正文写明凯亚因玩家兑现承诺而认可其判断"}',
    '- 示例：{"type":"npc","name":"派蒙","memory":"派蒙拉着玩家一起品尝蒙德特色点心，并吐槽价格太贵。","recentInteraction":"派蒙和玩家在酒馆一起品尝点心，气氛轻松。","sharedExperiences":["在酒馆一起品尝蒙德点心"],"evidence":"正文写明派蒙主动招呼玩家尝点心，玩家实际品尝"}',
    '- 示例：{"type":"npc","name":"陈老伯","gender":"男","memory":"陈老伯在玩家帮助修复风车后，留下自己的联络方式，表示以后有需要可以找他。","recentInteraction":"陈老伯委托玩家修理风车，事后主动留下联络方式。","openItems":["陈老伯留下的联络方式，后续可主动联系"],"evidence":"正文写明陈老伯委托修理并留下联络方式"}',
    '',
    '### 物品：item',
    '- 字段：action（gain / consume / give / lose）、category、name、description、quantity、rarity、stackable、source、sourceDescription、narrativeEffects、evidence。',
    '- 获得实体物品用 gain；明确使用/吃掉用 consume；交给角色或任务交付用 give；遗失/损毁用 lose。所有扣除动作必须输出，不能只在正文里写。',
    '- 只有 gain 必须带 category 与 rarity；consume / give / lose 只需 name、quantity、evidence，category 可用于同名物品消歧。',
    '- category 只能是 weapon / artifact / food / material / gadget / quest / furnishing；artifact 必须带 artifactSlot。',
    '- 物品必须有具体名称和描述；模糊的“一些东西”不落库。',
    '- 坐标、路线、权限、口令、线索、情报、名单等“信息本身”不是背包物品；请改写为 world_event、npc.memory 或正文承接。只有实体载体才可入背包。',
    '- 物品只写叙事效果，不写数值加成、装备槽位或穿戴状态。',
    '- 示例：{"type":"item","action":"gain","category":"food","name":"蒙德烤鱼","description":"外皮金黄的烤鱼，散发着香草的气味。","quantity":2,"rarity":1,"source":"剧情掉落","evidence":"正文写明从河里钓到鱼并烤制"}',
    '',
    '### 世界事件：world_event',
    '- 字段：text、evidence。',
    '- 用于可被后续剧情引用的客观结果，例如区域损坏、撤离完成、组织动向、公开事件。',
    '- 示例：{"type":"world_event","text":"风龙废墟方向的异常气流已经平息","evidence":"正文写明骑士团确认气流平息"}',
    '',
    '### 信使种子：courier_seed',
    '- 字段：targetType、targetId、targetName、title、context、triggerType、priority、relatedNpcIds、evidence。',
    '- 只生成“稍后可能来信”的种子，不写完整 messages。每回合最多 0-2 条；出现新约定、分头行动、任务进展、关系变化、抵达新地点、关键物品时必须审计是否写 1 条。',
    '- targetType 用 private 或 group；targetName 必填中文 NPC 名；relatedNpcIds 写对应 NPC id。',
    '- 示例：{"type":"courier_seed","targetType":"private","targetName":"安柏","title":"低语森林的调查结果","context":"安柏想知道玩家在低语森林发现了什么。","triggerType":"quest","priority":"normal","relatedNpcIds":["npc_amber"],"evidence":"正文写明玩家完成了调查"}',
    '',
    '### 技能使用：skill_used',
    '- 字段：talentName、evidence。',
    '- 旅行者施展了技能面板里已登记的天赋（元素战技、元素爆发、普通攻击招式、固有天赋）时输出；系统会按使用给该天赋 +1 级（上限 20 级）。',
    '- talentName 必须与登记的名称完全一致；没有登记的技能、敌人的技能、同伴的技能都不要输出。',
    '- 同一回合多次施展同一技能只输出 1 条；只是提到技能名字而没有实际施展不要输出。',
    '- 示例：{"type":"skill_used","talentName":"风涡剑","evidence":"正文写明旅行者挥出风涡剑牵引敌人"}',
    '',
    '## 严格约束',
    '',
    '- 只记录正文和变量草稿能相互印证的已发生事实；变量草稿不是命令，不能直接照抄落库。',
    '- 不要把剧情编织当前段、后续段、未触发敌人、未抵达地点或未登场 NPC 当成本回合变量事实。',
    '- 不确定就不写。宁可漏掉轻微变量，也不要写错对象、错日期、错路径。',
    '',
    '# 当前 TeyvatDomainCommand 登记表',
    buildTeyvatCommandRegistryPrompt(),
    nsfwPolicy?.enabled ? `\n${NSFW_ARCHIVE_SEPARATION_RULE}` : '',
    nsfwPolicy?.enabled && baselineCandidates.length > 0
      ? [
          '',
          '# 成人档案候选',
          ...baselineCandidates.map((candidate) => `- ${candidate.npcName}${candidate.gender ? `（${candidate.gender}）` : ''}`),
          '- 只在可见正文存在稳定长期事实时输出 nsfw_archive；没有证据时不要补写经历或偏好。',
          '- 已确认成年女性可使用 virginityStatus（virgin / not_virgin / unknown）与 firstSexualPartner；只有正文明确改变时才更新，未成年或年龄不明角色绝不写这两个字段。',
          nsfwPolicy.maleArchiveEnabled ? '- 男性档案已启用。' : '- 男性身体档案未启用，不得输出男性身体字段。',
        ].join('\n')
      : '',
  ].filter(Boolean).join('\n');
}

export function buildVariablePromptModulesSection(
  promptModules?: 提示词模块[],
  nsfwEnabled?: boolean,
): string {
  if (!promptModules?.length) return '';
  const base = buildIndependentPromptModulesSection(promptModules, 'variable');
  if (!base) return '';
  return nsfwEnabled ? `${base}\n\n${NSFW_ARCHIVE_SEPARATION_RULE}` : base;
}

export async function callVariableModel(
  config: API配置项,
  request: VariableModelRequest,
): Promise<VariableModelResult> {
  const systemPrompt = buildVariableModelPrompt(request.state, {
    enabled: request.nsfwEnabled,
    maleArchiveEnabled: request.maleNsfwArchiveEnabled,
    baselineCandidates: request.nsfwBaselineCandidates,
  }, request.promptModules);
  const userMessage = [
    `第 ${request.turnCount} 回合`,
    '玩家输入：',
    request.userInput || '（无）',
    '本回合可见正文：',
    request.body,
    '候选提示（必须回到正文核验证据）：',
    request.variableDraft?.trim() || '（无）',
    '只输出一个 {"facts":[...]} JSON 对象；没有事实时输出 {"facts":[]}。',
  ].join('\n\n');
  const requestOnce = (messages: Array<{ role: string; content: string }>) => chatCompletionNonStream(config, {
    messages,
    systemPrompt,
    signal: request.signal,
    maxTokens: config.maxTokens ?? 2200,
    temperature: config.temperature ?? 0.25,
  });

  let modelText = await withRetries(
    () => requestOnce([{ role: 'user', content: userMessage }]),
    { retries: request.retryCount ?? 0, signal: request.signal, label: '变量模型' },
  );
  let protocol = checkVariableModelProtocol(modelText);
  if (!protocol.ok) {
    modelText = await withRetries(
      () => requestOnce([
        { role: 'user', content: userMessage },
        { role: 'assistant', content: modelText },
        { role: 'user', content: buildVariableProtocolRepairPrompt(protocol) },
      ]),
      { retries: 1, signal: request.signal, label: '变量模型协议修复' },
    );
    protocol = checkVariableModelProtocol(modelText);
  }

  let rawText = protocol.ok && protocol.json
    ? wrapVariableFacts(protocol.json)
    : ensureVariableProtocolFallback();
  const review = reviewVariableModelContent(rawText, request);
  if (review.shouldRetry) {
    const reviewedText = await withRetries(
      () => requestOnce([
        { role: 'user', content: userMessage },
        { role: 'assistant', content: modelText },
        { role: 'user', content: buildVariableContentReviewPrompt(review) },
      ]),
      { retries: 1, signal: request.signal, label: '变量模型内容复审' },
    );
    const reviewedProtocol = checkVariableModelProtocol(reviewedText);
    if (reviewedProtocol.ok && reviewedProtocol.json) rawText = wrapVariableFacts(reviewedProtocol.json);
  }
  return { rawText };
}

function checkVariableModelProtocol(rawText: string): VariableProtocolCheck {
  try {
    const candidate = extractJsonLikeText(rawText, 'object');
    const parsed = parseJsonWithRepair<Record<string, unknown>>(candidate, 'object');
    if (!Array.isArray(parsed.facts)) return { ok: false, issues: ['facts 必须是数组'] };
    return { ok: true, issues: [], json: JSON.stringify({ facts: parsed.facts }) };
  } catch (error) {
    return { ok: false, issues: [`无法解析 facts JSON：${error instanceof Error ? error.message : String(error)}`] };
  }
}

function buildVariableProtocolRepairPrompt(protocol: VariableProtocolCheck): string {
  return [
    '上一版没有满足领域事实 JSON 契约。',
    `失败项：${protocol.issues.join('；') || '未知协议错误'}。`,
    '从零重新输出一个合法 JSON 对象，根字段只能是 facts；没有事实时输出 {"facts":[]}。',
    '不要解释、不要代码块、不要附加第二个载荷。',
  ].join('\n');
}

function ensureVariableProtocolFallback(): string {
  return wrapVariableFacts('{"facts":[]}');
}

function wrapVariableFacts(json: string): string {
  return `<变量事实>\n${json}\n</变量事实>`;
}
