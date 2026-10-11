# Task 4 — 稳定旅程编号与十个不同回合

状态：DONE_WITH_CONCERNS（本任务定向验证通过；完整 `pnpm test`、真实浏览器跨标签页与桌面进程测试交由控制器/人工执行）。未提交、合并、推送，未调用真实 API，未访问或清理真实存档，未启动子代理或生产构建。

## 实现结果与边界决策

- 自动档按明确 root 身份分别保留最新 **10 个不同有效回合**。使用 `turnCountSource: explicit` 加非负安全整数作为可信判据；回合组按最后一次实际保存的 timestamp/ID 排序，组内全部节点保留，不做 root+turn upsert。手动最多五节点和导入/备份豁免不变。
- 新摘要从正文明确的有效 `turnCount` 标为 explicit；聊天数量回退值标为 inferred。目录里无来源证明的旧数字、无效数字标为 unknown；显示数字可以是零，但轮换从不把 unknown/inferred 当作可去重回合。原有目录版本不升级：缺标记的旧目录自动采用保守语义，不批量读取正文补证明。
- 保留原有 `deleteManagedSaveItems` 的 hidden delta base 安全删除链路。实测浏览器与桌面均有隐藏基底，窗口内每一节点能完整读回；十回合不是十文件的承诺，也不承诺恢复已经删除且无备份的历史。
- `getSaveCatalogSnapshot` 在所有后端分支共同出口附加展示元数据；注册表只读取目录摘要，不读取全部正文。模块不导入 dbService，且不再次进入 saveMutationPriority，避免内部目录查询死锁。
- 按控制器裁定，每姓名独立编号，注册表保存 `(root identity, trim 后精确姓名)` 的历史分配与单调计数。删除别的 root 不删墓碑/计数，不交换、不复用；明确改名时分配新姓名队列内编号，改回旧名只复用该 root 自己的历史关联。该“改名可改变显示序号”的取舍用于避免同名碰撞，并非修改玩家状态。
- 每个 root 的全部自动/手动摘要采用完整目录中 timestamp/ID 最新、非空的姓名作为当前显示名；保留各摘要原有 travelerName，不改实际玩家姓名/对话/存档 ID/物理文件名。若删除了最新改名节点，最新剩余可靠摘要可能使显示名回到历史姓名，但此前历史编号仍保留。
- 浏览器编号分配在同一 SETTINGS_STORE readwrite 事务里 read-modify-write，跨独立模块连接的并发实际测试使用 fake IndexedDB。桌面使用独立 `saves/journey-registry.json`、既有 withDesktopStorageLock 和 adapter 原子 JSON 写。无新分配时不 put/writeJson；损坏、计数落后、写失败均拒绝，不静默重置。
- root 缺失/空白的旧节点按 ID 独立。自审新增命名空间测试：实际 root 名等于 `legacy-isolated-auto-999` 时不会占用 rootless 配额；树视图实际 root 等于 `legacy-root-1` 时，rootless 树使用不碰撞的合成选择 ID，明确 rootId 保持原值供既有删除/导出 API 使用。已有明确 root 内父子/分支关系保留。
- 弹窗树选择、详情、时间线及设置树列表/详情统一使用公共 getSaveJourneyLabel；弹窗文案说明最新十个不同回合、同回合分支保留、旧无有效回合数保守保留。

## RED 证据（先于对应实现）

1. `pnpm exec vitest run tests/unit/saveRoundRetention.test.ts tests/unit/saveJourneyLabel.test.ts`
   - 2 文件失败；9 failed / 1 passed。
   - 13 个写入节点属于 11 回合，期望候选 `[1]`，旧实现返回 `[1,2,3,4,5,6,7]`。
   - 重访第一回合期望 `[2]`，旧实现返回 `[1,2,3,4,5,6]`。
   - 旅程序号期望 `[1,2,1]`，旧实现均 undefined；三个同名单调回合的 rootless 记录期望三树，旧实现只有一树。
   - 无效/旧回合正规化期望 unknown，旧实现不提供来源标记。
2. `pnpm exec vitest run tests/unit/saveJourneyLabelUi.test.tsx`
   - 2 failed；弹窗期望至少 5 处“云01”，实际 0；设置组标题/节点期望两处，实际 0。首次 matcher 的 undefined/null 提示修正为计数零后重跑，取得行为断言失败，随后才改 UI。
3. 注册表自审追加 RED：已有 IDB 注册表记录的 value 为 undefined，期望拒绝损坏，实际成功返回并重置编号；修复为只有 key 完全不存在才初始化。
4. 配额命名空间自审 RED：真实 root 为 `legacy-isolated-auto-999`，另有 rootless ID999，期望候选 `[1]`，实际 `[1,2]`；改为明确 root 与 legacy 命名空间分离。
5. 树命名空间自审 RED：真实 root 为 `legacy-root-1` 加 rootless ID1，期望三树，实际两树；修复合成选择标识碰撞并把空白 root 视为缺失。

## GREEN 与验证输出

最终定向命令：

```text
pnpm exec vitest run tests/unit/saveRoundRetention.test.ts tests/unit/saveJourneyLabel.test.ts tests/unit/saveJourneyDesktop.test.ts tests/unit/saveJourneyLabelUi.test.tsx tests/unit/manualSaveOverwrite.test.ts tests/unit/manualSaveDesktopOverwrite.test.ts tests/unit/manualSaveActionsUi.test.tsx tests/unit/storageAuditRepair.test.ts
Test Files 8 passed (8)
Tests 69 passed (69)
```

- saveRoundRetention：7；saveJourneyLabel：15；saveJourneyDesktop：7；saveJourneyLabelUi：2。
- 既有 manualSaveOverwrite：7；manualSaveDesktopOverwrite：6；manualSaveActionsUi：1；storageAuditRepair：24。既有断言全部保留；desktop 手动覆盖 mock 的 readText 改成与真实 adapter 一致的字符串输出（原先 JSON map 值直接作为对象返回），不改任何行为断言。
- 浏览器与桌面集成分别构造两个同名 root、0–11 回合、最新回合另一个分支，最终各 root 有 10 不同回合、11 可见节点；总 22 可见节点，隐藏基底数量 >0。逐节点校验 formal dialogue 数量与姓名。桌面测试清空 fake IDB 后再次逐节点读取，证明不是兼容缓存掩盖镜像缺失。
- 浏览器额外保存 12 个没有明确 turnCount 的实际节点，目录标记 inferred，全部保留并可读取。
- 并发测试使用独立模块/连接与不相交的快照，验证同名分配为 01/02，而非仅同时读取同一组已分配数据。另覆盖重排、删除后新增 03、模块重载、改名/改回、损坏/写失败和不反复写盘。
- `pnpm exec tsc -b --force` 最终 exit 0、无输出。首次 exit 1 是新测试中 health 的 nullable 检查遗漏，修正后重跑通过。
- 本轮 16 个 TS/TSX/MJS 文件 scoped eslint 最终 exit 0，**0 errors / 20 warnings**，警告均在 SaveLoadModal 原有 hooks/Promise handlers（这些行未因本任务更改逻辑），没有称为 lint 零警告。
- `node scripts/save-performance-regression.mjs`：save performance regression ok。
- `node scripts/save-retention-behavior-regression.mjs`：[save-retention-behavior-regression] ok。
- `node scripts/save-tree-ui-regression.mjs`：[save-tree-ui-regression] ok。
- `node scripts/save-tree-regression.mjs`：save tree regression ok。
- `node scripts/save-delta-regression.mjs`：[save-delta-regression] ok；其行为子测试 storageAuditRepair 24 passed。
- `node scripts/save-asset-store-regression.mjs`：[save-asset-store-regression] ok；其原有子测试 1 passed / 2 skipped，如实记录，未移除跳过项。
- `App.tsx` 实测 1644 行，本任务未改；未提高 App/bundle 等门禁预算。

## 本任务实际触及文件

原有脏工作区中仅添加本任务小范围改动，下面不是相对 HEAD 的全部差异列表：

- `services/storage/saveRetention.ts`：十回合可信分组、真实/legacy 配额命名空间。
- `services/storage/saveCatalog.ts`：来源和展示字段类型/正规化保留。
- `services/dbService.ts`：完整目录出口附加展示信息，摘要明确/推断来源；未改原有 delta 安全删除实现。
- `utils/saveTreeView.ts`：逐 ID legacy 隔离和选择标识避碰撞。
- 新 `services/storage/saveJourneyRegistry.ts`、`utils/saveJourneyLabel.ts`。
- `components/features/SaveLoad/SaveLoadModal.tsx`、`components/features/Settings/storage/StorageSaveTreeView.tsx`：公共展示名和文案。
- 新 `tests/unit/saveRoundRetention.test.ts`、`saveJourneyLabel.test.ts`、`saveJourneyDesktop.test.ts`、`saveJourneyLabelUi.test.tsx`。
- `tests/unit/manualSaveDesktopOverwrite.test.ts`：仅矫正 mock readText 的序列化语义，既有断言保留。
- `scripts/save-performance-regression.mjs`、`save-retention-behavior-regression.mjs`、`save-tree-ui-regression.mjs`：六节点/同名猜分组旧断言更新为新契约，并新增原子注册表/来源/分支保留门禁。
- 本报告。

## 自审与未验证项

- 完整性：逐条核对简报七条要求；重点复核旧回合保守保留、相同 root 自动/手动显示一致、实际保存时间排序、墓碑、目录所有返回路径、空白/恶意根名碰撞、delta 引用保护。
- 质量/纪律：注册表独立且无 dbService runtime 循环；未在 App 增加协调；无按姓名+回合自动迁移，无 root+turn upsert；既有手动覆盖与性能门禁断言保留/加强。大型 dbService 和 SaveLoadModal 只做必要接口/文案改动，未重构任务外代码。
- 桌面目录实证：编号文件存在时移除镜像 index 强制重建，健康扫描 invalidSaveFiles=0 且 saveFiles 与 totalStoredCount 一致；strict save scan 数量也一致。现有 SAVE_RECORD_RE 只匹配 `^save-(\\d+)\\.json$`，注册表不会成为存档候选。
- 未验证：完整 `pnpm test`（含 bundle-size/生产构建）由控制器最终串行执行；真实两个浏览器标签页/两个 Tauri 进程，以及 Rust 磁盘原子写故障未运行。fake-IDB/adapter 测试覆盖原子调用边界，不能替代真实进程/文件系统故障注入。
- 注册表文件/设置条目如果被外部完全删除，系统无法分辨“首次使用”与“编号历史丢失”；当前任务禁止静默重置的是存在但损坏/读写失败，已 fail closed。正常删除旅程、重排/重载不删除注册表；未提供 registry 重置/自动修复工具。
- 正规化 display 数字零不再是删除证据；旧未知回合节点可能超十个，故存储增长属已批准的保守保留语义，不是假称已满足十文件上限。

## Task4 审查修复轮 1/5

控制器给出 Needsfixes：既有 `deleteSaveTreeInternal` 会 trim 非空 root 参数，而编号/轮换/UI 已按精确 root 身份隔离；以及无新分配的桌面目录查询虽然不 writeJson，却仍创建/删除锁文件。本轮只修这两个要求内边界，未扩大到其他 API/迁移逻辑。

### RED

命令：`pnpm exec vitest run tests/unit/saveJourneyLabel.test.ts tests/unit/saveJourneyDesktop.test.ts`。

输出：2 文件 failed；3 failed / 21 passed。

- 实际 fake-IDB 存储两条同名但不同 root 的旅程：`' root-a '` 显示云01、`'root-a'` 显示云02，并保存各自独立正文。调用 `deleteSaveTree(' root-a ')` 后，期望留下无空格旅程 ID5，实际留下带空格 ID4，证明删错对象，而不只是比较字符串纯函数失败。
- 已知编号的直接附加查询及实际 `getSaveCatalogSnapshot()` 查询都期望没有排他锁创建，实际各调用 `writeTextExclusive('locks/save-journey-registry.lock', …)` 一次。原 no-writeJson 断言未删除。

### 实现

- `services/dbService.ts`：`trim` 只用于纯空白参数判定；`collectSaveTreeSummaries` 接收原始精确 rootId，不把一条独立旅程的身份变成另一条。`loadSaveTree` 保持原先精确查询，无需改动。
- `services/storage/saveJourneyRegistry.ts`：桌面先真实读取并严格验证注册表，无缓存；只有全部关联已知且不可变时，返回现有 labels。若任一关联需要分配，使用原有锁，并在锁内重新读取/验证后原子分配、写入，绝不使用锁外旧快照来分配。损坏与读/写失败继续向调用方抛错，无回退重置；浏览器单事务 RMW 不变。
- `tests/unit/saveJourneyLabel.test.ts`：新增真正保存/加载/删除测试，保留前后原 travelerName/旅程展示名断言、精确 loadSaveTree、正确存活 ID/原正文，以及重删不存在的带空格 root 和纯空白 root 都返回零且不能删除另一条旅程。
- `tests/unit/saveJourneyDesktop.test.ts`：将 adapter 排他写转成可观察的保真实现，原分配测试追加 no-lock-creation 断言，并新增实际完整目录查询 no-lock/no-writeJson/文件集合不变测试。保留独立模块不相交快照并发测试、损坏与写失败 fail-closed 及桌面独有增量节点完整加载测试。
- 未修改其他生产/UI/脚本文件。本轮附加本报告；没有 Git 写操作、API/真实存储访问、子代理或完整构建。

### GREEN 与自审

```text
pnpm exec vitest run tests/unit/saveJourneyLabel.test.ts tests/unit/saveJourneyDesktop.test.ts tests/unit/saveRoundRetention.test.ts tests/unit/manualSaveOverwrite.test.ts tests/unit/manualSaveDesktopOverwrite.test.ts tests/unit/storageAuditRepair.test.ts tests/unit/saveJourneyLabelUi.test.tsx tests/unit/manualSaveActionsUi.test.tsx
Test Files 8 passed (8)
Tests 71 passed (71)
```

- `pnpm exec tsc -b --force`：exit 0、无输出。
- `pnpm exec eslint services/dbService.ts services/storage/saveJourneyRegistry.ts tests/unit/saveJourneyLabel.test.ts tests/unit/saveJourneyDesktop.test.ts`：exit 0、无输出（本轮四文件 0 errors / 0 warnings）。前轮全范围 20 个既有 UI 警告没有声称被本轮修复。
- save-performance / save-retention-behavior / save-tree-ui / save-tree / save-delta / save-asset-store 六个脚本重新运行 exit 0；delta 行为子测试 24 passed，asset 子测试仍为原有 1 passed / 2 skipped。
- 自审：原精确 root 参数一路传入实际目录过滤；桌面只读路径验证真实注册表再返回不可变历史关联，新分配仍锁内重读；已有 concurrent disjoint contexts 防止双编号/覆盖断言不减弱；无锁实现复制、无缓存、无内部 mutation queue 嵌套。App 仍实测 1644 行。
- 状态仍为 DONE_WITH_CONCERNS，仅剩控制器完整 `pnpm test` 和前述真实跨标签页/进程/原子磁盘故障验证；本轮审查指出的两处缺陷已有失败复现及定向绿色证据。
