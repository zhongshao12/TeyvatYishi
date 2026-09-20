export function collectPackageScriptClosure(packageScripts, roots = ['test']) {
  const reached = new Set();
  const pending = [...roots];
  while (pending.length) {
    const name = pending.shift();
    if (!name || reached.has(name) || typeof packageScripts[name] !== 'string') continue;
    reached.add(name);
    const command = packageScripts[name];
    const childPattern = /\b(?:pnpm|npm(?:\.cmd)?)\s+(?:run\s+)?([\w:-]+)/gu;
    for (const match of command.matchAll(childPattern)) {
      if (packageScripts[match[1]] && !reached.has(match[1])) pending.push(match[1]);
    }
  }
  return reached;
}

export function collectNodeScriptEntries(packageScripts, scriptNames) {
  const entries = new Set();
  const nodePattern = /\bnode\s+scripts\/([\w.-]+\.mjs)\b/gu;
  for (const name of scriptNames) {
    const command = packageScripts[name];
    if (typeof command !== 'string') continue;
    for (const match of command.matchAll(nodePattern)) entries.add(match[1]);
  }
  return entries;
}

export function findUnclassifiedScripts(allNames, classifiedNames) {
  const classified = new Set(classifiedNames);
  return [...allNames].filter((name) => !classified.has(name)).sort();
}
