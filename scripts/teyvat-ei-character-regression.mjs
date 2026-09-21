import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * 「影」独立角色契约（玩家要求）：影是独立角色，头像等信息复用雷电将军。
 *
 * 关键点：影原本是雷电将军的别名。只要别名还在，归一化就会把两者合并成同一个人，
 * 玩家永远见不到独立的影；反过来如果把雷电将军的英文别名也删掉，
 * 已有存档里的 Raiden Shogun 会变成第二个雷电将军（重复身份）。
 */

const canonical = fs.readFileSync('data/canonicalCharacters.ts', 'utf8');
const registry = fs.readFileSync('data/teyvatAvatarRegistry.generated.ts', 'utf8');
const overrides = JSON.parse(fs.readFileSync('data/teyvatAvatarNameOverrides.json', 'utf8'));
const enrichment = fs.readFileSync('utils/npcArchiveEnrichment.ts', 'utf8');

assert.match(canonical, /name: '影',/, '原著角色表必须有独立的「影」。');
assert.match(canonical, /aliases: \['雷电影', 'Raiden Ei', 'Ei'\]/, '影必须带自己的别名，且不再依赖雷电将军的别名表。');
assert.match(canonical, /aliases: \['Raiden Shogun', '巴尔泽布'\]/, '雷电将军必须保留 Raiden Shogun / 巴尔泽布，但不能再含「影」。');
assert.doesNotMatch(canonical, /aliases: \[[^\]]*'影'\]/, '雷电将军的别名表里不能再出现「影」。');

// 头像复用：影的默认头像就是雷电将军那张图的副本，且注册表里能查到。
assert.ok(
  fs.existsSync('public/assets/teyvat-avatars/characters/影.webp'),
  '影必须有一张默认头像文件（复用雷电将军头像的副本）。',
);
assert.match(registry, /"canonicalName": "影"/, '头像注册表必须包含影。');
assert.match(registry, /characters\/%E5%BD%B1\.webp/, '影的默认头像路径必须指向 characters/影.webp。');
// roster 覆盖表必须把雷电将军的 roster id 映射到中文名，否则头像审计会掉到 5-star 路径上找不到图。
assert.equal(overrides['raiden-shogun'], '雷电将军', 'roster 覆盖表必须保留 raiden-shogun → 雷电将军。');

// 档案基线：影有自己的一条，年龄确认按原著成年。
assert.match(enrichment, /^\s{2}影: \{/m, '档案基线必须覆盖影。');

console.log('teyvat ei character regression ok');
