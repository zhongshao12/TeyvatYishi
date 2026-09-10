import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export { 获取图鉴人物名, 获取图鉴人物名列表 } from './models/codexArchive.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'codex-character-display-name-regression-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const { 获取图鉴人物名, 获取图鉴人物名列表 } = await import(moduleUrl);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const amphoreusPreset = JSON.parse(
  fs.readFileSync('public/zhiku-presets/legacy-hsr/amphoreus-character-rebuild.json', 'utf8'),
);

for (const id of [
  'zhiku_character_rebuild_anaxa_profile',
  'zhiku_character_rebuild_cipher_profile',
  'zhiku_character_rebuild_tribbie_profile',
  'zhiku_character_rebuild_cerydra_profile',
  'zhiku_character_rebuild_mydei_profile',
  'zhiku_character_rebuild_cyrene_profile',
  'zhiku_character_rebuild_castorice_profile',
]) {
  const entry = amphoreusPreset.entries.find((item) => item.id === id);
  assert(entry, `missing regression fixture: ${id}`);

  const displayName = 获取图鉴人物名(entry);
  assert(displayName === entry.标题, `${entry.标题}: expected ${entry.标题}, got ${displayName}`);
  assert(
    获取图鉴人物名列表(entry).includes(entry.关联角色ID ?? ''),
    `${entry.标题}: internal role id must remain available as an alias`,
  );
}

const chineseRelatedRole = {
  标题: '瓦尔特·杨',
  关联角色ID: '瓦尔特·杨',
  关键词: ['角色:瓦尔特'],
};
assert(获取图鉴人物名(chineseRelatedRole) === '瓦尔特·杨', 'Chinese related-role display name must keep precedence.');

console.log('ZHIKU_CHARACTER_DISPLAY_NAME_REGRESSION_OK');
