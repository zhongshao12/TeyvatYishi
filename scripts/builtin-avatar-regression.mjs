import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const avatarSourcePath = path.join(root, 'data', 'builtinAvatars.ts');
const registryPath = path.join(root, 'data', 'teyvatAvatarRegistry.generated.ts');
const registry = fs.readFileSync(registryPath, 'utf8');
const source = fs.readFileSync(avatarSourcePath, 'utf8');

// 2026-09-02 起注册表已激活：registry 必须非空，且全部指向提瓦特头像目录。
assert.match(source, /TEYVAT_AVATAR_SETS/, 'runtime registry must consume the generated Teyvat avatar sets');
assert.match(registry, /TEYVAT_AVATAR_SETS: GeneratedAvatarSet\[\] = \[\s*\{/, 'generated registry must contain at least one avatar set');
assert.doesNotMatch(registry, /march7th|danheng|himeko|welt|pom-pom|herta|asta|arlan|stelle|caelus|bronya/i, 'generated registry must not retain legacy-universe identifiers');
assert.ok(!registry.includes('/assets/builtin-avatars/'), 'generated registry must only serve teyvat-avatars assets');
const srcCount = (registry.match(/\/assets\/teyvat-avatars\/characters\//g) ?? []).length;
assert.ok(srcCount >= 100, `generated registry should serve 100+ teyvat avatars, got ${srcCount}`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teyvat-avatar-regression-'));
const bundlePath = path.join(tempDir, 'builtin-avatars.mjs');

try {
  await esbuild.build({
    entryPoints: [avatarSourcePath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'silent',
  });

  const avatarModule = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
  assert.ok(avatarModule.BUILTIN_AVATAR_SETS.length > 0, 'runtime registry must expose the activated Teyvat avatar sets');
  assert.equal(avatarModule.getBuiltinAvatarSet(undefined), undefined);
  assert.equal(avatarModule.getBuiltinAvatarSet(''), undefined);
  const amber = avatarModule.getBuiltinAvatarSet('安柏');
  assert.ok(amber && amber.candidates.length > 0, '安柏 must resolve through the activated Teyvat registry');
  assert.ok(amber.candidates[0].src.startsWith('/assets/teyvat-avatars/'), 'avatar src must point into the teyvat-avatars directory');
  for (const set of avatarModule.BUILTIN_AVATAR_SETS) {
    assert.ok(set.canonicalName && set.candidates.length > 0, `set ${set.canonicalName} must have candidates`);
  }
  assert.ok(avatarModule.getDefaultBuiltinAvatar('安柏'), '安柏 must resolve to a default avatar');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Builtin avatar regression passed: legacy portraits remain unregistered and neutral fallbacks are safe.');
