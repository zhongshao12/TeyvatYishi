# Toolchain gates repair · 2026-10-09

## Scope / contract

协调者增量授权 T01–T04 及本次存储合同导致的桌面门禁迁移。只修改 ESLint 范围、对应 regression scripts、统一 workflow 清单和新增两个小工具；不删门禁原意、不固定成功、不调用真实 API、不全量套跑。使用 code-quality-workflow / systematic-debugging / TDD / verification-before-completion。

## RED evidence

以下命令在修改前均实跑失败：

- `node node_modules/eslint/bin/eslint.js .superpowers/sdd/2026-10-03-public-steambird/client-phase-index.ts`：project service parsing error。
- `node scripts/inventory-variable-regression.mjs`：accepted live settlement guarded root commit 旧字符串错误。
- `node scripts/reroll-regression.mjs`：蒸汽鸟报旧 set蒸汽鸟报 正则错误。
- `node scripts/story-weaving-regression.mjs`：steambirdPrompt.mjs 未装载，ERR_MODULE_NOT_FOUND。
- `node scripts/workflow-sources-integrity-regression.mjs`：postTurnSteambirdTask 未登记；主线新增后又检出 postSettlementTaskState / steambirdRetryTask 未登记。

## Changes / GREEN

| ID | Result | Protected behavior |
| --- | --- | --- |
| T01 | GREEN | `.superpowers/**` 工作草稿不参与类型化 ESLint；未关闭全项目类型检查 |
| T02 | GREEN | inventory 门禁运行真实 settlementCommitIdentity（7测试，正常一次写入/玩家编辑/切档零写入）；reroll 门禁运行真实 steambirdTaskIntegration（5测试，迟到请求不能写新档/保留并发编辑/冻结任务复用） |
| T03 | GREEN | TS AST 遍历 emitted runtime imports/exports/side-effect/literal dynamic imports；递归处理 @/ 与相对路径，显式 stubs 优先，visited 处理环，原剧情断言全部保留 |
| T04 | GREEN | 新增 postTurnSteambirdTask、postSettlementTaskState、recoveredSettlementTasks、steambirdRetryTask 到 workflow 视图；完整性门禁 52 模块通过 |
| Desktop | GREEN | 旧 backup strip/helper 名字检查迁为完整 storageAuditRepair 行为门禁（24项）；验证真实JSON、缺依赖不删除、自包含图片备份脱离 live 镜像仍恢复 |

已实跑通过：`node scripts/inventory-variable-regression.mjs`、`node scripts/reroll-regression.mjs`、`node scripts/story-weaving-regression.mjs`、`node scripts/workflow-sources-integrity-regression.mjs`、`node scripts/desktop-edition-regression.mjs`。新增 `node scripts/regression-module-loader-regression.mjs` 实跑 alias/相对/export/动态import/循环/stub 行为，自动进入聚合扫描。TEMP/TMP 使用 workspace/.tmp-regression。

T01 focused `node node_modules/eslint/bin/eslint.js --no-warn-ignored .superpowers/sdd/2026-10-03-public-steambird/client-phase-index.ts` exit 0；正常 lint 范围仍保留类型化规则。最终 tracked diff whitespace 检查 exit 0。

## Residual / coordinator gates

全量套跑交由协调者。早期 reroll focused 5/5 通过但失败请求 error-report 旁路打印 `indexedDB is not defined`；协调者为其主线测试初始化 fake-indexeddb 后，最终 focused 5/5 通过且该警告消失。

非聚合 `node scripts/desktop-storage-audit.mjs` 在同步本修复相关的目录/物化/缓存检查后仍 exit 1、11 个其他源码形状证据 missing（保存/设置/Rust atomic/迁移备份/跨版本package等），未将静态 missing 当真实存储漏洞，也未扩大范围修复。这不影响已实跑通过的 desktop-edition 行为门禁，但该审计不能报告全绿。
