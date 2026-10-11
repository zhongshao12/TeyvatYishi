import fs from 'node:fs';
import { runFocusedBehaviorRegression } from './lib/runFocusedBehaviorRegression.mjs';
const adapter = fs.readFileSync('components/features/Codex/productionAdapter.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(/buildCodexArchiveItems\(codex: ArchiveCodex, npcRecords: readonly NPC记录\[\] = \[\]\)/.test(adapter), 'production adapter must accept formal Codex and an optional public NPC overlay.');
assert(adapter.includes('buildCodexEntryInjectionPreview') && adapter.includes('unlocked:'), 'adapter must preserve injection preview and unlock state.');
runFocusedBehaviorRegression(['tests/unit/codexCharacterVisibility.test.tsx']);
console.log('codex production adapter regression ok');
