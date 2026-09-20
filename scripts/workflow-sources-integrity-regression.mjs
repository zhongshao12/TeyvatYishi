/**
 * 工作流源码视图完整性门禁。
 *
 * 保护三条不变量（都由本项目的真实事故驱动）：
 *
 *  1. WORKFLOW_FILES 里的文件必须存在。
 *     缺失会让 `assert(!text.includes(...))` 负断言空转 —— 静默地「假装还在保护行为」。
 *
 *  2. 被工作流模块 import 的工作流层文件，必须**要么登记进 WORKFLOW_FILES，
 *     要么显式写进 WORKFLOW_OUT_OF_SCOPE 并给出理由**。
 *     事故来源：`services/ai/mainNarrativeRetryPolicy.ts` 与 `mainNarrativeAttemptRunner.ts`
 *     曾被漏登记，导致调用方断言「发送必须走共享请求层」时范围悄悄缩小。
 *     「不在视图里」必须是一个决定，而不是一次遗漏。
 *
 *  3. 回归脚本禁止「一路切到结尾」的切片（`text.slice(text.indexOf(X))`）。
 *     拼接是尾部相接的，这种切片会静默吞掉后面新登记的文件。
 *     事故来源：`inventory-variable-regression.mjs` 的校准阶段切片吞掉了 turnSnapshot.ts。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  WORKFLOW_FILES,
  WORKFLOW_OUT_OF_SCOPE,
  workflowFileSpans,
  readWorkflowSources,
} from './lib/workflowSources.mjs';

function fail(message) {
  console.error(`✗ workflow sources integrity: ${message}`);
  process.exit(1);
}

const root = process.cwd();

// ── 不变量 1：登记的文件必须存在 ────────────────────────────────────────────
for (const file of WORKFLOW_FILES) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`WORKFLOW_FILES 登记的 ${file} 不存在（文件被移动/改名后必须同步登记表）`);
  }
}

// 拼接必须真的包含每个文件的内容（防止读到空文件而断言空转）
const sources = readWorkflowSources(root);
const spans = workflowFileSpans(root);
if (sources.length !== spans[spans.length - 1].end) {
  fail('拼接文本长度与 workflowFileSpans 不一致（区间计算与实际读取不同步）');
}
for (const span of spans) {
  if (span.end <= span.start) {
    fail(`${span.file} 内容为空，登记它只会让断言范围看起来存在`);
  }
}

// ── 不变量 2：工作流层依赖不得漏登记 ────────────────────────────────────────
const WORKFLOW_LAYER = [
  /^hooks\/useGame\/[\w.-]+\.ts$/,
  /^services\/ai\/mainNarrative[\w]*\.ts$/,
  /^services\/ai\/activeApiConfig\.ts$/,
];

function resolveLocalImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  } else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.posix.join(base, 'index.ts')]) {
    if (fs.existsSync(path.join(root, candidate))) return candidate;
  }
  return null;
}

const imported = new Set();
for (const file of WORKFLOW_FILES) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(text))) {
    const resolved = resolveLocalImport(file, match[1]);
    if (resolved && !WORKFLOW_FILES.includes(resolved)) imported.add(resolved);
  }
}

const drifted = [...imported].filter(
  (file) =>
    WORKFLOW_LAYER.some((pattern) => pattern.test(file)) && !(file in WORKFLOW_OUT_OF_SCOPE),
);
if (drifted.length) {
  fail(
    `以下工作流层文件被工作流模块 import，但既未登记进 WORKFLOW_FILES，也未列入 WORKFLOW_OUT_OF_SCOPE：\n` +
      drifted.map((f) => `    - ${f}`).join('\n') +
      `\n  请二选一：登记进视图，或写明「有意排除」的理由。`,
  );
}

// 反向检查：OUT_OF_SCOPE 里列的文件必须真的存在，且不得同时登记进视图
for (const [file, reason] of Object.entries(WORKFLOW_OUT_OF_SCOPE)) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`WORKFLOW_OUT_OF_SCOPE 列出的 ${file} 已不存在，请清理该条目`);
  }
  if (WORKFLOW_FILES.includes(file)) {
    fail(`${file} 同时出现在 WORKFLOW_FILES 和 WORKFLOW_OUT_OF_SCOPE 中，语义矛盾`);
  }
  if (!reason || reason.trim().length < 4) {
    fail(`WORKFLOW_OUT_OF_SCOPE 的 ${file} 缺少可读的排除理由`);
  }
}

// ── 不变量 3：禁止「切到结尾」的切片 ────────────────────────────────────────
// 检测 text.slice(<同一表达式>.indexOf(...)) —— 单参数 slice 且起点是 indexOf。
const TAIL_SLICE = /\.slice\(\s*[A-Za-z_$][\w$.]*\s*\.\s*indexOf\s*\([^)]*\)\s*\)/;

// 自检：保证检测器本身可证伪（否则它可能永远为真，等于没有门禁）。
const TAIL_SLICE_SAMPLES = [
  ['sources.slice(sources.indexOf("a"))', true], // integrity-selftest
  ['text.slice(text.indexOf(X))', true], // integrity-selftest
  ['sendWorkflow.slice(start, end)', false],
  ['sources.slice(sources.indexOf("a"), sources.indexOf("b"))', false],
];
for (const [sample, shouldMatch] of TAIL_SLICE_SAMPLES) {
  if (TAIL_SLICE.test(sample) !== shouldMatch) {
    fail(`尾切片检测器自检失败：${JSON.stringify(sample)} 期望 ${shouldMatch}`);
  }
}

const offenders = [];
for (const name of fs.readdirSync(path.join(root, 'scripts'))) {
  if (!name.endsWith('-regression.mjs')) continue;
  const text = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
  if (!/readWorkflowSources|readWorkflowFile|WORKFLOW_FILES/.test(text)) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // 跳过注释
    if (line.includes('integrity-selftest')) return; // 跳过本门禁自己的可证伪样本
    if (TAIL_SLICE.test(line)) offenders.push(`${name}:${index + 1}: ${line.trim()}`);
  });
}
if (offenders.length) {
  fail(
    `以下脚本在工作流视图上使用了「切到结尾」的切片，会静默吞掉后续登记的文件：\n` +
      offenders.map((o) => `    - ${o}`).join('\n') +
      `\n  改用 sliceWorkflowFile(文件, 起始标记, 结束标记)，或用\n` +
      `  assertSpanWithinSingleFile(start, end) 显式声明区间不跨文件。`,
  );
}

// ── 不变量 4：宽视图不得让【正断言】退化到"谁都能满足" ──────────────────────
// 视图是 38 个文件拼接的：一个字面量只要出现在**任意一个**文件里，断言就成立。
// 命中文件数越多，该断言越接近空转。本项目已实测到两例（都是 9 个文件）：
//   裸 `userInput,`                -> 破坏清洗调用点后断言**仍通过**
//   裸 `catch (error)`             -> 删掉回退动作后断言**仍通过**
// 两者都已改为「同处一地」的有限跨度正则。阈值设 5：超过就该收紧
// （用正则要求相关代码在有限跨度内同时出现，从而仍能随代码整体搬迁）。
const AMBIGUITY_LIMIT = 5;
const fileTexts = new Map(
  WORKFLOW_FILES.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]),
);
const ambiguous = [];
for (const name of fs.readdirSync(path.join(root, 'scripts'))) {
  if (!name.endsWith('-regression.mjs')) continue;
  if (name === 'workflow-sources-integrity-regression.mjs') continue;
  const text = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
  if (!/readWorkflowSources/.test(text)) continue;
  const varRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?readWorkflowSources\s*\(/g;
  const viewVars = new Set();
  let varMatch;
  while ((varMatch = varRe.exec(text))) viewVars.add(varMatch[1]);
  if (!viewVars.size) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const viewVar of viewVars) {
      const re = new RegExp(
        `(!?)\\s*${viewVar}\\s*\\.\\s*includes\\(\\s*(['"])((?:\\\\[\\s\\S]|(?!\\2)[^\\\\])*)\\2`,
        'g',
      );
      let match;
      while ((match = re.exec(line))) {
        // 极性判定：`assert(!x.includes(L))` 是**真负断言**（L 不得存在）；
        // 而 `if (!x.includes(L)) throw` 是**正向意图**（L 必须存在）——只是写成了否定语法。
        // 早期版本把两者一律当负断言跳过，导致后者完全逃过模糊度检查。
        const negated = match[1] === '!';
        const insideIfCondition = /if\s*\(\s*$/.test(line.slice(0, match.index));
        const positiveIntent = negated ? insideIfCondition : true;
        if (!positiveIntent) continue; // 真负断言由另一条不变量覆盖
        const literal = match[3];
        if (literal.length < 3) continue;
        if (literal.includes('\\')) continue; // 含转义时按原文比对不可靠，不参与判定
        const hits = [...fileTexts.values()].filter((t) => t.includes(literal)).length;
        if (hits >= AMBIGUITY_LIMIT) {
          ambiguous.push(
            `    - ${name}:${index + 1} 命中 ${hits} 个文件：${JSON.stringify(literal.slice(0, 80))}`,
          );
        }
      }
    }
  });
}
if (ambiguous.length) {
  fail(
    `以下正断言在宽视图下已被 ${AMBIGUITY_LIMIT}+ 个文件满足，接近空转（破坏其目标代码后仍会通过）：\n` +
      ambiguous.join('\n') +
      `\n  改法：用有限跨度正则要求相关代码「同处一地」，例如\n` +
      `      /normalizePlayerSpeechInBody\\(\\{[\\s\\S]{0,300}?userInput,/.test(view)\n` +
      `  这样既恢复证明力，又保留随代码整体搬迁的鲁棒性。`,
  );
}

// ── 可见性输出：视图规模，便于判断断言范围是否被动地变大 ────────────────────
console.log(
  `[workflow-sources-integrity] ok：${WORKFLOW_FILES.length} 个文件、${sources.length} 字符、` +
    `${Object.keys(WORKFLOW_OUT_OF_SCOPE).length} 个显式排除、0 个尾切片、` +
    `正断言模糊度上限 ${AMBIGUITY_LIMIT}`,
);
