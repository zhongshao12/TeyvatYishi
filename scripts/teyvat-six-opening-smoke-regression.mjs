import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function loadOpeningHarness() {
  const bundled = await build({
    stdin: {
      contents: `
        export { OFFICIAL_OPENING_PRESETS } from './models/teyvat/opening.ts';
        export { createTeyvatGameFromOpeningPreset } from './services/teyvatOpeningFactory.ts';
      `,
      resolveDir: process.cwd(),
      sourcefile: 'teyvat-six-opening-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}

const harness = await loadOpeningHarness();
const presets = harness.OFFICIAL_OPENING_PRESETS;

assert.equal(presets.length, 6, 'release smoke must cover exactly the six official opening presets');
assert.deepEqual(
  presets.map((preset) => preset.regionId),
  ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan'],
  'the six opening presets must cover the planned regions in canonical order',
);

const seenStates = new Set();
for (const preset of presets) {
  const state = harness.createTeyvatGameFromOpeningPreset(preset.id);
  assert.equal(state.universe, 'teyvat', `${preset.id} must create a Teyvat runtime`);
  assert.equal(state.schemaVersion, 2, `${preset.id} must create schema 2`);
  assert.equal(state.世界.当前地区, preset.regionId, `${preset.id} must retain its planned region`);
  assert.equal(state.世界.当前地点, preset.location, `${preset.id} must retain its planned location`);
  assert.ok(state.世界.当前地点.trim(), `${preset.id} must have a non-empty location`);
  assert.equal(state.旅行者.身份, preset.identitySeed.身份, `${preset.id} must seed the custom traveler identity`);
  assert.notEqual(state.旅行者.id, 'aether', `${preset.id} must not alias the custom traveler to Aether`);
  assert.notEqual(state.旅行者.id, 'lumine', `${preset.id} must not alias the custom traveler to Lumine`);
  assert.notEqual(state.旅行者, preset.identitySeed, `${preset.id} must own an independent traveler profile`);
  assert.equal(seenStates.has(state), false, `${preset.id} must return an independent root state`);
  seenStates.add(state);

  const originalSeedIdentity = preset.identitySeed.身份;
  state.旅行者.身份 = 'mutation-probe';
  const secondState = harness.createTeyvatGameFromOpeningPreset(preset.id);
  assert.equal(preset.identitySeed.身份, originalSeedIdentity, `${preset.id} must not expose a mutable preset seed`);
  assert.equal(secondState.旅行者.身份, originalSeedIdentity, `${preset.id} must create an independent traveler on every call`);
  state.旅行者.身份 = originalSeedIdentity;

  const serialized = JSON.stringify(state);
  assert.doesNotMatch(
    serialized,
    /命途|光锥|黑塔空间站|星穹列车|星核|忆庭|开拓者/,
    `${preset.id} must not serialize retired runtime vocabulary`,
  );
}

console.log(`[teyvat-six-opening-smoke-regression] PASS ${presets.length}/${presets.length}`);
