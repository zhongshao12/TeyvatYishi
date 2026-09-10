import type { 世界书, 世界书条目 } from '@/models/worldbook';
import { ELEMENTAL_ECHO_INVITE_MASTERY } from '@/services/elementalAttunementService';
// [迁移] COMPANION_ARCHIVE_WORLDBOOK_CONTENT / VARIABLE_SYSTEM_WORLDBOOK_PROMPT / NSFW_ARCHIVE_WORLDBOOK_CONTENT
// 已迁移到提示词模块系统（builtin_companion_archive_worldbook / builtin_variable_worldbook / builtin_nsfw_archive_worldbook），
// 不再以世界书条目形式注入，此处不再 import。

// 「内置世界书与提示词」Tab 用 id 白名单判定。
// 如果 IndexedDB 里某本世界书 id 在这里，UI 把它划到内置 Tab；否则归入「额外」Tab。
// 注：CoT 已迁移到「提示词模块」系统（设置→提示词模块），不再以世界书形式注入。
// 批次5(D10, 2026-07-26): 开局规范/叙事铁律/禁词/力量体系四本已整体迁移为提示词模块
// (builtin_rule_* 系列),不再是世界书;旧存档残留由 REMOVED_LEGACY_WORLDBOOK_IDS 清理。
export const BUILTIN_BOOK_IDS = [
  'builtin_compass',
  'builtin_worldview_core',
  'builtin_paths_lore',
  'builtin_story_normal',
  'builtin_story_harem',
  'builtin_story_romance_alt',
  'builtin_story_deep_single',
] as const;

export const BUILTIN_FIRST_TURN_ENTRY_ID = 'builtin_first_turn_rule';

export const FORBIDDEN_PHRASES_CONTENT = `# 禁词世界书 / 反八股文规则

本条目用于压制高频 AI 腔、空泛强调词、廉价比喻、套路动作与总结式收束。它不要求机械删词，而是要求在生成前避开这些写法，改用现场可验证细节。

## 禁止高频 AI 腔与空泛强调词
- 禁止使用或高频重复：极其、非常、无比、极度、一丝、一抹、一种、带着一丝、带着一种、难以言喻、某种意义上、仿佛整个世界、空气凝固、命运齿轮、复杂情绪、说不清道不明、微妙、莫名、深处涌起、隐隐、某种、令人窒息、不容拒绝、不容置疑、不易察觉。
- 尤其禁止把“极其”当作万能加强词大量重复。

## 禁止套话动作
- 禁止把情绪反复写成：指节发白、指节泛白、拳头攥到发白、牙关紧咬、喉结滚动、眼底闪过、眸光一闪、嘴角勾起、唇角微扬、呼吸一滞、倒吸一口凉气、背脊发寒、鸡皮疙瘩、声音低沉沙哑、声音沙哑、声音很低、声音不大、声音细若蚊蝇、声音压成耳语、眼神复杂、手上薄茧、空气里弥漫着。
- 角色情绪优先通过行动选择、停顿位置、说话内容、视线落点、与旁人的距离变化来呈现。

## 禁止廉价比喻和解释腔
- 禁止机械套用：像、如同、仿佛、似乎、不是……而是……、没有……而是……、不是……是……、首先/其次/再次/最后、我意识到、这象征着。
- 不是不能出现任何比喻，而是不能用比喻替代事实推进。若一个句子删掉比喻后没有信息量，就重写。

## 禁止无效副词和慢动作灌水
- 禁止滥用：轻轻地、慢慢地、缓缓地、这一下、这四个字、揉成一团。
- 动作描写优先白描，不写“一瞬间的人体微距特写”。写“他把终端推到桌边”，不要写“他缓缓抬起手指，轻轻地把那枚终端一点点推向桌边”。

## 禁止情绪通胀和生硬比喻
- 禁止使用：如遭雷击、大脑空白、惊涛骇浪、心如刀绞、机械移动、听觉神经风暴、生锈的铠甲、精心构筑的城墙、甜美的风暴席卷口腔、香气挑逗味蕾。
- 强烈程度不靠大词堆叠表达，靠现场后果表达。

## 成人描写禁用遮羞套词
- 成人描写中禁止文学化遮羞套词：肉魈、甬道、分身、浮木。
- 已有明确性器词可用时，不绕成隐晦比喻；NSFW 未开启时则不进入露骨成人描写。

## 禁止泛化总结式收束
- 禁止用这些句式收尾：这一刻、从此以后、无人知道、只有他自己明白、仿佛有什么东西悄然改变、故事才刚刚开始、命运已经改写。
- 回合结尾应停在可继续互动的现场状态、人物回应、环境变化或行动后果上。

## 替代原则
- 若需要表达强烈程度，优先换成现场可验证细节：手上动作、脚步变化、兵器位置、对话停顿、旁人反应、环境反馈与实际后果。
- 不要为了避开禁词改用同义套话。目标是降低八股味，不是把“空气凝固”换成“气氛冻结”。`;

export const EMOTION_REALISM_CONTENT = `## 情绪真实性约束

> 本条目与上方「叙事铁律」配合使用。叙事铁律管「去神话化 / 去魅主 / 去发情化」等方向性约束，本条目专门管 NPC 与主角的情绪强度与变化节奏，防止单回合内出现"刚见面就誓死追随"式失真。

### 1. 基本原则
- NPC 与主角的情绪贴合真实人类波动，**无因果的情绪极化在输出阶段就要被收掉**。
- 默认情绪区间停留在「克制、犹疑、试探、恼怒、欣喜、失落」等可理解层级。
- 极端情绪需要明确事件链支撑，不在单回合内突变。

### 2. 情绪强度阶梯
- **L1 轻波动**：迟疑、警惕、松动、不耐、尴尬。
- **L2 中波动**：失望、愤怒、依赖、嫉妒、明显动摇。
- **L3 极端波动**：崩溃边缘、偏执、防御性攻击、短暂失控。
- **默认上限压在 L2**；L3 只有**同时满足**以下三项时才可短暂启用：
  1. 多回合持续累积；
  2. 当回合出现明确强触发事件（重创、背叛、重大损失、元素冲击）；
  3. 正文能给出可观察证据链。
- 任一条件不满足，统一降级为 L2。

### 3. 强情绪收口项
- 缺乏充分互动基础时，关系结果**收束在感谢、松动、试探、合作层**，不直接落成无端崇拜、献祭式忠诚或人格依附。
- 传功 / 授课 / 送资源 / 救急 / 救命 / 单次并肩 / 单次亲密，结果**收束在阶段性情感变化**，不直接抬升为「誓死追随 / 只为玩家而活 / 随时赴死」。
- 「报恩」继续保持在报恩层；「效忠 / 追随」建立在多回合共同经历与价值立场靠拢之后。
- 高好感 NPC 也必须**保留现实顾虑、独立计划、分歧能力与拒绝权**——不能写成只围着主角转的工具人。
- 单次小挫折收束在可理解的失落、恼怒、受挫层，不直接推进成「活不下去 / 彻底火」式绝望。
- 情绪强烈时**逻辑仍保持连续**：前后态度不突然断裂、人格不突然翻转。
- 关系变化按回合累积推进——不在一回合内从冷淡跳到生死相许，也不把复杂关系简化成无条件原谅或无条件仇恨。
- 亲密 / 性行为叙事（若 NSFW 模块启用）**保留角色原有人格与边界**，不写成征服、驯服、收服式结构。

### 4. 允许项（需因果）
- 重大创伤、背叛、长期压迫、连续失败 → 可逐步提升负面情绪强度。
- 救助、共患难、长期稳定相处 → 可逐步提升信任与亲密，但**仍需保留个体边界**。
- 稳定追随、忠诚或深度亲密，至少要具备：**多回合累积 + 双向投入 + 角色自身利益或信念一致**。
- 强烈情绪优先通过多回合累积形成，**单回合突变**应尽量避免。

### 5. 落地要求
- 每次情绪变化**至少给出一个可观察触发点**：一句话、一个动作、一次事件结果。
- 同一 NPC **保持情绪连续性**：本回合情绪能从上回合状态推导出来。
- 优先使用**复杂情绪**而非二元极端：「嘴硬但在意」「愤怒中夹杂失望」「克制下的动摇」。
- 出现强情绪时**至少保留 1 条自我约束或现实顾虑细节**，防止角色失真。
- 若强度判定不清或证据不足，**按 L2 处理**——L3 只在证据充分时才启用。`;

export const NARRATIVE_GENERAL_CONTENT = `## 提瓦特主剧情叙事约束

- 本回合只通过 NarrativeTurn 的 body、choices、factCandidates、continuation 继续故事，不输出旁路协议或幕后推理。
- 当前自定义旅行者是独立主角；原著的空与荧仍按开局档案存在，三者不可互相替代。
- 玩家输入、当前场景、已发生事实与人物档案优先；推测不能覆盖事实，CanonDeviation 只能在明确偏离原著后记录。
- NPC 按自己的职责、信息边界与关系行动。安柏、凯亚、琴等原著人物必须保持可辨识的性格，不因主角出现就失去判断。
- 以可观察动作、环境反馈和现实后果推进，不替玩家补写未输入的对白、心理、决定或额外动作。
- 战斗、调查、交涉和日常同行都写成连续场面；选项只放在 choices，不在 body 里列菜单。`;

export const BATTLE_NARRATION_CONTENT = `## 提瓦特战斗叙事

- 战斗服务于当前目标，用地形、武器、七元素反应、体力与保护对象形成因果链，不写数值战报。
- 每段交手都给出清楚的空间锚点，例如城门、山道、遗迹回廊、林间坡地或水岸。
- 元素表现来自角色已有能力、环境与训练；不能临时授予力量，也不能把元素反应写成自动胜利。
- 结果必须可观察：谁受伤、谁撤离、道路如何改变、物品是否损坏，以及留下了什么后续风险。
- 不让 NPC 集体称赞主角；他们仍按性格、职责和当下判断回应。`;

export const FIRST_TURN_RULE_CONTENT = `# 原生开场规范

- 首回合必须直接承接开局档案中的地区、地点、身份、当前压力与玩家切入点，不等待玩家先说话。
- 自由或预设开局都只使用已提供的种子；不得把未知背景补成确定事实，也不得强制回到蒙德。
- 用提瓦特当地天气、街巷、野外、遗迹、商旅或 NPC 行动建立日式西幻冒险感，并给出一个可立即回应的钩子。
- 自定义旅行者与原著空、荧彼此独立。开局只聚焦其中一人时，也不得抹除其余已登记身份。
- 只输出一个 NarrativeTurn JSON 对象；body 展开现场，choices 只列真正有用且后果不同的行动，factCandidates 只记录 body 已证实的事实。`;

const COMPASS_CONTENT = `## 提瓦特罗盘

故事发生在提瓦特大陆。蒙德、璃月、稻妻、须弥、枫丹、纳塔与至冬各有自己的自然环境、制度、信仰、交通与日常生活；开局档案指定的地区和地点是当前现实。

自定义旅行者是玩家主角，拥有自己的来历、关系与元素经历；空与荧仍是原著中的双子旅行者，不被玩家替代。三者可以相遇、同行或走上不同道路。

当前事实优先于原著默认走向。只有正文已明确造成偏离时，才以 CanonDeviation 记录差异；资料背景不能把故事拉回默认序章，也不能抹去玩家已建立的原创人物与事件。`;

const WORLDVIEW_SPINE = `## 提瓦特世界骨架

- 提瓦特由七国、荒野、秘境、遗迹、地脉与跨地区道路构成；旅行受距离、天气、地形、关卡与交通方式限制。
- 七元素是风、岩、雷、草、水、火、冰。元素力通过角色已有设定、神之眼、特殊体质或明确共鸣经历表现，不是随手新增的职业树。
- 原著人物、组织与国家保留各自职责和信息边界；未知信息不能被 NPC 凭空掌握。
- 玩家输入与当前已发生事实优先，原著仅作稳定背景。已证实的偏离由 CanonDeviation 显式记录，未发生的偏离不能预写。
- 所有可见回复遵守 NarrativeTurn；世界资料只帮助叙事，不在 body 中朗读设定条目。`;

export const WORLDVIEW_SPINE_USAGE_RULES = `### 世界观使用原则
- 优先写当前地点、人物、行动和可见后果；资料只在对话、物件、习俗与环境中自然显露。
- 开局档案与已发生事实高于默认原著进度；CanonDeviation 只记录已有证据的偏离。
- 自定义旅行者、空与荧是独立个体，不共享身份、记忆或玩家决定。`;

const WORLDVIEW_ARCHONS_ELEMENTS = `## 七国、七神与七元素

七神与各国历史构成提瓦特公共背景，但普通人只知道其身份与经历允许知道的部分。风、岩、雷、草、水、火、冰的使用必须有既有设定或本回合证据。神明不会因为叙事需要直接赐予陌生人力量，也不会被自动安排为元素体验的观众。`;

const WORLDVIEW_LEY_LINE_ANOMALIES = `## 地脉与异常

地脉会保存和扰动记忆、元素与环境。异常可能表现为魔物活动、遗迹机关失控、污染、错位景象或区域生态变化，但必须有现场证据；不得把任何冲突都归因于地脉，也不得用异常跳过调查过程。`;

const WORLDVIEW_TRAVELERS_ADVENTURE = `## 旅行者与冒险

跨地区旅行依靠道路、船只、升降设施、驮兽、步行与已解锁的传送锚点。冒险家协会可以发布委托、提供登记与情报，但不会替玩家解决现场问题。派蒙、空与荧属于原著旅行线；自定义旅行者与他们并行存在。`;

const WORLDVIEW_MONDSTADT = `## 蒙德地区

蒙德以自由之都、骑士团、教会、酒业与风元素传统闻名。安柏热心而直接，凯亚善于观察且保留分寸，琴以职责和城市安全为先。只有当前地点或已发生事件确实在蒙德时，才展开当地人物与危机。`;

const WORLDVIEW_FACTIONS = `## 主要组织关系

西风骑士团、璃月七星与千岩军、稻妻奉行、须弥教令院、枫丹执律机构、冒险家协会、愚人众和深渊教团各有权限、利益与盲区。组织不会因玩家一句话就交出机密或改变立场；合作、怀疑与冲突都需要可见理由。`;

const WORLDVIEW_TRAVEL_INFO = `## 旅行与信息边界

人物只能依据亲历、对话、书信、公告、档案或可靠转述获知信息。跨地区移动要尊重路程、天气、许可和交通条件；传送锚点只在角色已知且可用时使用。图鉴资料用于校准，不等于所有 NPC 都知道其中内容。`;

export const WORLDVIEW_TIME_PROGRESSION = `## 提瓦特时间推进

- 当前日期、当前时间与旅行天数是单向锚点，不得因新回合回退或重置。
- 只有 body 明确写出等待、赶路、休息、调查、疗伤或跨日等耗时证据时才推进时间。
- 普通对话、瞬间反应与元素内省默认不推进现实时间。
- 若时间确实变化，在同一 NarrativeTurn.factCandidates 中加入 domain="time" 的候选事实，evidence 必须逐字摘自对应 body.text；没有证据就不生成。
- 跨日必须在 body 中明确写出次日、睡醒或天色变化等事实，同时保持日期与旅行天数一致。`;

const PATHS_OVERVIEW = `## 七元素概览

提瓦特的正式元素为风、岩、雷、草、水、火、冰。元素表达来自角色已记录的神之眼、特殊体质、训练或共鸣经历，并通过感官、动作、环境反应和代价呈现。多元素经历必须有设定依据，不能把元素写成任意切换的技能菜单。`;

const PATHS_THRESHOLD = `## 元素共鸣的叙事边界

元素体验以旅行者自己的记忆、身体感受、当下选择与愿意承担的代价展开。它是内省与理解深化，不是考试、预言、神明会见或现场授力；任何力量变化都必须由正式系统事实确认。`;

const PATHS_TENSION = `## 元素与组织

元素本身不会自动决定善恶、阵营或性格。角色与组织的冲突来自历史、职责、资源、法律和具体行动；拥有同一元素的人仍可能作出完全不同的选择。`;

export const POWER_SYSTEM_OVERVIEW_CONTENT = `## 提瓦特力量边界

- 力量表现取决于角色既有能力、训练、武器、元素、地形、情报、伤势与保护对象，不使用隐藏等级替代叙事判断。
- 七元素为风、岩、雷、草、水、火、冰；没有既有证据时不得新增元素能力或夸大掌握程度。
- 强者也受距离、体力、准备、环境和责任限制；弱者可以凭协作、机关、地形与计划争取机会。
- 神之眼、特殊体质和旅行者共鸣各有设定边界。元素深化来自个人记忆、感受、选择、代价与理解，不由外部权威当场赐予，也不安排超然会见或旁观评审。
- 正文只写动作与后果，不写等级表、数值比较或技能菜单。`;

export const ELEMENTAL_ECHO_INTERROGATION = `## 元素回响·内省桥段

当旅行者某种已解锁元素的掌握度达到 ${ELEMENTAL_ECHO_INVITE_MASTERY} 且尚未达到 100 时，可在安静且安全的剧情间隙发出邀请。

- 只允许风、岩、雷、草、水、火、冰七种正式元素。
- 回响由旅行者自己的记忆、感官、选择、代价与自我理解构成，不推进现实时间。
- 三问从感受、亲历到眼前取舍递进，不替玩家作答，不设置失败、惩罚、预言或唯一正确答案。
- 意识空间里不得出现神明角色，也不安排超然会见、旁观或评审；力量不由外部权威当场赐予。
- 邀请在 body 的 system 块中可见，并生成有逐字 evidence 的 system factCandidate；回应回合明确写出“共鸣深化”。
- 掌握度与回响状态由正式服务维护，不通过叙事私自改写。`;

function entry(partial: Omit<世界书条目, 'createdAt' | 'updatedAt'>, now: number): 世界书条目 {
  // contentVersion 默认 1:内置条目内容更新时递增该条目的版本号,老存档即可强制刷新(D12)。
  return { contentVersion: 1, ...partial, createdAt: now, updatedAt: now };
}

export function createBuiltinConfigWorldbooks(): 世界书[] {
  const now = Date.now();

  // [迁移·批次5 D10] 原 1.开局规范 / 2.主剧情(叙事铁律+情绪真实性+战斗描写) / 禁词世界书 /
  // 力量体系总览 四本书与 时间推进、回响三问 两个条目,已整体迁移为提示词模块 builtin_rule_* 系列
  // (data/builtinPromptModules.ts),获得 migratePromptModules 强制内容刷新能力;
  // 旧存档残留经 REMOVED_LEGACY_WORLDBOOK_IDS(整本)与条目自然消失(条目)清理。
  // 内容常量仍保留在本文件并 export,供模块引用与回归脚本钉验。

  // 3. 提瓦特罗盘（开局·提瓦特罗盘 + A1 + A2，合并为单条总览）
  const compassBook: 世界书 = {
    id: 'builtin_compass',
    title: '提瓦特罗盘',
    description: '提瓦特七国总览、自定义旅行者与空荧并存，以及当前事实优先规则。',
    enabled: true,
    entries: [
      entry({
        id: 'builtin_compass_overview',
        title: '世界总览',
        content: COMPASS_CONTENT,
        type: 'world_lore',
        injectMode: 'always',
        keywords: [],
        priority: 220,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
    ],
    createdAt: now,
    updatedAt: now,
  };

  // 4. 世界观：宇宙骨架始终注入，势力 / 地点 / 地脉异常等细节按关键词展开。
  const worldviewBook: 世界书 = {
    id: 'builtin_worldview_core',
    title: '世界观',
    description: '提瓦特大陆、七元素、地脉异常、地区旅行、主要组织与信息边界。',
    enabled: true,
    entries: [
      entry({
        id: 'builtin_worldview_spine',
        title: '宇宙骨架与主剧情使用原则',
        content: WORLDVIEW_SPINE,
        type: 'world_lore',
        injectMode: 'always',
        keywords: [],
        priority: 219,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
      entry({
        id: 'builtin_worldview_archons_elements',
        title: '七执政与元素',
        content: WORLDVIEW_ARCHONS_ELEMENTS,
        type: 'world_lore',
        injectMode: 'keyword_match',
        keywords: ['七执政', '元素', '天理', '风神', '岩神', '雷神', '草神', '水神', '火神', '冰神'],
        priority: 207,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
      entry({
        id: 'builtin_worldview_ley_line_anomalies',
        title: '地脉异常与灾厄',
        content: WORLDVIEW_LEY_LINE_ANOMALIES,
        type: 'world_lore',
        injectMode: 'keyword_match',
        keywords: ['地脉异常', '地脉', '封存', '灾厄', '灾难', '深渊教团', '禁忌知识', '深渊力量'],
        priority: 208,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
      entry({
        id: 'builtin_worldview_travelers_adventure',
        title: '提瓦特之旅与冒险家',
        content: WORLDVIEW_TRAVELERS_ADVENTURE,
        type: 'world_lore',
        injectMode: 'keyword_match',
        keywords: ['提瓦特之旅', '旅途', '启程', '冒险家', '旅行者', '派蒙', '琴', '丽莎', '安柏', '凯亚'],
        priority: 206,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
      entry({
        id: 'builtin_worldview_mondstadt',
        title: '蒙德与丽莎序章限定时点',
        content: WORLDVIEW_MONDSTADT,
        type: 'world_lore',
        injectMode: 'keyword_match',
        keywords: ['蒙德', '低语森林', '丽莎', '凯瑟琳', '班尼特', '深渊教团', '蒙德城', '风起地', '摘星崖'],
        priority: 209,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
      entry({
        id: 'builtin_worldview_factions',
        title: '主要势力关系',
        content: WORLDVIEW_FACTIONS,
        type: 'world_lore',
        injectMode: 'keyword_match',
        keywords: ['商会', '愚人众', '教令院', '深渊教团', '璃月', '镀金旅团', '势力', '组织'],
        priority: 205,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
      entry({
        id: 'builtin_worldview_travel_info',
        title: '提瓦特旅行与信息边界',
        content: WORLDVIEW_TRAVEL_INFO,
        type: 'system_rule',
        injectMode: 'keyword_match',
        keywords: ['传送', '提瓦特旅行', '航路', '权限', '通讯', '情报', '图鉴', '资料库', '去哪里', '前往'],
        priority: 204,
        enabled: true,
        scope: ['main', 'opening'],
      }, now),
    ],
    createdAt: now,
    updatedAt: now,
  };

  // 5. 元素纲要（B1-B3）
  const pathsBook: 世界书 = {
    id: 'builtin_paths_lore',
    title: '元素纲要',
    description: '元素总览（始终注入）+ 觉醒桥段 / 七执政与组织张力（关键词触发）。',
    enabled: true,
    entries: [
      entry({
        id: 'builtin_paths_overview',
        title: '元素总览',
        content: PATHS_OVERVIEW,
        type: 'world_lore',
        injectMode: 'always',
        keywords: [],
        priority: 200,
        enabled: true,
        scope: ['main'],
      }, now),
      entry({
        id: 'builtin_paths_threshold',
        title: '元素回响·觉醒桥段',
        content: PATHS_THRESHOLD,
        type: 'atmosphere',
        injectMode: 'keyword_match',
        keywords: ['元素', '七执政', '觉醒', '回响', '风元素', '岩元素', '雷元素', '草元素', '水元素', '火元素', '冰元素'],
        priority: 195,
        enabled: true,
        scope: ['main'],
      }, now),
      entry({
        id: 'builtin_paths_tension',
        title: '七执政与组织的张力',
        content: PATHS_TENSION,
        type: 'world_lore',
        injectMode: 'keyword_match',
        keywords: ['组织', '势力', '冲突', '敌人', '盟友', '璃月', '深渊', '公司', '深渊教团'],
        priority: 190,
        enabled: true,
        scope: ['main'],
      }, now),
    ],
    createdAt: now,
    updatedAt: now,
  };

  // 7. 图鉴世界书已迁移到提示词模块系统。
  //    图鉴系统调用 AI 时走自己的正式提示构建器，从 settings.promptModules 读取。
  //    此处不再生成旧图鉴世界书条目。

  // 8. 蒸汽鸟报世界书已迁移到提示词模块系统。
  //    蒸汽鸟报系统调用 AI 时走自己的正式提示构建器，从 settings.promptModules 读取。
  //    此处不再生成旧报刊世界书条目。

  // 9. 信使系统世界书已迁移到提示词模块系统（builtin_courier_worldbook）。
  //    信使系统调用 AI 时走自己的正式提示构建器，从 settings.promptModules 读取。
  //    此处不再生成旧通讯世界书条目。

  // 10. 原著轨道世界书已迁移到提示词模块系统（builtin_canon_worldbook）。
  //    剧情编织分解模型 AI 调用时走自己的 buildStoryWeavingSystemPrompt，从 settings.promptModules 读取。
  //    此处不再生成旧剧情轨道世界书条目；分解模型从原著轨道模块读取。

  // 11. 伙伴档案世界书已迁移到提示词模块系统（builtin_companion_archive_worldbook）。
  //    伙伴档案 AI 调用时走提示词模块拼接，从 settings.promptModules 读取。
  //    此处不再生成 builtin_companion_archive 世界书条目（死代码已清理，原 builtin_companion_archive_guideline entry 无检索逻辑读取）。

  // 12. NSFW 档案世界书已迁移到提示词模块系统（builtin_nsfw_archive_worldbook）。
  //    NSFW 档案 AI 调用时走提示词模块拼接，从 settings.promptModules 读取。
  //    此处不再生成 builtin_nsfw_archive 世界书条目（死代码已清理，原 builtin_nsfw_archive_worldbook entry 无检索逻辑读取）。

  // 13. 变量系统世界书已迁移到提示词模块系统（builtin_variable_worldbook）。
  //    变量系统 AI 调用时走提示词模块拼接，从 settings.promptModules 读取。
  //    此处不再生成 builtin_variable_system 世界书条目（死代码已清理，原 builtin_variable_system_worldbook entry 无检索逻辑读取）。

  return [compassBook, worldviewBook, pathsBook];
}
