import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function importBundled(entryPoint) {
  const result = await build({ absWorkingDir: process.cwd(), entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@': process.cwd() }, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const model = await importBundled('services/ai/steambirdModel.ts');
assert.deepEqual(model.buildSteambirdGenerationRequest({ publicFacts: [{ title: '风场异动', detail: '骑士团已发布提醒' }] }), { publicFacts: [{ title: '风场异动', detail: '骑士团已发布提醒' }] });
assert.equal(model.normalizeSteambirdGeneration({ publicArticles: [], privateFacts: [{ title: '不应刊登' }] }), null);
const output = model.normalizeSteambirdGeneration({ publicArticles: [{ id: 'a', section: 'world', status: 'published', title: '公开报道', body: '风场异动', turn: 1, timestamp: 1, important: false, organizationTags: [], relatedSystems: [], narrativeSeriesId: '', narrativeSegmentId: '', createdAt: 1, updatedAt: 1 }] });
assert.equal(output?.[0].title, '公开报道');
console.log('steambird update regression passed');
