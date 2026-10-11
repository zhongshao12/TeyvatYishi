import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Compile the emitted runtime graph, including relative/alias imports, exports,
 * side-effect imports and literal dynamic imports. Existing explicit stubs win. */
export function transpileRegressionModuleGraph(root, outputRoot, entries, stubPaths = new Set()) {
  const visited = new Set();
  const outputName = source => source.replace(/\.(?:tsx?|jsx?|mjs)$/, '.mjs');
  const compile = relative => {
    relative = relative.replaceAll('\\', '/');
    const outputRelative = outputName(relative);
    if (visited.has(relative) || stubPaths.has(outputRelative)) return;
    const sourcePath = path.resolve(root, relative);
    const fromRoot = path.relative(root, sourcePath);
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new Error(`Regression import escapes root: ${relative}`);
    visited.add(relative);
    let output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const parsed = ts.createSourceFile(outputRelative, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const edits = [];
    const dependencies = [];
    const rewrite = literal => {
      const specifier = literal.text;
      if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return;
      const candidate = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2)) : path.resolve(path.dirname(sourcePath), specifier);
      const base = /\.(?:tsx?|jsx?|mjs)$/.test(candidate) ? candidate.replace(/\.(?:tsx?|jsx?|mjs)$/, '') : candidate;
      const dependency = [candidate, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (!dependency) throw new Error(`Regression dependency missing: ${relative} -> ${specifier}`);
      const dependencyRelative = path.relative(root, dependency).replaceAll('\\', '/');
      let rewritten = path.posix.relative(path.posix.dirname(outputRelative), outputName(dependencyRelative));
      if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
      edits.push({ start: literal.getStart(parsed), end: literal.getEnd(), text: JSON.stringify(rewritten) });
      dependencies.push(dependencyRelative);
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) rewrite(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) rewrite(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    const target = path.join(outputRoot, outputRelative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, 'utf8');
    dependencies.forEach(compile);
  };
  entries.forEach(compile);
  return visited;
}
