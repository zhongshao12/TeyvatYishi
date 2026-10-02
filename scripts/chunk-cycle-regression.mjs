import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * 分包循环门禁（2026-09-29）。
 *
 * 症状：构建输出 `Circular chunk: app-content -> app-core -> app-content. Please adjust the manual
 * chunk logic for these chunks.`（用户直接引用过这句）。
 *
 * 成因：`build/manualChunkStrategy.ts` 把若干 `data/*` 内容模块划进 `app-content`，而这些模块又
 * **运行时静态导入**了 `app-core` 里的模块（`import type` 会被擦除，不算），于是
 * app-content → app-core →（app-core 里那些 data 模块的引用者）→ app-content 形成环。
 *
 * 硬断言（确定性、不依赖构建）：`app-content` 成员里不存在任何**运行时**静态导入到 `app-core` 模块的边。
 * 附加（尽力而为）：能跑 `vite build` 时，断言输出里没有 `Circular chunk` 警告。
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ROOT = process.cwd();
const strategyPath = 'build/manualChunkStrategy.ts';
const strategy = fs.readFileSync(strategyPath, 'utf8');

// 与策略文件同源的会员规则（下面的 assert 会校验这些模块名确实仍写在策略文件里，避免两处漂移）。
const APP_CONTENT_EXTRA = [
  'models/prompts', 'models/codex', 'models/codexArchive', 'models/codexGovernance', 'models/teyvat/elements',
  'services/elementalAttunementService', 'services/promptDelivery', 'services/contentResourceStatus',
  'compat/legacy-hsr/readOnly', 'utils/valueGuards',
];
const APP_CONTENT_DATA = [
  'storyWeavingCanonDecomposed', 'teyvatAvatarRegistry.generated', 'canonicalCharacters', 'courierWorldbook',
  'companionArchiveWorldbook', 'variableWorldbook', 'weatherRules', 'nsfwWorldbook', 'steambirdWorldbook',
  'modelRecommendations', 'openingCompanionScenes', 'keyboardShortcutDefaults', 'teyvatAvatarNameOverrides',
  'gameMenu', 'homeBackgrounds', 'questWorldbook', 'storyWeavingWorldbook', 'characterPresets',
  'releaseAnnouncements', 'journeyPresets', 'builtinPromptModules', 'codexPreset', 'builtinWorldbookConfig',
  'codexIdentityRegistry', 'storyModeWorldbooks', 'codexCustomGovernance',
];
const LAZY_HOOKS = [
  'contextSnapshot', 'narrativeImageWorkflow', 'postSettlementRecoveryWorkflow', 'variableSettlementWorkflow',
  'postSettlementCommitStage', 'sendPreparationStage', 'variableCalibrationStage', 'mainPromptAssembly',
  'aiMessageStage', 'autoSaveStage', 'apiMessagesStage', 'elementalSettlementStage', 'memoryUpdateStage',
  'worldCommitStage', 'mainNarrativeStreamingStage', 'mainNarrativeRequestStage',
];

// 0) 防漂移：上面用到的每个模块名（取路径末段、去掉扩展名）都必须仍出现在策略文件里。
//    策略里会写成 `models\/(?:prompts|codex|…)` 这类转义形式，逐字比对不成立，因此只比对末段 token。
for (const name of [...APP_CONTENT_EXTRA, ...APP_CONTENT_DATA]) {
  const token = name.split('/').pop().split('.')[0];
  assert(strategy.includes(token),
    `策略文件里已不存在 ${token}（来自 ${name}）：本门禁的会员镜像与 build/manualChunkStrategy.ts 漂移，请同步更新两侧。`);
}

function classify(absPath) {
  const id = absPath.replace(/\\/g, '/');
  if (new RegExp(`/hooks/useGame/(?:${LAZY_HOOKS.join('|')})\\.ts$`).test(id)) return 'lazy-hook';
  if (id.includes('/prompts/')) return 'app-content';
  if (id.includes('/data/') && APP_CONTENT_DATA.some((name) => id.endsWith(`/${name}.ts`) || id.endsWith(`/${name}.json`))) return 'app-content';
  if (APP_CONTENT_EXTRA.some((name) => id.endsWith(`/${name}.ts`))) return 'app-content';
  if (id.includes('/services/') || id.includes('/hooks/') || id.includes('/models/')) return 'app-core';
  return 'other';
}

function resolveSpec(spec, fromFile) {
  let target = null;
  if (spec.startsWith('@/')) target = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) target = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${target}.ts`, `${target}.tsx`, `${target}.json`, path.join(target, 'index.ts'), target]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const roots = ['data', 'prompts', 'models', 'services', 'utils', 'compat', 'hooks'].map((dir) => path.join(ROOT, dir));
const files = roots.flatMap((dir) => walk(dir));
const appContentFiles = files.filter((file) => classify(file) === 'app-content');
assert(appContentFiles.length >= 20, `app-content 成员过少（${appContentFiles.length}），会员镜像可能已经失效。`);

const runtimeEdges = [];
for (const file of appContentFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/^\s*import\s+([^'"]*?)from\s*['"]([^'"]+)['"]/gm)) {
    if (/^\s*type\b/.test(match[1])) continue; // import type 会被擦除，不构成运行时环边
    const resolved = resolveSpec(match[2], file);
    if (resolved && classify(resolved) === 'app-core') {
      runtimeEdges.push(`${path.relative(ROOT, file).replace(/\\/g, '/')} → ${path.relative(ROOT, resolved).replace(/\\/g, '/')}`);
    }
  }
}
assert(
  runtimeEdges.length === 0,
  `app-content 不得运行时静态导入 app-core（会形成 Circular chunk: app-content -> app-core -> app-content）：\n  ${runtimeEdges.join('\n  ')}`,
);

// 附加：能构建就顺带确认构建输出里没有循环警告（构建不可用时跳过，不让门禁依赖环境）。
const build = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
  cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 300000,
});
if (build.status === 0 && typeof build.stdout === 'string') {
  const circular = build.stdout.split('\n').filter((line) => /Circular chunk/i.test(line));
  assert(circular.length === 0, `构建仍报告循环分包：\n  ${circular.join('\n  ')}`);
  const appContent = /app-content-[\w-]+\.js\s+([\d.,]+) kB/.exec(build.stdout);
  const appCore = /app-core-[\w-]+\.js\s+([\d.,]+) kB/.exec(build.stdout);
  console.log(`chunk-cycle-regression: ok（app-content ${appContent?.[1] ?? '?'} KB / app-core ${appCore?.[1] ?? '?'} KB，无循环警告）`);
} else {
  console.log('chunk-cycle-regression: ok（静态检查通过；构建不可用或失败，跳过构建期断言）');
}
