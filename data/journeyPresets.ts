import type {
  官方开局预设,
  创意工坊开局模板,
  创意工坊开局模板包,
  地区自由开局引导,
  开局地区,
  开局章节锚点,
  能力预设,
  自由开局写作问题,
  阵营定义,
  难度定义,
  起始场景,
  剧情模式定义,
  开局模板,
} from '@/models/teyvat/opening';

// ── 开局模板库（W15）──
export const officialOpeningTemplates: 开局模板[] = [
  {
    id: 'official_mondstadt_dragon',
    name: '蒙德 · 风魔龙之影',
    source: 'official',
    description: '低语森林与风起地被龙灾笼罩，从特瓦林异变切入主线起点。',
    元素: 'anemo',
    阵营: 'adventurers_guild',
    起始场景: 'mondstadt_dragon_incident',
    开局文本: '龙吼撕开低语森林的雾霭，风车菊在劲风中伏倒。你握紧刚到手的神之眼，决定先弄清这片土地为何被龙灾笼罩。',
    tags: ['官方', '主线', '危机开场'],
  },
  {
    id: 'official_liyue_ritual',
    name: '璃月 · 请仙典仪',
    source: 'official',
    description: '请仙典仪上岩王帝君自天坠落，璃月港的契约与暗流同时压向你。',
    元素: 'geo',
    阵营: 'adventurers_guild',
    起始场景: 'liyue_ritual_incident',
    开局文本: '请仙典仪上，岩王帝君自天坠落。璃月港的钟声、千岩军的脚步声与往生堂的白色灯笼，同时朝你涌来。',
    tags: ['官方', '主线', '调查'],
  },
  {
    id: 'official_inazuma_decree',
    name: '稻妻 · 眼狩令',
    source: 'official',
    description: '雷暴封锁海域，勘定奉行收缴神之眼，反抗军的暗流在离岛酝酿。',
    元素: 'electro',
    阵营: 'none',
    起始场景: 'inazuma_vision_decree',
    开局文本: '雷暴封锁海域，勘定奉行正在收缴神之眼。你藏好自己的元素共鸣，决定先回答“永恒”为何要夺走愿望。',
    tags: ['官方', '主线', '压迫'],
  },
  {
    id: 'official_sumeru_dream',
    name: '须弥 · 虚空与梦境',
    source: 'official',
    description: '教令院的虚空终端低鸣不止，梦境的边界开始碎裂。',
    元素: 'dendro',
    阵营: 'akademiya',
    起始场景: 'sumeru_dream_incident',
    开局文本: '教令院的虚空终端低鸣不止，梦境的边界开始碎裂。你从一场不属于自己的梦里醒来。',
    tags: ['官方', '主线', '梦境'],
  },
  {
    id: 'official_fontaine_prophecy',
    name: '枫丹 · 预言之水',
    source: 'official',
    description: '原始胎海的水位随预言上涨，审判庭的钟声比海水更早抵达。',
    元素: 'hydro',
    阵营: 'none',
    起始场景: 'fontaine_prophecy',
    开局文本: '原始胎海的水位在预言中上涨，审判庭的钟声比海水更早抵达。你被卷入一场关于“溶解”的谜案。',
    tags: ['官方', '主线', '谜案'],
  },
  {
    id: 'official_natlan_war',
    name: '纳塔 · 深渊战火',
    source: 'official',
    description: '深渊的裂口在圣火下方张开，部族的战士把最后一道防线交到你手里。',
    元素: 'pyro',
    阵营: 'none',
    起始场景: 'natlan_war',
    开局文本: '深渊的裂口在圣火下方张开，部族的战士把最后一道防线交到你手里。',
    tags: ['官方', '主线', '战争'],
  },
];

export function 归一化开局模板(input: unknown): 开局模板 {
  const raw = (input ?? {}) as Partial<开局模板>;
  return {
    id: String(raw.id || ('player_' + Date.now())),
    name: String(raw.name || '未命名模板'),
    source: raw.source === 'official' ? 'official' : 'player',
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined,
    难度: typeof raw.难度 === 'string' && raw.难度.trim() ? raw.难度.trim() : undefined,
    元素: typeof raw.元素 === 'string' && raw.元素.trim() ? raw.元素.trim() : undefined,
    天赋: Array.isArray(raw.天赋) ? raw.天赋.map((talent) => ({ ...talent })) : undefined,
    阵营: typeof raw.阵营 === 'string' && raw.阵营.trim() ? raw.阵营.trim() : undefined,
    起始场景: typeof raw.起始场景 === 'string' && raw.起始场景.trim() ? raw.起始场景.trim() : undefined,
    开局文本: typeof raw.开局文本 === 'string' && raw.开局文本.trim() ? raw.开局文本.trim() : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    旅人: raw.旅人 ? { ...raw.旅人 } : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
}

export function normalizeOpeningTemplates(input: unknown): 开局模板[] {
  if (!Array.isArray(input)) return [];
  return input.map(归一化开局模板).filter((t) => Boolean(t.id) && Boolean(t.name));
}

export function getOpeningTemplateById(id: string): 开局模板 | undefined {
  return officialOpeningTemplates.find((t) => t.id === id);
}

// 重构期占位数据：命题/简介为草稿，等待玩家或编辑器打磨。

export const difficulties: 难度定义[] = [
  {
    id: 'easy',
    name: '简单',
    attributePoints: 30,
    description: '体力宽裕，战斗判定温和，剧情容错高。适合初次踏上旅程的旅人。',
  },
  {
    id: 'normal',
    name: '普通',
    attributePoints: 25,
    description: '标准的旅程体验。世界会回应你的选择，但不会处处宽容。',
  },
  {
    id: 'hard',
    name: '困难',
    attributePoints: 20,
    description: '体力与判定收紧。失误的代价会清晰地写在故事里。',
  },
  {
    id: 'extreme',
    name: '极限',
    attributePoints: 10,
    description: '资源稀缺、决断锋利。属于愿意承担高风险的旅人。',
  },
];

export function getDifficulty(id: string): 难度定义 | undefined {
  return difficulties.find((d) => d.id === id);
}

export const storyModes: 剧情模式定义[] = [
  {
    id: 'normal',
    name: '正常向',
    description: '没有特殊倾向，按主线剧情与人物关系的自然脉络推进。',
  },
  {
    id: 'harem',
    name: '后宫向',
    description: '叙述会更倾向于让多名异性角色对你产生兴趣与暧昧。',
  },
  {
    id: 'romance_alt',
    name: '百合 / BL 向',
    description: '同性向情感线路。具体走百合或 BL 由你的角色性别决定。',
  },
  {
    id: 'deep_single',
    name: '深度单线向',
    description: '鼓励你与某一位角色建立深度专属关系，AI 不会主动撒网。',
  },
];

export function getStoryMode(id: string): 剧情模式定义 | undefined {
  return storyModes.find((s) => s.id === id);
}

// ── 组织背景 ──
// 开局向导只把它作为叙事身份写入档案和首回合摘要,不创建阵营声望系统。
export const factions: 阵营定义[] = [
  {
    id: 'none',
    name: '无固定组织',
    shortName: '自由身份',
    description: '你不隶属于任何大型组织，可以是旅行者、佣兵、商队护卫或临时卷入者。',
    openingHint: '首回合不会默认给你组织支援，旁人会先按你的自定义身份与现场表现判断你。',
  },
  {
    id: 'akademiya',
    name: '教令院（须弥）',
    shortName: '教令院',
    description: '你与须弥教令院的学者、学派或知识网络有关，可以是学生、研究员、助手或被研究项目牵连的人。',
    openingHint: '建议在自定义身份里写清学派或导师关系，避免 AI 直接给出过高权限。',
  },
  {
    id: 'adventurers_guild',
    name: '冒险家协会',
    shortName: '冒险家协会',
    description: '你是冒险家协会的注册冒险家，与凯瑟琳及各地分会的委托网络有关。',
    openingHint: '首回合可体现委托、登记与悬赏，但不会默认协会完全保护你。',
  },
  {
    id: 'eremites',
    name: '镀金旅团',
    shortName: '镀金旅团',
    description: '你是沙漠中来去自由的镀金旅团成员或雇佣兵，以契约与本事谋生。',
    openingHint: '你会作为独立来客或临时同行者被看待，旅团名号不会自动换来信任。',
  },
];

export function getFaction(id: string): 阵营定义 | undefined {
  return factions.find((f) => f.id === id);
}

export const openingRegions: 开局地区[] = [
  {
    id: 'mondstadt',
    name: '蒙德',
    description: '风与自由的国度，西风骑士团与冒险家协会守护着龙灾下的城邦。',
    defaultLocationHint: '蒙德',
  },
  {
    id: 'liyue',
    name: '璃月',
    description: '契约与商船之城，岩王帝君“陨落”后，七星与千岩军撑起整座港口。',
    defaultLocationHint: '璃月港',
  },
  {
    id: 'inazuma',
    name: '稻妻',
    description: '雷暴封锁的群岛之国，眼狩令与永恒之道笼罩着每一座岛屿。',
    defaultLocationHint: '稻妻',
  },
  {
    id: 'sumeru',
    name: '须弥',
    description: '智慧与雨林并存的国度，教令院的虚空终端掌控着知识的流向。',
    defaultLocationHint: '须弥',
  },
  {
    id: 'fontaine',
    name: '枫丹',
    description: '水与审判之城，预言之水与机械发明并存，蒸汽鸟报在此发行。',
    defaultLocationHint: '枫丹廷',
  },
  {
    id: 'natlan',
    name: '纳塔',
    description: '圣火与战争之邦，部族勇士对抗着日益逼近的深渊裂口。',
    defaultLocationHint: '纳塔',
  },
];

export const openingChapterAnchors: 开局章节锚点[] = [
  {
    id: 'mondstadt_dragon_incident',
    regionId: 'mondstadt',
    name: '风魔龙之影',
    summary: '风魔龙特瓦林在低语森林上空咆哮，深渊教团的阴谋与四风守护的传承同时浮现。',
    officialChapterName: '序章·蒙德「捕风的异乡人」',
    officialChapterPhase: '序章前段',
    priorStoryState: '这是当前可选主线最早锚点，不存在需要跳过的前置主线。正文应从龙灾与低语森林危机切入。',
    defaultLocationHint: '蒙德 · 低语森林或风起地',
    keyNpcs: ['派蒙', '安柏', '凯亚', '温迪', '琴'],
    loreKeywords: ['蒙德', '风魔龙', '深渊教团', '西风骑士团', '四风守护'],
    openingPressure: ['龙灾', '骑士团戒严', '深渊教团阴影', '异乡人失忆'],
  },
  {
    id: 'liyue_ritual_incident',
    regionId: 'liyue',
    name: '请仙典仪',
    summary: '请仙典仪上岩王帝君自天坠落，璃月港的契约秩序与暗流同时逼近摊牌。',
    officialChapterName: '第一章·璃月「辞行久远之躯」',
    officialChapterPhase: '第一章前段',
    priorStoryState: '蒙德序章已作为背景前置处理，不进入正文转跳推进；正文直接从请仙典仪后的璃月港展开。',
    defaultLocationHint: '璃月港 · 玉京台或码头',
    keyNpcs: ['钟离', '凝光', '刻晴', '甘雨', '魈', '胡桃'],
    loreKeywords: ['请仙典仪', '岩王帝君', '璃月七星', '千岩军', '往生堂'],
    openingPressure: ['帝君陨落', '七星接管', '愚人众异动', '契约疑云'],
  },
  {
    id: 'inazuma_vision_decree',
    regionId: 'inazuma',
    name: '眼狩令',
    summary: '雷暴封锁海域，勘定奉行收缴神之眼，反抗军的暗流在离岛与鸣神岛之间酝酿。',
    officialChapterName: '第二章·稻妻「不动鸣神，恒常乐土」',
    officialChapterPhase: '第二章前段',
    priorStoryState: '蒙德与璃月主线已作为背景前置处理，不进入正文转跳推进；正文直接从离岛盘查与眼狩令展开。',
    defaultLocationHint: '稻妻 · 离岛或鸣神岛',
    keyNpcs: ['雷电将军', '八重神子', '神里绫华', '托马', '珊瑚宫心海', '枫原万叶'],
    loreKeywords: ['眼狩令', '雷暴', '三奉行', '海祇反抗军', '神之眼'],
    openingPressure: ['眼狩令', '锁国令', '奉行盘查', '愿望被夺'],
  },
  {
    id: 'sumeru_dream_incident',
    regionId: 'sumeru',
    name: '虚空与梦境',
    summary: '教令院的虚空终端低鸣不止，梦境的边界开始碎裂，你从一场不属于自己的梦里醒来。',
    officialChapterName: '第三章·须弥「虚空鼓动，劫火高扬」',
    officialChapterPhase: '第三章前段',
    priorStoryState: '此前主线已作为背景前置处理；正文直接从须弥城、梦境异常与世界树的低语展开。',
    defaultLocationHint: '须弥 · 须弥城或雨林边缘',
    keyNpcs: ['纳西妲', '提纳里', '赛诺', '艾尔海森', '迪希雅'],
    loreKeywords: ['虚空终端', '教令院', '梦境', '世界树', '禁忌知识'],
    openingPressure: ['梦境异动', '教令院管控', '雨林异常', '世界树低语'],
  },
  {
    id: 'fontaine_prophecy',
    regionId: 'fontaine',
    name: '预言之水',
    summary: '原始胎海的水位随预言上涨，审判庭的钟声比海水更早抵达，你被卷入“溶解”谜案。',
    officialChapterName: '第四章·枫丹「谕示裁定枢机」',
    officialChapterPhase: '第四章前段',
    priorStoryState: '此前主线已作为背景前置处理；正文直接从枫丹廷、审判庭与原始胎海线索展开。',
    defaultLocationHint: '枫丹廷 · 歌剧院或港口',
    keyNpcs: ['芙宁娜', '那维莱特', '林尼', '琳妮特', '夏洛蒂', '克洛琳德'],
    loreKeywords: ['预言', '原始胎海', '枫丹廷', '蒸汽鸟报', '审判'],
    openingPressure: ['预言恐慌', '溶解谜案', '水神审判', '魔术与暗流'],
  },
  {
    id: 'natlan_war',
    regionId: 'natlan',
    name: '深渊战火',
    summary: '深渊的裂口在圣火下方张开，部族的战士把最后一道防线交到你手里。',
    officialChapterName: '第五章·纳塔「深渊之战」',
    officialChapterPhase: '第五章前段',
    priorStoryState: '此前主线已作为背景前置处理；正文直接从圣火、裂口与部族防线展开。',
    defaultLocationHint: '纳塔 · 圣火广场或部族营地',
    keyNpcs: ['玛薇卡', '基尼奇', '玛拉妮', '卡齐娜', '希诺宁'],
    loreKeywords: ['圣火', '深渊裂口', '夜神之国', '部族', '战争'],
    openingPressure: ['深渊入侵', '圣火黯淡', '部族分歧', '战争阴影'],
  },
];

export const officialOpeningPresets: 官方开局预设[] = [
  {
    id: 'official_mondstadt_dragon',
    source: 'official_preset',
    regionId: 'mondstadt',
    regionName: '蒙德',
    chapterId: 'mondstadt_dragon_incident',
    chapterName: '风魔龙之影',
    title: '蒙德 · 风魔龙之影',
    summary: '以低语森林龙灾、骑士团戒严与深渊教团阴影为背景，玩家作为异乡人切入蒙德主线起点。',
    defaultLocationHint: '蒙德 · 低语森林或风起地',
    keyNpcs: ['派蒙', '安柏', '凯亚', '温迪', '琴'],
    loreKeywords: ['蒙德', '风魔龙', '深渊教团', '西风骑士团', '四风守护'],
    openingPressure: ['龙灾', '骑士团戒严', '深渊教团阴影', '异乡人失忆'],
    recommendedEntryAngles: ['在低语森林被龙吼惊动', '受安柏邀请进入蒙德城', '以冒险家协会新人为名登记', '提前认识某位骑士团成员'],
  },
  {
    id: 'official_liyue_ritual',
    source: 'official_preset',
    regionId: 'liyue',
    regionName: '璃月',
    chapterId: 'liyue_ritual_incident',
    chapterName: '请仙典仪',
    title: '璃月 · 请仙典仪',
    summary: '以岩王帝君坠落、七星接管与愚人众异动为背景，玩家从璃月港的契约与暗流中切入。',
    defaultLocationHint: '璃月港 · 玉京台或码头',
    keyNpcs: ['钟离', '凝光', '刻晴', '甘雨', '魈', '胡桃'],
    loreKeywords: ['请仙典仪', '岩王帝君', '璃月七星', '千岩军', '往生堂'],
    openingPressure: ['帝君陨落', '七星接管', '愚人众异动', '契约疑云'],
    recommendedEntryAngles: ['作为观礼者目睹帝君坠落', '因商会委托抵达璃月港', '受千岩军盘查牵连', '与往生堂或胡桃产生交集'],
  },
  {
    id: 'official_inazuma_decree',
    source: 'official_preset',
    regionId: 'inazuma',
    regionName: '稻妻',
    chapterId: 'inazuma_vision_decree',
    chapterName: '眼狩令',
    title: '稻妻 · 眼狩令',
    summary: '以雷暴封锁、眼狩令与奉行盘查为背景，玩家从离岛或鸣神岛的压抑空气中切入。',
    defaultLocationHint: '稻妻 · 离岛或鸣神岛',
    keyNpcs: ['雷电将军', '八重神子', '神里绫华', '托马', '珊瑚宫心海', '枫原万叶'],
    loreKeywords: ['眼狩令', '雷暴', '三奉行', '海祇反抗军', '神之眼'],
    openingPressure: ['眼狩令', '锁国令', '奉行盘查', '愿望被夺'],
    recommendedEntryAngles: ['乘船在雷暴中抵达离岛', '藏匿神之眼躲避收缴', '接受神里家或反抗军的委托', '从万叶或托马线索切入'],
  },
  {
    id: 'official_sumeru_dream',
    source: 'official_preset',
    regionId: 'sumeru',
    regionName: '须弥',
    chapterId: 'sumeru_dream_incident',
    chapterName: '虚空与梦境',
    title: '须弥 · 虚空与梦境',
    summary: '以虚空终端、梦境异常与世界树低语为背景，玩家从一场不属于自己的梦里醒来。',
    defaultLocationHint: '须弥 · 须弥城或雨林边缘',
    keyNpcs: ['纳西妲', '提纳里', '赛诺', '艾尔海森', '迪希雅'],
    loreKeywords: ['虚空终端', '教令院', '梦境', '世界树', '禁忌知识'],
    openingPressure: ['梦境异动', '教令院管控', '雨林异常', '世界树低语'],
    recommendedEntryAngles: ['在教令院外的长椅上醒来', '因梦境记忆被巡林队盘问', '受提纳里委托调查雨林异常', '从虚空终端故障切入'],
  },
  {
    id: 'official_fontaine_prophecy',
    source: 'official_preset',
    regionId: 'fontaine',
    regionName: '枫丹',
    chapterId: 'fontaine_prophecy',
    chapterName: '预言之水',
    title: '枫丹 · 预言之水',
    summary: '以预言、原始胎海与审判庭为背景，玩家从枫丹廷的钟声与暗流中切入。',
    defaultLocationHint: '枫丹廷 · 歌剧院或港口',
    keyNpcs: ['芙宁娜', '那维莱特', '林尼', '琳妮特', '夏洛蒂', '克洛琳德'],
    loreKeywords: ['预言', '原始胎海', '枫丹廷', '蒸汽鸟报', '审判'],
    openingPressure: ['预言恐慌', '溶解谜案', '水神审判', '魔术与暗流'],
    recommendedEntryAngles: ['以观众身份旁听审判', '收到夏洛蒂的采访邀约', '追踪原始胎海传闻', '被林尼的魔术表演卷入'],
  },
  {
    id: 'official_natlan_war',
    source: 'official_preset',
    regionId: 'natlan',
    regionName: '纳塔',
    chapterId: 'natlan_war',
    chapterName: '深渊战火',
    title: '纳塔 · 深渊战火',
    summary: '以圣火黯淡与深渊裂口为背景，玩家从纳塔部族的最后一道防线切入。',
    defaultLocationHint: '纳塔 · 圣火广场或部族营地',
    keyNpcs: ['玛薇卡', '基尼奇', '玛拉妮', '卡齐娜', '希诺宁'],
    loreKeywords: ['圣火', '深渊裂口', '夜神之国', '部族', '战争'],
    openingPressure: ['深渊入侵', '圣火黯淡', '部族分歧', '战争阴影'],
    recommendedEntryAngles: ['作为外来支援者抵达战场', '随基尼奇的狩猎队行动', '因部族委托护送物资', '从深渊裂口异变切入'],
  },
];

export const freeOpeningWritingQuestions: 自由开局写作问题[] = [
  {
    id: 'identity',
    title: '你是谁',
    description: '写清身份、来历、阵营关系和别人第一眼会怎样判断你。',
    examples: ['旅途中迷路的异乡人', '受雇调查地脉异动的冒险家', '持有邀请函的枫丹宾客'],
  },
  {
    id: 'reason',
    title: '你为什么在这里',
    description: '给出抵达当前地区的原因，最好能和委托、事故、调查、邀请或逃亡相连。',
    examples: ['收到凯瑟琳的委托信', '追踪一枚异常的地脉之花', '被某位角色邀请同行'],
  },
  {
    id: 'entry_scene',
    title: '从哪里开始',
    description: '指定初始地点、事件前后或第一个可互动对象，避免开局只剩背景介绍。',
    examples: ['蒙德城门盘查口', '璃月码头货栈旁', '枫丹歌剧院入场通道'],
  },
  {
    id: 'relationships',
    title: '你认识谁',
    description: '说明和重要角色是陌生、见过、合作过、亲近还是有矛盾。没有写明就默认陌生或初识。',
    examples: ['与安柏有过一次狩猎合作', '只在图鉴中见过钟离', '和迪希雅互相试探但谈不上信任'],
  },
  {
    id: 'tone',
    title: '你想要什么氛围',
    description: '选择日常、悬疑、战斗、暧昧、调查、轻松或压迫感，让首回合更贴近玩法。',
    examples: ['偏调查和悬疑', '先日常相处再进入主线', '直接从危机现场开场'],
  },
];

export const freeOpeningGuides: 地区自由开局引导[] = [
  {
    regionId: 'mondstadt',
    overview: '蒙德适合写成龙灾余波、骑士团委托、冒险家协会日常、风花节筹备或低语森林异变。',
    identityHints: ['异乡旅行者', '冒险家协会新人', '商队随行者', '被龙吼惊动的迷路人'],
    entryAngles: ['在低语森林被风魔龙惊动', '在蒙德城门口接受安柏问询', '接到凯瑟琳的委托', '在天使的馈赠与迪卢克相遇'],
    relationshipHints: ['可以提前认识安柏、凯亚或派蒙', '与琴、迪卢克等高层需写清相识理由', '不要默认与骑士团已经非常熟'],
    pacingHints: ['适合快速建立龙灾与行动压力', '若想日常开局，可写在风花节前或冒险家协会委托现场'],
    cautionNotes: ['只有选择蒙德地区时才默认龙灾危机', '旅行者是否登场仍由原著主角选择控制'],
    sampleTexts: ['我是刚到蒙德的异乡旅人，在低语森林采集风车菊时听见龙吼，安柏的箭矢擦过我头顶，她喊着让我快离开这片树林。'],
  },
  {
    regionId: 'liyue',
    overview: '璃月适合写成请仙典仪余波、商会委托、千岩军盘查、层岩巨渊传闻或海灯节筹备。',
    identityHints: ['外来旅人', '商队护卫', '冒险家协会委托者', '往生堂临时雇员'],
    entryAngles: ['目睹帝君自天坠落', '在码头货栈接受盘查', '因商会委托抵达璃月港', '在万民堂与香菱相遇'],
    relationshipHints: ['可写与香菱、行秋或胡桃的已知关系', '凝光、刻晴等七星高层不会无条件信任玩家'],
    pacingHints: ['日常可从码头、茶室或万民堂开始', '主线压力可从请仙典仪疑云、愚人众异动或契约争端开始'],
    cautionNotes: ['不要把所有璃月角色一开场就围在玩家身边', '七星权限、千岩军戒严和往生堂业务都需要合理理由'],
    sampleTexts: ['我是随商船抵达璃月的护卫，刚在码头交完货，就听见玉京台方向传来钟声与骚动——请仙典仪出了大事。'],
  },
  {
    regionId: 'inazuma',
    overview: '稻妻适合写成雷暴渡海、眼狩令、奉行盘查、反抗军暗流或鸣神大社委托。',
    identityHints: ['偷渡旅客', '藏匿神之眼的人', '商会随行人员', '被雷暴冲散的水手'],
    entryAngles: ['在离岛接受勘定奉行盘查', '从雷暴中的海岸醒来', '受神里家或万叶线索引导', '在稻妻城目睹收缴神之眼'],
    relationshipHints: ['可以提前认识托马、万叶或宵宫', '雷电将军与八重神子不会轻易放下永恒立场'],
    pacingHints: ['想慢热可从离岛商馆或长野原烟花店开始', '想紧张可从眼狩令收缴、奉行追捕或反抗军行动开始'],
    cautionNotes: ['眼狩令的压迫感要保留，但自由开局可以弱化主线', '不要默认所有神之眼持有者都信任玩家'],
    sampleTexts: ['我藏好神之眼挤在渔船里抵达离岛，勘定奉行的登记官盯着我的行李看了很久，托马正好从码头经过，朝我点了点头。'],
  },
  {
    regionId: 'sumeru',
    overview: '须弥适合写成梦境异常、教令院学术委托、雨林巡林、沙漠商队或虚空终端故障。',
    identityHints: ['外地学者', '巡林队协助者', '沙漠商队成员', '从梦里醒来的陌生人'],
    entryAngles: ['在须弥城长椅上醒来', '因虚空终端异常被教令院问询', '受提纳里委托调查雨林', '随迪希雅护送商队穿越沙漠'],
    relationshipHints: ['可写与提纳里、柯莱或迪希雅的初始关系', '教令院学者、大风纪官赛诺有各自边界'],
    pacingHints: ['日常可从咖啡馆、雨林营地或大巴扎开始', '悬疑可从梦境重复、知识禁忌或世界树低语开始'],
    cautionNotes: ['不要随意使用“禁忌知识”作为万能背景', '虚空终端的权限与教令院管控需要合理理由'],
    sampleTexts: ['我在须弥城的树下醒来，手心还残留着梦里的雨。虚空终端显示了一段不属于我的记忆，提纳里刚好巡林回来，看见我的脸色不太对。'],
  },
  {
    regionId: 'fontaine',
    overview: '枫丹适合写成审判旁听、预言传闻、蒸汽鸟报采访、机械发明或原始胎海线索。',
    identityHints: ['外地游客', '蒸汽鸟报临时写手', '机械工坊学徒', '被卷入谜案的人'],
    entryAngles: ['在歌剧院旁听审判', '收到夏洛蒂的采访邀约', '在港口发现异常水位', '被林尼的魔术表演卷入'],
    relationshipHints: ['可写与夏洛蒂、林尼或娜维娅的初始关系', '那维莱特与芙宁娜的立场需要谨慎处理'],
    pacingHints: ['日常可从咖啡馆、工坊或海滨大道开始', '悬疑可从溶解传闻、预言恐慌或审判证据开始'],
    cautionNotes: ['预言与原始胎海是主线级设定，自由开局中只作背景', '不要默认玩家与逐影庭或最高审判官熟悉'],
    sampleTexts: ['我是来枫丹廷采风的旅行者，第一天就在歌剧院旁听了一场审判。散场时夏洛蒂拦住我，说我的留影机拍到了一些有趣的东西。'],
  },
  {
    regionId: 'natlan',
    overview: '纳塔适合写成深渊裂口、部族委托、圣火仪式、狩猎队行动或战争边缘的日常。',
    identityHints: ['外来支援者', '部族客人', '狩猎队随行者', '被圣火指引的旅人'],
    entryAngles: ['抵达圣火广场时警报响起', '随基尼奇狩猎队行动', '受部族委托运送物资', '在裂口边缘发现异常'],
    relationshipHints: ['可写与玛拉妮、卡齐娜或基尼奇的初始关系', '玛薇卡作为火之执政有明确的职责边界'],
    pacingHints: ['战争压力可从深渊裂口、部族集结开始', '想慢热可从圣火庆典、部族市集或训练场开始'],
    cautionNotes: ['深渊战争是主线级设定，自由开局中保持为背景威胁', '部族传统与圣火规则不要随意改写'],
    sampleTexts: ['我跟着商队进入纳塔时，圣火广场的钟声正在敲响。卡齐娜跑过来说裂口又扩大了，她问我愿不愿意先帮她搬一批矿石。'],
  },
];

export const workshopOpeningTemplates: 创意工坊开局模板[] = [
  {
    id: 'workshop_mondstadt_commission',
    source: 'workshop',
    title: '蒙德 · 委托与龙影',
    author: 'system',
    version: '0.1.0',
    regionId: 'mondstadt',
    chapterId: 'mondstadt_dragon_incident',
    summary: '玩家以冒险家协会委托人或低语森林调查者的身份切入蒙德，在龙灾阴影下完成第一份委托。',
    defaultLocationHint: '蒙德 · 冒险家协会门口',
    keyNpcs: ['安柏', '凯亚', '派蒙', '琴'],
    loreKeywords: ['蒙德', '冒险家协会', '低语森林', '风魔龙', '委托'],
    openingPressure: ['龙灾警报', '委托时限', '骑士团戒严'],
    tags: ['蒙德', '委托', '危机切入', '冒险家'],
    playerEntryTemplate: '我是{身份}，因为{来到此地原因}进入蒙德。开局从{起始地点}开始，我与{已认识角色}的关系是{初始关系}。本开局希望{叙事倾向}。',
    editableFields: [
      { id: '身份', label: '身份', placeholder: '例如：冒险家协会新人、异乡旅人、临时护卫', required: true },
      { id: '来到此地原因', label: '来到此地原因', placeholder: '例如：接到委托、寻找失散同伴、躲避风暴', required: true },
      { id: '起始地点', label: '起始地点', placeholder: '例如：蒙德城门、低语森林、天使的馈赠' },
      { id: '已认识角色', label: '已认识角色', placeholder: '例如：安柏、凯亚；不认识可写“暂无”' },
      { id: '初始关系', label: '初始关系', placeholder: '例如：临时协作、远程联系过、只是档案里见过' },
      { id: '叙事倾向', label: '叙事倾向', placeholder: '例如：委托调查、龙灾救援、先日常后危机', multiline: true },
    ],
  },
  {
    id: 'workshop_liyue_caravan',
    source: 'workshop',
    title: '璃月 · 商队来客',
    author: 'system',
    version: '0.1.0',
    regionId: 'liyue',
    chapterId: 'liyue_ritual_incident',
    summary: '玩家以商队护卫或码头雇员身份抵达璃月港，在请仙典仪余波与契约争端中切入。',
    defaultLocationHint: '璃月港 · 码头货栈',
    keyNpcs: ['香菱', '行秋', '胡桃', '凝光'],
    loreKeywords: ['璃月港', '商队', '千岩军', '请仙典仪', '契约'],
    openingPressure: ['货物异常', '千岩军盘查', '帝君陨落余波'],
    tags: ['璃月', '日常切入', '商会', '可慢热'],
    playerEntryTemplate: '我是{身份}，因{来到此地原因}抵达璃月。开局从码头的货运交接开始，我和{已认识角色}的关系是{初始关系}。本开局希望{叙事倾向}。',
    editableFields: [
      { id: '身份', label: '身份', placeholder: '例如：商队护卫、码头雇员、外来旅人', required: true },
      { id: '来到此地原因', label: '来到此地原因', placeholder: '例如：护送一批货物、寻找失联商船、受人委托', required: true },
      { id: '已认识角色', label: '已认识角色', placeholder: '例如：香菱、行秋；不认识可写“暂无”' },
      { id: '初始关系', label: '初始关系', placeholder: '例如：见过一面、互相欠人情、只是听说过' },
      { id: '叙事倾向', label: '叙事倾向', placeholder: '例如：先日常后主线，偏调查和轻松互动', multiline: true },
    ],
  },
  {
    id: 'workshop_inazuma_escort',
    source: 'workshop',
    title: '稻妻 · 渡海护送',
    author: 'system',
    version: '0.1.0',
    regionId: 'inazuma',
    chapterId: 'inazuma_vision_decree',
    summary: '玩家从雷暴渡海、离岛盘查或神之眼藏匿者支线切入，适合慢热关系与锁国氛围。',
    defaultLocationHint: '稻妻 · 离岛码头',
    keyNpcs: ['托马', '枫原万叶', '宵宫', '神里绫华'],
    loreKeywords: ['离岛', '雷暴', '眼狩令', '神之眼', '三奉行'],
    openingPressure: ['渡海检查', '奉行盘查', '雷暴天气'],
    tags: ['稻妻', '离岛', '支线生活', '关系慢热'],
    playerEntryTemplate: '我是{身份}，因为{来到此地原因}来到稻妻。开局地点在离岛码头附近，我与{已认识角色}的关系是{初始关系}，希望故事{叙事倾向}。',
    editableFields: [
      { id: '身份', label: '身份', placeholder: '例如：偷渡旅客、商会随行、藏匿神之眼的人', required: true },
      { id: '来到此地原因', label: '来到此地原因', placeholder: '例如：渡海探亲、运送物资、躲避追捕', required: true },
      { id: '已认识角色', label: '已认识角色', placeholder: '例如：托马、万叶、宵宫' },
      { id: '初始关系', label: '初始关系', placeholder: '例如：被救助过、合作过、互相怀疑' },
      { id: '叙事倾向', label: '叙事倾向', placeholder: '例如：偏日常照料、锁国调查、逐步介入主线', multiline: true },
    ],
  },
  {
    id: 'workshop_sumeru_dream_investigation',
    source: 'workshop',
    title: '须弥 · 梦境调查',
    author: 'system',
    version: '0.1.0',
    regionId: 'sumeru',
    chapterId: 'sumeru_dream_incident',
    summary: '玩家从梦境异常、虚空终端故障或巡林委托切入须弥，适合悬疑与知识主题。',
    defaultLocationHint: '须弥 · 须弥城或雨林边缘',
    keyNpcs: ['提纳里', '柯莱', '赛诺', '纳西妲'],
    loreKeywords: ['须弥', '虚空终端', '梦境', '巡林队', '世界树'],
    openingPressure: ['梦境异常', '教令院问询', '雨林异动'],
    tags: ['须弥', '梦境', '悬疑', '知识'],
    playerEntryTemplate: '我是{身份}，持有一段{记忆异常}的记忆在须弥醒来。开局从{起始地点}开始，我与{已认识角色}的关系是{初始关系}。本开局希望{叙事倾向}。',
    editableFields: [
      { id: '身份', label: '身份', placeholder: '例如：外地学者、巡林协助者、梦游者', required: true },
      { id: '记忆异常', label: '记忆异常', placeholder: '例如：不属于自己的梦、重复的一天、虚空推送的片段', required: true },
      { id: '已认识角色', label: '已认识角色', placeholder: '例如：提纳里、柯莱、赛诺；不认识可写“暂无”' },
      { id: '初始关系', label: '初始关系', placeholder: '例如：互相试探、刚见面、对方似乎知道你的来历' },
      { id: '叙事倾向', label: '叙事倾向', placeholder: '例如：悬疑调查、雨林日常、梦境异常逐步升级', multiline: true },
    ],
  },
];

export const workshopOpeningTemplatePacks: 创意工坊开局模板包[] = [
  {
    schema: 'teyvat-opening-workshop-pack',
    version: '0.1.0',
    title: '提瓦特开局样例包',
    author: 'system',
    description: '内置示例包，便于后续创意工坊导入导出校验。',
    tags: ['示例', '开局', '创意工坊'],
    templates: workshopOpeningTemplates,
  },
];

// ── 能力预设 ──
// 开局特质：偏向提瓦特世界观中的元素、料理、旷野与图鉴适性。
export const abilityPresets: 能力预设[] = [
  {
    id: 'element_resonance',
    name: '元素共鸣',
    description: '你与元素力的共鸣更清晰，危机或抉择中更容易感知元素痕迹，但它不会替你预警或代替你的选择。',
  },
  {
    id: 'vision_intuition',
    name: '神之眼直觉',
    description: '你对神之眼、元素残留与地脉异常更敏感，常能从细微信号里找到可用线索。',
  },
  {
    id: 'culinary_alchemy',
    name: '料理与炼金',
    description: '你擅长辨认食材、调配药剂与修复简单机关，在旅途与委托中更不容易被补给问题难倒。',
  },
  {
    id: 'wilderness_craft',
    name: '旷野生存',
    description: '你熟悉风之翼滑翔、攀爬、扎营与辨认方向，适合在七国的旷野与秘境中行动。',
  },
  {
    id: 'archive_memory',
    name: '图鉴考据',
    description: '你对资料、档案与人物细节有出色的整理能力，适合在剧情中承担记录、推理与复盘。',
  },
  {
    id: 'reaction_sense',
    name: '元素反应敏锐',
    description: '你擅长观察元素之间的相互作用，能在战斗与解谜中更快想到蒸发、冻结、扩散等反应的用法。',
  },
];

// ── 起始地点 / 官方章节锚点 ──
// 多开局重构后，这里暴露各地区的官方章节入口。
// 自由开局与创意工坊会通过开局档案承接玩家自定义切入，不再把蒙德作为唯一默认路线。
export const startingScenarios: 起始场景[] = [
  {
    id: 'mondstadt_dragon_incident',
    name: '蒙德 · 风魔龙之影',
    description: '低语森林的雾霭被龙吼撕开，风魔龙特瓦林在天空盘旋。所选旅行者尚未登场，西风骑士团与冒险家协会正在戒备；玩家会以自定义身份切入这场龙灾。',
    officialPresetId: 'official_mondstadt_dragon',
    openingHighlights: [
      '风魔龙在低语森林与风起地上空盘旋，龙灾笼罩蒙德。',
      '西风骑士团开始戒严，冒险家协会的委托激增。',
      '安柏与凯亚会在最早的关键交点出现。',
      '旅行者会以自定义身份接入这场危机，成为原著之外的新变量。',
    ],
  },
  {
    id: 'liyue_ritual_incident',
    name: '璃月 · 请仙典仪',
    description: '请仙典仪上岩王帝君自天坠落，璃月港的钟声、千岩军的脚步与往生堂的白色灯笼同时涌来。玩家从契约与暗流交错的璃月港切入。',
    officialPresetId: 'official_liyue_ritual',
    openingHighlights: [
      '岩王帝君在请仙典仪上坠落，璃月七星接管局面。',
      '千岩军封锁玉京台，愚人众在港口活动频繁。',
      '钟离、凝光与胡桃会成为最早的关键交点。',
      '契约、贸易与仙神的旧秩序同时受到考验。',
    ],
  },
  {
    id: 'inazuma_vision_decree',
    name: '稻妻 · 眼狩令',
    description: '雷暴封锁海域，勘定奉行正在收缴神之眼。玩家藏好自己的元素共鸣，从离岛盘查与永恒之道的阴影中切入。',
    officialPresetId: 'official_inazuma_decree',
    openingHighlights: [
      '锁国令下的雷暴让渡海异常危险。',
      '眼狩令让神之眼持有者隐姓埋名。',
      '托马、万叶或宵宫会成为最早的关键交点。',
      '“永恒”为何要夺走愿望，是贯穿开局的问题。',
    ],
  },
  {
    id: 'sumeru_dream_incident',
    name: '须弥 · 虚空与梦境',
    description: '教令院的虚空终端低鸣不止，梦境的边界开始碎裂，玩家从一场不属于自己的梦里醒来，卷入知识与禁忌的漩涡。',
    officialPresetId: 'official_sumeru_dream',
    openingHighlights: [
      '虚空终端出现异常，梦境的边界开始碎裂。',
      '教令院加强管控，雨林中流传着世界树的低语。',
      '提纳里、赛诺或纳西妲会成为最早的关键交点。',
      '禁忌知识与梦境记忆的边界逐渐模糊。',
    ],
  },
  {
    id: 'fontaine_prophecy',
    name: '枫丹 · 预言之水',
    description: '原始胎海的水位在预言中上涨，审判庭的钟声比海水更早抵达。玩家从枫丹廷的审判与“溶解”谜案中切入。',
    officialPresetId: 'official_fontaine_prophecy',
    openingHighlights: [
      '预言让枫丹廷笼罩在恐慌之中。',
      '原始胎海的线索指向“溶解”谜案。',
      '夏洛蒂、林尼或那维莱特会成为最早的关键交点。',
      '水神审判与机械发明同时装点这座水之城。',
    ],
  },
  {
    id: 'natlan_war',
    name: '纳塔 · 深渊战火',
    description: '深渊的裂口在圣火下方张开，部族的战士把最后一道防线交到玩家手里。战争与圣火同时考验着纳塔。',
    officialPresetId: 'official_natlan_war',
    openingHighlights: [
      '深渊裂口在圣火下方张开，部族开始集结。',
      '圣火黯淡，夜神之国的传闻在营地流传。',
      '玛薇卡、基尼奇或玛拉妮会成为最早的关键交点。',
      '战争阴影下，日常与委托依然在继续。',
    ],
  },
];

export function getStartingScenario(id: string): 起始场景 | undefined {
  return startingScenarios.find((s) => s.id === id);
}

export function getOpeningRegion(id: string): 开局地区 | undefined {
  return openingRegions.find((region) => region.id === id);
}

export function getOpeningChapterAnchor(id: string): 开局章节锚点 | undefined {
  return openingChapterAnchors.find((chapter) => chapter.id === id);
}

export function getOfficialOpeningPreset(id: string): 官方开局预设 | undefined {
  return officialOpeningPresets.find((preset) => preset.id === id);
}

export function getOfficialOpeningPresetByChapterId(chapterId: string): 官方开局预设 | undefined {
  return officialOpeningPresets.find((preset) => preset.chapterId === chapterId);
}

export function getOfficialOpeningPresetsByRegion(regionId: string): 官方开局预设[] {
  return officialOpeningPresets.filter((preset) => preset.regionId === regionId);
}

export function getFreeOpeningGuide(regionId: string): 地区自由开局引导 | undefined {
  return freeOpeningGuides.find((guide) => guide.regionId === regionId);
}

export function getWorkshopOpeningTemplate(id: string): 创意工坊开局模板 | undefined {
  return workshopOpeningTemplates.find((template) => template.id === id);
}

export function getWorkshopOpeningTemplatesByRegion(regionId: string): 创意工坊开局模板[] {
  return workshopOpeningTemplates.filter((template) => template.regionId === regionId);
}

export function getWorkshopOpeningTemplatePack(schema = 'teyvat-opening-workshop-pack'): 创意工坊开局模板包 | undefined {
  return workshopOpeningTemplatePacks.find((pack) => pack.schema === schema);
}

export function getOpeningScenarioBundle(scenarioId: string): {
  region?: 开局地区;
  chapter?: 开局章节锚点;
  preset?: 官方开局预设;
} {
  const chapter = getOpeningChapterAnchor(scenarioId);
  const preset = getOfficialOpeningPresetByChapterId(scenarioId)
    ?? (chapter ? getOfficialOpeningPresetByChapterId(chapter.id) : undefined)
    ?? officialOpeningPresets.find((item) => item.chapterId === scenarioId || item.regionId === chapter?.regionId);
  const region = chapter ? getOpeningRegion(chapter.regionId) : preset ? getOpeningRegion(preset.regionId) : undefined;
  return { region, chapter, preset };
}
