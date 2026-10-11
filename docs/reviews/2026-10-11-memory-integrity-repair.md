# 逐回合记忆与世界树整理修复验收

日期：2026-10-11。分支：`codex/npc-affinity-memory-consistency`。
范围：已批准实施计划的记忆问题 7–10；不混入未提交手机照片改动，不自动合并或推送。
状态：Task 1–8 全部完成。7 个原计划实现提交＋1 个复审修复提交；最终文档独立提交。以下数字是实跑证据，不代表真实供应商效果已验收。

## 修复效果

- 每个可恢复的完整回合单独生成短期摘要；进度分组不再把 15 个回合挤成一次摘要。失败恢复从未完成回合/晋升阶段继续。
- 原文、消息身份、实际来源回合与历史世界时刻一起保留。超过 2,000 项来源映射不截断，超过 50 条即时记忆不在归档前删除；未知历史时刻显示未记录。
- 重建只替换所选范围内可验证、未编辑来源；范围外、跨范围、缺口、未知来源、玩家修改保留。
- 即时→短期→中期→长期使用独立阈值。自动整理、手动整理、世界树一键压缩和失败重试复用同一规则；失败原文与完整材料保留，不每回合重复请求 pending。
- 异步结果按 session/root/来源原值核验，记忆和世界树原子合并。取消、切档、重掷、源删除/修改后拒绝旧结果，无关追加保留。
- 保存失败明确显示“页面已更新，保存失败”；重试保存不重新请求模型。取消整理不停止主剧情回合。
- 世界树新增一键压缩、进度、取消和原因反馈。重建弹窗独立 portal、高于系统面板；缺口列表滚动、Tab 限定、Esc 只关顶层、入口焦点恢复。

## 分任务验证与提交

| 任务 | 提交 | 完整单测 | 回归脚本 | app-core KB |
| --- | --- | --- | --- | --- |
| 来源及投影 | bd9ae39 | 301 文件 / 2242 | 192/192 | 1165.1 |
| 范围与 CAS 合并 | 5929661 | 302 / 2257 | 192/192 | 1165.2 |
| 共享分层规则 | 22e586e | 303 / 2270 | 192/192 | 1163.3 |
| 逐回合及断点恢复 | ff2b7df | 304 / 2280 | 192/192 | 1163.3 |
| 会话与保存身份 | 9e6e726 | 306 / 2299 | 192/192 | 1159.8 |
| 全入口迁移 | 57ec566 | 307 / 2309 | 192/192 | 1147.4 |
| UI 与世界树入口 | e26543c | 308 / 2316 | 192/192 | 1148.0 |

每项先观察业务断言 RED，再实现 GREEN；既有门禁从旧实现位置升级为行为契约，未放宽体积限制。T7 完整 `pnpm test` 最终退出 0，包含构建、全量单测、release/资源、体积与全部回归。复审修复提交 d2c4f0c 后，最终 pnpm test 退出 0：309 文件 / 2327 测试、192/192 回归、生产构建与 release/资源全部通过。最终定向 19 文件 / 146 测试通过；tsc -b --force 通过；ESLint 0 错误、18 个既有警告和 1 个新增非 DOM ref 清理提示；diff check 通过。

Windows 默认 TEMP 的 esbuild 清理 ACL 曾失败，改用计划目录下的临时目录实跑通过；没有用产品代码绕过构建。最终体积：index 227.8 / app-core 1148.5 / total JS 2977.9 / gzip 943.6 KB，现有门限保持。

## 浏览器验收

使用 bundled Node Playwright + 已安装 Chrome、独立临时浏览器上下文、本地合成历史、完整产品样式，检查 390×844 和 1440×900 两个视口。30 条无法定位历史提示强制产生可滚动区域，实际 scrollTop > 0；覆盖层 z60（高于 z50 面板、低于 z130 确认窗），开始/取消/关闭可点击，重复开始只调用一次，取消迟到结果不显示保存成功，Tab 留在顶层，Esc 后下层保留且焦点回到入口，零 pageerror。最终截图已人工查看。

最初未加载完整样式的夹具结果不计验收，补齐样式重新运行。没有操作真实玩家数据库、浏览器个人资料或收费模型。启动的测试服务器由夹具停止，未触碰玩家服务。

## 独立整体复审

复审包范围：`bfbf8b8..e26543c`，7 个实现提交。独立 fresh-context 只读审阅：0 Critical、2 Important、0 Minor，结论 With fixes。两项均确认并在唯一一次修复轮解决：

1. 重复回合号将输入 A 与回复 B 混配；现在跨玩家段不能当作重掷，同号多玩家输入保守跳过并保留原记录；删除旧来源必须核验可恢复的消息身份，不能仅凭回合号。两条提取、两条结算来源测试观察 RED→GREEN。
2. await 首次模块加载后才绑定 session；现在加载前捕获 session/root/取消代数，关闭、取消、切档或换根后不调用协调器；相同草稿 ID 不能误改新档。六条延迟加载/取消案例 RED→GREEN；暂时去掉 root 校验的一条测试独立 RED，再恢复 GREEN。

复审修复提交：`d2c4f0c`。19 文件 / 146 定向测试以及完整 2327 单测、192 回归通过。没有第二次复审；修复由 TDD 和全量门禁验证。审阅者不判断真实供应商/玩家数据库/Rust 真机以及无关手机改动，理由和成本已列入下方决策记录。

## 未验证与资料恢复边界

- 原文已实际删除且无历史正文/备份时，不能恢复或凭空补写；旧来源不明确的条目保留并显示缺口。
- 模型是否保留每个事实仍依赖供应商与提示词；本批验证材料完整投递、摘要不硬截八行、完整原文留存，不宣称摘要语义百分百无遗漏。
- 真实模型响应质量、真实供应商取消时延、Windows 桌面进程终止/文件占用/重启恢复、真机软键盘尚未端到端实测；本批没有 Rust 修改或 Rust 验证声明。
- 保守覆盖校验可能使原文/跨范围摘要仍占空间，这是防止无证据删除，不承诺压缩后每次条目数下降。
- 本批不扩大召回窗口、不新增发送前硬上限，不更改玩家已设阈值。

## Rulings I made（完整决策记录，依次列出及风险成本）

- Ruling: Keep user-approved current directory on existing codex branch instead of creating a worktree — honors explicit execution/isolation preference and preserves phone edits — cost if wrong: repairs share checkout, mitigated by exact-file staging.
- Ruling: Migrate provenance in compat/legacy-hsr/migrate.ts instead of the atomic services/teyvatSaveMigration.ts wrapper — actual DTO mapping lives in compat — cost if wrong: migration tests catch the partial-save boundary.
- Ruling: Pull forward only the on-demand memoryRebuild import boundary from Task 5 and classify that lazy entry normally — needed to pass the unchanged bundle budget; no task behavior changes — cost if wrong: lazy module load timing, covered by memory rebuild regression and build. New chunk-strategy test observed RED (app-core instead of undefined).
- Ruling: Leave the new scope/provenance helpers attached to the lazy rebuilding boundary, not force them into app-core — follows the approved on-demand module design and preserves bundle headroom — cost if wrong: chunk load order, checked by build and regression.
- Ruling: Add optional archiveSources snapshots to MemoryMaintenancePatch — a retained archive can still supply model input; removed/upsert deltas alone cannot verify it. Verify linked archives for removed array sources too — cost if wrong: conservative rejection; unchanged input and unrelated edits remain mergeable.
- Task 3 rulings: Allocate IDs to anonymous retained sources without granting generated fingerprints or fabricating turns — shared staging needs identity; Task 5/6 must bind these identities in the live base before asynchronous work. Cost if wrong: conservative retention/extra metadata, not fictional provenance.
- Ruling: Keep actual new-turn IDs and turn numbers even without a calendar moment — turn is explicitly provided by the caller, calendar remains unknown. Legacy source IDs remain unknown. Cost if wrong: duplicate event identity, covered by replay tests.
- Ruling: Compare JSON DTO values independently of field order — normalization reordered unchanged archives, causing false deltas and duplicate sources. Observed RED and fixed with shared value comparator. Cost if wrong: false comparison, original values still compared, not hashes alone.
- Ruling: Fix the summary bullet regex now — unescaped hyphen consumed English text; real mocked transport retry produced only '-'. Existing new English retry assertion was RED; fix preserves Latin text. Line-count changes remain Task 4.
- Ruling: Update the three memory-tier implementation-location checks to read the shared layer module, retain all kind/prompt assertions and add automatic-delegation assertion — code moved, behavior contract did not. Payload tests check actual prompt/kind sequences. Cost if wrong: tests assert the new service while an obsolete path persists; entrypoint tests in Task 6 address routing.
- Ruling: Upgrade the failure regression fixture to record formal turn identities and test unknown legacy provenance separately; replace successful-fallback expectation with intact originals plus pending archive — matches the approved contract, retaining full snapshot and retry assertions. Cost if wrong: callers without formal provenance show unknown range instead of guessed dates.
- Ruling: Add an optional sourceIds selection to the shared compression service — exact world-tree-only retry must exclude unrelated archives while using the same promotion logic. Observed RED: world-tree draft stayed pending; fixed with bound/standalone identity resolution. Cost if wrong: conservative blocked retry, covered by unchanged and edited-source tests.
- Ruling: Rebase staged multi-level archive deletion claims onto original leaf archives only after actual text/turn coverage verifies; otherwise restore original archives. Existing verified surviving summaries can also prove deletion in the CAS merger — intermediates can disappear before commit, invalidating the former direct proof. Observed RED: multi-layer delta rejected; fixed. Cost if wrong: extra retained anchors rather than unproven deletion.
- Ruling: Add stopOnFailure to the shared promotion service — rebuild must pause at the first failed stage without discarding earlier staged successes. Automatic compression keeps the prior continue-other-eligible-sources policy. Cost if wrong: rebuild stops conservatively, not partial live commit.
- Ruling: Exclude pairs with duplicate IDs or unverifiable gameTime instead of assigning sequential guessed turns; list gaps (first 100 for display) — source identity is required for safe range replacement. Cost if wrong: old unlocatable history remains unreconstructed and visible, never silently overwritten.
- Ruling: Retain compressionThreshold only as compatibility fallback when no independent thresholds are supplied; Task 5 supplies the three real settings. Keep stagingItems as a derived compatibility view — public callers still reference old task fields. Cost if wrong: an unmigrated external caller retains old thresholds, not fabricated provenance.
- Ruling: Upgrade rebuild regression expectations to one material per actual turn and completed progress groups, preserving failed-material, successful staging, resume and tier assertions — batch size now controls progress only. Cost if wrong: old aggregation regression is replaced by literal per-turn payload and call-count checks.
- Ruling: Add optional sourceReads to the patch — a failed model request still consumed originals that must be checked without deleting them — cost if wrong: conservative retry rejection; original values, not hashes, govern CAS.
- Ruling: Permit same-ID replacement only when that original is explicitly removed and CAS-verified — exact failed-summary retry updates an existing identity — cost if wrong: duplicate or changed identities remain rejected by collision checks.
- Ruling: Alias new rebuild artifacts that collide with protected edited arrays/archives, retaining full linked references — repeat reconstruction must not overwrite player edits — cost if wrong: extra retained evidence rather than silent overwrite.
- Ruling: Pull forward the independent cancellation action from Task 6 — Task 5 cancellation contract requires a public hook route, separate from the main controller — cost if wrong: API surface appears before the UI is wired in Task 7.
- Ruling: Rebase resumable failure snapshots from the canonical live projection after commit — optional undefined fields normalize differently, otherwise identical failure drafts falsely fail CAS — cost if wrong: projection could hide a real change; full sources and task-owned failures are still compared.
- Ruling: Keep the coordinator on the lazy import boundary — chunk classifier previously forced hooks/useGame modules into app-core; observed RED, whitelist the async entry — cost if wrong: load-order change, checked by production build.
- Ruling: Remove the old text-only undo instead of implementing a second dual-state undo transaction — approved cancel/failure protection and retained originals provide safe maintenance; array-only undo left stale archive provenance — cost if wrong: users use retained originals or prior save rather than a 9-second undo.
- Ruling: Forward optional shared patches through the actual post-narrative commit, keeping the existing fallback rebase for legacy callers — unrelated new memory must merge instead of rejecting all compression, with exact input read checks — cost if wrong: conservative deferral if a processed source changed.
- Ruling: Ignored failures block only automatic reprocessing; an explicit manual action can try those retained sources — ignoring must stop per-turn API spam without prohibiting deliberate maintenance — cost if wrong: a manual action can consume another API call.
- Ruling: Replace the retired panel threshold-string assertion with delegated-route checks plus actual shared 14-source/no-call behavior; retain all existing default/migration/custom threshold assertions — cost if wrong: wiring still needs UI evidence, supplied by the real React button test.
- Ruling: Classify postNarrativeMemoryStage as an async workflow entry, alongside memoryUpdateStage — new shared CAS dependencies must not become eager app-core via a classifier rule — cost if wrong: lazy chunk load order, validated by build/full regressions.
- Ruling: Include recoveredSettlementTasks in the lazy workflow classification — only the async recovery entry imports it, but its forced core chunk pulled shared maintenance back into the first-screen bundle. RED chunk assertion verified. Cost if wrong: recovery chunk timing, covered by all recovery regressions.
- Ruling: Remove obsolete MemoryPanel text-setter/session/turn plumbing from App after migration, keep optional props for existing callers — unused mutable routes undermine the boundary and exceeded the line ratchet — cost if wrong: an external legacy caller must use the new coordinator to compress; no array replacement fallback remains.
- Ruling: Add observable snapshots/reporting to the existing lightweight maintenance lease — the tree and memory panels need live progress without polling or another task queue — cost if wrong: extra per-session UI metadata/listeners; source CAS and task identity remain independent.
- Ruling: Extract the existing SystemPanelContext declaration to a type-only module — App must stay below the unchanged line ratchet while adding action wiring — cost if wrong: type-import maintenance, no new runtime boundary or behavior.
- Ruling: Use bundled Node Playwright with installed Chrome for real-browser synthetic UI checks — Python Playwright and downloaded browsers were absent; no new dependency, real user profile, database or API was used — cost if wrong: device/provider behavior remains unverified.
- Ruling: Use this plan's resolved temporary directory instead of the generic .tmp-regression directory — same verified Windows ACL workaround, scoped scratch cleanup and no production change — cost if wrong: build behavior under default Windows TEMP remains an environment limitation.
- Ruling: Reject duplicate turn numbers belonging to distinct player messages and cross-user-segment rerolls instead of guessing a newest pair — exact history identity must govern reconstruction — cost if wrong: ambiguous old turns are left unreconstructed with warnings, original sources retained.
- Ruling: Known message identities must be reconstructed before old sources are replaceable; distinguish existing array/archive identity references from actual message references — numeric recoverability alone cannot authorize deleting another pair — cost if wrong: unprovable legacy provenance retains extra records.
- Ruling: Capture lazy-action session/root and cancellation generation before await; reject stale starts, allow only same-session first-root adoption when no root existed — closes the pre-coordinator boundary consistently with the approved new-game saving policy — cost if wrong: cancelled starts require another click; safe same-session first save can adopt its root.
- Final: Ruling: Real provider quality, real player-database persistence and Rust/device-specific behavior set aside by reviewer — keep explicit scope prohibition and report these unverified limits rather than touch real player data or paid APIs — cost if wrong: integration/device problems may remain beyond the synthetic checks.
- Final: Ruling: Dirty phone files/report set aside by reviewer — preserve them outside memory commits; new prompt-library work is a separate approved bounded change — cost if wrong: these phone repairs require their own integration verification.
- Ruling: Keep the existing codex branch/workspace instead of asking for integration again — the approved plan explicitly forbids merge/push and the user now added a separate feature — cost if wrong: integration remains pending and must be verified when authorized.

## Deferred minors

- Final: minor (deferred): ESLint reports one newly triggered exhaustive-deps warning for a non-DOM cancellation-generation ref in unmount cleanup; zero errors, lifecycle cases passed, optional lint-oriented cleanup deferred. Other 18 warnings are pre-existing.

## 执行中失败及处理

- T1 体积 1172.5 >1171.9 KB：提早按需加载重建边界后通过，未提高预算。
- T3 默认 Windows TEMP 的 esbuild 清理 ACL 失败：只改验证进程的临时目录后全量通过。
- T4 测试 WorldMoment 字面量类型被扩大：修正测试注解后全量通过，不修改产品判断。
- T5 memoryMaintenanceSession 冷模块加载超过测试等待 1 秒：改为条件等待最多 10 秒，未改变产品超时；全量通过。
- T6 destructiveActionBehavior 两条旧数组撤销契约失败：保留所有原文/后续记录断言，升级为原子维护入口、不提供不安全文字撤销；体积1173.3超预算及 App1647超行数分别通过恢复任务按需加载和删除旧无效传参解决。
- T8 Windows pnpm.cmd 将 ESLint 文件数组合成单个参数：直接调用 Node ESLint 后全变更文件校验成功。

## 集成与清理

保持 `codex/npc-affinity-memory-consistency` 和现有工作区；未合并 main、未推送。四个手机文件及其报告未纳入本批提交。临时目录清理被环境安全策略阻止，未删除任何文件，也未尝试替代删除方式；计划专用草稿、测试日志、浏览器夹具及临时构建目录仍保留。

- Ruling: Keep owned scratch after policy blocked cleanup — no alternate deletion attempted — cost if wrong: temporary files continue consuming disk space.


