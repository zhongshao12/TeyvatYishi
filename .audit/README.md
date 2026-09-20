# 审计原始证据 / Audit raw evidence

本目录是 `CODE_AUDIT.md`（仓库根目录）的**支撑材料**，可以安全删除。

生成时间：2026-09-10 · 审计对象：commit `a4e0d45`（v1.5.0 公开快照）

---

## 为什么会有这个目录

沙箱环境禁止子进程 spawn 和 stdout 捕获，所以 `pnpm` / `tsc` / `vitest` / `git` 都无法运行
（报 `EPERM` 或 `access denied`）。审计改为：

1. 用 Node 写独立扫描脚本，**把结果写进文件**而不是打印到 stdout；
2. 直接解析 `.git/index` 二进制来获取 Git 跟踪文件列表（绕开 `git` 可执行文件）；
3. 用 `read` / `grep` 工具逐处阅读源码，核对每个结论。

`CODE_AUDIT.md` 里**没有**任何"我跑过测试"的声明，原因就在这里。

---

## 四个深挖子报告（每个都由独立分析流程产出，并按文件+行号逐条核对）

| 文件 | 内容 |
|---|---|
| `ai-layer.md` | `services/ai/**`（33 模块 ≈14.5k 行）。7 份重复 SSE 解析器、abort 未取消上游、`onDelta` 重试重放、4 个 `*ProxyCore.ts` 的重复量化、密钥处理 |
| `storage-layer.md` | `services/dbService.ts`（1,975 行）及存档/云同步/desktop 镜像全链。写入无串行化、每回合写入放大、快照体积无界、失败伪装成成功 |
| `ui-layer.md` | 渲染层。`game` 每 tick 新 identity 击穿全部 memo、每帧强制同步布局、设置面板重复量化、a11y 排序、新发现的 5 个功能 bug |
| `tooling-layer.md` | 测试/构建/CI。179 个回归脚本的真实性质（61.4% 断言是源码 grep）、覆盖率门禁只测 0.44%、CI 缺口、仓库卫生 |

## 我自己跑的扫描脚本及其输出

| 脚本 | 输出 | 内容 |
|---|---|---|
| `scan.mjs` | `report.txt` | 类型逃逸统计、近似重复代码块、文件体积分布、import 扇入、循环依赖检测、React 性能气味、密钥处理、无障碍统计 |
| `dupScan.mjs` | `duplication.txt` | 跨文件重名函数（91 个）、重复常量（`isRecord` ×20 等）、**150 个跨文件重复的字符串字面量**、分层耦合、巨型文件内部形状 |
| `scriptsAnalysis.mjs` | `scripts.txt` | 回归脚本清单与孤儿脚本（29 个）、脚本风格普查、bundle 门禁数值核算、单测清单 |
| `gitindex.mjs` | `git.txt` | 直接解析 `.git/index`：973 个跟踪文件、按目录分布、>100KB 的跟踪文件 |
| `gitinfo.mjs` | — | 早期尝试（依赖 `git` 可执行文件，失败）。保留仅作记录，**可删** |
| — | `tsc.txt` | **空文件**。`tsc` 因 `EPERM` 未能运行，**可删** |

### 子分析流程留下的中间产物（`_` 前缀，仅供追溯，可删）

`_imported.txt`、`_never.csv`、`_never2.csv`、`_refs.txt`、`_refstatus.csv`、
`_scriptrefs.txt`、`_srclines.csv`、`_textonly.txt`、`_valueimp.txt`

---

## 如何复现

```bash
node .audit/scan.mjs            # → .audit/report.txt
node .audit/dupScan.mjs         # → .audit/duplication.txt
node .audit/scriptsAnalysis.mjs # → .audit/scripts.txt
node .audit/gitindex.mjs        # → .audit/git.txt
```

这些脚本只读仓库、只写 `.audit/` 下的文件，不改动任何源码。

## 未能验证的部分（需要你在本机跑）

`CODE_AUDIT.md` 第 3 节关于构建体积门禁的结论是**静态推断**的，建议这样交叉验证：

```bash
pnpm build
node scripts/bundle-size-report.mjs            # 看真实 chunk 分布
node scripts/bundle-size-regression.mjs        # 应该会"通过"——但看它打印的 cap 数值
node scripts/bundle-size-report.mjs --update   # 然后看 .bundle-baseline.json 的 diff
```

重点看三件事：
1. 打印出的 `capMaxChunk` 是否约 3.4 MB（而真实最大块只有约 1.1 MB）；
2. baseline 里 `maxChunkName` 指的 `chunk-st-presets-*.js` 在 `dist/assets/` 里**是否存在**；
3. `pnpm test` 在**没有先 build** 的干净检出上是否以 ENOENT 失败。

另外建议跑一次 `pnpm test` 和 `pnpm test:all` 的**耗时**，用来评估把 39 个真正执行模块的
脚本迁移到 vitest projects 的收益（现在每次冷跑要串行 spawn 176 次 Node 进程）。
