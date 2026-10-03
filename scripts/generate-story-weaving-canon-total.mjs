import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const args = process.argv.slice(2);
const mode = args[0];
if (!['--check', '--write'].includes(mode) || args.slice(1).some((arg, i) => i % 2 === 0 && arg !== '--target')) {
  console.error('Usage: node scripts/generate-story-weaving-canon-total.mjs --check|--write [--target FILE]');
  process.exit(2);
}
const target = path.resolve(args[args.indexOf('--target') + 1] && args.includes('--target') ? args[args.indexOf('--target') + 1] : 'data/storyWeavingCanonDecomposed.json');
try {
  // Registry order, never directory order or title matching.
  const registry = fs.readFileSync('data/storyWeavingPreset.ts', 'utf8').split('const CANON_START_SERIES_ID')[0];
  const ids = [...registry.matchAll(/id: '(story_canon_[^']+)'/g)].map(match => match[1]);
  assert.equal(ids.length, 19);
  assert.equal(new Set(ids).size, ids.length);
  const series = ids.map(id => {
    const value = JSON.parse(fs.readFileSync(path.join('public/data/story-weaving-canon', `${id}.json`), 'utf8'));
    assert.equal(value.id, id);
    assert.equal(new Set(value.分段列表.map(segment => segment.id)).size, value.分段列表.length);
    for (const segment of value.分段列表) {
      assert(segment.原文内容 && segment.本段概括 && segment.本段结束状态.length && segment.关键事件.length, `${segment.id}: incomplete decomposition`);
      assert.equal(new Set((segment.场景节点 ?? []).map(scene => scene.id)).size, (segment.场景节点 ?? []).length);
    }
    return value;
  });
  const current = JSON.parse(fs.readFileSync(target, 'utf8'));
  const generated = { ...current, 系列列表: series };
  if (mode === '--check') {
    if (!isDeepStrictEqual(current, generated)) throw new Error('剧情资源漂移：总表与 public 权威源语义不一致；请审阅差异后显式 --write');
    console.log(`story canon check ok: ${series.length} series`);
  } else {
    fs.writeFileSync(target, `${JSON.stringify(generated, null, 2)}\n`);
    console.log(`story canon generated: ${series.length} series`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
