// 变量登记表 + 命令校验。
// 设计参考：墨色项目 utils/variableRegistry.ts。
//
// 用途：
// 1. 构建登记表 → 注入 system prompt 末尾，告诉 AI "只能写入这些路径"。
// 2. 校验命令 → AI 输出后逐条比对，路径不在白名单的直接拒绝（防止 AI 瞎编字段）。

import type { 变量命令 } from '@/models/variableCommand';
import { ARTIFACT_SLOTS, ITEM_CATEGORIES, ITEM_RARITIES, type TeyvatInventory } from '@/models/teyvat/items';
import { matchCanonical } from '@/data/canonicalCharacters';
import { 解析路径片段, 读取路径值 } from './variablePath';
import { readLegacyNpcNameFromKey } from '@/compat/legacy-hsr/readOnly';
import { LEGACY_NPC_ID_TO_CHINESE_NAME, normalizeLegacyNpcSelector } from '@/utils/legacyNpcIdentity';

/** 变量命令允许操作的根路径，全部对应 useGameState 的一个 setter。 */
export const VARIABLE_ROOT_KEYS = [
  '旅人',   // 旅行者档案（玩家手写字段只读）
  '背包',   // 正式 TeyvatInventory 根
  '世界',   // 世界状态
  '记忆',   // 记忆系统
  '世界树', // 世界树记忆账本
  '图鉴',   // 原著资料图鉴
  '手机',   // 手机通信系统
  'NPC',    // 伙伴档案库（含 companion / extra / 图像预留 / NSFW 预留）
  '蒸汽鸟报', // 公开报刊档案
  '剧情',   // 旧剧情节点兼容
] as const;

const NPC_ARRAY_ITEM_FIELDS = new Set([
  'id',
  '姓名',
  '别名',
  '阶位',
  '好感度',
  '关系',
  '亲密关系',
  '同行',
  '初见回合',
  '最近回合',
  '性别',
  '对玩家称呼',
  '外貌',
  '穿着',
  '说话方式',
  '性格',
  '介绍',
  '装备摘要',
  '同行记忆',
  '最近互动',
  '对玩家长期印象',
  '当前关系阶段',
  '共同经历',
  '未完成事项',
  '未解决冲突',
  '必须记得',
  '禁止遗忘',
  '总结记忆',
  '备注',
  '原著角色',
  'NSFW档案',
  '图像档案',
  '头像',
]);

const NPC_NSFW_FIELDS = new Set([
  'enabled',
  '年龄确认',
  '是否处女',
  '首次性行为对象',
  '亲密阶段',
  '边界',
  '偏好',
  '敏感点',
  '禁忌',
  '女性身体档案',
  '男性身体档案',
  '经历',
  '长期事实',
  '标签',
  '备注',
  '胸部',
  '女性私处',
  '后庭',
  '男性器',
  '体态',
  '体味',
]);

const PROMPT_BINARY_IMAGE_PATH_RE = /(?:^|\.)头像$|(?:^|\.)图像档案\.(?:头像|立绘)(?:$|\.)|(?:^|\.)图像档案\.头像槽位(?:$|\.)/;

export type VariableRootKey = typeof VARIABLE_ROOT_KEYS[number];

type RootPolicy = 'writable' | 'partial' | 'readonly';

interface RootWritePolicy {
  label: string;
  policy: RootPolicy;
  owner: string;
  note: string;
  allowed?: string;
  forbidden?: string;
}

const ROOT_WRITE_POLICIES: Record<VariableRootKey, RootWritePolicy> = {
  旅人: {
    label: '旅人',
    policy: 'partial',
    owner: '玩家档案与元素共鸣服务层',
    note: '玩家手写核心档案只读。物品资产位于正式根 背包.items。',
    forbidden: '不要写姓名、别名、性别、年龄、生日、身高、身份、外貌、性格、背景、专长知识、能力、头像、图像档案、属性、主元素、元素共鸣或天赋。',
  },
  背包: {
    label: '背包',
    policy: 'partial',
    owner: '变量系统 + 背包服务层',
    note: '正式 TeyvatInventory 根；变量系统只写 items，mora 由正式结算维护。',
    allowed: 'push 背包.items；sub 背包.items[id=...].quantity。',
    forbidden: '不要 set/delete 整个背包，不要写 lightcone、颜色品质或旅人侧背包镜像。',
  },
  世界: {
    label: '世界',
    policy: 'partial',
    owner: '变量系统 + 元素回响服务层',
    note: '可写日期、时间、地点、天气、旅程天数、全局事件和氛围变化。',
    allowed: 'set 世界.当前日期/当前时间/当前地点/当前天气/氛围变化；add 世界.旅程天数；push 世界.全局事件。',
    forbidden: '不要写 进行中元素回响、元素回响邀请。',
  },
  记忆: {
    label: '记忆',
    policy: 'readonly',
    owner: '记忆系统',
    note: '即时、短期、长期记忆由记忆系统写入与压缩。',
    forbidden: '变量模型不得 set/push/delete 记忆 root 或其子字段。',
  },
  世界树: {
    label: '世界树',
    policy: 'readonly',
    owner: '世界树服务',
    note: '记忆条目入库、召回和精炼由世界树服务维护。',
    forbidden: '变量模型不得写入 entries。',
  },
  图鉴: {
    label: '图鉴',
    policy: 'readonly',
    owner: '图鉴系统',
    note: '图鉴是原著资料库，不由每回合变量模型维护。',
    forbidden: '变量模型不得新增、修改或删除图鉴条目。',
  },
  手机: {
    label: '手机',
    policy: 'partial',
    owner: '变量系统 + 手机系统',
    note: '变量系统只负责入口事件：联系人、剧情群组空频道、主动消息契机。',
    allowed: 'push 手机.contacts；push 手机.conversations 空频道；push 手机.deliverySeeds；set 未读状态类字段。',
    forbidden: '不要直接写完整 messages，不要压缩手机对话记忆。',
  },
  NPC: {
    label: 'NPC',
    policy: 'writable',
    owner: '变量系统',
    note: '伙伴与路人档案是变量系统重点维护对象。',
    allowed: 'push 新 NPC；set 已有 NPC 档案字段；push NPC[id=...].同行记忆 / 共同经历 / 未完成事项 / 必须记得等账本字段。',
    forbidden: '不要把怪物、泛称敌人、一次性杂兵写入 NPC。',
  },
  蒸汽鸟报: {
    label: '蒸汽鸟报',
    policy: 'readonly',
    owner: '蒸汽鸟报',
    note: '公开报道由独立 API 生成和归档。',
    forbidden: '变量模型不得写入蒸汽鸟报 root；可改写成 世界.全局事件 或 信使.deliverySeeds。',
  },
  剧情: {
    label: '剧情',
    policy: 'partial',
    owner: '旧剧情节点兼容',
    note: '旧剧情节点兼容保留。新剧情推进以剧情编织和蒸汽鸟报链路为主。',
    allowed: '仅在旧节点明确存在时更新状态；一般不要新增。',
    forbidden: '不要自动推进剧情编织，不要把原著剧情完成状态写到这里。',
  },
};

const READONLY_ROOTS = new Set<VariableRootKey>(
  Object.entries(ROOT_WRITE_POLICIES)
    .filter(([, policy]) => policy.policy === 'readonly')
    .map(([root]) => root as VariableRootKey),
);

const TRAVELER_PLAYER_AUTHORED_FIELDS = new Set([
  '姓名',
  '别名',
  '性别',
  '年龄',
  '生日',
  '身高',
  '身份',
  '外貌',
  '性格',
  '背景',
  '专长知识',
  '能力',
  '头像',
  '图像档案',
  '主元素',
  '元素共鸣',
  '天赋',
]);

interface ArraySchemaTemplate {
  path: string;
  title: string;
  actionHint: string;
  required: string[];
  recommended?: string[];
  example: string;
  forbidden?: string[];
}

const ARRAY_SCHEMA_TEMPLATES: ArraySchemaTemplate[] = [
  {
    path: 'NPC',
    title: 'NPC[] 伙伴/路人档案对象',
    actionHint: '新角色入档使用 `push NPC = {...完整对象...}`；已有角色更新使用 `NPC[id=xxx].字段`。',
    required: ['id', '姓名', '阶位'],
    recommended: ['好感度', '关系', '亲密关系', '同行', '初见回合', '最近回合', '备注', '性别', '别名', '对玩家称呼', '外貌', '穿着', '说话方式', '性格', '介绍', '同行记忆', '最近互动', '对玩家长期印象', '当前关系阶段', '共同经历', '未完成事项', '未解决冲突', '必须记得', '禁止遗忘', '原著角色', '图像档案', 'NSFW档案'],
    example: '{"id":"npc_amber","姓名":"安柏","阶位":"companion","好感度":5,"关系":"acquaintance","同行":true,"初见回合":1,"最近回合":1,"备注":["西风骑士团侦察骑士"],"原著角色":true,"外貌":"棕色长发与红色兔耳发带，神情明快。","穿着":"便于滑翔与侦察的骑士制服，随身携带弓箭。","说话方式":"语速明快，主动关心旅人的处境。","性格":"热情负责，遇事会率先行动。","介绍":"蒙德城的侦察骑士，也是旅行者最早结识的伙伴之一。"}',
    forbidden: ['怪物、泛称敌人、一次性杂兵不要入档。', '不要重复 push 同一人物的别称或状态称呼。', '对玩家称呼不明确时写“未知”，不要写“你”“喂”等临时指代。'],
  },
  {
    path: 'NPC[id=...].同行记忆',
    title: 'NPC同行记忆[] 对象',
    actionHint: '已有 NPC 本回合与玩家产生直接互动时，使用 `push NPC[id=xxx].同行记忆 = {...}`。',
    required: ['id', '回合', '摘要'],
    recommended: ['原文', '来源', '关联NPCID'],
    example: '{"id":"npc_mem_amber_1_patrol","回合":1,"摘要":"安柏与旅行者在低语森林确认同行，并提醒旅行者留意丘丘人营地。","来源":"变量","关联NPCID":["npc_amber"]}',
    forbidden: ['不要把 A 的经历写进 B 的同行记忆。', '无法确认归属时不写同行记忆。'],
  },
  {
    path: '背包.items',
    title: '背包.items[] 提瓦特物品对象',
    actionHint: '获得明确物品时使用 `push 背包.items = {...完整对象...}`。',
    required: ['category', 'name', 'rarity', 'quantity'],
    recommended: ['description', 'artifactSlot', 'stackable', 'narrativeEffects', 'useEffects', 'source', 'sourceDetail'],
    example: '{"category":"food","name":"提瓦特煎蛋","rarity":1,"quantity":2}',
    forbidden: ['不要输出占位名称。', 'artifact 必须写五个正式 artifactSlot 之一。', '非 artifact 不得写 artifactSlot。', '禁止写 lightcone、颜色品质、装备槽位或穿戴状态。'],
  },
  {
    path: '信使.contacts',
    title: '信使.contacts[] 联系人对象',
    actionHint: '剧情明确建立通信方式时，使用 `push 信使.contacts = {...}`。正式认识并获得通信许可、加入共同频道、或收到主动来信后都可以解锁；仅仅远远看见 NPC 不解锁。',
    required: ['id', 'name', 'available'],
    recommended: ['npcId', 'avatar', 'relationLabel', 'status', 'lastActiveTurn', 'unlockSource'],
    example: '{"id":"contact_amber","npcId":"npc_amber","name":"安柏","avatar":"","relationLabel":"伙伴","available":true,"status":"available","lastActiveTurn":1,"unlockSource":"story"}',
    forbidden: ['敌人、怪物、泛称 NPC 不进通讯录。', '未正式认识、未交换联系方式、未通过剧情频道建立通讯权限时不要写联系人。'],
  },
  {
    path: '信使.conversations',
    title: '信使.conversations[] 会话对象',
    actionHint: '仅剧情确有共同频道时，创建空群聊频道；玩家自建群聊由 UI 完成。',
    required: ['id', 'type', 'title', 'participantIds', 'messages', 'unread', 'updatedAt'],
    recommended: ['pinned', 'localArchive', 'typingMemberIds'],
    example: '{"id":"dispatch_temp","type":"group","title":"临时联络频道","participantIds":["npc_amber","npc_kaeya"],"messages":[],"unread":0,"typingMemberIds":[],"pinned":false,"updatedAt":1779580800000}',
    forbidden: ['不要直接写完整 messages。', '不要替手机系统压缩通信记忆。'],
  },
  {
    path: '信使.deliverySeeds',
    title: '信使.deliverySeeds[] 主动投递种子',
    actionHint: '重要事件需要远方或不在场角色回应时，使用 `push 信使.deliverySeeds = {...}`。',
    required: ['id', 'turn', 'source', 'triggerType', 'priority', 'targetType', 'targetId', 'title', 'context', 'relatedNpcIds', 'status'],
    recommended: ['expiresAfterTurns'],
    example: '{"id":"courier_seed_1_amber_followup","turn":1,"source":"main_story","triggerType":"quest","priority":"normal","targetType":"private","targetId":"contact_amber","title":"安柏确认巡逻路线","context":"旅行者与安柏约定确认巡逻路线，她可以稍后投递来信询问进展。","relatedNpcIds":["npc_amber"],"expiresAfterTurns":6,"status":"pending"}',
    forbidden: ['每回合最多 0-2 条种子。', '普通寒暄不要生成来信种子。', 'source 禁止使用旧 battle。'],
  },
  {
    path: '世界.全局事件',
    title: '世界.全局事件[] 字符串',
    actionHint: '本回合发生了足以影响后续的事实时，使用 `push 世界.全局事件 = "..."`。',
    required: ['字符串'],
    example: '"低语森林出现异常丘丘人营地，西风骑士团已调整巡逻路线。"',
  },
];

/** 一份精简版游戏 state，用于变量系统读写（不包含 UI/loading 等 transient state）。 */
export type VariableState = Record<VariableRootKey, unknown>;

export interface RegistryOptions {
  /** 最大递归深度，避免对象层级太深炸栈 */
  maxDepth?: number;
  /** 最大行数，超出截断；避免 prompt 膨胀 */
  maxLines?: number;
}

/** 把单个值的可达路径递归收集到 result 里。 */
function 收集路径(value: unknown, prefix: string, result: string[], depth: number) {
  result.push(prefix);
  if (depth <= 0 || value === null || value === undefined || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    if (value.length > 0) {
      // 数组用 [] 表示"任意 index 都合法"，并展开第一个元素的字段（作为同类元素的字段模板）
      result.push(`${prefix}[]`);
      收集路径(value[0], `${prefix}[0]`, result, depth - 1);
    }
    return;
  }

  Object.keys(value as Record<string, unknown>)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .forEach((k) => {
      收集路径((value as Record<string, unknown>)[k], `${prefix}.${k}`, result, depth - 1);
    });
}

function buildRootPolicyPrompt(): string[] {
  return [
    '## Root 写入策略',
    '',
    ...VARIABLE_ROOT_KEYS.flatMap((root) => {
      const policy = ROOT_WRITE_POLICIES[root];
      const stateLabel = policy.policy === 'writable' ? '可写' : policy.policy === 'partial' ? '半可写' : '只读';
      return [
        `- ${root}（${stateLabel}）：${policy.note}`,
        `  - 维护者：${policy.owner}`,
        policy.allowed ? `  - 允许：${policy.allowed}` : '',
        policy.forbidden ? `  - 禁止：${policy.forbidden}` : '',
      ].filter(Boolean);
    }),
    '',
  ];
}

function buildArraySchemaPrompt(): string[] {
  return [
    '## 数组对象 schema 模板',
    '',
    '即使当前数组为空，以下数组路径也视为可 `push`。必须传入完整 JSON，不要输出字段列表、占位符或省略号。',
    '',
    ...ARRAY_SCHEMA_TEMPLATES.flatMap((template) => [
      `### ${template.title}`,
      `- 路径：${template.path}`,
      `- 用法：${template.actionHint}`,
      `- 必填：${template.required.join('、')}`,
      ...(template.recommended?.length ? [`- 推荐：${template.recommended.join('、')}`] : []),
      ...(template.forbidden?.length ? template.forbidden.map((item) => `- 禁止：${item}`) : []),
      `- 示例：\`${template.example}\``,
      '',
    ]),
  ];
}

/** 扫存档生成路径清单，作为 AI 命令白名单。 */
export function buildVariableRegistry(state: Partial<VariableState>, options?: RegistryOptions): string[] {
  const maxDepth = Math.max(1, options?.maxDepth ?? 4);
  const maxLines = Math.max(20, options?.maxLines ?? 300);
  const result: string[] = [];

  for (const root of VARIABLE_ROOT_KEYS) {
    if (READONLY_ROOTS.has(root)) continue;
    if (!(root in state)) continue;
    收集路径(state[root], root, result, maxDepth);
    if (result.length >= maxLines) break;
  }

  return Array.from(new Set(result))
    .filter((path) => path !== '旅人' && !isTravelerPlayerAuthoredPath(path) && !isPromptBinaryImagePath(path))
    .slice(0, maxLines);
}

function isPromptBinaryImagePath(path: string): boolean {
  return PROMPT_BINARY_IMAGE_PATH_RE.test(path);
}

/** 把登记表格式化成 prompt 注入文本。 */
export function buildVariableRegistryPrompt(state: Partial<VariableState>): string {
  const paths = buildVariableRegistry(state);
  if (paths.length === 0) return '';
  return [
    '# 变量路径登记表',
    '',
    '变量系统只负责把本回合正文中已经发生的事实落成结构化状态。请先遵守 root 写入策略，再参考 schema 模板，最后才看当前路径清单。',
    '',
    ...buildRootPolicyPrompt(),
    ...buildArraySchemaPrompt(),
    '## 当前存档可达路径',
    '',
    '- `set/add/sub/delete` 只能写入清单中已存在的路径，或写入 schema 模板声明的标准数组对象字段。',
    '- 数组新增条目请对清单中标 `[]` 或 schema 模板中的数组路径使用 `push`，传入完整的新对象。',
    '- 已存在的数组条目也可以使用 `id` 选择器定位，例如 `NPC[id=amber].最近回合`；前提是该 id 能在当前存档中找到对应对象。',
    '- 如果 `NPC[id=xxx]`、`信使.contacts[id=xxx]` 等 id 选择器找不到对象，不要 set 子字段；应先 push 对应数组的完整对象。',
    '- 不在清单中的字段视为未登记变量，本回合不要写入；如必须新增，请通过 push 到对应数组。',
    '',
    ...paths.map((p) => `- ${p}`),
  ].join('\n');
}

export interface CommandValidation {
  allowed: boolean;
  reason?: string;
  /** 解析出的根路径，便于执行器路由 */
  root?: VariableRootKey;
  /** 去掉根的剩余路径 */
  rest?: string;
}

/** 提取根路径：从 "旅人.属性.力量" 中取出 "旅人" + ".属性.力量"。 */
export function extractRoot(rawKey: string): { root: VariableRootKey; rest: string } | null {
  const key = (rawKey || '').trim();
  if (!key) return null;
  for (const root of VARIABLE_ROOT_KEYS) {
    if (key === root) return { root, rest: '' };
    if (key.startsWith(`${root}.`)) return { root, rest: key.slice(root.length + 1) };
    if (key.startsWith(`${root}[`)) return { root, rest: key.slice(root.length) };
  }
  return null;
}

/** 判断同数组其它对象里是否存在该字段（用于允许 set/add 给数组对象新增字段）。 */
function 同数组其它对象存在字段(rootValue: unknown, rawPath: string): boolean {
  const tokens = 解析路径片段(rawPath);
  const lastToken = tokens[tokens.length - 1];
  if (typeof lastToken !== 'string') return false;

  for (let i = tokens.length - 2; i >= 0; i--) {
    if (typeof tokens[i] !== 'number') continue;
    const arrayPath = tokens
      .slice(0, i)
      .map((t) => (typeof t === 'number' ? `[${t}]` : `.${t}`))
      .join('')
      .replace(/^\./, '');
    const { exists, value } = 读取路径值(rootValue, arrayPath);
    if (!exists || !Array.isArray(value)) return false;
    return value.some(
      (item) => item && typeof item === 'object' && !Array.isArray(item) && lastToken in (item as Record<string, unknown>),
    );
  }
  return false;
}

function hasIdSelector(rawPath: string): boolean {
  return /\[[^\]]+=/.test(rawPath);
}

function getArrayPathBeforeSelector(rawPath: string): string {
  const index = rawPath.search(/\[[^\]]+=/);
  if (index < 0) return rawPath;
  return rawPath.slice(0, index).replace(/\.$/, '');
}

function getLastPathField(rawPath: string): string | null {
  const tokens = 解析路径片段(rawPath);
  const last = tokens[tokens.length - 1];
  return typeof last === 'string' && !last.startsWith('[') ? last : null;
}

function joinRootPath(root: VariableRootKey, rest: string): string {
  if (!rest) return root;
  return rest.startsWith('[') ? `${root}${rest}` : `${root}.${rest}`;
}

function normalizeSchemaPath(path: string): string {
  return path
    .replace(/\.\[/g, '[')
    .replace(/\[[^\]=]+=[^\]]+\]/g, (selector) => {
      const eq = selector.indexOf('=');
      const field = selector.slice(1, eq).trim();
      return `[${field}=...]`;
    });
}

function findSchemaTemplate(path: string): ArraySchemaTemplate | undefined {
  const normalized = normalizeSchemaPath(path);
  return ARRAY_SCHEMA_TEMPLATES.find((template) => template.path === path || template.path === normalized);
}

function isSchemaArrayPath(root: VariableRootKey, rest: string): boolean {
  const fullPath = joinRootPath(root, rest);
  return Boolean(findSchemaTemplate(fullPath));
}

function isKnownSchemaItemField(root: VariableRootKey, rest: string): boolean {
  const arrayPath = getArrayPathBeforeSelector(rest);
  const fullArrayPath = joinRootPath(root, arrayPath);
  const template = findSchemaTemplate(fullArrayPath);
  if (!template) return false;
  const field = getLastPathField(rest);
  if (!field) return false;
  return [...template.required, ...(template.recommended ?? [])].includes(field);
}

function selectorTargetExists(rootValue: unknown, rest: string): boolean {
  if (!hasIdSelector(rest)) return true;
  const arrayPath = getArrayPathBeforeSelector(rest);
  const selectorMatch = rest.slice(arrayPath.length).match(/^\[([^\]]+)\]/);
  if (!selectorMatch) return true;
  const selector = selectorMatch[1];
  if (!selector) return true;
  const eq = selector.indexOf('=');
  if (eq < 0) return true;
  const field = selector.slice(0, eq).trim();
  const expected = selector.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  const targetArray = arrayPath ? 读取路径值(rootValue, arrayPath).value : rootValue;
  if (!Array.isArray(targetArray)) return false;
  return targetArray.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    const candidates = field === 'id'
      ? [record.id, record.姓名, record.name, record.名称, record.名字, record.别名]
      : [record[field]];
    return candidates.some((candidate) => {
      if (typeof candidate !== 'string') return false;
      return candidate.trim() === expected || candidate.trim().toLowerCase() === expected.toLowerCase();
    });
  });
}

function getMissingSelectorTargetReason(root: VariableRootKey, rest: string, rootValue: unknown): string | null {
  if (!hasIdSelector(rest)) return null;
  if (selectorTargetExists(rootValue, rest)) return null;
  if (root === 'NPC' && isAutoEnsurableCanonicalNpcSelector(rest)) return null;
  const arrayPath = getArrayPathBeforeSelector(rest);
  const fullArrayPath = joinRootPath(root, arrayPath);
  const template = findSchemaTemplate(fullArrayPath);
  if (!template) return null;
  return `${fullArrayPath} 中找不到该 id。若这是新对象，请先使用 push ${fullArrayPath} = ${template.example}`;
}

const NON_INVENTORY_INFORMATION_RE = /(坐标|座标|位置|地点|方位|路线|路径|权限$|访问权限|通行权限|许可$|口令|密码|暗号|线索|情报|消息|讯息|资料|记录|名单|地址|坐标点)/;
const PHYSICAL_INFORMATION_CARRIER_RE = /(卡|钥匙|钥|芯片|终端|地图|纸条|便签|信件|文书|档案袋|票|通行证|徽章|铭牌|印章|玉牌|玉兆|令牌|样本|碎片|装置|模块|硬盘|数据盘|存储器)/;

function isInformationOnlyBackpackValue(value: Record<string, unknown>): boolean {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const sourceDescription = typeof value.sourceDetail === 'string' ? value.sourceDetail.trim() : '';
  const haystack = [name, description, sourceDescription].filter(Boolean).join(' ');
  if (!NON_INVENTORY_INFORMATION_RE.test(haystack)) return false;
  return !PHYSICAL_INFORMATION_CARRIER_RE.test(name);
}

function isAutoEnsurableCanonicalNpcSelector(rest: string): boolean {
  const selector = rest.match(/^\[([^\]]+)\]/);
  if (!selector) return false;
  const expression = selector[1];
  if (!expression) return false;
  const eq = expression.indexOf('=');
  if (eq < 0) return false;
  const field = expression.slice(0, eq).trim();
  if (field !== 'id' && field !== '姓名' && field !== '名称' && field !== '名字' && field !== '别名') return false;
  const rawValue = expression.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  return Boolean(matchCanonical(npcSelectorValueToCanonicalName(rawValue)));
}

function npcSelectorValueToCanonicalName(value: string): string {
  const normalized = normalizeLegacyNpcSelector(value);
  return LEGACY_NPC_ID_TO_CHINESE_NAME[normalized] ?? (readLegacyNpcNameFromKey(normalized) || value);
}

function validateSchemaPushValue(root: VariableRootKey, rest: string, value: unknown): string | null {
  const fullPath = joinRootPath(root, rest);
  const template = findSchemaTemplate(fullPath);
  if (!template) return null;

  if (template.required.length === 1 && template.required[0] === '字符串') {
    return typeof value === 'string' && value.trim() ? null : `${fullPath} push 值必须是非空字符串`;
  }

  if (!isRecord(value)) return `${fullPath} push 值必须是完整 JSON 对象`;
  const missing = template.required.filter((field) => !(field in value));
  if (missing.length) return `${fullPath} push 对象缺少必填字段：${missing.join('、')}`;

  if (template.path === '背包.items') {
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name === '名称' || name === '物品' || name === '未知物品' || name.includes('...')) {
      return '背包物品名称不能是占位符';
    }
    if (!ITEM_CATEGORIES.includes(value.category as typeof ITEM_CATEGORIES[number])) return '背包物品 category 未登记';
    if (!ITEM_RARITIES.includes(value.rarity as typeof ITEM_RARITIES[number])) return '背包物品 rarity 必须是 1-5 整数';
    if (typeof value.quantity !== 'number' || !Number.isInteger(value.quantity) || value.quantity <= 0) return '背包物品 quantity 必须是正整数';
    if (value.category === 'artifact') {
      if (!ARTIFACT_SLOTS.includes(value.artifactSlot as typeof ARTIFACT_SLOTS[number])) return 'artifact 物品必须提供正式 artifactSlot';
    } else if (value.artifactSlot !== undefined) {
      return '非 artifact 物品不得写 artifactSlot';
    }
    if ('品质' in value || 'quality' in value || 'lightcone' in value) return '背包物品不得写旧 lightcone 或颜色品质字段';
    if (isInformationOnlyBackpackValue(value)) {
      return '坐标、位置、权限信息、线索、情报或消息不是实体背包物品；请写入 world_event、NPC 记忆或正文承接。只有卡片、地图、芯片、纸条、钥匙、徽章、样本等实体载体才可入背包';
    }
  }

  if (template.path === '信使.deliverySeeds') {
    const source = typeof value.source === 'string' ? value.source : '';
    const allowedSources = new Set(['main_story', 'steambird', 'memory', 'plot', 'system']);
    if (!allowedSources.has(source)) return '信使.deliverySeeds.source 只能是 main_story / steambird / memory / plot / system';
    const triggerType = typeof value.triggerType === 'string' ? value.triggerType : '';
    const allowedTriggerTypes = new Set([
      'injury',
      'victory',
      'defeat',
      'location_change',
      'important_item',
      'relationship',
      'steambird',
      'quest',
      'time',
      'custom',
    ]);
    if (!allowedTriggerTypes.has(triggerType)) return '信使.deliverySeeds.triggerType 不是已登记类型';
    const priority = typeof value.priority === 'string' ? value.priority : '';
    if (!new Set(['low', 'normal', 'high', 'urgent']).has(priority)) return '信使.deliverySeeds.priority 只能是 low / normal / high / urgent';
    const targetType = typeof value.targetType === 'string' ? value.targetType : '';
    if (!new Set(['private', 'group']).has(targetType)) return '信使.deliverySeeds.targetType 只能是 private / group';
    if (value.status !== 'pending') return '信使.deliverySeeds.status 新种子必须写 pending';
  }

  if (template.path === '信使.conversations') {
    const messages = value.messages;
    if (!Array.isArray(messages)) return '信使.conversations 新会话必须提供 messages: []';
    if (messages.length > 0) return '变量模型只允许创建空会话频道，不允许直接写完整聊天 messages';
  }

  return null;
}

// 元素共鸣和元素回响由正式服务维护，变量模型只读。
function isElementalStateProtectedPath(rawKey: string, _action: 变量命令['action']): boolean {
  const k = rawKey.trim();
  if (k === '世界.进行中元素回响' || k === '世界.元素回响邀请') return true;
  if (k.startsWith('世界.进行中元素回响.') || k.startsWith('世界.元素回响邀请.')) return true;
  if (k === '旅人.主元素' || k === '旅人.元素共鸣' || k === '旅人.天赋') return true;
  return /^旅人\.(?:元素共鸣|天赋)\[[^\]]+\](?:\..+)?$/.test(k);
}

function isDeprecatedProtectedPath(rawKey: string): string | null {
  const k = rawKey.trim();
  if (/^NPC(?:\[[^\]]+\])?\.阵营ID$/.test(k)) {
    return '独立派系/阵营变量已废弃；NPC 阵营归属只作为原著/开局资料保留，变量模型不得维护';
  }
  if (/^NPC(?:\[[^\]]+\])?\.好感$/.test(k)) {
    return 'NPC 好感字段正式名称是 好感度，请改用 NPC[id=...].好感度';
  }
  if (k === '旅人.属性' || k.startsWith('旅人.属性.')) {
    return '旅人.属性 是旧五维/属性系统字段，当前项目不再由变量模型维护';
  }
  if (/^背包\.items\[[^\]]+\]\.属性加成/.test(k)) {
    return '背包物品.属性加成 是旧数值装备字段，变量模型不得继续写入';
  }
  return null;
}

function isTravelerPlayerAuthoredPath(rawKey: string): boolean {
  const parsed = extractRoot(rawKey);
  if (parsed?.root !== '旅人') return false;
  if (!parsed.rest) return false;
  const tokens = 解析路径片段(parsed.rest);
  const first = tokens[0];
  return typeof first === 'string' && TRAVELER_PLAYER_AUTHORED_FIELDS.has(first);
}

export function isTravelerPlayerAuthoredVariablePath(rawKey: string): boolean {
  const key = rawKey.trim();
  return key === '旅人' || key === '旅人.穿着' || isTravelerPlayerAuthoredPath(key);
}

/** 校验一条命令是否符合登记表。 */
export function validateCommand(cmd: 变量命令, state: Partial<VariableState>): CommandValidation {
  if (!cmd || typeof cmd.key !== 'string') {
    return { allowed: false, reason: '命令格式错误：缺少 key' };
  }
  if (isTravelerPlayerAuthoredVariablePath(cmd.key) && cmd.key.trim() === '旅人.穿着') {
    return { allowed: false, reason: '旅人.穿着 未登记；旅人外观/服装属于玩家手写档案，变量模型不得维护；NPC 服装才写 NPC[id=...].穿着' };
  }
  if (isTravelerPlayerAuthoredVariablePath(cmd.key)) {
    return {
      allowed: false,
      reason: `旅人核心档案 ${cmd.key} 由玩家手写维护，变量模型不得 ${cmd.action}。请改写为 NPC 记忆、世界事件、物品或剧情正文承接。`,
    };
  }
  // 元素共鸣/回响状态只能由玩家操作与服务层维护。
  if (isElementalStateProtectedPath(cmd.key, cmd.action)) {
    return {
      allowed: false,
      reason: `元素共鸣/回响字段 ${cmd.key} 只能由服务层维护，变量模型不许 ${cmd.action}`,
    };
  }
  const deprecatedReason = isDeprecatedProtectedPath(cmd.key);
  if (deprecatedReason) {
    return { allowed: false, reason: deprecatedReason };
  }
  const parsed = extractRoot(cmd.key);
  if (!parsed) {
    return { allowed: false, reason: `根路径未登记。允许的根：${VARIABLE_ROOT_KEYS.join(' / ')}` };
  }
  if (READONLY_ROOTS.has(parsed.root)) {
    const policy = ROOT_WRITE_POLICIES[parsed.root];
    return { allowed: false, reason: `${parsed.root} 由${policy.owner}维护，变量模型不可写入。${policy.forbidden ?? ''}` };
  }
  const rootValue = state[parsed.root];
  if (rootValue === undefined) {
    return { allowed: false, reason: `根 ${parsed.root} 在当前存档中不存在` };
  }

  if (parsed.root === '背包') {
    const isItemPush = cmd.action === 'push' && parsed.rest === 'items';
    const quantitySubMatch = cmd.action === 'sub'
      ? parsed.rest.match(/^items\[id=([^\]]+)\]\.quantity$/)
      : null;
    const isQuantitySub = Boolean(quantitySubMatch);
    if (!isItemPush && !isQuantitySub) {
      return { allowed: false, reason: '背包只允许 push 背包.items 或 sub 背包.items[id=...].quantity' };
    }
    if (quantitySubMatch) {
      const expectedId = (quantitySubMatch[1] ?? '').trim().replace(/^["']|["']$/g, '');
      const inventory = rootValue as TeyvatInventory;
      if (!expectedId || !inventory.items.some((item) => item.id === expectedId)) {
        return { allowed: false, reason: `背包中没有精确 id「${expectedId}」对应的物品` };
      }
      return { allowed: true, root: parsed.root, rest: parsed.rest };
    }
  }

  // 整段根：始终允许（push/set/delete 根本身）
  if (parsed.rest.length === 0) {
    if (parsed.root === '旅人') {
      return {
        allowed: false,
        reason: `旅人根对象包含玩家手写核心档案，变量模型不得 ${cmd.action} 整个旅人。物品资产请写正式根 背包.items。`,
      };
    }
    if (cmd.action === 'push' && !Array.isArray(rootValue)) {
      return { allowed: false, reason: `push 目标 ${parsed.root} 不是数组` };
    }
    if (cmd.action === 'push') {
      const schemaError = validateSchemaPushValue(parsed.root, parsed.rest, cmd.value);
      if (schemaError) return { allowed: false, reason: schemaError };
    }
    return { allowed: true, root: parsed.root, rest: parsed.rest };
  }

  if (cmd.action === 'push' && isSchemaArrayPath(parsed.root, parsed.rest)) {
    const selectorMissingReason = getMissingSelectorTargetReason(parsed.root, parsed.rest, rootValue);
    if (selectorMissingReason) return { allowed: false, reason: selectorMissingReason };
    const schemaError = validateSchemaPushValue(parsed.root, parsed.rest, cmd.value);
    if (schemaError) return { allowed: false, reason: schemaError };
    return { allowed: true, root: parsed.root, rest: parsed.rest };
  }

  // 有子路径：先看路径是否已存在
  const { exists, value: targetValue } = 读取路径值(rootValue, parsed.rest);
  if (exists) {
    if (cmd.action === 'push' && !Array.isArray(targetValue)) {
      return { allowed: false, reason: `push 目标 ${cmd.key} 不是数组` };
    }
    return { allowed: true, root: parsed.root, rest: parsed.rest };
  }

  const selectorMissingReason = getMissingSelectorTargetReason(parsed.root, parsed.rest, rootValue);
  if (selectorMissingReason) {
    return { allowed: false, reason: selectorMissingReason };
  }

  // 路径不存在：仅在 set/add/sub 给「同数组其它对象已有字段」时允许（让 AI 可以补全可选字段）
  if ((cmd.action === 'set' || cmd.action === 'add' || cmd.action === 'sub') && 同数组其它对象存在字段(rootValue, parsed.rest)) {
    return { allowed: true, root: parsed.root, rest: parsed.rest };
  }

  if ((cmd.action === 'set' || cmd.action === 'add' || cmd.action === 'sub') && isKnownSchemaItemField(parsed.root, parsed.rest)) {
    return { allowed: true, root: parsed.root, rest: parsed.rest };
  }

  if (parsed.root === 'NPC' && isKnownNpcArchivePath(parsed.rest)) {
    return { allowed: true, root: parsed.root, rest: parsed.rest };
  }

  return { allowed: false, reason: `路径 ${cmd.key} 未登记。如需新增条目，请 push 到对应数组` };
}

function isKnownNpcArchivePath(rawPath: string): boolean {
  const tokens = 解析路径片段(rawPath);
  if (tokens.length < 2) return false;
  const last = tokens[tokens.length - 1];
  if (typeof last !== 'string') return false;
  const hasKnownField = NPC_ARRAY_ITEM_FIELDS.has(last) || NPC_NSFW_FIELDS.has(last);
  if (!hasKnownField) return false;
  return tokens.some(
    (token) => typeof token === 'number' || (typeof token === 'string' && token.startsWith('[') && token.endsWith(']')),
  );
}
import { isRecord } from '@/utils/valueGuards';
