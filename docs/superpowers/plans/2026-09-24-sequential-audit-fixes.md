# 顺序修复审计问题

目标：按 2026-09-24 审计的优先级逐项修复，先修行为误导和数据保存风险，再修检查流程与覆盖缺口。当前分支 `codex/sequential-audit-fixes`，不改存档格式，不推送远端。

## 任务 1：队列“取消”明确为停止整个回合

- 根因：`VariableDrawer` 的单项“取消”调用 `App.handleCancelTask`，后者中止主回合共享控制器，并仅为点选任务追加取消记录。
- 测试先行：为队列抽屉添加交互测试，断言按钮显示“停止本回合”，点击仍传入对应任务 ID；为队列记录状态补充回归断言，确保不声称只取消一项。
- 最小改动：`VariableDrawer.tsx` 改标签及提示；`App.tsx` 在确有活跃控制器时中止回合，并将本回合当前 pending 任务标成 cancelled，避免单项误报；交由工作流 `catch/finally` 完成回滚和加载状态清理。
- 验证：相关 Vitest、类型检查、构建。

## 任务 2：世界书与设置保存应确认落盘结果

- 先写失败路径测试：模拟 `saveSetting` 拒绝，世界书不关闭且给出错误；成功后才关闭。设置的保存失败亦给出可见反馈。
- 在 `WorldbookManagerModal.tsx`/`App.tsx` 和 `SettingsModal.tsx` 仅调整保存边界，不改持久化 schema；避免未处理 Promise。
- 验证：针对性 UI/设置测试及完整单测。

## 任务 3：同伴资料编辑后的保存可靠性

- 先写回归测试：编辑成功后触发当前存档的防抖写入或提供显式保存反馈；失败时不得显示已保存。
- 复用现有存档服务和写入队列，不建立第二套存档通道。
- 验证：同伴 UI、存档隔离和完整单测。

## 任务 4：本地 lint 被诊断产物污染

- 先复现 `.triage` 导致的 lint 失败；在 `eslint.config.mjs` 忽略该 Git-ignored 诊断目录。
- 验证：`pnpm lint` 无 error；存量 warning 单独记录，不在本轮无关重构。

## 任务 5：测试覆盖与打包风险

- 为以上修复各补一条负向测试。剩余覆盖、循环 chunk 与包体问题先测量、定位，再决定独立修复边界，避免为了指标改动大模块。
- 最终门禁：`pnpm build`、`pnpm test:unit`、`pnpm lint`；回顾 diff 与现存 warning。

## 本轮执行记录

- 任务 1—4 已实现并加入失败路径测试。停止回合仅标记当前回合各任务最新的 pending 记录；空闲时不显示停止按钮。
- 世界书保存等待写入成功才关闭，失败留在编辑器；设置失败有错误提示。同伴资料有效保存后触发防抖自动存档，失败会重试并提示。
- `pnpm test` 最终门禁通过：174 个单测文件 / 1041 项单测、190 个脚本回归、发布回归与包体门禁；`pnpm lint` 为 0 error、146 条存量 warning。
- Vitest 覆盖率原先包含 `.triage` 临时诊断文件，排除后真实语句覆盖率 33.07%。风险较高的 `sendWorkflow.ts`、`dbService.ts`、`chatCompletionClient.ts` 分别仅约 10.16%、6.49%、5.62%，下一批应补集成/失败路径测试。
- 构建仍提示 `app-content → app-core → app-content` 循环分包，但包体门禁通过；因涉及多个数据模块的运行时依赖，需独立拆依赖并测冷启动，不在本轮盲改 chunk 归属。

## 下一批：内容分包循环依赖

- 通过 sourcemap 与运行时导入图定位内容模块反向依赖：世界书配置、提示词模块、图鉴数据以及其运行时工具。为这些内容依赖补充 `manualChunkStrategy` 测试，再将提供方归入同一 `app-content` 分包；源码 API 与存档格式未改。
- `pnpm build` 不再报告 `app-content ↔ app-core` 循环；`pnpm test:bundle-size` 通过（总 gzip 811.2 KB，预算 1024 KB）。该修复仅验证静态构建与体积，实际浏览器冷启动仍需单独测量。

## 下一批：云备份暂存清理中止路径

- `deleteCloudMergeStagedRecord` 与 `clearCloudMergeStaging` 原先没有监听 IndexedDB 事务的 `abort` 事件；仅触发中止时，调用方的 Promise 会一直等待。补充失败路径测试后，增加中止时的明确拒绝，沿用各操作现有的错误文案。

## 后续稳定性：共享 SSE 解析入口

- 业务回调曾与 `JSON.parse` 共用一个 `catch`，导致消费侧错误被误判为畸形帧并静默吞掉；现在只跳过 JSON 解析失败，消费侧异常向上抛出。
- 回调触发中止后，同一网络块内剩余已缓冲帧曾继续分发；现在每帧分发前检查中止信号。两种行为均先用失败测试复现。
