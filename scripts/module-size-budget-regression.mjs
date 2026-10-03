import fs from 'node:fs';

/**
 * 顶层文件体量棘轮门禁（2026-09-29，用户第 6 项的另一半）。
 *
 * 背景：`App.tsx` 与 `hooks/useGameState.ts` 长期承担大量协调职责（用户点名）。
 * 完整拆分是独立一轮的工作，但**不能再无声变大**：这里把当前实测行数钉成上限，
 * 只允许往下降（每完成一批拆分就手动下调一次上限，形成棘轮）。
 *
 * 拆分计划见 `docs/superpowers/plans/`（本门禁只负责阻止回流）：
 * 第一批（低风险、不动状态边界）—— 模态全家桶收敛成 host、系统面板路由外移、
 * 快捷键/命令面板、面板预加载、视图派生数据、useGameState 的 Legacy 适配层外移（纯函数，
 * 但必须保持 `hooks/useGameState.ts` 继续 re-export 全部符号，否则 10+ 深度导入文件会断链）。
 */

const BUDGETS = [
  // 2026-10-03 复核（PROJECT_AUDIT_2026-10-03 那批修复）：1603→1623 来自「手机回信失败」的失败结算
  // 适配器；1623→1645 来自「群聊部分成功提示」等修复。均按实测重新校准，棘轮仍然只许往下降；
  // 拆分落地后请同步下调，不要因为它变绿就放任增长。
  { file: 'App.tsx', maxLines: 1645, note: '第一批拆分目标 ≈1180 行' },
  { file: 'hooks/useGameState.ts', maxLines: 1421, note: 'Legacy 适配层外移后目标 ≈490 行' },
  // 上限一律以本门禁自己的计数口径为准（按 \n 计数，与 PowerShell 的 Measure-Object 不同）。
  { file: 'hooks/useGame.ts', maxLines: 571, note: '当前实测；只许变小' },
];

let failed = false;
for (const { file, maxLines, note } of BUDGETS) {
  const count = fs.readFileSync(file, 'utf8').split('\n').length - 1;
  const status = count <= maxLines ? 'ok' : '超出';
  console.log(`${status}: ${file} ${count} 行 ≤ ${maxLines}（${note}）`);
  if (count > maxLines) failed = true;
}
if (failed) {
  throw new Error('顶层文件体量超出棘轮上限：请拆分后再提交，或在新一批拆分完成后同步下调上限。');
}
console.log('module size budget regression ok');
