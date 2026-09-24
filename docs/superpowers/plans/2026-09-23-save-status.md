# Save Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让游戏顶栏的存档状态只反映当前游戏会话真实完成的写盘，并在失败时保留可重试提示。

**Architecture:** 一个独立的会话级状态控制器持有最近一次写盘尝试、已保存时间和已保存的游戏切片身份；游戏变化只改变“已保存”到“有未保存更改”，失败不会被变化或定时器抹去。手动、回合自动、手机自动及恢复写盘在现有持久化调用外围报告生命周期；顶栏订阅快照并提供手动重试。

**Tech Stack:** React 19、TypeScript、Vitest/jsdom、现有 IndexedDB 存档服务。

**Spec:** `docs/superpowers/specs/2026-09-23-remaining-player-experience-design.md` 第二批“顶部存档指示”。

## Global Constraints

- 不改存档 schema、不把 API 密钥或异常原文放在顶栏；只在 `saveGame` 成功返回后报告成功。
- 继续使用当前 `codex/` 分支，保留全部既有未提交改动；混合文件不做不安全提交。
- 会话切换后旧写盘结果不得更新新会话；失败状态保留到后续成功写入或切档。
- 手动与自动来源可辨识；重试不阻塞继续游玩。

## Review Focus

- 写盘过程中游戏又变化：不能把较早快照标为“当前已保存”。
- 两次并发写盘乱序完成：较旧尝试不能覆盖较新尝试状态。
- 自动存档跳过或旧手机会话失效：不能显示“已保存”。
- 失败后继续编辑：错误仍可见，重试成功才清除。
- 从存档读取或重新建档：新会话状态不继承旧会话的保存失败。

---

### Task 1: 会话级保存状态控制器

**Files:**
- Create: `utils/saveStatus.ts`
- Create: `tests/unit/saveStatus.test.ts`

**Interfaces:**
- Produces: `saveStatusStore`（`getSnapshot`, `subscribe`, `observeGame`, `markLoaded`, `begin`, `succeed`, `fail`, `cancel`）、`runTrackedSave` 与 `SaveStatusSnapshot`。`runTrackedSave` 只包围真实 Promise，不负责持久化。

- [ ] **Step 1: 写失败测试。** 以纯控制器创建实例并测试初始未保存、成功才已保存、游戏变化转未保存、失败持久、乱序与跨会话迟到结果忽略；测试包装函数在拒绝时标失败，并在返回 `saved=false` 时不报成功。例如：

```ts
const store = createSaveStatusStore();
const game = createEmptyTeyvatGameState();
store.observeGame(1, game);
const token = store.begin(1, game, 'manual');
expect(store.getSnapshot().phase).toBe('saving');
store.succeed(token, game, 123);
expect(store.getSnapshot()).toMatchObject({ phase: 'saved', source: 'manual', savedAt: 123 });
store.observeGame(1, { ...game, turnCount: 1 });
expect(store.getSnapshot().phase).toBe('unsaved');
```

- [ ] **Step 2: 运行 `node node_modules/vitest/vitest.mjs run tests/unit/saveStatus.test.ts --reporter=dot`，确认缺少新模块而 RED。**
- [ ] **Step 3: 实现控制器。** `gameSignature()` 比较持久化游戏切片引用和回合数，排除只用于反馈的后台队列；失败只由 `succeed`/`markLoaded`/会话重置清除。`begin` 生成单调序号；`succeed/fail/cancel` 验证当前会话与最新序号。`runTrackedSave(store, sessionId, gameAtStart, source, work, getCurrentGame, isSaved?)` 在 `work` 真正成功后才调用 `succeed`，抛错时调用 `fail` 并原样重抛。
- [ ] **Step 4: 定向测试、TypeScript、全量单测；对混合工作树不做提交。**

### Task 2: 接入真实写盘边界

**Files:**
- Modify: `hooks/useGame/saveLoadWorkflow.ts`, `hooks/useGame/autoSaveStage.ts`, `hooks/useGame/postSettlementRecoveryWorkflow.ts`, `hooks/useGame.ts`, `App.tsx`
- Test: `tests/unit/saveStatusIntegration.test.ts`

**Interfaces:**
- Consumes: Task 1 `runTrackedSave` 和 `saveStatusStore`。
- Produces: 手动、回合自动、手机自动、恢复和记忆快照写盘的真实生命周期报告。

- [ ] **Step 1: 写失败集成测试。** 对 `handleManualSave` 的真实调用边界替换仅底层 `saveGame`，断言挂起时 `saving`、拒绝时 `failed`、成功时 `saved` 且 `hasSave` 更新；`runPostTurnAutosaveTask` 的跳过/失效不应被成功上报。测试会话切换后旧完成不影响当前快照。
- [ ] **Step 2: 运行定向测试，确认现有入口未上报状态而 RED。**
- [ ] **Step 3: 在现有 `saveGame` 前后调用 Task 1 包装函数。** 手动成功补 `setHasSave(true)`；自动跳过不启动；恢复及手机失效传 `isSaved(result)`，失败保留状态。不要改现有保存负载或存档树顺序。
- [ ] **Step 4: 定向、全量单测和 TypeScript；不提交混合文件。**

### Task 3: 顶栏可见状态与重试

**Files:**
- Modify: `components/layout/TopBar.tsx`, `App.tsx`, `PLAYER_EXPERIENCE_ROADMAP.md`
- Create: `tests/unit/saveStatusTopBar.test.ts`

**Interfaces:**
- Consumes: Task 1 `SaveStatusSnapshot` 和 `saveStatusStore`。
- Produces: 桌面及手机顶栏状态文字；失败时手动重试入口。

- [ ] **Step 1: 写失败 UI 测试。** 用真实 TopBar 渲染 `unsaved/saving/saved/failed`，检查来源和保存时间、失败重试按钮可点击；断言没有泄露错误文本。
- [ ] **Step 2: 跑定向测试，确认旧顶栏没有存档状态而 RED。**
- [ ] **Step 3: 顶栏接收状态与重试回调。** `App` 用 `useSyncExternalStore` 订阅并用游戏状态变化调用 `observeGame`；重试调用既有手动保存并捕获错误提示，不禁用游戏操作。文档只记录已验证范围。
- [ ] **Step 4: 全量单测、TypeScript、变更文件 Lint、生产构建、`git diff --check`；不提交混合文件。**
