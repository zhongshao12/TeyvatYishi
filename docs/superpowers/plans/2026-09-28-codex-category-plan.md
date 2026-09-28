# 提瓦特图鉴分类可用性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地点、角色、术语切换后显示正确词条与对应详情，锁定词条不泄漏正文。

**Architecture:** 分类状态保留原始 slug，按钮只翻译标签；筛选与详情选择以同一条可见列表为准。继续使用现有 `ArchiveCodex` 和内置图鉴资源，不另造条目。

**Tech Stack:** TypeScript、React、Vitest、现有图鉴预设加载。

**Spec:** `docs/superpowers/specs/2026-09-28-phone-codex-profile-consistency-design.md` 提瓦特图鉴章节。

## Global Constraints

- 分类比较 slug (`character`/`location`/`term`)，中文只作展示。
- 切换分类不能显示上一分类详情；锁定条目不能通过详情/注入预览看到正文。
- 无内置资源、加载失败、空分类和搜索无匹配须有可区分反馈；不凭空生成原著词条。
- 不新增依赖，不影响原有图鉴检索与解锁规则。

## Review Focus

- 中文分类按钮与英文 slug 不匹配：Task 1 验证地点/角色/术语三类各有对应内容。
- 上一分类已选 ID 在新分类仍存在全局映射：Task 1 验证详情切换到新分类首项。
- 搜索结果为空但旧详情仍显示：Task 1 验证空态且不显示旧正文。
- 锁定条目在列表或注入预览泄漏：Task 2 验证仅显示锁定提示。
- 内置图鉴包加载失败或某类确实为空：Task 2 验证反馈不伪装为搜索无结果。

---

### Task 1: 分类 slug 与详情选择一致

**Files:**
- Modify: `components/features/Codex/CodexManagerModal.tsx`, `components/features/Codex/productionAdapter.ts`（仅需时）
- Test: `tests/unit/codexCategoryNavigation.test.tsx`

**Interfaces:**
- `activeCategory` 存 `'all' | string` 原始 slug；分类按钮渲染 `categoryName(slug)`；`listItems` 以同一 slug 筛选。
- `selectedEntry` 只可从 `listItems` 的 ID 解析；不属于当前列表的旧 `selectedId` 不参与展示。

- [ ] **Step 1: 写失败测试** `switching_location_character_term_shows_matching_entries`、`old_selection_and_empty_search_do_not_leak_details`：三分类预设各有条目，点击分类后列表和详情一致；空搜索显示“无匹配”而非旧详情。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/codexCategoryNavigation.test.tsx`；新增测试先失败。
- [ ] **Step 3: 实现** slug 分类、选中项收敛与“无条目/无匹配”两种空态；保持原搜索和关联条目逻辑。
- [ ] **Step 4: 重跑定向测试、TypeScript；通过后提交** `fix: keep codex category and detail selection aligned`。

### Task 2: 锁定条目与资源反馈

**Files:**
- Modify: `components/features/Codex/CodexManagerModal.tsx`, `components/features/Codex/productionAdapter.ts`, `App.tsx`（仅资源状态传递必要时）
- Test: `tests/unit/codexCategoryNavigation.test.tsx`, `tests/unit/contentResourceStatusPanel.test.ts`

**Interfaces:**
- 列表可显示已锁定标题/类别，但详情正文和注入预览仅 `CodexArchiveItem.unlocked === true` 时可见；未解锁显示原有解锁状态提示。
- 图鉴资源不可用时读取已有 `contentResourceStatus`，不将“加载失败”写成“此分类无资料”。

- [ ] **Step 1: 写失败测试** `locked_entry_hides_body_and_injection`、`missing_catalog_reports_resource_failure`：两类空态、搜索空态与锁定提示互不混淆。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/codexCategoryNavigation.test.tsx tests/unit/contentResourceStatusPanel.test.ts`；新增测试先失败。
- [ ] **Step 3: 实现** 锁定详情门禁和现有资源状态提示，不更改数据解锁条件、不移除条目。
- [ ] **Step 4: 重跑定向测试、图鉴检索回归、TypeScript；通过后提交** `fix: show codex lock and resource states honestly`。

### Task 3: 图鉴批次回归

**Files:** Test only: `tests/unit/codexCategoryNavigation.test.tsx`

- [ ] **Step 1: 用实际内置地理、人物、术语资源做烟测**，确认三类非空、切换后无跨类残留；资源缺失时测试正确错误提示。
- [ ] **Step 2: 跑**全量单测、TypeScript、Lint、生产构建；均退出 0，记录既有 warning。
- [ ] **Step 3: 如有集成修正单独提交** `test: cover codex category navigation`。
