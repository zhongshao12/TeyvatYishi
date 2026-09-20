// 原著角色库。NPC 首次进入档案时会用 matchCanonical 自动识别为原著角色 → tier='companion'。
// 这里只保留高频基础识别信息；精修人设与地区扩展由图鉴档案负责召回。

export interface CanonicalCharacterDef {
  name: string;
  aliases?: string[];
  gender?: '男' | '女' | '其他';
  appearance?: string;
  personality?: string;
}

export const CANONICAL_CHARACTERS: CanonicalCharacterDef[] = [
  {
    name: '派蒙',
    aliases: ['Paimon', '应急食品'],
    gender: '其他',
    appearance: '漂浮在空中的小巧白色飞行伙伴，帽檐与披风带有星空纹样。',
    personality: '贪吃、话多、机灵，既是向导也是吐槽担当。',
  },
  {
    name: '空',
    aliases: ['Aether'],
    gender: '男',
    appearance: '金发少年旅行者，白色异域服饰，剑术利落。',
    personality: '温和坚定，重视血亲，旅途中保持好奇与克制。',
  },
  {
    name: '荧',
    aliases: ['Lumine'],
    gender: '女',
    appearance: '金发少女旅行者，白色异域服饰，身姿轻盈。',
    personality: '冷静果敢，重视血亲，旅途中保持好奇与克制。',
  },
  {
    name: '安柏',
    aliases: ['Amber', '侦察骑士'],
    gender: '女',
    appearance: '红棕色短发少女，西风骑士团制服，背着兔兔伯爵与弓。',
    personality: '热情外向，行动力强，蒙德城最可靠的侦察骑士。',
  },
  {
    name: '凯亚',
    aliases: ['Kaeya', '骑兵队长'],
    gender: '男',
    appearance: '深蓝短发，眼罩遮住一只眼，西风骑士团制服。',
    personality: '风趣圆滑，藏得深，话里有话。',
  },
  {
    name: '丽莎',
    aliases: ['Lisa', '蔷薇魔女'],
    gender: '女',
    appearance: '紫发成熟女性，西风骑士团图书管理员，魔法书随身。',
    personality: '慵懒博学，喜欢捉弄人但教学认真。',
  },
  {
    name: '琴',
    aliases: ['Jean', '蒲公英骑士'],
    gender: '女',
    appearance: '金发蓝眼，西风骑士团代理团长，剑术沉稳。',
    personality: '责任感极强，工作狂，内心柔软。',
  },
  {
    name: '迪卢克',
    aliases: ['Diluc', '晨曦酒庄', '暗夜英雄'],
    gender: '男',
    appearance: '红发青年，黑色礼服，双手大剑，眼神疏离。',
    personality: '外冷内热，对蒙德的黑暗面有自己的处理方式。',
  },
  {
    name: '温迪',
    aliases: ['Venti', '巴巴托斯', '风神'],
    gender: '男',
    appearance: '翠绿披风与贝雷帽的吟游诗人，怀抱竖琴。',
    personality: '自由散漫，爱开玩笑，关键时刻可靠。',
  },
  {
    name: '芭芭拉',
    aliases: ['Barbara'],
    gender: '女',
    appearance: '金发双马尾，西风教会祈礼牧师，治疗与歌声。',
    personality: '温柔开朗，努力让歌声治愈他人。',
  },
  {
    name: '可莉',
    aliases: ['Klee', '火花骑士'],
    gender: '女',
    appearance: '红色双马尾小女孩，背着蹦蹦炸弹。',
    personality: '天真活泼，破坏力惊人，总被关禁闭。',
  },
  {
    name: '菲谢尔',
    aliases: ['Fischl', '断罪皇女'],
    gender: '女',
    appearance: '金发异色瞳少女，鸦羽服饰，自称“断罪之皇女”。',
    personality: '中二台词多，内心其实细腻害羞。',
  },
  {
    name: '班尼特',
    aliases: ['Bennett'],
    gender: '男',
    appearance: '橙色短发少年，冒险家装束，随身带着冒险笔记。',
    personality: '乐观倒霉，讲义气，厄运缠身却不服输。',
  },
  {
    name: '诺艾尔',
    aliases: ['Noelle', '女仆'],
    gender: '女',
    appearance: '银发女仆装，西风骑士团见习骑士，双手剑。',
    personality: '认真勤勉，总想帮忙却常把自己累坏。',
  },
  {
    name: '雷泽',
    aliases: ['Razor'],
    gender: '男',
    appearance: '灰发少年，狼群中长大的野性剑士。',
    personality: '寡言直率，与狼群感情深厚。',
  },
  {
    name: '凯瑟琳',
    aliases: ['Katheryne'],
    gender: '女',
    appearance: '各国冒险家协会前台接待员，标志性微笑与制服。',
    personality: '公式化热情，“向着星辰与深渊”。',
  },
  {
    name: '钟离',
    aliases: ['Zhongli', '摩拉克斯', '岩王帝君'],
    gender: '男',
    appearance: '棕发金瞳青年，深色长袍，气质沉稳。',
    personality: '博学寡言，重视契约，常忘记带摩拉。',
  },
  {
    name: '魈',
    aliases: ['Xiao', '降魔大圣'],
    gender: '男',
    appearance: '青黑短发，仙人服饰，持长柄武器。',
    personality: '清冷克制，背负业障，只愿守护璃月。',
  },
  {
    name: '甘雨',
    aliases: ['Ganyu', '王小美'],
    gender: '女',
    appearance: '蓝发双角的半仙少女，璃月七星秘书。',
    personality: '温柔勤勉，工作狂，偶尔迷糊。',
  },
  {
    name: '刻晴',
    aliases: ['Keqing', '玉衡星'],
    gender: '女',
    appearance: '紫发少女，干练服饰，雷元素单手剑。',
    personality: '雷厉风行，质疑传统，相信人的努力。',
  },
  {
    name: '凝光',
    aliases: ['Ningguang', '天权星'],
    gender: '女',
    appearance: '白发成熟女性，金饰华服，指尖转动烟斗。',
    personality: '精明强干，视璃月如棋局也如家业。',
  },
  {
    name: '胡桃',
    aliases: ['Hu Tao', '往生堂堂主'],
    gender: '女',
    appearance: '棕发双马尾少女，往生堂制服，俏皮活泼。',
    personality: '古灵精怪，谈吐惊人，对生死有自己的哲学。',
  },
  {
    name: '行秋',
    aliases: ['Xingqiu', '飞云商会二少爷'],
    gender: '男',
    appearance: '蓝发少年，书生装束，水元素单手剑。',
    personality: '文雅腹黑，爱写武侠小说，家业与侠义兼顾。',
  },
  {
    name: '香菱',
    aliases: ['Xiangling', '万民堂'],
    gender: '女',
    appearance: '双马尾厨师少女，围裙与锅巴同行。',
    personality: '热情开朗，痴迷做菜，敢于尝试奇怪食材。',
  },
  {
    name: '北斗',
    aliases: ['Beidou', '南十字船队'],
    gender: '女',
    appearance: '高挑女船长，单眼，雷元素大剑，豪迈。',
    personality: '豪爽仗义，敢与海怪和神明硬碰硬。',
  },
  {
    name: '申鹤',
    aliases: ['Shenhe'],
    gender: '女',
    appearance: '白发冷艳女子，驱邪符与红绳装饰。',
    personality: '冷淡疏离，被仙人养大，正在学习人间情感。',
  },
  {
    name: '夜兰',
    aliases: ['Yelan'],
    gender: '女',
    appearance: '深蓝短发，紧身衣与骰子饰品，神秘干练。',
    personality: '冷静神秘，情报网遍布，喜欢赌局。',
  },
  {
    name: '雷电将军',
    aliases: ['Raiden Shogun', '巴尔泽布', '影'],
    gender: '女',
    appearance: '紫发御姐，稻妻和服与薙刀，雷光环绕。',
    personality: '威严寡言，追求永恒，内心藏着对稻妻的柔软。',
  },
  {
    name: '八重神子',
    aliases: ['Yae Miko', '狐斋宫'],
    gender: '女',
    appearance: '粉发狐耳女性，鸣神大社宫司，衣着华美。',
    personality: '腹黑从容，喜欢看戏，洞悉人心。',
  },
  {
    name: '神里绫华',
    aliases: ['Kamisato Ayaka', '白鹭公主'],
    gender: '女',
    appearance: '蓝发少女，神里流剑术，和服与折扇。',
    personality: '端庄温柔，背负家族责任，内心渴望自由。',
  },
  {
    name: '神里绫人',
    aliases: ['Kamisato Ayato'],
    gender: '男',
    appearance: '蓝发青年，神里家家主，水元素单手剑。',
    personality: '温雅从容，善用权谋，保护妹妹与家族。',
  },
  {
    name: '宵宫',
    aliases: ['Yoimiya', '长野原烟花店'],
    gender: '女',
    appearance: '金发少女，和服与弓，烟花般灿烂。',
    personality: '活泼直率，用烟花点亮他人的愿望。',
  },
  {
    name: '珊瑚宫心海',
    aliases: ['Sangonomiya Kokomi', '海祇岛'],
    gender: '女',
    appearance: '粉发少女，珊瑚宫巫女，水元素法器。',
    personality: '冷静善谋，自称普通人却总在担起大局。',
  },
  {
    name: '枫原万叶',
    aliases: ['Kaedehara Kazuha'],
    gender: '男',
    appearance: '红白异色发少年，浪人剑客，枫叶缀发。',
    personality: '洒脱诗意，随风而动，重情重义。',
  },
  {
    name: '托马',
    aliases: ['Thoma', '神里家执事'],
    gender: '男',
    appearance: '金发青年，神里家执事，火元素长柄武器。',
    personality: '热情可靠，擅长家务与社交。',
  },
  {
    name: '荒泷一斗',
    aliases: ['Arataki Itto', '荒泷派'],
    gender: '男',
    appearance: '红角鬼族青年，豪放体格，岩元素大剑。',
    personality: '大大咧咧，讲义气，视胜负如生命。',
  },
  {
    name: '纳西妲',
    aliases: ['Nahida', '布耶尔', '草神'],
    gender: '女',
    appearance: '白发绿眸的幼小神明，教令院知识化身。',
    personality: '温和好奇，聪慧包容，渴望走出封闭。',
  },
  {
    name: '提纳里',
    aliases: ['Tighnari', '巡林官'],
    gender: '男',
    appearance: '绿发狐耳青年，巡林官装束，草元素弓。',
    personality: '直率毒舌，博学严谨，守护雨林。',
  },
  {
    name: '柯莱',
    aliases: ['Collei'],
    gender: '女',
    appearance: '绿发少女，巡林队成员，草元素弓。',
    personality: '内敛努力，曾被愚人众实验影响，正在走出阴影。',
  },
  {
    name: '赛诺',
    aliases: ['Cyno', '大风纪官'],
    gender: '男',
    appearance: '白发少年，赤金异瞳，雷元素长柄武器。',
    personality: '严肃自律，酷爱七圣召唤与冷笑话。',
  },
  {
    name: '艾尔海森',
    aliases: ['Alhaitham', '书记官'],
    gender: '男',
    appearance: '灰绿短发青年，教令院书记官，草元素单手剑。',
    personality: '理性务实，讨厌麻烦，逻辑至上。',
  },
  {
    name: '迪希雅',
    aliases: ['Dehya', '镀金旅团'],
    gender: '女',
    appearance: '棕肤黑发女战士，火元素大剑，洒脱豪放。',
    personality: '仗义直爽，身手矫健，把承诺看得重。',
  },
  {
    name: '妮露',
    aliases: ['Nilou', '祖拜尔剧场'],
    gender: '女',
    appearance: '红发少女，舞者服饰，水元素单手剑。',
    personality: '温柔爱舞，害怕冲突，却为舞台挺身而出。',
  },
  {
    name: '芙宁娜',
    aliases: ['Furina', '芙卡洛斯', '水神'],
    gender: '女',
    appearance: '蓝白水色礼服，异色瞳，华丽而夸张。',
    personality: '戏剧化、爱面子，藏在表演下的孤独与坚持。',
  },
  {
    name: '那维莱特',
    aliases: ['Neuvillette', '最高审判官'],
    gender: '男',
    appearance: '白蓝长发青年，枫丹最高审判官，水元素法器。',
    personality: '公正沉稳，情感内敛，与龙的历史相连。',
  },
  {
    name: '林尼',
    aliases: ['Lyney', '大魔术师'],
    gender: '男',
    appearance: '红发魔术师，火元素弓，礼帽与猫。',
    personality: '优雅自信，护短，魔术与情报双修。',
  },
  {
    name: '琳妮特',
    aliases: ['Lynette'],
    gender: '女',
    appearance: '蓝紫短发少女，魔术助手，风元素单手剑。',
    personality: '安静寡言，行动迅捷，默默配合兄长。',
  },
  {
    name: '夏洛蒂',
    aliases: ['Charlotte', '蒸汽鸟报'],
    gender: '女',
    appearance: '粉发少女记者，留影机不离手，水元素法器。',
    personality: '热情敏锐，追求独家新闻，嘴快心热。',
  },
  {
    name: '娜维娅',
    aliases: ['Navia', '刺玫会'],
    gender: '女',
    appearance: '金发少女，华丽洋装与伞剑，岩元素双手剑。',
    personality: '明艳率直，重情重义，会长大人风范。',
  },
  {
    name: '玛薇卡',
    aliases: ['Mavuika', '火神'],
    gender: '女',
    appearance: '红发御姐，纳塔圣火之主，火元素大剑。',
    personality: '果敢豪迈，为部族与圣火而战。',
  },
  {
    name: '基尼奇',
    aliases: ['Kinich'],
    gender: '男',
    appearance: '绿黑发少年，纳塔猎人，草元素大剑。',
    personality: '沉默利落，与同伴龙蜥配合默契。',
  },
  {
    name: '玛拉妮',
    aliases: ['Mualani'],
    gender: '女',
    appearance: '棕肤少女，冲浪板与贝壳装饰，水元素法器。',
    personality: '开朗热心，喜欢带游客体验纳塔。',
  },
  {
    name: '达达利亚',
    aliases: ['Tartaglia', '公子', '阿贾克斯'],
    gender: '男',
    appearance: '橙发青年，愚人众执行官，水元素弓与双刃。',
    personality: '好战直率，享受强敌，对家人温柔。',
  },
  {
    name: '阿蕾奇诺',
    aliases: ['Arlecchino', '仆人'],
    gender: '女',
    appearance: '黑发女性，愚人众执行官，冷峻优雅。',
    personality: '克制冷峻，把“家”与秩序握在自己手里。',
  },
  {
    name: '罗莎琳',
    aliases: ['Rosalyne', 'La Signora', 'Signora', '女士', '焚尽的炽炎魔女'],
    gender: '女',
    appearance: '铂金长发的愚人众执行官，红黑蝶翼半面具遮住一眼，冰蓝与赤红相间的华服带有霜雪和烈焰意象。',
    personality: '高傲决绝，言辞冰冷而带轻蔑，旧日伤痛与炽烈执念深藏在克制外表之下。',
  },
  {
    name: '流浪者',
    aliases: ['Wanderer', '散兵', '倾奇者'],
    gender: '男',
    appearance: '深蓝发少年，宽檐帽与和风服饰，风元素法器。',
    personality: '尖锐敏感，背负过去，正在寻找新的自我。',
  },
  {
    name: '戴因斯雷布',
    aliases: ['Dainsleif', '坎瑞亚'],
    gender: '男',
    appearance: '金发青年，坎瑞亚末代宫廷卫队长装束，面罩与剑。',
    personality: '沉静神秘，背负诅咒，对深渊与天理立场复杂。',
  },
];

// 名称 + alias 模糊匹配。简单去空白比较，未来可扩展为 Levenshtein。
export function matchCanonical(name: string): CanonicalCharacterDef | null {
  const target = name.replace(/\s+/g, '').trim().toLocaleLowerCase('en-US');
  if (!target) return null;
  for (const ch of CANONICAL_CHARACTERS) {
    if (ch.name.replace(/\s+/g, '').toLocaleLowerCase('en-US') === target) return ch;
    if (ch.aliases?.some((a) => a.replace(/\s+/g, '').toLocaleLowerCase('en-US') === target)) return ch;
  }
  return null;
}

function canonicalIdCandidates(id: string): string[] {
  const decoded = (() => {
    try { return decodeURIComponent(id); } catch { return id; }
  })().trim();
  if (!decoded) return [];
  const candidates = new Set<string>([decoded]);
  let cursor = decoded;
  for (let index = 0; index < 4; index += 1) {
    const stripped = cursor.replace(/^(?:contact|courier|sender|npc)[\s:_-]+/i, '').trim();
    if (!stripped || stripped === cursor) break;
    candidates.add(stripped);
    cursor = stripped;
  }
  const tail = decoded.split(/[\s:_-]+/).filter(Boolean).at(-1);
  if (tail) candidates.add(tail);
  return [...candidates];
}

/**
 * Resolve a canon identity from durable identifiers before trusting model-written labels.
 * This prevents prose fragments such as “the person who knows your ability” from replacing Lisa.
 */
export function matchCanonicalIdentity(input: {
  id?: string;
  name?: string;
  aliases?: readonly string[];
}): CanonicalCharacterDef | null {
  for (const candidate of canonicalIdCandidates(input.id ?? '')) {
    const matched = matchCanonical(candidate);
    if (matched) return matched;
  }
  const byName = matchCanonical(input.name ?? '');
  if (byName) return byName;
  for (const alias of input.aliases ?? []) {
    const matched = matchCanonical(alias);
    if (matched) return matched;
  }
  return null;
}
