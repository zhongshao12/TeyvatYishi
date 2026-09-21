import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const presetRoot = path.join(root, 'public', 'codex-presets');
const ignoredKeys = new Set([
  '来源',
  '关键词',
  '触发关键词',
  '辅助关键词',
  '资料类型',
  '使用范围',
  '关联角色ID',
  '关联形态ID',
]);
const forbiddenTerms = [
  '黑塔空间站',
  '星穹列车',
  '星核猎手',
  '星际和平公司',
  '贝洛伯格',
  '雅利洛-VI',
  '仙舟罗浮',
  '匹诺康尼',
  '命途',
  '光锥',
  '星神',
  '开拓者',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function scanValue(value, where) {
  if (typeof value === 'string') {
    for (const term of forbiddenTerms) {
      assert(!value.includes(term), `${where} leaked developer language: ${term}`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (ignoredKeys.has(key)) continue;
    scanValue(child, `${where}.${key}`);
  }
}

const files = fs.readdirSync(presetRoot).filter((name) => name.endsWith('.json')).sort();
assert(files.length === 6, `expected 6 formal Codex presets, got ${files.length}`);

let entryCount = 0;
let characterCount = 0;
for (const fileName of files) {
  const payload = JSON.parse(fs.readFileSync(path.join(presetRoot, fileName), 'utf8'));
  scanValue(payload.description, `${fileName}.description`);
  for (const entry of payload.entries ?? []) {
    entryCount += 1;
    if (entry.分类 === 'character') characterCount += 1;
    scanValue(entry, `${fileName}/${entry.标题}`);
    scanValue(entry.摘要, `${fileName}/${entry.标题}.摘要`);
    scanValue(entry.原文, `${fileName}/${entry.标题}.原文`);
    scanValue(entry.注入内容, `${fileName}/${entry.标题}.注入内容`);
    scanValue(entry.外貌锚点, `${fileName}/${entry.标题}.外貌锚点`);
    scanValue(entry.性格锚点, `${fileName}/${entry.标题}.性格锚点`);
    scanValue(entry.说话方式, `${fileName}/${entry.标题}.说话方式`);
    scanValue(entry.关系边界, `${fileName}/${entry.标题}.关系边界`);
    scanValue(entry.禁止误写, `${fileName}/${entry.标题}.事实边界`);
  }
}

// 迁移: 385/110 -> 386/111。理由: 「影（雷电影）」从雷电将军的别名拆成独立角色，
// 在 teyvat-characters-core.json 末尾追加了一条 character 词条（并同步 codexIdentityRegistry 的下标）。
assert(entryCount === 386, `expected 386 formal Codex entries, got ${entryCount}`);
assert(characterCount === 111, `expected 111 character entries, got ${characterCount}`);

const auditSource = fs.readFileSync(new URL('./teyvat-runtime-language-audit.mjs', import.meta.url), 'utf8');
assert(!auditSource.includes("path.resolve(root, '..'"), 'project audit must not traverse outside the repository');

console.log(JSON.stringify({ files: files.length, entries: entryCount, characters: characterCount }));
console.log('CODEX_PRESET_LANGUAGE_AUDIT_OK');
