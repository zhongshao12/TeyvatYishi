import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Map([
  ['validation', 'core/contracts/validation.ts'],
  ['./validationSchema', 'core/contracts/validationSchema.ts'],
  ['@/core/contracts/identity', 'core/contracts/identity.ts'],
  ['fixtures', 'tests/unit/core2/fixtures.ts'],
]);
const loaded = new Map();
function load(name) {
  if (!allowed.has(name)) throw new Error(`Unregistered schema generator import: ${name}`);
  if (loaded.has(name)) return loaded.get(name);
  const filename = root + allowed.get(name);
  const source = readFileSync(filename, 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  loaded.set(name, module.exports);
  new Script(`(function(require,module,exports){${javascript}\n})`, { filename }).runInThisContext()(load, module, module.exports);
  return module.exports;
}

const validation = load('validation');
const bundle = { formatVersion: 1, checks: validation.coreSchemaDescriptions() };
const mode = process.argv[2] ?? '--check';
if (mode === '--print') {
  process.stdout.write(JSON.stringify(bundle));
} else if (mode === '--check') {
  const saved = JSON.parse(readFileSync(root + 'core/contracts/nativeSchemas.json', 'utf8'));
  if (JSON.stringify(saved) !== JSON.stringify(bundle)) throw new Error('CORE2_NATIVE_SCHEMA_STALE: regenerate the owned JSON through apply_patch');
  process.stdout.write(`native schema contract synchronized: ${Object.keys(bundle.checks).length} kinds\n`);
} else if (mode === '--corpus') {
  const { makeSeed, makeSource, makeMemory, makeCandidate, makeCommit } = load('fixtures');
  const seed = makeSeed();
  const commit = makeCommit(seed.head);
  const source = makeSource();
  const memory = makeMemory();
  const candidate = makeCandidate();
  const rows = [];
  const add = (kind, input) => rows.push({ kind, input, accepted: validation.validateCoreDto(kind, input).ok });
  for (const [kind, value] of [['seed', seed], ['source', source], ['memory', memory], ['candidate', candidate], ['commit', commit], ...seed.records.map(value => ['state', value])]) {
    add(kind, value); add(kind, { ...value, hiddenPrompt: 'not-declared' });
  }
  add('head', { ...seed.head, parent: { journeyId: seed.head.scope.journeyId, branchId: 'parent' }, forkSeq: 0, forkMemoryRevision: 0 });
  add('head', { ...seed.head, parent: { journeyId: 'foreign', branchId: 'parent' }, forkSeq: 0, forkMemoryRevision: 0 });
  add('source', { ...source, blocks: [{ blockId: 'hidden', kind: 'analysis', text: 'not-visible' }] });
  add('source', { ...source, moment: { ...source.moment, turn: 1.5 } });
  add('memory', { ...memory, sourceRefs: [], eventIds: [], memoryRefs: [] });
  add('candidate', { ...candidate, kind: 'time' });
  add('commit', { ...commit, changes: commit.changes.map(change => ({ ...change, after: change.after && { ...change.after, scope: { journeyId: 'foreign', branchId: 'foreign' } } })) });
  const evidence = candidate.evidenceRefs[0];
  add('evidence', evidence); add('evidence', { ...evidence, end: evidence.end + 1 });
  add('evidence', { ...evidence, quote: '😀', start: 0, end: 2 });
  add('evidence', { ...evidence, quote: '😀', start: 0, end: 1 });
  process.stdout.write(JSON.stringify(rows));
} else {
  throw new Error('Use --print, --check or --corpus; this tool never writes files.');
}
