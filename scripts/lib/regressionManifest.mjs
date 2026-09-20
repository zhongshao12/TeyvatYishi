/** 不符合 *-regression.mjs 命名规则但必须进入全量回归的脚本。 */
export const EXTRA_REGRESSION_SCRIPTS = [
  'builtin-tavern-preset-surface-audit.mjs',
  'check-node-version.mjs',
  'npc-ledger-variable-facts-behavior.mjs',
  'teyvat-runtime-language-audit.mjs',
  'validate-story-weaving-canon.mjs',
];

/**
 * 这些顶层脚本是显式人工工具：它们会生成/改写文件、依赖真实桌面安装包或访问线上发布源，
 * 因而不能被普通 `pnpm test` 自动执行。新增脚本必须在这里明确登记，或接入全量回归。
 */
export const INTENTIONAL_MANUAL_SCRIPTS = [
  'bundle-size-report.mjs',
  'desktop-code-signing-decision.mjs',
  'desktop-github-release-notes.mjs',
  'desktop-github-upload-commands.mjs',
  'desktop-install-update-drill.mjs',
  'desktop-preflight.mjs',
  'desktop-readiness.mjs',
  'desktop-release-gates.mjs',
  'desktop-sign-updater.mjs',
  'desktop-stage-release.mjs',
  'desktop-storage-audit.mjs',
  'desktop-storage-strategy.mjs',
  'desktop-update-manifest.mjs',
  'desktop-verify-online-update.mjs',
  'desktop-verify-release-gates.mjs',
  'desktop-verify-release.mjs',
  'optimize-teyvat-avatar.mjs',
  'run-prompt-regressions.mjs',
  'sync-teyvat-avatar-manifest.mjs',
  'teyvat-avatar-contact-sheet.mjs',
  'teyvat-avatar-registry-sync.mjs',
  'zhiku-project-language-audit.mjs',
  'zhiku-stage2-legacy-save-acceptance.mjs',
];

/** 只被其他脚本 import 的顶层支持模块，不是可独立执行的门禁。 */
export const REGRESSION_SUPPORT_MODULES = [
  'desktop-release-rules.mjs',
  'teyvat-avatar-roster.mjs',
];
