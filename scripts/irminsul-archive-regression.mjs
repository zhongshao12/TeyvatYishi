import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function importBundled(entryPoint) {
  const result = await build({ absWorkingDir: process.cwd(), entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@': process.cwd() }, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const [archive, retrieval] = await Promise.all([importBundled('services/irminsulArchive.ts'), importBundled('services/irminsulRetrieval.ts')]);
const entry = archive.buildIrminsulArchiveEntry({ id: 'memory', title: '风起之忆', summary: '抵达蒙德', sourceTurns: [1], keywords: ['蒙德'], recordedAt: '1', archiveType: 'refined', sourceText: '正文', turn: 1, untrusted: true });
assert.equal(Object.hasOwn(entry, 'untrusted'), false);
assert.deepEqual(retrieval.retrieveIrminsulEntries({ entries: [entry] }, '蒙德', 1).map((item) => item.id), ['memory']);
console.log('irminsul archive regression passed');
