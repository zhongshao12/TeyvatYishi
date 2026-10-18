import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const relative = file => path.relative(root, file).split(path.sep).join('/');
const blocked = new Set(['hooks/useGame.ts', 'hooks/useGameState.ts', 'hooks/useTeyvatRuntime.ts', 'hooks/useGame/variableSettlementWorkflow.ts', 'services/teyvatTurnTransaction.ts']);
const writers = new Set(['setNPC', 'setCourier', 'saveGame', 'applyLegacyGameStateOverrides', 'mapTeyvatNpcsToLegacy', 'toLegacyTraveler', 'toLegacyWorld', 'fromLegacyStoryWeaving']);
const entryFlag = process.argv.indexOf('--entry');
const entry = path.resolve(root, entryFlag >= 0 ? process.argv[entryFlag + 1] ?? '' : 'components/features/Core2/Core2Runtime.tsx');
if (!entry.startsWith(root) || !existsSync(entry)) throw Error('CORE2_BOUNDARY_ENTRY_INVALID');
const seen = new Set(), violations = [];
function resolve(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const target = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  if (/\.(?:css|json|png|jpe?g|webp|svg|woff2?|ttf)$/iu.test(target)) return null;
  for (const file of [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.mjs`, path.join(target, 'index.ts'), path.join(target, 'index.tsx')]) {
    if (/\.(?:[cm]?[jt]sx?)$/u.test(file) && existsSync(file)) return file;
  }
  violations.push({ kind: 'unresolved_local_import', file: relative(from), specifier }); return null;
}
function visit(file, trace) {
  if (seen.has(file)) return; seen.add(file);
  const name = relative(file), route = [...trace, name];
  if (blocked.has(name)) { violations.push({ kind: 'forbidden_module', file: name, trace: route }); return; }
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const aliases = new Set(writers), edges = new Set();
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        if (bindings.elements.length && bindings.elements.every(element => element.isTypeOnly)) continue;
        for (const element of bindings.elements) if (!element.isTypeOnly && writers.has((element.propertyName ?? element.name).text)) aliases.add(element.name.text);
      }
      if (ts.isStringLiteral(node.moduleSpecifier)) edges.add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(element => element.isTypeOnly)) continue;
      edges.add(node.moduleSpecifier.text);
    }
  }
  const walk = node => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) edges.add(node.arguments[0].text);
        else violations.push({ kind: 'unresolved_dynamic_import', file: name, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
      const called = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
      if (called && aliases.has(called)) violations.push({ kind: 'legacy_writer_call', file: name, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, called, trace: route });
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  for (const specifier of edges) { const dependency = resolve(file, specifier); if (dependency) visit(dependency, route); }
}
visit(entry, []);
console.log(JSON.stringify({ entry: relative(entry), files: seen.size, violations }, null, 2));
if (violations.length) process.exitCode = 1;
