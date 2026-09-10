// 头像注册表同步脚本：把 public/assets/teyvat-avatars 下的实图同步为运行时注册表。
// 用法：pnpm avatars:sync
//
// 流程（用户后续加头像的三步）：
//   1. 把 <角色 slug>.webp 放进 public/assets/teyvat-avatars/characters/{5-star|4-star}/；
//   2. 运行 pnpm avatars:sync —— 生成 data/teyvatAvatarRegistry.generated.ts 并打印缺图清单；
//   3. 运行 pnpm avatars:audit 与 pnpm test:builtin-avatars 验证尺寸、体积和消费链。
// data/builtinAvatars.ts 会直接消费生成结果，因此同步后无需再手工激活。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROSTER_PATH = path.join(ROOT, 'public', 'assets', 'teyvat-avatars', 'roster.json');
const CANONICAL_PATH = path.join(ROOT, 'data', 'canonicalCharacters.ts');
const OVERRIDES_PATH = path.join(ROOT, 'data', 'teyvatAvatarNameOverrides.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'teyvatAvatarRegistry.generated.ts');
// 约定：头像直接放 characters/ 下，文件名 = 原著角色中文名.webp（与 NPC 匹配链的 canonicalName 一致）。
const FLAT_AVATAR_DIR = path.join(ROOT, 'public', 'assets', 'teyvat-avatars', 'characters');
const AVATAR_DIRS = [
  path.join(ROOT, 'public', 'assets', 'teyvat-avatars', 'characters', '5-star'),
  path.join(ROOT, 'public', 'assets', 'teyvat-avatars', 'characters', '4-star'),
];

// ── 解析 canonicalCharacters.ts：中文名 → 英文别名集合 ──
function parseCanonicalCharacters(source) {
  const map = []; // { nameZh, aliases: string[] }
  const entryRe = /name:\s*'([^']+)'\s*,\s*(?:aliases:\s*\[([^\]]*)\],?\s*)?/g;
  let match;
  while ((match = entryRe.exec(source)) !== null) {
    const nameZh = match[1].trim();
    const aliases = (match[2] ?? '')
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    map.push({ nameZh, aliases });
  }
  return map;
}

function findNameZh(rosterName, canonicalMap, overrides, rosterId) {
  const override = overrides?.[rosterId];
  if (typeof override === 'string' && override.trim()) return override.trim();
  const lower = rosterName.trim().toLowerCase();
  const hit = canonicalMap.find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lower));
  return hit?.nameZh ?? null;
}

// ── 扫描实际存在的头像文件（平铺中文名优先，其次按 roster slug 的子目录） ──
const flatAvatars = new Map(); // 中文名 → src
if (fs.existsSync(FLAT_AVATAR_DIR)) {
  for (const file of fs.readdirSync(FLAT_AVATAR_DIR)) {
    if (!file.endsWith('.webp')) continue;
    const nameZh = file.slice(0, -'.webp'.length).trim();
    if (nameZh) flatAvatars.set(nameZh, `/assets/teyvat-avatars/characters/${encodeURIComponent(nameZh)}.webp`);
  }
}
const existingFiles = new Set();
for (const dir of AVATAR_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.webp')) existingFiles.add(file);
  }
}

const roster = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
const canonicalMap = parseCanonicalCharacters(fs.readFileSync(CANONICAL_PATH, 'utf8'));
const overrides = fs.existsSync(OVERRIDES_PATH)
  ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
  : {};

const present = [];
const missing = [];
const unmatched = []; // roster 里找不到中文名的角色

for (const character of roster.characters) {
  const fileName = `${character.id}.webp`;
  const nameZh = findNameZh(character.name, canonicalMap, overrides, character.id);
  // 平铺中文名文件优先（用户直接放图的主通道）
  if (flatAvatars.has(character.name) || (nameZh && flatAvatars.has(nameZh))) {
    const key = flatAvatars.has(character.name) ? character.name : nameZh;
    present.push({ ...character, nameZh: key, src: `/assets/teyvat-avatars/characters/${encodeURIComponent(key)}.webp` });
    continue;
  }
  const hasFile = existingFiles.has(fileName);
  if (!nameZh) {
    unmatched.push(character);
    continue;
  }
  if (hasFile) {
    present.push({ ...character, nameZh, src: character.path });
  } else {
    missing.push({ ...character, nameZh });
  }
}

// 平铺目录里存在、但不在 roster 中的角色（用户自行补充的头像）也纳入注册表
const rosterNames = new Set(roster.characters.map((item) => item.name));
for (const [nameZh, src] of flatAvatars.entries()) {
  if (present.some((item) => item.nameZh === nameZh)) continue;
  present.push({ id: nameZh, name: nameZh, nameZh, src, rarity: 0, element: '', path: src, status: 'ready', extra: true });
}

// ── 生成注册表草稿 ──
const byNameZh = new Map();
for (const item of present) {
  if (!byNameZh.has(item.nameZh)) byNameZh.set(item.nameZh, []);
  byNameZh.get(item.nameZh).push(item);
}
const draftSets = [...byNameZh.entries()]
  .sort(([a], [b]) => a.localeCompare(b, 'zh'))
  .map(([nameZh, items]) => ({
    canonicalName: nameZh,
    candidates: items.map((item, index) => ({
      id: `${item.id}_${index}`,
      title: index === 0 ? `${item.nameZh} 默认头像` : `${item.nameZh} 备选${index}`,
      src: item.src,
    })),
  }));

const generated = `// 由 scripts/teyvat-avatar-registry-sync.mjs 生成（pnpm avatars:sync），请勿手工编辑。
// 结构自含（不 import builtinAvatars），由 data/builtinAvatars.ts 消费。

export interface GeneratedAvatarCandidate {
  id: string;
  title: string;
  src: string;
}

export interface GeneratedAvatarSet {
  canonicalName: string;
  candidates: GeneratedAvatarCandidate[];
}

export const TEYVAT_AVATAR_SETS: GeneratedAvatarSet[] = ${JSON.stringify(draftSets, null, 2)};
`;

fs.writeFileSync(OUTPUT_PATH, generated, 'utf8');

// ── 报告 ──
console.log(`roster 槽位: ${roster.characters.length} · 已有图: ${present.length} · 缺图: ${missing.length} · 未匹配中文名: ${unmatched.length}`);
if (missing.length) {
  console.log('\n缺图清单（放入对应目录后重跑本脚本）：');
  for (const item of missing) {
    console.log(`  [${item.rarity}星] ${item.nameZh ?? item.name} → ${item.rarity}-star/${item.id}.webp`);
  }
}
if (unmatched.length) {
  console.log('\n未匹配中文名（需在 data/canonicalCharacters.ts 补别名）：');
  for (const item of unmatched) console.log(`  ${item.name} (${item.id})`);
}
console.log(`\n运行时注册表: ${draftSets.length} 组角色 → ${OUTPUT_PATH}`);
console.log('请继续运行 pnpm avatars:audit 与 pnpm test:builtin-avatars。');
