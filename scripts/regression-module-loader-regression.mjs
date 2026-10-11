import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { transpileRegressionModuleGraph } from './lib/regressionModuleLoader.mjs';

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(root, '.tmp-regression-loader-'));
const sourceRoot = path.join(temporary, 'source');
const outputRoot = path.join(temporary, 'output');
const fixture = (relative, content) => {
  const target = path.join(sourceRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
};
try {
  fixture('entry.ts', `import '@/sideEffect';
    export { label } from './nested';
    export { stub } from './network';
    export const later = () => import('@/dynamic.ts');`);
  fixture('sideEffect.ts', 'globalThis.__regressionLoaderEffect = "side effect retained"; export {};');
  fixture('nested/index.ts', 'import "../cycle"; export { label } from "./leaf";');
  fixture('nested/leaf.ts', 'export const label: string = "nested export retained";');
  fixture('cycle.ts', 'import "./nested"; export {};');
  fixture('dynamic.ts', 'export const value: string = "dynamic alias retained";');
  fixture('network.ts', 'throw new Error("real network dependency must remain stubbed"); export const stub = "wrong";');
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'network.mjs'), 'export const stub = "explicit stub retained";');
  const visited = transpileRegressionModuleGraph(sourceRoot, outputRoot, ['entry.ts'], new Set(['network.mjs']));
  const loaded = await import(pathToFileURL(path.join(outputRoot, 'entry.mjs')).href);
  assert.equal(loaded.label, 'nested export retained');
  assert.equal(loaded.stub, 'explicit stub retained');
  assert.equal(globalThis.__regressionLoaderEffect, 'side effect retained');
  assert.equal((await loaded.later()).value, 'dynamic alias retained');
  assert.equal(visited.has('nested/leaf.ts'), true);
  assert.equal(visited.has('network.ts'), false);
  console.log('regression module loader behavior ok');
} finally {
  delete globalThis.__regressionLoaderEffect;
  if (path.dirname(temporary) !== path.resolve(root) || !path.basename(temporary).startsWith('.tmp-regression-loader-')) throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(temporary, { recursive: true, force: true });
}
