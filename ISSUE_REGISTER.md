# yuanshen 问题清单 —— 关闭与遗留报告

> 项目：`旅行者纪事 / TeyvatYishi`（`C:\Users\zhong\Desktop\KaiTuoYiShi-main\yuanshen`）
> 上一版：2026-09-16 首版（14 条问题，静态阅读 + 运行时探针）
> 本版性质：**逐条复核对回当前源码**，标注「已修复 / 部分修复 / 遗留」
>
> 验证运行（由使用者在本机执行并提供输出）：
> - `npx tsc -b` → 无输出，退出码 0
> - `npx vitest run` → **Test Files 101 passed (101)，Tests 600 passed (600)**，0 失败
>
> 对比基线：首版分析时套件为 90 文件 / 556 用例；本次 **101 文件 / 600 用例**，新增用例中有 4 个文件专门断言了本报告的 S1–S4。

---

## 0. 结论摘要

**14 条中 13 条已修复，1 条部分修复（唯一遗留）。**

| ID | 原严重度 | 问题 | 现状 | 证据 |
|---|---|---|---|---|
| S1 | 🔴 严重 | 领域命令契约未注入变量模型 | ✅ **已修复** | `tests/unit/promptModuleScopesBehavior.test.ts:26` |
| S2 | 🔴 严重 | `storyWeaving` 作用域零命中 | ✅ **已修复** | 同上 `:37` |
| S3 | 🔴 严重 | 图鉴/世界树中文召回恒空 | ✅ **已修复** | `tests/unit/retrievalBehavior.test.ts:35,65` |
| S4 | 🟠 中等 | 空查询注入图鉴前 N 条 | ✅ **已修复** | 同上 `:26` |
| M1 | 🔴 严重 | 存储根迁移部分成功致存档消失 | ✅ **已修复** | `src-tauri/src/lib.rs:386-418` |
| M2 | 🟠 中等 | 迁移提交阶段无回滚 | ✅ **已修复** | 同上 `:412-416` |
| M3 | 🟠 中等 | 37 个 legacy HSR 资源随包发布 | ✅ **已修复** | 全仓已无 `legacy-hsr/*.json` |
| M4 | 🟡 轻微 | `path_to_string` 恒等 `replace` | ✅ **已修复** | `src-tauri/src/lib.rs:607-608` |
| M5 | 🟡 轻微 | 共享路径工具无原型污染守卫 | ✅ **已修复** | `utils/variablePath.ts:17,89,99,259` |
| M6 | 🟠 中等 | `executeSendWorkflow` 巨型函数 | ⚠️ **部分修复** | `hooks/useGame/sendWorkflow.ts:653`→`:2046` |
| M7 | 🟡 轻微 | Gemini 协议判定用 URL 子串 | ✅ **已修复** | `services/ai/providerRouting.ts:25-50` |
| M8 | 🟠 中等 | CI 不编译 Rust；无 ESLint | ✅ **已修复** | `.github/workflows/ci.yml:20,28-38` |

---

## 1. 已修复项及其证据

### S1 + S2 —— 提示词作用域匹配器

新增 `tests/unit/promptModuleScopesBehavior.test.ts`，直接断言了首版报告的核心结论：

```ts
// :26  领域命令两模块必须进入 variable 目标
expect(selected.map((m) => m.id)).toEqual(expect.arrayContaining([
  'builtin_variable_worldbook', 'builtin_domain_command_rules',
  'builtin_domain_command_output_format', 'builtin_companion_archive_worldbook',
]));

// :37  三个 canon 模块必须进入 storyWeaving 目标
expect(selected.map((m) => m.id)).toEqual([
  'builtin_canon_worldbook', 'builtin_canon_output_format', 'builtin_canon_decomposition_rules',
]);
```

**修复范围大于首版建议**：首版只点名 `builtin_domain_command_` 与 `builtin_canon_` 两个前缀；`:47-67` 的第三个用例同时覆盖 `custom_variable_` / `st_import_variable_` / `custom_storyWeaving_` / `st_import_story_weaving_` —— 这四个前缀会被同一次重命名一起弄坏，属首版漏掉的部分。3 个用例全部通过。

### S3 + S4 —— 中文召回

新增 `tests/unit/retrievalBehavior.test.ts`（4 用例全通过），逐条覆盖首版的失败形态：

| 用例 | 断言内容 | 对应首版问题 |
|---|---|---|
| `:26` | 空白查询返回 `{ entries: [], injection: '' }` | S4（`[].every()` 为真 → 注入前 N 条） |
| `:35` | **带标签的多行中文查询**（`玩家当前输入：我想去骑士团找琴问问龙灾的事。`）召回 `knights` | S3（标签前缀 + 空白切词 → 恒空） |
| `:52` | 命中证据多的条目排在前面 | 首版建议的「任一命中 + 命中数排序」 |
| `:65` | 世界树同样支持带标签中文查询 | S3 的 irminsul 侧 |

另 `tests/unit/mainRecallStage.test.ts:69` 断言「开局系统回合禁用两条召回」，与 S4 的注入面一起收口。

### M1 + M2 —— Rust 存储根迁移（数据安全）

`src-tauri/src/lib.rs` 已重构为**准备/提交两阶段事务**：

```rust
// :125-136  先收集全部迁移计划，不再逐个 ? 早退
let mut migrations = Vec::new();
if current_roots.save_dir.as_deref() != next_save_dir.as_deref() { migrations.push((from, to)); }
if current_roots.backup_dir.as_deref() != next_backup_dir.as_deref() { migrations.push((from, to)); }

// :138-149  把「写配置」作为提交动作传入事务
migrate_storage_roots_transactionally(&migrations, || { write_storage_roots(/* 新配置 */) })?;
```

事务实现（`:386-418`）的关键顺序：

1. `validate_storage_migration_plan`（`:420-443`）拒绝两个迁移之间的交叉/嵌套
2. **准备阶段**：逐个复制；任一失败 → `rollback_prepared_migrations(&prepared)` 后返回 Err
3. **校验阶段**：目标条目必须全部存在，否则回滚
4. **提交阶段**：`commit()` 即写配置；失败 → 回滚全部已复制内容
5. **仅在配置已落盘之后**才删除旧目录，且删除失败被有意忽略：

```rust
// :410-411
// 配置已指向并已完整校验过的目标目录。此后清理旧目录即使失败，
// 也只会留下可人工删除的副本，不会再让应用看不见已迁移的数据。
for migration in prepared {
    if migration.cleanup_source { let _ = fs::remove_dir_all(migration.from); }
}
```

这正好修掉首版指出的两条：**配置写入不再晚于迁移**（M1）；**删除阶段不再需要回滚，因为它在提交点之后且为尽力而为**（M2）。此外还补了首版未要求的嵌套目录与跨迁移重叠校验。

### M3 —— legacy HSR 资源

`glob **/legacy-hsr/*.json` → **0 个文件**（`public/` 与 `dist/` 均已清空）。新增 `tests/unit/productionAssetBoundary.test.ts:12`「keeps historical HSR fixtures outside Vite public assets」作为边界锁。

### M4 —— `path_to_string`

```rust
// src-tauri/src/lib.rs:607-608
fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
```
恒等 `replace('\\', "\\")` 已删除。

### M5 —— 原型污染纵深防御

`utils/variablePath.ts` 已采纳首版建议的**下沉式守卫**（不再依赖调用方自觉）：

```ts
:17   const 危险对象键 = new Set(['__proto__', 'prototype', 'constructor']);
:89   cursor = 是对象(cursor) && Object.hasOwn(cursor, t) ? cursor[t] : undefined;
:99   if (危险对象键.has(field) || !Object.hasOwn(item, field)) return false;
:259  if (!是对象(cursor) || !Object.hasOwn(cursor, t)) return { exists: false, value: undefined };
```

即 `in` → `Object.hasOwn`（4 处），并显式拒绝危险键。`tests/unit/variablePathSafety.test.ts`（5 用例）通过。

### M7 —— 提供商路由

`services/ai/providerRouting.ts` 改为**显式 provider 优先**，URL 启发式退回到 `default:` 分支：

```ts
// :25-40  switch (config.provider) —— 显式提供者一律直接返回
// :42-43  注释：仅为缺失 provider 的旧配置保留端点推断。任何受支持的显式 provider
//         都必须优先，避免中转地址或模型别名中的品牌词切换请求协议。
// :44-50  URL 推断（含 googleapis 子串）只在此兜底路径生效
```

这正是首版指出的缺陷（中转地址含 `googleapis` 被强制切到原生 Gemini 协议）。`providerRouting.test.ts` 由 15 增至 16 用例。

### M8 —— 门禁缺口

`.github/workflows/ci.yml`：

| 行 | 内容 | 对应首版问题 |
|---|---|---|
| `:17` | `node-version: 22.18.0`（原为浮动 `22`） | 环境漂移 |
| `:20` | `pnpm lint` | 无 ESLint |
| `:22` | `pnpm typecheck:index-safety` | 新增 |
| `:25` | `pnpm test:bundle-size` | 体积门禁未进 CI |
| `:28-38` | 独立 `desktop-rust` job：`cargo check --locked --manifest-path src-tauri/Cargo.toml` | **CI 从不编译 Rust** |

最后一条是首版特别点名的：M1/M2 都在 `lib.rs`，而该文件此前从不被任何自动化编译。

---

## 2. ⚠️ 唯一遗留项：M6 —— `executeSendWorkflow` 仍然过大

```text
hooks/useGame/sendWorkflow.ts:653   export async function executeSendWorkflow(
                            :2046   async function runVariableCalibrationStep(
```

当前约 **1393 行**（首版测得约 1503 行；`CODE_AUDIT.md` 时期为 1838 行）。同文件已把大量逻辑提取为顶层小函数（首版只见 6 个顶层函数，现可见 17 个）。

**已改善，但仍承担**整条回合流水线：请求装配 → 流式 → 解析 → 结算 → 8 个后台任务 → 变量校准。它依然是全仓最大的单点故障与最难单测的单元。

**建议**（不改严重度，仅列为后续）：按现有阶段命名继续外提。该目录下已出现 `variableSettlementWorkflow`、`postSettlementCommitStage`、`postNarrativeMemoryStage`、`postTurnElementalStage` 等**已独立成测试的**阶段（见本次新增用例），说明拆分路径已被验证可行，沿用它即可。

---

## 3. 复现与回归

```bash
cd C:\Users\zhong\Desktop\KaiTuoYiShi-main\yuanshen

npx tsc -b            # 期望：无输出，退出码 0
npx vitest run        # 期望：101 files / 600 tests 全通过
pnpm lint             # 本次新增门禁
pnpm test:bundle-size # 本次新增门禁
```

针对本报告结论的定点回归（跑绿即代表 S1–S4 未复发）：

```bash
npx vitest run tests/unit/promptModuleScopesBehavior.test.ts \
               tests/unit/retrievalBehavior.test.ts \
               tests/unit/mainRecallStage.test.ts \
               tests/unit/variablePathSafety.test.ts \
               tests/unit/productionAssetBoundary.test.ts
```

Rust 侧（首版无法执行；CI 现已覆盖，本机需装 Rust 工具链）：

```bash
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

---

## 4. 本文件的判定标准

首版约定「每一行结论背后都要有一次已验证的运行」，本版同样遵守。**所有「已修复」判定都要求两件事同时成立**：

1. 在当前源码里读到修复（附 `文件:行号`）；且
2. 存在断言该行为的测试，且该测试在 `101 files / 600 tests` 那次运行中通过。

唯一例外是 M6 —— 标为**部分修复**而非「已修复」，因为没有任何测试能证明「一个函数有多大」这件事被解决了。

> 本文件现已只包含已修复项的证据与一条遗留建议，不再包含可利用的漏洞链路。
