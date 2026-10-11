# Storage repair · 2026-10-09

## Gate / scope

用户授权报告 S01–S07 定向修复。Structural: Local Fix；Execution: 分阶段 Local Fix Only（统一物化边界按 Staged Refactor 管理）。不改格式版本、不新增依赖、不改 B08/B09/Rust、不操作真实玩家数据、不提交推送。保留现有 dirty changes；全套验证由协调者执行。

行为合同：正式 JSON 增量必须恢复正式切片及对话；同 ID 编辑不能被 append 丢弃；普通读取可从完整 IDB fallback，无法物化则抛错，绝不返回占位。重建/替换/清理必须预先校验全部节点及隐藏基线，校验失败不改 live stores/mirrors。桌面备份须内嵌图片、自包含。目录按 ID 并集，冲突服从桌面主存储；索引写入用跨实例排他文件锁，超时拒绝、不偷活锁。

预算：三个存储边界阶段；每阶段审查行为变化，测试不计生产 churn；预计 8 个生产文件，约 300 行总生产增量（批准问题跨多个原有边界，不做整体重写）。删除仅限现有维护流程，经完整节点预校验；回滚仅逆转本任务补丁，不能恢复报告修复前的不安全维护流程。发生目录/依赖不完整或锁超时立即拒绝，保留原数据。

## RED evidence

`$env:TEMP = Join-Path (Get-Location) '.tmp-regression'; $env:TMP = $env:TEMP; node node_modules/vitest/vitest.mjs run tests/unit/storageAuditRepair.test.ts`

旧实现实跑：15/15 失败；S04 实际对话只有 1 条；S05 同 ID 编辑错误允许 append；S01/S02 返回缺旅人的占位；缺 delta/base/坏 JSON 重建错误成功；直接 replace 占位先清掉 IDB 后失败；备份缺旅人；S03 delta/隐藏图片被清理且缺依赖不拒绝；S06 隐藏节点 10；S07 两实例索引只剩 [2]。测试用真实 JSON 文件 Map、真实 fake-indexeddb，所有状态为合成 fixture。

## Progress

| ID | State | Decision |
| --- | --- | --- |
| S01 | GREEN | 统一 materializeSaveNode；桌面/IDB/云/覆盖依赖共用；缺依赖拒绝；IDB-only 资源补取 |
| S02 | GREEN | 严格全库存读取含隐藏/孤儿文件；替换前物化、结构/写入格式/资源预校验；内嵌图片备份脱离 live files 仍恢复 |
| S03 | GREEN | 完整节点及隐藏基线收集引用；依赖缺失 fail closed，不删除文件 |
| S04 | GREEN | universe/schema/正式对话明确判别，JSON 省略手机键不再误入 Legacy |
| S05 | GREEN | 持久化消息内容深比较，同 ID 正文/图片编辑回退 checkpoint |
| S06 | GREEN | ID 并集，桌面同 ID 优先；保留隐藏 ID 元数据及计数 |
| S07 | GREEN | save/delta 全部索引 mutation/repair 的 RMW 受跨实例 CAS 文件锁保护；超时不偷锁、失败后释放 |

## GREEN verification

`node node_modules/vitest/vitest.mjs run tests/unit/storageAuditRepair.test.ts tests/unit/desktopSaveMirrorDelta.test.ts tests/unit/manualSaveDesktopOverwrite.test.ts tests/unit/manualSaveOverwrite.test.ts tests/unit/saveFailureVisibility.test.ts`

最新收口：5 文件、45/45 通过。新回归 24 项；原手动覆盖模拟改成 JSON stringify/parse，保留全部原断言。新增 RED→GREEN 边界包括桌面-only 隐藏目录、IDB-only 图片、hidden 标记不从基线继承、缺 chatBaseLength、完整档缺旅行者、read-only legacy replace 在 clear 前拒绝。另有锁失败释放/超时不偷锁的运行验证。

Focused ESLint（8 个生产文件及 3 个测试文件）exit 0；本域 tracked `git diff --check` exit 0。无 Rust/依赖改动。全量单测/构建/聚合回归由协调者执行。

## Scope check / re-gate

物化、资源预校验和隐藏节点合同补齐后，按原授权重新 Gate 为三个边界 Staged Refactor，仍只涉及 8 个生产模块，无重写/新增外部能力。最终 workspace 默认完整范围检查（`python .../check_patch_scope.py --preset staged-refactor --fail-on-warning`）exit 1：111 文件、4733 行，含其他并行修复、用户旧改动和41个 untracked；报告本身编码被识别为 unknown-line。默认5文件/200行预算不适用本轮31问题联合修复，不能将此结果冒充本域独立预算通过。需要协调者审查整体批次预算。生产 tracked diff 包含旧改动，不能把 HEAD diff 全归为本任务。

## Risks / remaining verification

真实 Rust/Tauri Windows 占用/崩溃/重启尚未验收。CAS 锁采用 fail-closed，崩溃遗留锁不会基于时间被自动偷走，需经用户确认进程均关闭后处理。跨文件替换不是跨文件系统原子事务；本次保证预校验失败不改原数据、事前自包含备份，而不声称崩溃时所有文件同步替换。
