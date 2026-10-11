# Task 4：稳定旅程编号与十个不同回合

这是已批准计划的第四项，实施者先读本文件。当前目录是已有大量未提交改动的 codex 分支；只修改本任务相关文件，不提交/合并/推送，不清理真实存档，不调用真实 API，不启动子代理。采用 TDD，先记录预期失败，再实现，最后自审。完整报告写 `docs/reviews/2026-10-11-save-task-report.md`，包括红绿命令/输出、实际修改文件、边界决策和未验证项；最后只返回状态、测试摘要和问题。

## 要求

1. 每条独立 rootId 的自动档保留最新 **10 个不同有效游戏回合**。同回合多次写入不占额外回合名额，不覆盖同回合的不同分支。手动档最多 5 节点、重复手动保存覆盖当前节点、另存为新增均不变。导入/备份不轮换；缺失/无效或无法证明的旧回合数保守保留，不能当同一回合 0 清除。缺失 rootId 的记录各自隔离。
2. 最新按每个回合最后一次实际保存时间排序，时间相同按 ID 稳定排序；跳回旧分支也保留最近实际保存的回合，绝不按回合数字推测哪条独立旅程。不要为了去重上推 root+turn upsert。
3. 保留原增量依赖保护：仍被引用的基底只能隐藏/保留，不能破坏窗口内完整加载。十回合不保证总文件数十个。过去已经删除且没有备份的回合不承诺恢复。
4. 同名独立旅程列表/树/详情/设置统一显示 `姓名01`、`姓名02`、`姓名03`。序号绑定独立 root 身份，并持久化分配记录；重排、保存、重载、删除其他旅程不交换或复用。仅显示名改变，实际玩家姓名、对话、存档 ID/物理文件名不变。同一 root 自动/手动一致。

   Ruling：采用按姓名分配、以 `(root 身份, 姓名)` 持久化关联的编号。玩家明确改名时，为同一 root 在新姓名组分配新号；改回原名可复用该 root 自己的既有号，不复用其他或已删除 root 的号。完整目录按最新可靠节点时间/ID选同一 root 的当前显示姓名，先统一贴标签再做界面筛选。这样不同名字各自可从 01 开始；代价是明确改名时显示序号可能变化，原始玩家资料不变。
5. 旧无 root 记录不能凭同名+单调回合分段合并，各存档 ID 独立隔离。不要破坏明确 root 内已有父子/分支关系。
6. 持久化注册表的并发分配必须原子：浏览器使用一个 IndexedDB readwrite 事务 RMW（模块队列不能防跨标签页）；桌面可使用独立 JSON + 已有 `withDesktopStorageLock` 原子写。不要嵌套已有 saveMutationPriority 导致死锁。注册表损坏/写失败不能静默重置导致旧序号复用；不每次视图写盘，不加载全部存档正文给列表编号。
7. UI 文案明确最新十个不同回合、同回合分支保留、旧无有效回合数保守保留。不要修改现有玩家姓名或自动迁移真实数据。

## 代码路由与已知边界

- `services/storage/saveRetention.ts` 当前自动档常量为 6、按节点 slice。新增可信回合分组；`saveCatalog.normalizeSaveListItemSummary` 当前会将无效回合数变为 0，`dbService.buildSaveSummary` 会用聊天条数推断，必须保留可靠性/来源标记防误删。有效新档 turnCount 可用于轮换；无法证明旧推断值不能批量清除。
- `services/dbService.ts`：getSaveCatalogSnapshot 有多个桌面/IDB返回；使用共享完整快照边界附加编号，不漏路径。此函数也在 saveMutationPriority 内调用，注册表不能再次等同一队列。rotateManagedSaves 经 selectSaveNodeRotationCandidates -> deleteManagedSaveItems，现有 hidden delta base 保护要保留。
- `services/storage/saveCatalog.ts` summary 正规化保留已知字段；新增展示/回合来源字段须传过桌面索引和 union。
- `utils/saveTreeView.ts` 中 buildLegacyRootIdMap 当前按姓名和回合猜旅程，改为证据不足逐 ID 隔离。saveTree.createdAt 是节点时间，不能用它每次动态重新分配 root 序号。注册表保留已删除 root 的序号/计数。
- `services/storage/gameDatabase.ts` openGameDatabase/SETTINGS_STORE 可用于原子 IDB 注册表。`services/desktop/desktopStorageLock.ts` 提供跨实例独占创建锁；不要新建一份锁实现。AppStorageAdapter 已提供 readJson/writeJson 等原子桌面能力。避免 dbService 与 registry runtime 循环依赖。
- UI：`components/features/SaveLoad/SaveLoadModal.tsx` 多处姓名及 5/6 节点提示；`components/features/Settings/storage/StorageSaveTreeView.tsx` 多处姓名。尽量公共展示 helper，不在 App.tsx 增加协调代码（App 当前 1644 行，门禁 1645）。
- 脚本旧契约 `scripts/save-performance-regression.mjs`/`save-retention-behavior-regression.mjs`/`save-tree-ui-regression.mjs` 锁 6 节点/旧姓名猜分组。按新需求更新行为断言，保留强度，不删除/弱化门禁；手动策略/性能门禁保持。

## 验收与测试

- 新 `tests/unit/saveRoundRetention.test.ts`、`saveJourneyLabel.test.ts`：11+回合，最新回合多次保存、同回合不同分支、两个 root、未知回合/未知 root、顺序变动、删除后不复用、重新加载、并发分配。
- 扩展实际 fake-IDB 与桌面 adapter 集成，验证轮换后保留 10 个不同回合且每个节点可完整读取，hidden delta base 仍有效；两个同名独立旅程无覆盖。
- 参考 `manualSaveOverwrite.test.ts`、`manualSaveDesktopOverwrite.test.ts` 和 `storageAuditRepair.test.ts` 的真实存储/桌面 mock，保留全部既有断言。
- focused tests + `pnpm exec tsc -b --force` + 本轮文件 scoped lint + 涉及脚本；控制器最终统一完整 pnpm test，不在此并发生产构建。不要提高 bundle/App 行数门禁。

## 报告状态

DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED；不要把测试通过当所有需求已满足。任何设计歧义先报给控制器；不扩展到本任务以外模块。
