# 旅行者纪事 v1.5.0 — 代码审计与优化建议

> 审计范围：`C:\Users\zhong\Desktop\KaiTuoYiShi-main\yuanshen`（公开仓库快照，单 commit `a4e0d45`）
> 审计方式：静态代码分析 + 依赖图/重复度扫描 + Git 索引直接解析
> 说明：本报告的每一条结论都附带文件路径与行号，均为实际读取验证，不是推测。

---

## 0. 审计方法与一个环境限制（重要）

沙箱环境**禁止子进程 spawn 与 stdout 捕获**，因此以下命令无法在本机执行：

- `pnpm build` / `tsc -b`（esbuild / tsc 需要 spawn 子进程，报 `EPERM`）
- `pnpm test:unit` / `vitest`（同上，`spawn EPERM`）
- `pnpm test:all`（179 个回归脚本全部依赖 `spawnSync`）

所以**本报告不包含"我跑过了测试"这类声明**。所有结论来自对源码本身的直接阅读与程序化扫描。
建议维护者自行执行一次 `pnpm build && pnpm test` 来交叉验证第 3 节关于构建门禁的结论。

扫描用的脚本与原始输出保留在 `.audit/` 目录，可复现。

### 0b. 我在审计过程中自我更正过的判断

审计过程中有 5 处我最初的判断被后续证据推翻。**列在这里而不是悄悄改掉**，因为它们本身就是"这个项目的代码比表面看起来更需要仔细读"的证据：

| 我最初的说法 | 实际情况 | 结论 |
|---|---|---|
| `useGameState` 有 ~24 个独立 `useState` 切片，与 `game` 对象并存 → "双份真相" | **错。** 只有 14 个 `useState`，且**全是视图级标量**（`:896, 972-988`）；所有游戏切片住在**一个** `useState<TeyvatGameState>`（`useTeyvatRuntime.ts:26`），切片是 `game` 的纯派生（`useGameState.ts:900-912`），`:915-919` 直接取内部引用 | **不存在双份真相。** 撤回。真正的问题只有一个：`legacyView` 的 memo key 是 `[game]`，而 `game` 每 tick 都是新对象（见 9.0） |
| `dbService ⇄ desktopSaveMirror` 是**运行时**循环依赖，会造成初始化顺序 bug | **错。** `desktopSaveMirror.ts:2` 是 `import type`，被 esbuild 完全擦除，`isolatedModules: true` 进一步保证；其 value import 图里没有任何模块到达 `dbService` | **无害，不需要修。** 只是分层瑕疵（见第 8 节更正） |
| 已安装 `@testing-library/react` / `user-event` 但没用 | **错。** `node_modules` 里那个 `user-event` 是 **Storybook 的传递依赖**；`package.json` 的 20 个 devDependencies 里 grep `testing-library` 为 **0 命中** | 情况比"装了没用"**更差**：能力本身不存在（见 5.3） |
| 167/179 回归脚本是纯文本匹配 | **口径偏严。** 该口径没把"用 esbuild 打包后 import"算作行为测试 | 采用更细的分类：**120/176 纯 grep**、24 纯行为、15 混合（见 5.1） |
| 116 个缺 `type=` 的 `<button>` 会导致意外表单提交（a11y 问题） | **错。** 整个 `components/` 下**没有 `<form>`，也没有 `onSubmit`** | **目前不是用户可见 bug。** 撤回严重性排序（见 9.6）；真正的 a11y 问题是 Esc 在 7 个对话框里无效 |
| 118 个缺 `type` 的按钮 = 116（数字） | 实际 118（我第一轮的正则漏计了多行属性写法）| 按 118 计 |

我把这些列出来，是因为它们恰好说明了一件事：**这个项目的代码质量高于它的门禁质量。** 我（和一个只读源码的自动扫描）会在这些点上误判，正是因为代码里有大量"看起来像反模式、实际是经过设计"的东西（`import type` 断环、单 `useState` 根 + 派生切片、`rafCoalescedSetter` 隔离流式）。而现有的 179 个回归脚本**帮不上忙** —— 它们 61.4% 的断言是 grep 源码文本，抓不到上面任何一条。

---

## 1. 项目规模基线

| 维度 | 数值 |
|---|---|
| Git 跟踪文件 | 973 |
| TS/TSX 源文件 | 400（114,902 行） |
| 组件 | 89 文件 / 37,943 行 |
| services | 76 文件 / 20,632 行 |
| utils | 47 文件 / 10,770 行 |
| hooks | 23 文件 / 10,247 行 |
| models | 38 文件 / 9,244 行 |
| tests | 34 文件 / 5,639 行 |
| scripts | 208 个 `.mjs`（其中 176 个 `*-regression.mjs`） |
| 单测 | 32 个 `tests/unit/*.test.ts` |
| 回归脚本总量 | 179（176 glob + 3 manifest） |
| 类型逃逸 | `@ts-ignore` **0**、`@ts-nocheck` **0**、`as any` 5、`as unknown as` 63 |

**先说好的部分**（这些是真做对了，不要在重构中弄丢）：

- `utils/lazyWithRetry.ts` — chunk 加载失败自动重载一次并用 `kty_chunk_retry` 查询参数防死循环，成功后清理标记。这是很多成熟项目都没做对的细节。
- `utils/rafCoalescedSetter.ts` + `utils/streamingMessageStore.ts` — 用 `useSyncExternalStore` 把流式文本挡在 `App`/`useGameState` 之外，再用 rAF 合并到每帧一次。流式性能的关键决策是对的。
- `utils/longSessionRetention.ts`（195 行）— 长会话瘦身策略有明确分层：20 回合详细 / 2 回合保留完整 debugContext / 变量批次 20 详细 + 80 摘要，且 `preTurnSnapshot` 只保留在最后一条消息上。**长会话内存增长是被认真设计过的**，不是漏掉的。
- `services/ai/apiErrorReportService.ts:22` — `maskApiKey` 只保留末 4 位。
- `styles/adventurer-journal-tokens.css` — 令牌层已包含 `@media (prefers-contrast: more)` 与 `prefers-reduced-motion` 降级。
- 全仓库 `eval` / `new Function` / `innerHTML` / `dangerouslySetInnerHTML` **均为 0**。
- 空 `catch {}` 块 **0 个**。

下面的问题是真实存在的，按"价值 / 成本"排序。

---

## 2. 交付物瘦身 — 4.1MB 死资源

**这是投入产出比最高的一条。**

`public/` 下有 7 个 PNG，全部无任何代码引用（对 `zhiku-archive-hall-background-concept`、`icon-trace`、`emblem-reference`、`concept-v2/v3` 四种模式做全仓库 grep，命中数为 0）：

| 文件 | 大小 | 备注 |
|---|---|---|
| `public/assets/zhiku/zhiku-archive-hall-background-concept-v3.png` | **2,061 KB** | 同目录已有 `.webp` 190 KB（**10.8×**） |
| `public/assets/zhiku/zhiku-archive-hall-background-concept-v2.png` | **1,658 KB** | 同目录已有 `.webp` 108 KB（**15.3×**） |
| `public/assets/zhiku/icon-trace/term-emblem-reference.png` | 184 KB | 已有 `term-emblem-precision-a.svg` 等 |
| `public/assets/zhiku/icon-trace/aeon-emblem-reference.png` | 159 KB | 已有 `aeon-emblem-trace.svg` 等 |
| `public/assets/zhiku/icon-trace/enemy-emblem-reference.png` | 100 KB | 已有 `enemy-emblem-trace.svg` 等 |
| `public/assets/zhiku/icon-trace/faction-emblem-reference.png` | 94 KB | — |
| `public/assets/zhiku/icon-trace/gold-emblem-reference.png` | 70 KB | 已有 `gold-emblem-trace.svg` |

合计 **4.1 MB**，占 `public/` PNG 总体积（4.23 MB）的 **97%**。

补充事实：
- `public/` 的 WebP 资源共 146 个仅占 4.25 MB，PNG 用 7 个文件占了 4.23 MB —— 资源策略本身是 WebP 优先的，这 7 个 PNG 是遗留物。
- `.gitignore:26` 已经把 `assets-src/` 标为"工作素材，不随包发布"，说明作者本来就有这个意识，只是 `public/` 下这几张漏了。
- 这两张背景图的 WebP 版本（190KB / 108KB）体积已经很小，说明 WebP 版本才是交付版本。

**动作**：删除这 7 个文件；如果 `icon-trace/*.png` 是 SVG 描摹的参考底图，移到已被 gitignore 的 `assets-src/`。
**收益**：仓库与部署产物减重 4.1 MB，零功能影响。**成本：S（1 分钟）**。

---

## 3. 构建体积门禁已经失效（且"通过"是假通过）

这是我认为**最危险的一条**，因为一个坏掉的门禁比没有门禁更糟 —— 它给出虚假的安全感。

### 3.1 门禁的通过条件在逻辑上是恒真的

`scripts/bundle-size-regression.mjs`：

```js
// line 32-36
const capMaxChunk = Math.min(Math.floor(baseline.maxChunkBytes * 1.15), 3.5 * 1024 * 1024);
const capTotalJs  = Math.floor(baseline.totalJsBytes * 1.15);
...
assert(maxChunkBytes < capMaxChunk, `最大单块 ... 超过预算 ...`);
```

上限是从 baseline **自身派生**的（`baseline × 1.15`）。而 `scripts/bundle-size-report.mjs:45-50` 提供 `--update` 重写 baseline。于是流程是：构建变大 → 门禁报警 → 跑 `--update` 刷新 baseline → 门禁重新通过。**上限会随代码一起漂移，永远不会真正拦住任何东西。**

唯一真正固定的是 `indexBytes < 300KB`（line 31），和 3.5MB 那个兜底。

### 3.2 baseline 已经过期，引用的产物不存在

`.bundle-baseline.json`：

```json
{ "maxChunkBytes": 3024301, "maxChunkName": "assets/chunk-st-presets-DMlFZxWT.js", "at": "2026-09-02T05:00:49.746Z" }
```

但 `vite.config.ts:147-161` 的 `manualChunks` 里**没有任何产生 `st-presets` 这个 chunk 的规则**；对 `st-presets` 做全仓库 grep 也是 0 命中。同时 `data/builtinPresets/index.ts:12-14` 的注释明确说明三个约 3MB 的内置预设已改为 `public/` + 运行时 `fetch`，不再进 JS 包。

结论：这个 3.02MB 的 chunk 是**历史产物**。今天真实的 max chunk 是 `chunk-app`（baseline 自己记录的 1,126,379 B ≈ 1.1 MB）。

后果是双重失效：
- 上限被一个**不存在的大块**抬高到 3.32 MB，而真实最大块只有 1.1 MB → 即使体积翻三倍也不会报警。
- 如果哪天又误把 3MB 数据打进 bundle，门禁**依然不会报警**（3MB < 3.32MB）。

### 3.3 门禁没有被 CI 执行

`.github/workflows/ci.yml` 的步骤是：`pnpm build` → `test:unit:coverage` → `test:release` → `test:all`。

而 `scripts/run-all-regressions.mjs:6` 用 `readdirSync('scripts').filter(f => f.endsWith('-regression.mjs'))` 收集脚本 —— `bundle-size-regression.mjs` 恰好符合这个命名，**所以它其实会被 `test:all` 跑到**。

但 `package.json` 里**没有**任何 `test:bundle-size` 之类的独立入口，CHANGELOG 却把它列为新增回归脚本。也就是说：它的执行完全依赖"文件名恰好匹配 glob"这一隐式约定，一旦改名或移目录就静默失效，而没有人会注意到。

**动作**：
1. 把上限改为**绝对写死的目标**（例如 `maxChunk < 2.0 MB`、`totalJs < 3.5 MB`），而不是从 baseline 派生。
2. 在同一 commit 里 `pnpm build && node scripts/bundle-size-report.mjs --update` 重建 baseline，删掉 `chunk-st-presets` 的残留。
3. 在 `package.json` 加显式 `"test:bundle-size"` 并在 CI 单独置为 required check。
4. 加一条"baseline 中的 `maxChunkName` 必须真实存在于 `dist/assets/`"的断言 —— 这正是本次问题能溜过去的漏洞。

**收益**：让体积回归真正生效。**成本：S**。

---

## 4. 安全：API Key 被明文写进 IndexedDB

### 4.1 泄漏链路（已验证）

```
services/ai/apiTools.ts:304
  const url = `${base}/models?key=${encodeURIComponent(apiKey)}`;   // ← Gemini：key 在 URL 查询串里

        ↓ fetch 失败时

services/ai/chatCompletionClient.ts:1037-1058  fetchWithApiErrorReport()
  void appendApiErrorReport({ source, config, requestUrl: url, requestMode, error });
                                        ^^^^^^^^^^^^^^^ 完整 URL，含 ?key=AIza...

        ↓

services/ai/apiErrorReportService.ts:52-59
  requestUrl: input.requestUrl,          // ← 原样持久化
  const next = [report, ...current].slice(0, MAX_API_ERROR_REPORTS);  // 最多 80 条
  await saveSetting(API_ERROR_REPORTS_KEY, next);
```

`maskApiKey`（line 22-26）只处理 `config.apiKey` 字段 → 存进 `apiKeyHint` 时是脱敏的。
但 `requestUrl` 字段**完全没有脱敏**，而 Gemini 的 key 就在 URL 里。

于是：**最多 80 条含明文 Gemini API Key 的记录，长期驻留在 IndexedDB 的 `apiErrorReports` 表中**。而 IndexedDB 会被 `services/exportService.ts` / `services/savePackage.ts` / `services/cloudBackupBuilder.ts` 打包导出与上传到云存档 —— 即 key 会随每份备份流出。

### 4.2 讽刺的是，正确写法项目里已经有了

`chatCompletionClient.ts:2278` 走的是 header：

```js
'x-goog-api-key': config.apiKey,
```

`services/ai/openAICompatibleModels.ts:30`、`services/ai/apiTools.ts:346` 也都是 header。**只有 `apiTools.ts:304` 这一处把 key 塞进了查询串**（Gemini 的 `models` 列表接口）。所以这是个孤立的不一致，不是设计缺陷。

### 4.3 动作

1. `services/ai/apiTools.ts:304` 改用 `x-goog-api-key` header（与 line 2278 一致）。
2. 在 `appendApiErrorReport` 里对 `requestUrl` 做查询串剥离（`url.origin + url.pathname`），作为纵深防御。
3. 顺手：`services/ai/openAICompatibleModels.ts:68` 的缓存键 `cacheKey` 直接拼了明文 apiKey
   （`` `${base}\u0000${apiKey}` ``）。改成先 `crypto.subtle.digest` 取哈希前缀，避免 key 出现在堆快照/调试面板里。

**收益**：堵住唯一一处 key 外泄路径。**成本：S**。

---

## 5. 测试：179 个回归脚本，但没有一行 UI 测试

### 5.1 程序化测量结果（`scripts/` 全量扫描）

我在第一轮扫描里用"是否 import `.ts`"做了粗分类，得到 **167/179 为纯文本匹配**。这个口径**偏严**：它没有把"用 esbuild 打包成临时文件再 import"的脚本算作行为测试。更细的分类（176 个 `*-regression.mjs`，逐文件人工核对）如下 —— **以这份为准**：

| 类别 | 数量 | 占比 |
|---|---|---|
| **纯文本匹配** —— `readFileSync` + `.includes()`，从不执行任何项目模块 | **120** | **68.2%** |
| **纯行为测试** —— 打包/转译后调用真实导出，不做源码 grep | 24 | 13.6% |
| **混合** —— 既执行模块又 grep 源码 | 15 | 8.5% |
| 其他（子进程 / 文件存在性 / JSON 数据契约） | 17 | 9.7% |

断言级测量（更可信的口径）：

| 指标 | 数值 |
|---|---|
| `assert(` 调用点总数 | **3,914** |
| 直接针对**源文件文本**的断言 | **2,404** |
| **源码 grep 占全部断言的比例** | **61.4%** |
| ≥80% 断言是源码 grep 的脚本 | 98 / 176（55.7%）|
| 完全不含文本 grep 断言的脚本 | 61 / 176 |
| 全套件 `.includes(` 出现次数 | 3,990 |

**结论：这套回归的主体是在对自己的源码做模式匹配。** 约三分之二的脚本、五分之三的断言是 grep。

**为什么这很严重**：文本匹配测试在代码坏掉但字符串还在时会通过。最极端的例子是 `scripts/chat-scroll-smoothness-regression.mjs`（39 行，100% grep）—— 它读取三个 `.tsx`，按字符串边界切出函数体，然后断言字面源码文本。它**不可能**发现第 9.1 节那个"流式每帧重启平滑滚动"的问题，因为那个 bug 完全在于**运行时调用频率**，而不在于源码里有没有某个字符串。

`scripts/save-tree-regression.mjs:25` 更能说明问题：

```js
assert(dbService.includes('return runWithSaveMutationPriority(() => saveGameInternal(record))'))
```

它断言的是**某个实现字符串**。任何重构都会让它失败，而它对行为零验证 —— 正是这种测试会被人习惯性地"改期望值"修好，从而彻底失效。

**公平地说，这套套件不是没有价值**，有真正优秀的部分：
- `long-session-oom-regression.mjs`（242 行，纯行为）：用 `data:` URL 打包 4 个真实模块，跑 170 回合和 500 回合的合成历史（含 4KB debug 字符串）。
- `npc-ledger-variable-facts-behavior.mjs`（258 行，纯行为）：把真实 `<变量事实>` 载荷喂进真实解析器，断言**派生出的命令 key**。
- `story-weaving-regression.mjs`（1,069 行，混合）：约 45 条真实行为断言（跨段跳跃阈值、归档锚点自愈、连续证据累积，`:648-659`）交织约 30 条源码 grep。
- 一些 grep 断言编码了**难以行为化测试的架构不变量**（如 `save-isolation-regression.mjs` 的存档隔离约束）。

所以判断应该是：**它是一套"架构不变量 + 少量行为测试"，不是行为安全网。** 真正的风险是那 98 个 grep 主导的脚本会随着合法重命名被逐个"修期望值"而静默失效。

更微妙的是，这里存在一个**元层面的盲区**：仓库里有一个 `scripts/test-entry-coverage-regression.mjs`，名字表明它在守护"测试入口覆盖率"。但它自己也是文本匹配脚本，因此它**在结构上不可能发现**下面 5.2 节的问题。

### 5.1b 覆盖率门禁主动隐藏了覆盖率

`vitest.config.ts:9-17`：

```js
coverage: {
  provider: 'v8',
  include: [
    'utils/imageTaskQueue.ts',
    'services/storyWeavingConflict.ts',
    'utils/workflowRecoveryModel.ts',
  ],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
},
```

`include` 只有 **3 个文件**。v8 覆盖率只统计这三个文件，于是 80% 的阈值**只在 471 行上成立**。而实际已经存在 **32 个测试文件 / 292 个 `it()` / 6,171 行测试**——它们的覆盖率数字**从未被计算过**。

删掉 `include` 白名单（或改为逐目录渐进提升阈值）这一处改动，会**立刻让已有的 292 个测试用例变得可见**。这是全项目**单位字符收益最高的一处修改**。

另外一处幻影依赖：`scripts/teyvat-avatar-audit.mjs:3` 等 **4 个脚本**硬编码了 `../node_modules/.pnpm/sharp@0.34.5/...`；而 `sharp` **没有出现在 `package.json` 里**（我核对过：`package.json` 中 grep `sharp` 为 0 命中）。而 `teyvat-avatar-audit.mjs` 又在 `test:release` 链里 —— 意味着 **sharp 版本号一变或 pnpm hoisting 策略一变，CI 就会以 module-not-found 失败**。

### 5.2 29 个脚本完全不可达

`test:all` 只跑 `*-regression.mjs` + 3 个 manifest 条目。`scripts/` 里另有 **29 个 `.mjs` 既不符合命名也不在 manifest 中，因此永远不执行**。它们有 `package.json` 入口，所以看起来是活的：

- 桌面端全套 19 个：`desktop-readiness`、`desktop-release-gates`、`desktop-verify-release-gates`、`desktop-storage-audit`、`desktop-storage-strategy`、`desktop-install-update-drill`、`desktop-preflight`、`desktop-stage-release`、`desktop-verify-release`、`desktop-verify-online-update`、`desktop-sign-updater`、`desktop-update-manifest`、`desktop-github-release-notes`、`desktop-github-upload-commands`、`desktop-code-signing-decision`、`desktop-release-rules` 等
- 头像工具：`teyvat-avatar-audit`、`teyvat-avatar-registry-sync`、`teyvat-avatar-roster`、`sync-teyvat-avatar-manifest`、`optimize-teyvat-avatar`、`teyvat-avatar-contact-sheet`
- 其他：`zhiku-project-language-audit`、`zhiku-stage2-legacy-save-acceptance`、`builtin-tavern-preset-surface-audit`、`check-node-version`

其中 **4 个做真实的产物校验**（`desktop-verify-release.mjs:40-62` 重算真实 SHA-256 并交叉核对 `SHA256SUMS.txt`；`desktop-release-rules.mjs:35-55` 有真实的 mtime 新鲜度门禁，能抓住经典的"`.sig` 过期"错误）。但 **7 个只是报告生成器**，写一份 markdown 清单、从不因产物质量失败。

而且**没有任何东西在发布**：`desktop-github-upload-commands.mjs:70,76` 只是**打印** `gh release create/upload` 命令让人手动粘贴；`desktop-code-signing-decision.mjs:75` 只是**打印** `Get-AuthenticodeSignature` 而不执行检查；`src-tauri/tauri.conf.json:26` 是 `"csp": null`，且**没有代码签名配置、安装包未签名**。

一句话：**CI 里有的部分是好的（`tsc -b` + 179 个回归脚本在每个 PR 上跑，对同人项目而言远超平均），但"发布"这件事完全依赖人工、本地、无强制。**

### 5.3 UI 层零行为测试

**先更正我在第 1 节里的一个错误说法**：我当时写"已安装 `@testing-library/react` 与 `user-event`"，这是**错的**。`node_modules` 里出现的 `@testing-library/user-event` 是 **Storybook 的传递依赖**，不是本项目的依赖；`package.json` 的 devDependencies（20 项）里 **grep `testing-library` 为 0 命中**。实际情况比"装了没用"更差 —— **能力本身就不存在**：

- `package.json` 里**没有** `@testing-library/*`、`jsdom`、`happy-dom`、`@vitest/browser`
- `vitest.config.ts:7` 写死 `environment: 'node'`
- `tests/` 下 `render(` / `@testing-library` / `jsdom` / `happy-dom` / `screen.` / `fireEvent` / `document.createElement` / `ReactDOM` **全部 0 命中**
- 唯一例外：`tests/unit/teyvatExtensionSystems.test.ts:519` 用 `renderToStaticMarkup` 对 `LeftPanel` 做了**一次字符串渲染**（无 DOM、无事件、无交互）

所以 **89 个组件 / 37,943 行 —— 全项目最大的单一代码体 —— 自动化验证基本为零**，其中包括 118 个缺 `type=` 的 `<button>`（见 10.1）。

**`fake-indexeddb` 是已安装但没用**：它在 `package.json:143` 里，但 **0 个测试文件使用**（唯一消费者是 `scripts/teyvat-migration-failure-drill-regression.mjs:8`）。而在整个 `tests/` 下，`indexedDB` / `localStorage` / `sessionStorage` 出现 **0 次** —— 没有任何测试碰过存储 API。

**最讽刺的一点**：`services/dbService.ts:197-198` **专门为测试留了一个 seam**：

```ts
afterIndexedDbStaging?: () => void;
```

它被设计成"在 IndexedDB 暂存后、提交前"注入抛错以验证原子性回滚 —— **而测试套件从未使用过它**。也就是说：**测试最危险的持久化层所需的能力（`fake-indexeddb`）和钩子（`afterIndexedDbStaging`）都已经就位，只是没人接线。**

对照：本项目最大的单个函数 `executeSendWorkflow` 有 **~2,075 行**（`sendWorkflow.ts:1652→3727`，见 7.1），它调用 9 个不同的 AI 服务、写存档、改 14 个状态切片，**调用点只有 1 个**（`hooks/useGame.ts:96`），而它只有 **1 个 `it(`**（`tests/unit/postSettlementRecovery.test.ts`），且从 `:1322` 进入后**从未走到提交路径**（`:3645`）或自动存档（`:3354`）。

### 5.3b 覆盖率实测口径

| 指标 | 数值 |
|---|---|
| 真实源码树 | **342 模块 / 106,649 行** |
| vitest 以任何形式引用（import 或 fs 读取） | 100（29.2%）|
| **vitest 从未引用** | **242（70.8%）** |
| **真正被 value-import（模块体实际执行）** | **92（26.9%）** |
| vitest 从未引用的行数 | 65,833 / 106,649（61.7%）|
| 断言套件统计 | 32 个 `*.test.ts`、51 个 `describe`、**292 个 `it(`**、1,246 个 `expect(`|
| `.only` / `.skip` / `.todo` | **0**（没有任何测试被静默禁用，这点值得肯定）|

按目录看 value-imported 数量（最能说明问题的一列）：

| 目录 | 文件 | 行数 | 被 vitest value-import |
|---|---:|---:|---:|
| `components/` | 89 | 40,060 | **9** |
| `services/` | 76 | 22,340 | 23 |
| `models/` | 38 | 9,974 | 22 |
| `utils/` | 47 | 11,713 | 14 |
| `hooks/` | 23 | 10,968 | 14 |
| `prompts/` | 16 | 278 | **0** |
| `functions/` | 8 | 488 | **0** |
| `data/` | 35 | 7,412 | 9 |
| `compat/` | 8 | 1,822 | 1 |

**可以说得出口的结论是：342 个模块中只有 92 个（26.9%）在真实断言下执行过；250 个（73.1%）从未执行。**

四个最危险文件的具体情况：

| 文件 | 行数 | 测试情况 | 风险 |
|---|---|---|---|
| `services/ai/chatCompletionClient.ts` | 2,509 | **0 个测试引用**；11 个脚本引用全是 grep | 读 `config.apiKey` 并构造 `Authorization: Bearer`（`:264`）、`x-api-key`（`:267`）、`x-goog-api-key`（`:272`）；对 `/api/*` 路由**故意去掉 header 把裸 key 放进 POST body**（`:324-340`）；**7 处无保护的 `JSON.parse`** 解析上游 SSE 帧（`:1497,1586,1861,1943,2028,2100,2319`）。密钥泄漏 + 畸形响应风险，零行为覆盖 |
| `services/dbService.ts` | 1,975 | **只在两个 `vi.mock()` 工厂里被引用**，**没有任何导出被真正调用过** | 19 处 `indexedDB` 引用；`JSON.parse` 导入的存档文件（`:1548`）。数据丢失风险，且测试 seam 已就位却未用（见 5.3） |
| `hooks/useGame/sendWorkflow.ts` | 3,727 | 仅 `postSettlementRecovery.test.ts` 的 **1 个 `it(`**，且 mock 了 dbService | `executeSendWorkflow` 是 **~2,075 行的单函数**，是整个回合主循环，**每个回合的单点故障**，1 个测试用例 |
| `utils/variableFacts.ts` | 1,648 | 四个文件里覆盖最好的（6 个测试文件 import） | `factsToVariableCommands`（`:1023-1351`，~329 行）**导出但无任何引用 —— 死代码** |

### 5.4 一个未声明的运行时要求 + 两个已被"锁死"的缺陷

**（a）未声明的 Node floor。** 有 **12 个脚本直接 `import ... from '../services/xxx.ts'`**，依赖 Node 内置类型擦除。类型擦除默认开启是 Node **22.18.0**；22.6–22.17 需要 `--experimental-strip-types`。

`package.json` **没有 `engines` 字段**、**没有 `.nvmrc` / `.tool-versions`**，`ci.yml:17` 又钉的是浮动的 `node-version: 22`。所以 CI 今天能过，纯粹因为 `setup-node` 拉到的是 ≥22.18。好消息：这 20 个 `.ts` 目标都不含不可擦除语法（无 `enum` / `namespace` / 构造函数参数属性 / 装饰器）。

**（b）`test:desktop-edition` 被引用但未定义。** `desktop-preflight.mjs:4` 与 `desktop-readiness.mjs:52` 都要求它，而 `package.json` 里没有这个脚本（我 grep 确认）。后果：`pnpm desktop:preflight` **在第 1 步就失败**，`desktop:readiness` **永久报告 `missing=1`**。更糟的是，`desktop-edition-regression.mjs:922` 只检查该字符串**是否存在**，所以它把这个 bug **锁死**了 —— 又一个"文本匹配测试保护了缺陷"的实例。

**（c）发布门禁证据可被环境变量伪造。** `desktop-release-gates.mjs:41-44` 接受 `DESKTOP_RELEASE_GATES_LOCAL_READY=1` / `..._READINESS_READY=1` 来**预先勾选**"已运行 …"复选框，而实际什么都没跑。真正严格的检查是 `desktop-verify-release-gates.mjs:31`（只要还有 `- [ ]` 就失败），但它**只能手动跑**。

### 5.5 `test:all-prompt` 的依据文档被 gitignore

`.gitignore:44` 整体忽略了 `docs/`。而：

```js
// scripts/run-prompt-regressions.mjs:1-3
// 提示词相关回归脚本聚合入口（P0 准备项，2026-07-26 提示词优化计划）
// 用法：pnpm run test:all-prompt
// 清单来源：docs/superpowers/specs/2026-07-26-prompt-optimization-feasibility-review.md §3
```

**一个 28 脚本测试清单的来源文档被 gitignore 了。** 于是"为什么是这 28 个、按什么标准挑的"对任何克隆仓库的人**不可恢复**。而这个清单（`:6-35`）与 `run-all-regressions.mjs` 的自动扫描**大量重叠**，所以 `test:all-prompt` 的唯一独特价值，恰好存在于那个被忽略的文件里。而且这 28 个脚本**在任何自动化里都没被跑过**（`ci.yml` 不含 `test:all-prompt`）。

顺带：`CONTRIBUTING.md`（1,393 B）**不提测试、lint 或构建流程**（grep `test|CI|deploy|build` 无命中）。179 个脚本的套件是项目最有价值的资产，却对贡献者完全无文档 —— 贡献者无法分辨哪个脚本是真的行为测试、哪个只是 grep。

### 5.6 一个空文件与两个多余的大二进制

- **`components/features/Settings/WorldbookManagerModal.tsx` 是一个 3 字节的裸 BOM**（`EF BB BF`，零内容，我已读取确认）。它有 **0 个导入者**；`App.tsx:57` 导入的是真正的 1,297 行 `components/features/Worldbook/WorldbookManagerModal.tsx`（55,532 B）。这是文件移动留下的死文件，**但 `tsconfig.json:18` 的 `include: ["**/*.ts","**/*.tsx"]` 会在每次 `tsc -b` 时编译它**。删除即可。
- **`stories/assets/**`（16 文件，743 KB，含 456 KB 的 `addon-library.png`）** 是 Storybook 默认脚手架素材，而 `.storybook/main.ts` 只注册了 `@storybook/addon-docs` —— 大部分图片没有任何 story 引用。
- **`src-tauri/icons/icon.icns`（2.76 MB）** 是 macOS 图标，而 `tauri.conf.json:31` 的 bundle target 是 **`["nsis"]`（仅 Windows）**。

### 5.7 动作（按性价比）

1. **删掉 `vitest.config.ts:11-15` 的 `coverage.include` 白名单** —— 立刻让 29 个已有测试文件 / 292 个 `it()` / 6,171 行进入覆盖率统计。**成本 S，收益最高。**
2. **修 `bundle-size-regression.mjs`**：用 `fs.existsSync(dist)` 保护（现在只保护 baseline 不保护 dist），加 `package.json` 的显式 `test:bundle` 入口，并让 `test` 脚本先 build 或在 dist 缺失时跳过。**当前 `pnpm test` 在干净检出上会以 ENOENT 失败，而 CI 却能过**（因为 `ci.yml:20` 先 build 了）—— 这是对"主要开发命令"的信任破坏。
3. **在 `package.json` 声明 `sharp`**，把 4 个硬编码的 `../node_modules/.pnpm/sharp@0.34.5/...` 换成 `import sharp from 'sharp'`。**成本 S**，消除一个卡在 CI 路径（`test:release`）上的幻影依赖。
4. **加 `engines.node` / `.nvmrc`**，把 12 个脚本依赖的 Node ≥22.18 变成显式要求。**成本 S。**
5. **修 `test:desktop-edition` 缺失**，并删掉 `desktop-release-gates.mjs:41-44` 的环境变量伪造通道。**成本 S。**
6. **先把 `test-entry-coverage-regression.mjs` 改成真正的检查** —— 让它枚举 `scripts/*.mjs` 与 `*-regression.mjs` 的差集，发现孤儿就失败。**成本 S**，立刻防住 5.2 类问题复发。
7. **把桌面发布链接进 CI**（哪怕只在 `workflow_dispatch` 或 tag 上跑），并补上 `cargo check` —— **当前 Rust 那一半在 CI 里从未编译过**，改坏 `src-tauri/src/lib.rs` 会绿着通过。**成本 S–M。**
8. **接线已有的测试能力**：装 `jsdom` + `@testing-library/react`，用上已装的 `fake-indexeddb`，用上已存在的 `afterIndexedDbStaging` seam。先给 `dbService` 存档/读取写测试，再挑 3–5 个关键组件。**成本 M–L，但是本清单上限最高的一项。**
9. **把那 39 个真正执行模块的脚本（24 行为 + 15 混合）迁到 vitest projects**，用共享的 `loadModule()` 打包 helper 替掉约 2,000 行重复 harness，把 111 份手写 `assert` 换成 `expect`。**成本 M。**
10. **不要大爆炸式重写那 98 个 grep 主导的脚本** —— 逐个判断"改成行为测试"还是"改成显式架构标记（`// ARCH-INVARIANT: ...`）"。注意这个不对称：**grep 测试写起来便宜、维护起来贵**，每次合法重命名都会失败，而"改期望值"式修复提供的保护是零。

### 5.8 关于"该不该合并 90 个脚本"的判断

根因**不是工具偏好，是架构**：这些模块在 Node 里不可测（`story-weaving-regression.mjs` 必须手写 stub 20 个依赖才能 import `services/storyWeaving.ts`），所以 176 个脚本本质上是一套**被重复实现 176 次的模块隔离框架**。

值得肯定的是，这套 interop 很有创造力，而且**没有构建步骤**，共 5 种机制：
- **(a)** `ts.transpileModule` → 临时目录 → 重写 `@/` 别名 → 动态 import（10 个文件）
- **(b)** esbuild 打包 → **`data:text/javascript;base64,` URL import**（最优雅的一种，`long-session-oom-regression.mjs:5-17`）
- **(c)** esbuild → 临时文件 → `pathToFileURL`
- **(c′)** 对**字符串切出来的函数片段**做 esbuild `transform` —— `save-catalog-behavior-regression.mjs` 用 `indexOf` 偏移把 `summarizeSave` 从 1,975 行的 `dbService.ts` 里切出来跑。**它名字里有 "dbService"，却完全不碰 `indexedDB`**：它测试的是隔离的 `summarizeSave`，而让 `dbService` 危险的那条持久化路径一点没覆盖。而且两个函数任一改名，`indexOf` 返回 `-1`，切片变成垃圾 —— **静默失效**。
- **(d)** 直接 `import '../services/xxx.ts'`（12 个文件，见 5.4a）

**结论：合并到 vitest projects 是值得的，但要分步，不要大爆炸。** 39 个真正执行的脚本是资产，值得迁移；那 5 个货真价实的行为测试（`long-session-oom`、`npc-ledger-variable-facts-behavior`、`story-weaving`、`teyvat-avatar-audit`、`teyvat-migration-failure-drill`）**绝对不要删** —— 它们在做真活。

---

## 6. 重复代码：缺失的展示层原语

### 6.1 测量结果

最触目惊心的是**同一个 CSS `clipPath` 多边形字符串在 36 个文件里各写一遍**（作 `const smallClip = 'polygon(6px 0, ...)'`）：

| 常量名 | 出现文件数 |
|---|---|
| `smallClip` | **36** |
| `cardClip` | **30** |
| `clipSmall` | 5 |
| `providerOptions` | 9 |
| `savedFlash` | 12 |
| `handleSave` | 13 |

按字符串字面量去重（40–300 字符），跨文件重复的**不同**字面量有 **150 个**：

| 重复次数 | 字面量 |
|---|---|
| 37× | `polygon(6px 0, 100% 0, 100% calc(100% - 6px), ...)` |
| 31× | `polygon(10px 0, 100% 0, 100% calc(100% - 10px), ...)` |
| 22× | `polygon(8px 0, ...)` |
| 17× | `polygon(4px 0, ...)` |
| 15× | `inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.2)` |
| 14× | `linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), ...)` |
| 13× | `polygon(7px 0, ...)` |
| 9× | `linear-gradient(135deg, rgba(140, 220, 160, 0.95), ...)`（"已保存"绿色）|

### 6.2 根因：`components/ui/` 几乎是空的

`components/ui/` 只有 4 个文件、382 行：`ErrorBoundary.tsx`、`Icons.tsx`、`Modal.tsx`、`ToastHost.tsx`。

对比之下，各面板各自手写了本应共享的原语（同名定义出现在多个文件）：

| 原语 | 重复定义次数 | 举例 |
|---|---|---|
| `isRecord` | **20** | `compat/legacy-hsr/classify.ts`、`models/teyvat/character.ts`、`VariableManager.tsx` … |
| `Field` | 10 | `CodexSettingsTab.tsx`、`GameSettings.tsx`、`ImageGenerationSettingsTab.tsx` … |
| `ToggleRow` | 9 | 6 个 Settings tab |
| `readText` | 6 | `arkProxyCore.ts`、`opencodeProxyCore.ts`、`pioneerProxyCore.ts`、`presence.ts` |
| `proxyHeaders` | 4 | 4 个 `*ProxyCore.ts` |
| `uniqueText` | 4 | `npcRelationshipPlanning.ts`、`storyPlanningAnalysis.ts`、`storyProgressService.ts` |
| `assertNotAborted` | 4 | `cloudBackupBuilder.ts`、`cloudBackupMerge.ts`、`githubCloudSave.ts`、`githubRequest.ts` |
| `yieldToMainThread` | 3 | 同上三个云备份文件 |
| `TabButton` | 3 | `CompanionPanel.tsx`、`SaveLoadModal.tsx`、`WorldbookManagerModal.tsx` |
| `formatSize` | 3 | `SaveLoadModal.tsx`、`StorageManager.tsx`、`DesktopHomeScreen.tsx` |
| `sha256Hex` | 3 | `cloudBackupPackage.ts`、`desktopMigrationBackup.ts`、`desktopSaveBackup.ts` |
| `crc32` / `concatBytes` / `findEndOfCentralDirectory` | 2 each | ZIP 实现被抄了两份（`albumArchive.ts` 与 `savePackage.ts` / `imageGeneration.ts`）|

顶层函数名跨文件重复的共 **91 个**。

### 6.3 为什么这不只是"不好看"

`isRecord` 这种校验函数一旦在某一份里修了 bug，另外 19 处不会跟着修。`assertNotAborted` / `yieldToMainThread` 散在 4 个文件里，任何一处的中断语义调整都会造成云备份行为不一致。

而 `clipPath` 的 36 份拷贝有实打实的**开发体验代价**：想统一改圆角时，Cmd+Click 跳到的是某个组件内的局部常量，改完全项目要追 36 处，且没有任何编译期保护会提醒你漏了一处。

### 6.4 动作

1. 新建 `styles/clipPaths.ts`，导出 `CLIP_SMALL / CLIP_CARD / CLIP_ITEM / CLIP_PANEL` 与共享的 `insetRing(alpha)`、`gradientAccent()` helper；把 150 个重复字面量替换为引用。成本 **M**，收益最大（机械替换，风险低）。
2. 把 `isRecord`、`readText`、`assertNotAborted`、`yieldToMainThread`、`sha256Hex`、`uniqueText` 收敛到 `utils/guards.ts` / `utils/async.ts` / `utils/hash.ts`。成本 **S**。
3. 建 `components/ui/` 原语：`SettingsTabShell`（含保存按钮 + `savedFlash` + `saveMessage`，一次消灭 13 个 `handleSave` 与 12 个 `savedFlash`）、`ToggleRow`、`Field`、`TabButton`、`Panel`。成本 **M**。
4. ZIP 实现合并成 `utils/zip.ts`（`crc32` / `concatBytes` / `findEndOfCentralDirectory`）。成本 **S** —— 这是最值得优先做的一条，因为存档包与相册归档走的是两份独立实现，bug 修复会分叉。

---

## 7. 巨型文件与巨型函数

### 7.1 `executeSendWorkflow` 有 1,838 行

```
hooks/useGame/sendWorkflow.ts   3,728 行   58 个顶层函数
  └─ export async function executeSendWorkflow()   ← 1,838 行（占总文件 49%）
```

一个函数里塞了编号注释 `// 0.` 到 `// 10.` 的十一个阶段（行号已核对）：

| 阶段 | 起始行 | 内容 |
|---|---|---|
| 0 | 1720 | `compactPreTurnSnapshot` 全状态快照 |
| 1 | 1742 | 追加 user 消息 + 清掉旧 `preTurnSnapshot` |
| 2 | 1761 | 构建 system prompt |
| 3 | 2121 | 组装 API messages |
| 4 | 2258 | **流式请求 + 自动重试循环（约 220 行内联）** |
| 5 | 2484 | 构建 AI 消息 |
| 6 | 2621 | 记忆 |
| 7 | 2657 | 全局事件 |
| 8.5 | 2745 | 变量模型校准 |
| 9.5 | 3301 | 元素附着与反应 |
| 10 | 3330 | 自动存档 |

阶段 4 的重试循环本身就内联了 4 类校验分支，每类都要：写 `appendApiErrorReport`、推队列任务、`console.warn`、`apiMessages.push(...)`、`continue`：

- 空响应（line 2360-2374）
- 同行成员遗漏（line 2375-2391）
- 重 roll 相似度过高（line 2400-2418）
- DeepSeek 协议不完整（line 2419-2429）

这四段结构高度相似，是**明显的可提取模式**（见 7.3）。

### 7.2 其他巨型成员

| 文件 / 函数 | 行数 |
|---|---|
| `components/features/Settings/PromptModulesTab.tsx` → `PromptModulesTab()` | 3,466 / **927**（另有 875 行的 `V2PresetSwitcher`）|
| `components/features/Settings/StorageManager.tsx` → `StorageManagerTab()` | 2,552 / **996**，且 **`DesktopStorageStatus` 有 55 个 prop**（`:1415-2202`，调用点 `:947-1017`）|
| `components/features/Settings/ApiSettings.tsx` → `ApiSettingsOverviewTab()` | 1,501 / **1,076（单组件）** |
| `App.tsx` → `App()` | 1,530 / **~1,047** |
| `services/ai/chatCompletionClient.ts` | 2,510 |
| `services/dbService.ts` | 1,976（122 个顶层函数，最长仅 93 行 —— 这个文件**结构其实还行**，问题是职责数量不是函数长度）|
| `components/features/GameSystems/album/workspaces.tsx` | 2,772（其中 `:2118-2771` 约 700 行是**无 hook 的纯 builder**）|
| `components/features/GameSystems/PlotPanel.tsx` | 1,658（容器有状态，但 16 个内部组件**全是纯 props-in/JSX-out**）|
| `utils/variableFacts.ts` → `factsToVariableCommands()` | 1,649 / 324（**且是死代码**，见 5.3b）|
| `components/features/GameSystems/AlbumPanel.tsx` | 1,482（**34 个 `useState` 全在一个组件里**，无内部组件）|
| `components/features/GameSystems/CompanionPanel.tsx` | 1,247 |

**关于 `useState` 数量的更正**：我先前写 `StorageManager` "57 个 `useState`（全项目最多）"并暗示这是状态管理架构问题。数量属实，但**我先前对 `useGameState` 的描述是错的，需要更正**：

`useGameState.ts` 里现在**恰好只有 14 个 `useState`**，且**全部是视图级标量**（`view` / `apiSettings` / `gameSettings` / `currentTheme` / `worldbooks` / `hasSave` / `loading` / `workflowHint` / `workflowStatus` / `liveRecallSummary` / `liveRecallFullContent` / `pendingVariable` / `pendingOpeningTrigger` / `interruptedWorkflow`，见 `:896, 972-988`）。

**所有游戏切片都住在同一个 `useState<TeyvatGameState>` 里**（`hooks/useTeyvatRuntime.ts:26`），而 `useGameState.ts:900-912` 的 `legacyView` 是把它**派生**出来的 memo，`:915-919` 的 `背包`/`手机`/`世界树`/`蒸汽鸟报`/`图鉴` 更是直接取 `game` 的内部引用（注释在 `:914` 写得很清楚）。

**所以不存在"双份真相"**，切片都是 `game` 的纯函数，不会互相矛盾。我先前那个判断是错的。真正的问题只有一个，而且和第 9.0 节是同一个 —— `legacyView` 的 memo key 是 `[game]`，而 `game` 每 tick 都是新对象。

### 7.3 建议的拆分（具体到可执行）

**`sendWorkflow.ts`** —— 抽出 `hooks/useGame/mainStoryRequest.ts`，把阶段 4 拆成：

```
runMainStoryWithRetries(deps) → { result, cloudRetryMeta }
  ├─ validateBlankResponse()          // 纯函数，易测
  ├─ validatePartyMembers()           // 纯函数
  ├─ validateRerollSimilarity()       // 纯函数（已有 calculateRerollSimilarity）
  ├─ validateDeepSeekProtocol()       // 纯函数（已有 getDeepSeekMainProtocolIssues）
  └─ 统一 retry 编排：{ detail, guard(message), report(source) } 一个策略对象驱动
```

这样 4 个分支塌缩成一份编排逻辑 + 4 个纯函数，且**每个纯函数都能进 vitest**（现在一个都不能测，因为它们埋在 ~2,075 行里）。

**`App.tsx`** —— 它是"路由 + modal 编排 + slot 组合"。22 个 `useCallback` **不是**性能问题（`useGame` 的 `actions` 通过 `stateRef` 保持 identity 稳定，`useGame.ts:66-69, 537-567`），所以不要为了性能去动它们。真实问题在：12 个 modal 布尔量；`SettingsModal` 的 prop 包在 `:1082-1130` 与 `:1241-1284` **逐字复制两遍**；4 个 slot JSX 每渲染都构造成 element 对象（`:813-976`）；150 行的 `renderSystemPanel` + 40 字段 ctx 类型（`:1377-1529`）；约 200 行装饰性覆盖层（`:75-282`）。

拆分目标：`views/Home|NewGame|Game`、`ModalsHost`、`GameShellSlots`、`SystemPanelHost`、`hooks/useAppModals|useCourierReply|useWorkflowRecovery|useAppCommands`、`overlays/*`、`data/animationTimings.ts` → `App` ≈ **180 行**。**成本 M。**

**`StorageManager.tsx`** —— `StorageManagerTab` 的 996 行 + 57 个 `useState` 说明它同时管了"存储列表 + 诊断 + 迁移 + 清理 + 桌面目录"至少 5 件事，按 tab 拆成 5 个组件 + 1 个共享 hook；`DesktopStorageStatus` 的 55 prop 应改为传一个 context 或已聚合的 view-model。

**`PromptModulesTab.tsx`** —— 927 行组件 + 19 个 `useState` / 0 个 `useCallback` / 0 个 `memo`。**其中 `:1300-1574` 约 275 行是死代码**（`PresetSwitcher` + `V1PresetEntriesPanel`，无调用点；`:423` 的注释说明 V1 路线已废弃）。按 `modules` / `worldbook` 两种 `mode` 拆成两个组件，然后删掉死代码。

**`PlotPanel.tsx`** —— 16 个内部组件全是纯函数，是**最便宜的大文件拆分**。另外它有 10 处 index-as-key，**其中 6 处用在玩家可编辑的 AI 名字上** → 同级重挂载 + 输入时丢失焦点；还有两处 `.reduce` 遍历全部章节/分段直接写在 JSX prop 里（`:618-619`）。

**`album/workspaces.tsx`** —— `:2118-2771` 约 700 行纯 builder（无 hook）→ 抽到 `album/workspaces/model.ts`。**这是该目录性价比最高的一处（成本 S）。**

**`SaveLoadModal.tsx`** —— `buildSaveTreeTimeline(group)` 在 JSX 的 `.map` 内部被调用（`:502`）；`formatTime` 每渲染重建并传给最常重复的 `SaveRow`（`:377-386`）。

---

## 8. 循环依赖（6 条）— 全部无害，但暴露了一处分层问题

依赖图扫描发现 6 条环：

```
compat/legacy-hsr/readOnly.ts -> models/codexArchive.ts -> compat/legacy-hsr/readOnly.ts
models/settings.ts -> utils/imagePromptRules.ts -> models/settings.ts
models/storyWeaving.ts -> models/settings.ts -> models/storyWeaving.ts
compat/legacy-hsr/migrate.ts -> models/teyvat/index.ts -> models/teyvat/save.ts -> compat/legacy-hsr/migrate.ts
services/dbService.ts -> services/desktop/desktopSaveMirror.ts -> services/dbService.ts
services/ai/apiTools.ts -> services/ai/connectionTestPolicy.ts -> services/ai/apiTools.ts
```

**我最初怀疑最后两条是运行时环，这个怀疑是错的，在此更正。** 实际核对：

`services/desktop/desktopSaveMirror.ts:2`

```ts
import type { SaveListItemSummary } from '@/services/dbService';
```

是 **`import type`** —— 纯类型导入，被 esbuild 完全擦除；`tsconfig.json:12` 又开了 `isolatedModules: true`。所以运行时**不存在**这条边，不会产生 ESM 的 `undefined` 绑定问题。**不需要修，不要为了"消除环"去动它。**

它仍然是一处**分层瑕疵**（底层 mirror 反向依赖了顶层 orchestrator 的类型），正确的写法项目里已经有了 —— `services/cloudBackupBuilder.ts:2` 从 `@/services/storage/saveCatalog` 导入同一类型。改成那样子是**一行改动**，价值不在"消环"，而在于它是拆分 `dbService.ts` 的前置条件。

---

## 8b. 存储层：没有写入串行化（真实数据丢失风险）

这是四个深挖方向里**最严重的一组发现**，且与第 8 节的"环"无关，是另一个问题。

### 8b.1 `runWithSaveMutationPriority` 不是互斥锁

`services/storage/saveCatalogRepair.ts:72-83`（已核对源码）：

```ts
export async function runWithSaveMutationPriority<T>(task: () => Promise<T>): Promise<T> {
  pendingWriteCount += 1;
  try {
    return await task();          // ← 直接并发执行，没有任何排队
  } finally {
    pendingWriteCount = Math.max(0, pendingWriteCount - 1);
    if (pendingWriteCount === 0) {
      for (const resolve of Array.from(writeWaiters)) resolve();
      writeWaiters.clear();
    }
  }
}
```

函数名读起来像"以存档变更优先"，实现是**计数器**：它只用来暂停后台目录修复循环，**不提供任何互斥**。名字暗示的保证与实际行为不符，这是它容易被误用的原因。

由此产生三个具体的 read-modify-write 竞争（都在存档关键路径）：

| # | 位置 | 竞争内容 | 后果 |
|---|---|---|---|
| a | `services/desktop/desktopSaveMirror.ts:147-159` `reserveDesktopSaveId` | 读 ID → +1 → 写回，无 CAS | 两次并发保存抢到**同一个 id**，都写 `saves/save-N.json`，后者覆盖前者；失败那次的 IndexedDB `add` 抛 `ConstraintError`，而 `dbService.ts:306-312` **把它转成成功返回** |
| b | `desktopSaveMirror.ts:129-145` `mirrorSaveToDesktop` | 对 `saves/index.json` 做 RMW | 丢失更新 → 已提交的存档在列表里**不可见**（因为 `dbService.ts:363-372` 在桌面列表非空时优先信列表） |
| c | `desktopSettingsMirror.ts:33-47` `mirrorSettingToDesktop` | 对 `config/settings.json` 做 RMW | 设置丢失更新；每回合在 `sendWorkflow.ts:3364-3367` 命中 **4 次** |

可达路径：`hooks/useGame.ts:224-230` 的 `persistMemorySnapshot`（在 `:282 / :325 / :413 / :451 / :469` 被调用）与流式期间的自动存档**重叠**；手动保存按钮只靠自身的 `SaveLoadModal.tsx:528,589` 状态禁用，不防并发。

**动作**：把 `runWithSaveMutationPriority` 换成真正的 promise 链单飞队列（把"修复优先"的计数器作为**队列内部的独立信号**保留），并加 `navigator.locks.request('ktys-save-write', ...)` 处理跨标签页。**成本 S，一次修掉 a/b/c 三个竞争。**

### 8b.2 每回合的写入放大（四个独立来源）

| 来源 | 位置 | 量级 |
|---|---|---|
| 全状态 normalize **3 次/回合** | `saveLoadWorkflow.ts:85`（`withLegacyChat→normalizeConversationLog`）、`:86-92`、然后 `dbService.ts:187` 对**已经 normalize 过的** payload 再 normalize 一次 | 第 3 次是纯浪费，可删 |
| 全状态深比较 **4 次/回合** | `utils/saveDeltaStorage.ts:191-214, 292-326` 的 `jsonCompatibleEqual` 覆盖 17 个切片，每次保存调用两次（`dbService.ts:244, 282`） | — |
| **桌面模式：每回合把每张相册图重新 base64 一遍** | `utils/saveAssetStorage.ts:93` + `utils/albumObjectUrl.ts:20` 让 64MB Blob 缓存里的资源全部进入 `extractSaveAssetRecords`；`desktopAssetMirror.ts:374-391` 在**主线程**用 32KB 字符串拼接 + `btoa` 转 base64，再逐资源写 payload + `.meta.json` | ~20 张 @1.5MB ≈ 每回合 ~30MB→~40MB base64 + 40 次文件写，**图片根本没变**；无任何短路 |
| 恢复日志内嵌**整份已提交状态**，且走 `saveSetting`（即整份 `settings.json` 的 RMW） | `sendWorkflow.ts:2812-2817` 的 `committedState: committedSettlementGame`；每回合最多持久化 **6 次**（`:1718, 1751, 2608, 2772, 2817, 3362`） | — |

另外 `dbService.ts:966-979`（`countDeltasUsingBase`）与 `:946-955`（`getReferencedDeltaBaseIds`）在启用轮转后，每次自动存档要做 Θ(全部 delta) 的全游标扫描 **+ 每个 delta 一次 IPC**。

**动作**（按性价比）：
1. 删掉 `dbService.ts:187` 的多余 normalize（**S**，用已有的 `teyvatSaveContract` 单测守住）。
2. 桌面资源镜像改为增量：`assets/index.json` 里已有相同 `(id, updatedAt, size)` 就跳过（**M**，第 8b.1 之外最大的一笔桌面性能收益，把"每回合重写 ~30MB"变成"相册没变就什么都不写"）。
3. 给 `activeWorkflowRecoveryV1` 在 `desktopSettingsMirror.ts:29-31` 的 `SPECIAL_SETTING_PATHS` 里开独立文件，并把回合末 4 次 `saveSetting`（`sendWorkflow.ts:3364-3367`）合并为一次 `saveSettings(patch)`（**S**）。
4. `utils/saveDeltaStorage.ts:216-234`：当 `baseIsPrefix` 为 false 时应标记 `baseMode: 'checkpoint'`，而不是**静默把整份聊天历史塞进一个叫"delta"的记录**（**S**）—— 现在这让"delta 节点"的体积不可预测，也架空了保留策略的体积估算。

### 8b.3 快照：**数量**有界，**体积**无界

`utils/longSessionRetention.ts:113-129` + `utils/saveRuntimeCompactor.ts:77-89` 保证**最多只有 1 份 `preTurnSnapshot` 存活**，与回合数无关 —— 这一点做得很好。

但它的**体积**无界：`世界树` / `图鉴` / `NPC` / `剧情` / `记忆` 都**没有条目上限**（对 `models/teyvat` grep `slice(-|MAX_` 只命中 `MAX_ELEMENT_EVENTS`），聊天历史也从不裁剪（body 全文保留）。

一个尖锐的边界 bug：`utils/longSessionRetention.ts:177-185` 的 `findLatestSnapshotCarrier` 在"最新一条消息没有快照"时返回 `-1`，此时**所有**快照都会被丢弃，而不是只丢最新的那条。

**动作**：扩展 `compactChatHistoryForLongSession`，把超过 N 回合的 body 替换为已有的 `continuation.summary`（数据现成），并给 `世界树.entries` / `图鉴.entries` 加上与 `MAX_ELEMENT_EVENTS` 同风格的显式上限。这是"200 回合没问题"变成"2000 回合没问题"的关键，也是**唯一的配额防御**（见 8b.4）。

### 8b.4 失败语义：三处把失败伪装成成功

1. `dbService.ts:306-312`：IndexedDB 失败时**返回 desktopSaveId 当作成功**。
2. `dbService.ts:314-318`：迁移路径的提交后镜像失败被吞掉，UI 报成功（`GitHubCloudSaveModal.tsx:245`），而合并后的存档可能不可见。
3. `components/features/SaveLoad/SaveLoadModal.tsx:168`：`alert('保存失败')` **丢弃了 `err.message`**（只 `console.error`），用户无法区分"配额满"和"格式错误"。

配套：**全仓库没有任何 `QuotaExceededError` 处理**（grep `QuotaExceeded|navigator.storage|estimate()` 只命中一处无关文案），也没有用量展示与预防性清理。

另有一处 fire-and-forget：`hooks/useGame.ts:494` 的 `saveSetting('storyWeavingSystem', ...)` 既没 `await` 也没 `.catch` → 未处理的 rejection。

**动作**：`dbService.ts:306-312` 改为返回带类型的 `{ ok: false, mirrorOnly: true }`；`getSaveCatalogSnapshot`（`:363-372`）在桌面列表**比 IndexedDB 键集合更短**时回退到 IndexedDB；`SaveLoadModal` 显示真实 message 并加 `QuotaExceededError` 分支。**成本 S。**

### 8b.5 云存档：设计扎实，但指针没有 CAS

**做得好的**：header-only Bearer token（从不进 URL）、OAuth state 校验且 client_secret 在服务端（`functions/api/auth/github.ts:25-27`）、上传真正原子（git blob + 单次 tree/commit/ref）、每分片双向 SHA-256 + size 校验、合并提交是单次 5-store 只插不改的事务（`dbService.ts:636-718`，`:689` 用 `add` 而非 `put`）。**这套云同步的正确性高于同类项目平均水平。**

**问题**：
- **HIGH — 云端指针丢失更新**：UI 覆盖前从不检查远端（`GitHubCloudSaveModal.tsx:166-167`），`githubCloudSave.ts:228-229` 读旧指针**只是为了算删除列表**，随后在 `:281-291` 一次 commit 覆盖 `cloud-backup.json`。没有 CAS，也没有 `snapshotId`/`createdAt` 比对 → 设备 B 的"同步全部"会静默顶掉设备 A 更新的快照，A 的分片还在对象存储里但**通过 App 再也访问不到**。`:619` 对 ref 的非 force 更新 + 重试（`:506-516`）保护的是 **ref**，不是 payload。
- **HIGH — GitHub PAT 明文落盘**：`GitHubCloudSaveModal.tsx:106-109` → `dbService.ts:1321-1327` → Web 端是未加密的 IndexedDB 行，**桌面端是明文文件 `config/settings.json`**（因为 `githubCloudSaveConfig` 不在 `desktopSettingsMirror.ts:29-31` 的 `SPECIAL_SETTING_PATHS` 里）。这与第 4 节的 Gemini key 是**同一类问题**，只是载体不同。
- `githubRequest.ts:92-95` 的 timeout/abort **在响应体阶段失效**：`githubCloudSave.ts:702-711` 读 body 时已不可取消，所以卡住的 90MB 分片会永远挂着，`transferTimeoutMs`（`:842-844`）是死代码。
- `cloudBackupWorkerClient.ts:31` 的 `onerror` 既不置空也不 `terminate()` worker，且未处理 `onmessageerror` → 后续 `postMessage` 永不 settle，弹窗卡死。
- **gzip 炸弹**：`cloudBackupPackage.ts:145-149` **先解压再检查** 128MB 上限。
- **孤儿暂存**：`internal.cloudMerge.*` 记录（节点 JSON + 资源 Blob）存在 settings 库里，**没有任何回收器**（TTL 清理器覆盖的是另一个 DB，`cloudBackupTransferStore.ts:143-155`，且只从 `cloudBackupBuilder.ts:72` 调用）。合并中途崩溃就永久泄漏，并污染 settings blob。

### 8b.6 IndexedDB 连接生命周期

`dbService.ts:129-177` 处理了 `versionchange`，但**没有 `onclose`**。连接被强制关闭后，`dbPromise` 仍是一个已失效的句柄，之后每个事务都抛 `InvalidStateError` 且无恢复路径 → **整个会话报废直到刷新页面**。`onblocked` 分支会泄漏句柄（后续 `onsuccess` 命中 `settled=true` 就再也不 close）。`cloudBackupTransferStore.ts:157-184` 同样。

**动作**：加 `db.onclose = () => { dbPromise = null; }` + 一次重试包装。**成本 S，收益：消除"必须刷新才能继续用"的整类故障。**

---

## 8c. AI 调用层：4 个真实缺陷

### 8c.1 `onDelta` 在后端重试时被重放，UI 文本被拼接（已独立复核）

这是我在收到报告后**亲自读源码确认**的一条，因为它是唯一一条会直接污染玩家可见正文的 bug。

链路：

```
services/ai/chatCompletionClient.ts:1348-1353   每次 DeepSeek 恢复尝试都传入同一个回调
    const text = await chatCompletionOnce(attemptConfig, attemptRequest, {
      onDelta: callbacks.onDelta,      // ← 同一个闭包，无"重来"信号
      onDone: () => {},                // ← 注意：每次尝试的 onDone 被吞掉
      ...
    });

services/ai/deepSeekRecovery.ts:140            内部重试，外层完全不可见
    const retryResult = await run(initialConfig, { appendRecoveryInstruction: true, ... });

hooks/useGame/sendWorkflow.ts:2287, 2298       消费者按"外层 attempt"重置，看不到内层重试
    streamedText = '';   // 仅每个外层 attempt 重置一次
    streamedText += delta;
```

结果：若 DeepSeek 第 1 次尝试已吐出部分正文、第 2 次才成功，则

- `streamedText` = **尝试 1 + 尝试 2 的拼接**
- `result.fullText` = **只有尝试 2**

而 `streamedText` 恰恰是 `sendWorkflow.ts:2367, 2383, 2407, 2429` 处的**兜底值**（空响应判定、队伍校验、重 roll 相似度、DeepSeek 协议校验都要用它）。`onDone` 在 `chatCompletionClient.ts:1372` 只在恢复循环**全部结束后**触发一次，所以消费者**在原理上无法**用 `onDone` 划分尝试边界。

**影响**：DeepSeek 恢复路径下正文/流式预览可能重复或污染；`rerollSimilarity` 基于被污染的文本比较，可能误判。

**动作**：给 `StreamCallbacks`（`chatCompletionClient.ts:15-22`）加 `onRestart?: () => void`，在每次尝试开始前调用；消费者在 `onRestart` 里重置 `streamedText`。**成本 S（约 1 小时）。**

### 8c.2 7 份手写 SSE 解析器，且共享同一个 abort 缺陷

`chatCompletionClient.ts` 里有 **7 处**几乎逐字相同的流读取循环：`:1481-1519, 1571-1618, 1847-1881, 1929-1973, 2014-2045, 2086-2117, 2304-2343`。它们**只有 chunk 提取函数不同**，约 230 行重复。

7 处的 teardown 全是 `reader.releaseLock()`（`:1517, 1616, 1879, 1971, 2043, 2115, 2341`）：

```js
} finally {
  reader.releaseLock();     // ← 释放锁，但不取消底层流
}
```

`releaseLock()` **不会**取消流。整个 `services/ai/` 里**没有** `AbortController`、`reader.cancel()` 或 `body.cancel()`。后果：用户点"中止"或请求失败后，**上游模型仍在继续生成并计费**，客户端只是不再读。

另外，7 份里有 3 份（`streamOpenCodeMessages:1975`、`streamOpenCodeResponses:2047`、`streamGemini:2345`）**从不调用 `onResponseDiagnostics`**，这会**静默禁用** DeepSeek 的空正文恢复机制（`deepSeekRecovery.ts:127, 133, 138` 都依赖它）。

**动作**：抽出 `readSseStream(response, signal, extractDelta)` 单一实现（删约 230 行），teardown 改为 `reader.cancel()` 并串联 `signal`。**成本 S。这是本层性价比最高的一条** —— 同时减少 230 行、修掉 abort 计费泄漏、并让 3 个缺失的 diagnostics 一次补齐。

### 8c.3 `signal` 在 9 个重试点中有 6 个没被尊重

`services/ai/retry.ts:7` 把 `signal` 定义为**可选**，于是有 6 处调用直接不传：`imagePromptTokenizer.ts:132`（其 `tokenizeImagePrompt:91-96` 连 signal 形参都没有）、`characterAnchorExtract.ts:74`、`memoryCompression.ts:96`、`apiTools.ts:51`、`:399`。

后果与 8c.2 同源：用户取消后仍会**最多发出 3 次已计费的 LLM 调用**。

**动作**：把 `RetryOptions.signal` 改为**必填**，让编译器把所有遗漏点列出来。**成本 S（30 分钟）。**

### 8c.4 其他已核实缺陷

| 项 | 位置 | 问题 |
|---|---|---|
| Vite dev 代理破坏 SSE | `vite.config.ts:51, 76, 101, 126` | `res.end(Buffer.from(await response.arrayBuffer()))` **把整个流缓冲成一体**，导致 dev 环境下 ark/pioneer/qianfan/opencode 没有逐字渲染 → **流式 bug 在本地无法复现**。改用 `Readable.fromWeb(response.body).pipe(res)` |
| 代理不转发取消 | `arkProxyCore.ts:83-90`、`pioneerProxyCore.ts:74-81`、`opencodeProxyCore.ts:101-105`、`qianfanProxyCore.ts:128-135,147-154,169-176` | `request.signal` 未传给上游 fetch |
| 4 个 `*ProxyCore.ts` 高度重复 | `arkProxyCore.ts:61-104` vs `pioneerProxyCore.ts:52-95` | 43 行 handler 里约 40 行完全相同；`proxyHeaders()` / `readText()` 在 4 个文件中逐字节相同；跨 2+ 文件重复的不同行有 49 行（21 行在全部 4 个文件里）。另有**三份互不一致的 OpenCode URL 归一化器**（`opencodeProxyCore.ts:15-28`、`chatCompletionClient.ts:228-239`、`apiTools.ts:55-67`）—— 这类"同一规则三份实现"是未来 bug 的温床 |
| `onError` 契约破损 | `chatCompletionClient.ts:15-22` 声明 → `:1351` 传递 → `services/ai/text/index.ts:81` 依赖，**但传输层从不调用它** | 上层认为会收到错误回调，实际只有 `onDone` 会在成功时触发 |
| 死代码 | `isGeminiConfig:83`、`shouldUseDeepSeekPrefix:96`、`openCodeHeaders:260-275`、`readOpenCodeResponsesStreamDelta:1773-1782` | 仅有定义、无调用 |
| 模型缓存永不失效 | `openAICompatibleModels.ts:80-82` `clearOpenAICompatibleModelCache` **零调用者** | 模块级 `Map` 缓存（key 里含明文 apiKey，见 4.3）永不清空、无淘汰、无 in-flight 去重 → 测试间串味 |
| NovelAI 响应体二次读取 | `imageGeneration.ts:721-728` | `readJsonResponse` 已在 `:325` 用 `text()` 消费 body，`:728` 又落到 `blob()` → 抛 `TypeError`，**掩盖真实错误** |
| 中止被伪装成失败 | `imageGeneration.ts:104-116` | abort 被转成 `status:'failed'`，于是 `sendWorkflow.ts:1079` 的调用方守卫**永远不会触发** |
| 静默吞异常并持久化外部 URL | `imageGeneration.ts:1019-1026` | 裸 `catch {` 返回一个**可能带签名的** provider URL 并作为 `src` 存档 |
| CJK 长度校验按字节比较 | `functions/api/auth/_shared.ts:34-37` | 把 `text.length`（UTF-16 码元数）与**字节**上限比较 → 中文实际限额约为预期的 3 倍 |

### 8c.5 AI 层中**不要**重构的部分

- `services/ai/novelaiPromptCompiler.ts` 的预算计算**可证明正确**（无 off-by-one；`:240/:262` 的 floor 不可达）。
- SSE 分帧对**部分 JSON 是安全的**：`chatCompletionClient.ts:1488` 的 `buffer = lines.pop() ?? ''` 意味着不会解析半截 chunk，缓冲区也不会无界增长 —— 这一点我独立核对过，结论与报告一致。
- `services/ai/narrativeImageParse.ts`：有携带 `code` + `rawText` 的类型化错误类（`:400-410`），且校正重试会降低温度并限制次数（`:550-554`）。
- `services/ai/responseParser.ts:346-360` 的 live/legacy 解析器分离是**刻意的**，且有单测钉住（`tests/unit/narrativeTurnParser.test.ts:157-158`）。
- `services/ai/imageGeneration.ts` **零 `console.*`、密钥只出现在 header**，且整个图像栈**零非空断言**。`chatCompletionClient.ts` 全文件只有 2 处 `as unknown as`。
- 更正一条我原先的猜测：图像栈**没有** Stability/Ark/Gemini 分支 —— `models/settings.ts:422` 恰好只有 4 个（`openai_compatible|novelai|sd_webui|comfyui`），且 `imageGeneration.ts:202` 把 provider 钉死为 `openai_compatible`，所以 4.1 节的 Gemini key 问题**不可达于图像栈**，只影响文本模型列表接口。

---

## 9. 渲染与运行时性能

### 9.0 真正的第一性能风险：每一次状态变更都重渲染整条可见正文 `[复核]`

我最初只找到了滚动 thrash（9.1）和 `rewriteConfig` 穿透 memo（9.2）。但更根本的问题在下面这条链上，**它比前两条严重得多，而且作者自己在注释里已经点出了这个危险**：

```ts
// hooks/useGameState.ts:898-912
// Legacy 适配层转换必须按 game 引用缓存：否则任何一次 setState（哪怕只是 loading）
// 都会在渲染期重建这些对象，导致传给子组件的 props 引用全变、React.memo 全部失效。
const legacyView = useMemo(() => ({
  旅人: toLegacyTraveler(game),
  世界: toLegacyWorld(game),
  chatHistory: toLegacyChat(game),
  …
}), [game]);
```

**注释写对了，但 `[game]` 这个 memo key 根本稳不住：**

```ts
// hooks/useTeyvatRuntime.ts:32-34
const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
  setGame((current) => updateTeyvatState(current, updater));   // ← 每次都返回新根对象
}, []);

// models/teyvat/state.ts:87-113 —— 永远返回新对象，并重跑 16 个 normalizer
// models/teyvat/runtimeSlices.ts:428-455 —— normalizeConversationLog 重建**每一条**消息对象
```

于是：**一次 `相册` 写入或一次 `queueTasks` push，会重新 normalize 整个游戏状态（含完整对话日志），然后对新的 `game` 标识重跑全部 11 个 legacy adapter。** 其中 `toLegacyChat`（`useGameState.ts:384-422`）最贵 —— 每条消息都重新分配对象，重建 `parsedResponse.body/choices/factCandidates/continuation` 数组（`:387-395`）、`debugContext.messages`（`:407`）、`narrativeImages`（`:420`）；对快照承载者还要走一次完整 `toLegacyTurnCheckpoint`（`:405` → `:363-382`，内部又 `createEmptyTeyvatGameState()` + `normalizeTeyvatGameState()`）。

**所有本来写对了的 memo 全部被击穿：**

| 被击穿的 memo | 位置 | 原因 |
|---|---|---|
| `ChatHistoryList` | `ChatList.tsx:60` | `messages` 数组每 tick 都是新引用 → prop 比较失败 |
| `TurnItem`（可见的那 20 个） | `TurnItem.tsx:92` | 每个 `message` 对象都是新的 |
| `parseBodyLines` | `MessageRenderers.tsx:550` | 依赖 `[content, traveler, userInput]`，`traveler` 每 tick 都新 |
| `buildNpcLookupMap` | `MessageRenderers.tsx:552` | `NPC` 数组每 tick 都新 |
| `TopBar` / `LeftPanel` / `RightMenu` | `TopBar.tsx:23`、`LeftPanel.tsx:32`、`RightMenu.tsx:17` | 它们收到的四个切片每 tick 都新 |

触发这些 tick 的频率很高：`setQueueTasks`（`sendWorkflow.ts:759`）、叙事配图写 `相册`（`:956, :3253`）、NPC 压缩（`:3192, :3229`）、`updateGameState`（`:2938, :3324`）、每次记忆/变量提交，以及任何面板交互。**每一次都重新解析每条可见 AI 回合的正文，并重建 NPC 映射、相册查找和整棵正文子树。**

**修法（最关键的一条，且改动很小）** —— 不需要架构重写。normalize 本身**已经在各个 setter 里做过了**（`withLegacyChat` 调 `normalizeConversationLog`，`useGameState.ts:427`；`withLegacyAlbum` 调 `归一化相册系统`，`:615`；`applyLegacyWorldState` 调 `normalizeTeyvatWorld`，`:304`），而 `replaceGameState`（`:28-30`）保持为读档/迁移的 normalize 边界。所以只要让 `updateGameState` 在无变化时返回原对象、并且不在热路径上重复 normalize：

```ts
// hooks/useTeyvatRuntime.ts:32-34
const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
  setGame((current) => {
    const next = updater(current);
    if (next === current) return current;      // 切片级 bail-out
    return next;                               // normalize 交给 setter / 边界
  });
}, []);
```

**关于"要不要换成 `useReducer` 或 context store"** —— 我一开始倾向于认为 24 个独立 `useState` + 并行 `game` 对象是架构问题，**这个判断需要修正**：

- **`useReducer`：不值得。** `game` 已经是一个通过单一 `setGame(current => …)` 变更的单一对象，reducer 形状其实已经存在。成本在 `normalizeTeyvatGameState` + adapter，不在 dispatch 机制上。换 reducer 本身修不了上面这条。
- **context + selector store：对渲染路径确实更好，而且本项目已经证明这个模式可行** —— `utils/streamingMessageStore.ts` + `utils/toastStore.ts` 就是"模块单例 + `useSyncExternalStore`"，而且可从非 React 的 service 代码调用（`sendWorkflow.ts` 在 `:2806, 3021, 3199, 3235, 3269, 3410` 推 toast）。**流式渲染路径之所以快，正是因为它绕过了 `App`/`useGameState`。** 把这个模式推广到 `game` 是对的终点，但不是第一步。
- **那个 adapter 层不要急着删。** `toLegacyTurnCheckpoint` / `fromLegacyTurnCheckpoint`（`:326-382`）同时是**存档/读档边界**。重写它就是在拿"存档兼容性"冒险 —— 而这个项目最不能丢的就是存档。

**建议顺序**：先做上面的 identity 修复（约 40 行，行为不变，只改引用稳定性，**本报告性价比最高的一处**）；然后按切片逐步迁移（先 `旅人`/`相册`/`NPC`，它们读点最少、identity churn 最高）；只有在 profiling 仍显示 App 级重渲染压力时，才考虑全量 context store。

### 9.1 流式期间的滚动 thrash（`useLayoutEffect` 依赖了每帧都在变的值）

`components/features/Chat/ChatList.tsx:226-229`：

```js
useLayoutEffect(() => {
  if (pendingHistoryAnchorRef.current) return;
  forceLatestMessage();
}, [forceLatestMessage, historyWasReplaced, loading, streamingMessage, visibleMessages.at(-1)?.id]);
```

`streamingMessage` 来自 `useStreamingMessage()`（`ChatList.tsx:126`），在流式期间**每帧更新一次**（`rafCoalescedSetter` 的存在就是为了这个）。而 `forceLatestMessage`（line 151-155）每次都调用：

```js
bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
```

即：**流式生成时每帧启动一次新的平滑滚动动画**。`scrollIntoView({behavior:'smooth'})` 是浏览器动画，反复调用会不断重置动画起点，在长回复下表现为滚动迟滞/抖动，并持续占用主线程与合成线程。

紧邻的 `handleScroll`（line 132-143）**做对了** —— 它用 `scrollStateRafRef` 做 rAF 节流并对值做相等性判断（line 139 `if (nearBottomRef.current === nextNearBottom) return;`）。同一个文件里两种风格，说明这条依赖是后来加的，没有走同样的节流路径。

**顺带一个真实功能缺陷 `[复核]`**：这个 effect **无条件**滚动，完全没有判断用户是否已经上滑去看历史。后果是 **AI 写作期间玩家无法回读**，而且那个"回到底部"FAB（`ChatList.tsx:343-358`）**永远不可能生效** —— 因为你刚滚上去就被拉回底部了。

**动作**：`streamingMessage` 不要走 `forceLatestMessage`，改为"仅在已贴底时跟随 + rAF 合并 + 流式期间不用 smooth"：

```js
useEffect(() => {
  if (!nearBottomRef.current) return;        // 玩家上滑看历史时不打扰
  if (scrollFollowRafRef.current != null) return;
  scrollFollowRafRef.current = requestAnimationFrame(() => {
    scrollFollowRafRef.current = null;
    bottomRef.current?.scrollIntoView({ block: 'end' });   // 流式期间不用 smooth
  });
}, [streamingMessage]);
```

保留 `loading` / `historyWasReplaced` / 末条消息 id 走原来的 `forceLatestMessage`。**成本：S。**

### 9.2 `App.tsx` 里每次渲染都新建的 prop

`App.tsx` 传给 `<ChatList>`：

```jsx
rewriteConfig={state.apiSettings.activeConfigId
  ? (state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId) ?? state.apiSettings.configs[0] ?? null)
  : (state.apiSettings.configs[0] ?? null)}
```

内联 `find` + 三元，**每次 `App` 渲染都产生新引用**。`ChatList` 内部的 `ChatHistoryList` 是 `memo` 的（`ChatList.tsx:60`），`rewriteConfig` 引用变化会穿透 memo。不过在 9.0 的 identity 问题修好之前，这条其实是**次要的** —— 因为 `messages` 本身就每 tick 在变。

**顺带一处逻辑不一致**：这个三元把"取活跃配置"写在 JSX 里，而 `hooks/useGame.ts:72-90` 已有 `getActiveConfig` 做同一件事（还额外合并了 `enableClaudeMode`）。**两处不一致** —— UI 上"重写"用的配置与实际重写用的配置可能不同。

**动作**：提成 `useMemo` 并复用 `useGame` 的解析逻辑。**成本：S。**

### 9.2b 渲染期修改全局注册表 `[复核]`

`App.tsx:538-552`（已读源码确认）：

```js
const commandItems = useMemo(() => {
  clearCommands();                                    // ← 渲染期副作用
  registerCommand({ id: 'save', … });                 // ← 渲染期副作用
  …
  return listCommands();
}, [actions]);
```

在 `useMemo` 内部 `clearCommands()` + 多次 `registerCommand()` 是**渲染阶段的全局副作用**。在 React 18+ 并发渲染下不安全：渲染可能被中断或丢弃，但副作用已经执行了 —— 被丢弃的那次渲染会把注册表留成"已清空"或"半填充"状态。叠加 `index.tsx:21` 的 `<React.StrictMode>`（开发期双调用），这个模式在开发环境的重复注册/清空时序是未定义的。

**动作**：把注册搬到 `useEffect`（依赖 `[actions]`），`commandItems` 从 store 订阅。**成本：S。**

### 9.3 `revealStreamingPreview` 的伪流式延迟

`hooks/useGame/sendWorkflow.ts:832-877` + 调用点 `2497-2505`：

```js
if (state.gameSettings.enableStreaming) {
  if (streamEventCount > 0) {
    await previewChain;                    // 真流式：等预览链结束
  } else if (displayText.trim()) {
    await revealStreamingPreview(state, displayText, abortController.signal, {
      delayMs: 16, minChunks: 8,           // 非流式 provider：假装打字机
    });
  }
```

`revealStreamingPreview` 把**已经完整拿到的文本**切成块，每块之间 `await waitStreamingPreviewDelay(16)`。`waitStreamingPreviewDelay`（line 785-807）每次调用都要 `setTimeout` + `addEventListener('visibilitychange')` + `signal.addEventListener('abort')` 再加 `removeEventListener` 三件套。

对于不支持真流式的 provider，一段 2,000 字回复会被切成约 8–10 个大块，**纯等待 128–160ms**，期间用户看到的是"已经生成完的内容在慢慢吐"。`prefers-reduced-motion` 也没有被检查 —— 而 `styles/adventurer-journal-tokens.css:39-44` 已经为动效定义了降级令牌，说明项目在别处考虑了这个偏好。

**动作**：
1. 读取 `window.matchMedia('(prefers-reduced-motion: reduce)')`，命中时直接 `streamSetter.flush(text)` 跳过动画。
2. 把每块一次的 `addEventListener('visibilitychange')` 改为入口注册一次、结束注销一次（现在是 O(chunks) 次注册/注销）。
3. `delayMs` 按文本长度动态缩放，避免长文本累计等待。

**收益**：非流式 provider 的首字可见延迟 + 动效偏好合规。**成本：S。**

### 9.4 功能性缺陷：历史回合的书签按钮是死的 `[复核]`

`ChatList.tsx:283-295`（已读源码确认）渲染 `<ChatHistoryList>` 时传了 11 个 prop，**唯独漏了 `onToggleBookmark`**：

```jsx
<ChatHistoryList
  messages={renderedMessages}
  neighborMeta={neighborMeta}
  onEditBody={onEditBody}
  onRegenerateNarrativeImage={onRegenerateNarrativeImage}
  …
  rewriteConfig={rewriteConfig}
/>          {/* ← 没有 onToggleBookmark */}
```

而它是在 `ChatListProps:15` 声明、在 `ChatHistoryListProps:48` 声明、在 `ChatHistoryList` 解构 `:64`、并最终在 `TurnItem.tsx:236` 被调用的。所以 **`onToggleBookmark` 在 `ChatList` → `ChatHistoryList` 这一跳被丢掉了，每个历史 AI 回合上的"书签"按钮点了没反应。**

有趣的对照：`narrativeImageManualEnabled`（`:288`）和 `rewriteConfig`（`:294`）都传了 —— 说明这是纯粹的遗漏，不是设计。而这个 bug 能存活，正是因为**没有任何组件测试**（第 5.3 节）：任何一次 `TurnItem` 的渲染测试都会立刻抓到它。

**动作**：补上 `onToggleBookmark={onToggleBookmark}`。**成本：S（1 行）。**

### 9.5 其他已核实的 UI 缺陷

| 缺陷 | 位置 | 影响 |
|---|---|---|
| 系统面板 idle 预加载会被静默取消且不重试 | `App.tsx:563-571` + `lazyWithRetry.ts:74-86` | 首次打开 12 个系统面板之一时可能命中未预热的 chunk。与第 5.4 节的 `clearReloadMarker` 问题同源 |
| `PlotPanel` 草稿 effect 会丢弃正在编辑的内容 | `PlotPanel.tsx:248-250`（依赖含 `updatedAt`） | 后台持久化会把你手动编辑器里正在打的字**冲掉** |
| 两个同名 clip 常量含义不同 | `VisualSettingsTab.tsx:9-10`（8px）vs 其他 21 个文件（6px）；`StorageManager.tsx:89-92`（8px）vs 其他（10px） | 静默视觉漂移；"统一改一处"会弄坏另一个界面 |
| 两处 `clipPath` 是矩形 no-op | `SettingsModal.tsx:233`、`ApiSettings.tsx:154` | 死样式，误导后续读者 |
| `Icons.tsx` 用 emoji 充当 22 个"图标" | `components/ui/Icons.tsx` | 跨平台字形不一致，无法跟随主题色 |

### 9.6 无障碍：按真实用户影响排序（更正我先前的判断）

我在第一轮扫描里把"118 个 `<button>` 缺 `type=`"列为 a11y 问题。**这个判断是错的，需要撤回**：我已 grep 确认**整个 `components/` 下没有任何 `<form>` 元素，也没有任何 `onSubmit`**。没有 form 就不存在"误提交"，所以 `type` 缺失目前**不是用户可见 bug**（`react/button-has-type` 仍然值得开，作为对未来加 form 的防护，但它不是当下的 a11y 问题）。

真正有影响的是这几条：

| 排名 | 问题 | 位置 | 影响 |
|---|---|---|---|
| **1** | **Esc 在约 12 个对话框中有 7 个无效** | 7 个 modal | 真实、高影响。键盘用户无法用标准方式关闭 |
| **2** | **焦点没有被困在**同样这 7 个对话框里 | 同上 | 同一根因；Tab 会跑到对话框背后的内容 |
| 3 | `<div onClick>` 背景遮罩无键盘路径 | 17 处（其中 3 处是真的问题） | 鼠标专属交互 |
| 4 | 无标签输入框 | 2 处 | 屏幕阅读器无法说明字段用途 |
| 5 | 118 个缺 `type` 的按钮 | 见上 | **目前不是 bug**（见上方更正） |
| 6 | `htmlFor` 只有 1 处 | — | **基本是误报**：多数标签用包裹式关联，合法 |
| 7 | `Icons.tsx` 的 emoji 图标 | 见 9.5 | 字形/主题问题 |

`components/ui/Modal.tsx`（189 行）已经是**全项目唯一**有 `tabIndex` 的 modal 基类，说明焦点管理的正确做法已经存在，只是 7 个对话框没有走它。**动作**：让那 7 个对话框统一走 `Modal`。**成本 S。**

### 9.7 `manualChunks` 把所有应用代码打成一块

`vite.config.ts:147-152`：

```js
manualChunks(id) {
  if (!id.includes('node_modules')) {
    if (id.includes('/services/') || id.includes('/hooks/') || id.includes('/models/')) return 'chunk-app';
    return undefined;
  }
  ...
}
```

`baseline` 记录 `chunk-app` = **137 模块 / 40,123 行 → 1,126,379 B ≈ 1.1 MB**。

两个后果：
1. **缓存失效粒度最差**：改任何一个 model 字段或 service 函数，整个 1.1 MB 对回访用户全部失效。改 `models/teyvat/steambird.ts` 里一行字符串，就要重下全部 `services/ai/*`、23 个 hooks、38 个 models。
2. **懒加载被部分抵消**：`App.tsx:53-72` 声明了 22 个 `lazyWithRetry`，但 `SettingsModal`（332 KB）、`AlbumPanel`（243 KB）这些懒加载面板都从 `chunk-app` 取依赖，而 `chunk-app` 在首屏就加载了。有个不对称值得注意：**`components/`（89 文件 / 37,943 行，源码量比 chunk-app 还大）反而没被打进 `chunk-app`，所以 UI 是真的被路由切分了** —— 配置切了 UI，却把整个领域/服务/模型层钉死在首屏关键路径上。

**动作**：按加载体量/变更频率拆，例如 `chunk-core`（状态模型 + 回合主循环）、`chunk-ai`（`services/ai/*`）、`chunk-storage`（`services/storage/*` + `dbService`）、`chunk-teyvat-models`；或者干脆对 app 模块返回 `undefined`，让 Rollup 按动态 import 边界自己切。配合第 3 节把门禁修好，用**绝对**预算（如单块 < 1.5 MB）而非派生上限。

**收益**：回访用户的增量下载量、首屏 TTI。**成本：M。**

---

## 10. 工程化缺口

### 10.1 没有 linter

`package.json` 里没有 `lint` 脚本，仓库里没有 `.eslintrc*` / `eslint.config.*` / `.prettierrc` / `biome.json`。

而源码里留着 **2 处 `eslint-disable-next-line react-hooks/exhaustive-deps`**（`CourierModal.tsx:112`、`PromptModulesTab.tsx:441`）和 1 处 `TODO`（`PromptModulesTab.tsx`）—— **说明曾经有过 ESLint，后来配置丢了**。

在 114,902 行、400 个文件的规模下，这个缺口的实际代价是：
- 891 处内联箭头函数（`useMemo` 只有 122 处、`useCallback` 63 处、`React.memo` 10 处）—— 引用不稳定导致的 memo 穿透无法被自动发现，正是 9.2 那类问题的温床。
- 上面 2 处 `exhaustive-deps` 抑制会重新变成"沉默的 bug 源"，因为没有 lint 会在新增依赖时提示。

**动作**：上 ESLint（flat config）+ `typescript-eslint`，**第一批只开这几条**，避免一次性淹没在存量告警里：

```
react-hooks/exhaustive-deps        (warn)
react-hooks/rules-of-hooks         (error)
@typescript-eslint/no-floating-promises  (warn)   ← 大量 fire-and-forget，价值高
@typescript-eslint/no-misused-promises   (warn)
no-console                          (warn, 允许 console.warn/error)
```

`console.log` 目前只有 2 处（都在 `scripts/`），但 `console.warn` 有 72 处、`console.error` 50 处（其中 32 处在 `StorageManager.tsx`）。**先不禁止，只做可视化**，否则会引发大规模无关改动。

### 10.2 `tsconfig.json` 可以更严

当前已有 `strict: true`（好），但缺：

| 选项 | 建议 | 理由 |
|---|---|---|
| `noUncheckedIndexedAccess` | 建议开 | 大量 `array[0]` / `map[key]` 访问；`App.tsx` 的 `configs[0]` 就没判空 |
| `exactOptionalPropertyTypes` | 谨慎 | 存量代码大量用 `undefined` 赋值可选属性，开了改动量大，建议放最后 |
| `noImplicitOverride` | 建议开 | 几乎零成本 |
| `verbatimModuleSyntax` | 建议开 | 配合 `isolatedModules` 提升构建确定性 |
| `skipLibCheck: true` | 保留 | 合理 |

**注意**：`noUncheckedIndexedAccess` 在 267 个无测试覆盖的模块上开启会产生大量告警，**建议先只在 `models/` 和 `utils/` 目录通过一个继承的 `tsconfig` 开启**，避免一次性阻塞。

### 10.3 常量真值：`--update` 刷 baseline 的诱惑

第 3 节已经说过。补充一条流程建议：**baseline 更新应作为 PR 里的显式、可审查的 diff**，并在 CI 里检查 baseline 的 `maxChunkName` 是否存在于 `dist/assets/`。

---

## 11. 服务端与部署

### 11.1 `functions/api/presence.ts` 目前是关闭的（好事），但启用前需要改造

```js
// line 3
const PRESENCE_SYSTEM_ENABLED = false;
```

`onRequestGet`（line 292-299）与 `onRequestPost`（line 301-319）都直接返回 disabled body，**没有实际响应**。隐私上目前是安全的 —— 我核对了 `buildPresenceBody`（line 139+）返回的是 `PresenceBody` 类型（`online` / `onlineCount` / `storage` 等聚合字段），**不含 `PresenceSessionRecord` 里的 `ip` / `userAgent`**，所以之前担心的"在线列表泄漏 IP"并不成立。

但启用前有两个问题必须处理：

1. **无鉴权的 KV/R2 写入**。`onRequestPost` 接受客户端传入的任意 `sessionId`（`readSessionId` 只做字符白名单与 96 字符截断，line 66-68），然后 `writeRegistry`（line 187-200）对 `ONLINE_SESSIONS_KV` / R2 做 **read-modify-write 全量 registry 覆盖**。恶意或仅仅量大的心跳会：放大写入成本（每次心跳写整个 sessions.json，上限 500 条），并且并发心跳之间存在经典的 lost-update（读→改→写无 CAS）。
2. **`wrangler.toml` 已经绑定了真实的 KV namespace id**（`fa2733b4a1b64405997a4f34f725234f`）并设了 `ONLINE_SESSIONS_KV_PREFIX` 变量 —— 配置是"准备好启用"的状态，而代码里是 disabled，这个不一致容易让人误以为它在工作。

**动作**（启用前）：POST 加轻量限流（同 IP 每分钟 N 次）+ 校验 `sessionId` 形态（如必须是 UUID）；把 registry 写入改为按 session 分键（代码里其实已经有 `writeKvSession` / `getKvSessionKey`，line 216-219，但 `upsertPresenceSession` 走的是 `writeRegistry` 全量覆盖路径，**两套写路径并存**，需要统一到分键写入）；GET 只返回聚合计数（当前已满足）。

### 11.2 部署脚本

- `deploy:cf` = `pnpm build && wrangler pages deploy dist --project-name=kaituoyishi --branch=main`
- CI 里**没有**部署步骤，也没有环境区分（preview / production 靠 `deploy:cf:preview` 手跑）
- `pnpm build` 已经包含 `tsc -b`（`package.json:11`），所以 CI 的 build 步骤确实做类型检查 —— 这点是对的。

---

## 12. 优先级总表

按"价值 ÷ 成本"排序。P0 = 建议本轮就做。**每条都经过实际读码验证**（标注 `[复核]` 的是我独立确认过的关键项）。

### P0 — 本轮就做（合计约 1–2 天）

| # | 问题 | 位置 | 收益 | 成本 |
|---|---|---|---|---|
| 1 | **`game` 每 tick 新 identity → 击穿全部 memo，重渲染整条可见正文**（约 40 行修复，行为不变） | `useTeyvatRuntime.ts:32-34` + `useGameState.ts:900-912` `[复核]` | **本报告性价比最高的一处**：消掉每 tick 的 O(state) 工作，恢复所有现有 `memo` | **S** |
| 2 | 4.1 MB 无引用 PNG 随包发布 | `public/assets/zhiku/**`（7 个文件） | 产物/仓库减重 97% of PNG | **S** |
| 3 | **写入无串行化**：`runWithSaveMutationPriority` 只是计数器不是锁 | `services/storage/saveCatalogRepair.ts:72-83` + `dbService.ts:193,220,468,498,506,537,621,725` | 一次修掉 3 个 read-modify-write 竞争（存档 id 双占 + 文件覆盖、mirror index 丢失更新、settings blob 丢失更新）→ **真实数据丢失** | **S** |
| 4 | 失败被伪装成成功（3 处） | `dbService.ts:306-312`、`:314-318`、`SaveLoadModal.tsx:168` | 已提交的存档在 UI 里不可见 / 用户看不到真实错误 | **S** |
| 5 | Gemini API Key 明文入 IndexedDB + 桌面明文 JSON + 屏幕上显示 | `apiTools.ts:304` → `chatCompletionClient.ts:1053` → `apiErrorReportService.ts:53` → `ApiErrorReportsTab.tsx:27` | 堵住 key 泄漏路径（最多 80 条） | **S** |
| 6 | GitHub PAT 明文落盘（桌面为 `config/settings.json`） | `GitHubCloudSaveModal.tsx:106-109` → `dbService.ts:1321-1327` | 同上，另一个密钥 | **S** |
| 7 | **`onDelta` 在后端重试时被重放**，正文被拼接 | `chatCompletionClient.ts:1348-1353` + `deepSeekRecovery.ts:140` + `sendWorkflow.ts:2287,2298` `[复核]` | 修掉**玩家可见的正文污染** | **S** |
| 8 | **历史回合的书签按钮是死的**：`onToggleBookmark` 在 `ChatList → ChatHistoryList` 这一跳被丢掉 | `ChatList.tsx:283-295` `[复核]` | 1 行修复，恢复一个已有功能 | **S** |
| 9 | 7 个 SSE 解析器用 `releaseLock()` 而非 `cancel()` | `chatCompletionClient.ts:1517,1616,1879,1971,2043,2115,2341` | 中止后上游**仍在生成并计费** | **S** |
| 10 | `withRetries` 的 `signal` 可选，9 处中 6 处没传 | `retry.ts:7` + `imagePromptTokenizer.ts:132`、`characterAnchorExtract.ts:74`、`memoryCompression.ts:96`、`apiTools.ts:51,399` | 取消后仍发最多 3 次计费调用 | **S** |
| 11 | 体积门禁上限从 baseline 自身派生（恒真）+ baseline 引用不存在的 3.02MB chunk | `bundle-size-regression.mjs:32-36`、`.bundle-baseline.json` | 让体积回归真正生效 | **S** |
| 12 | 覆盖率 `include` 白名单只有 3 个文件（471 行 = 0.44%），掩盖 29 个已有测试文件 / 292 个 `it()` | `vitest.config.ts:11-15` | **单位字符收益最高的一处配置修改** | **S** |
| 13 | 29 个脚本永不被执行（含整条桌面发布链，4 个做真实产物校验） | `scripts/desktop-*.mjs` 等 | 恢复发布门禁 | **S** |
| 14 | `pnpm test` 在干净检出上以 ENOENT 失败（不保护 `dist`） | `bundle-size-regression.mjs:9`；`package.json:30` 的 `test` 无 build 步骤 | 恢复主要开发命令的可信度 | **S** |
| 15 | `sharp` 是幻影依赖，硬编码 `.pnpm/sharp@0.34.5/...`，且卡在 `test:release` 链上 | `teyvat-avatar-audit.mjs:3` 等 4 个脚本；`package.json` 无 `sharp` | 防止版本/hoisting 变化打断 CI | **S** |
| 16 | `test:desktop-edition` 被引用但**未定义**；`desktop-edition-regression.mjs:922` 只检查字符串存在，**把 bug 锁死了** | `desktop-preflight.mjs:4`、`desktop-readiness.mjs:52`、`package.json` | `desktop:preflight` 现在第 1 步就失败；`desktop:readiness` 永久 `missing=1` | **S** |
| 17 | 发布门禁证据可用环境变量伪造 | `desktop-release-gates.mjs:41-44` | 严格检查 `desktop-verify-release-gates.mjs:31` 只能手动跑 | **S** |
| 18 | 未声明 `engines.node >= 22.18`（12 个脚本依赖类型擦除，CI 靠浮动 major 侥幸通过） | `package.json`、`ci.yml:17` | 防环境漂移 | **S** |
| 19 | Esc 在约 12 个对话框中有 7 个无效，且焦点未困住（4 个逐字抄了 `Modal` 的遮罩 class 却省掉焦点管理） | `SettingsModal:224`、`SaveLoadModal:390`、`WorldbookManagerModal:213`、`GitHubCloudSaveModal:258`、`SystemDrawer:25`、`CourierModal:260`、`CodexManagerModal:115` | 统一走已存在且做得很好的 `ui/Modal.tsx` | **S** |
| 20 | 渲染期修改全局命令注册表 | `App.tsx:538-552` `[复核]` | 并发渲染下不安全；改用 `useEffect` | **S** |
| 21 | 恢复日志/暂存孤儿与失效事务的启动清理 | `dbService.ts:1631-1645`、`desktopSaveMirror.ts:246-252` | 防永久泄漏；`repairUnresolvedDesktopSaveTransactions` 现在只能手动点按钮 | **S** |
| 22 | `test-entry-coverage-regression.mjs` 自身是文本匹配，测不出 #13 | 该脚本 | 防止 #13 类问题复发 | **S** |
| 23 | `db.onclose` 缺失导致连接失效后**必须刷新页面**才能继续 | `dbService.ts:129-177`、`cloudBackupTransferStore.ts:157-184` | 消除整类故障 | **S** |
| 24 | `internal.cloudMerge.*` 无回收器 + gzip 炸弹（先解压后校验） | `cloudBackupPackage.ts:145-149`、`dbService.ts:1631-1645` | 防 OOM 与永久泄漏 | **S** |
| 25 | worker `onerror` 不 terminate → 弹窗永久卡死 | `cloudBackupWorkerClient.ts:31` | 消除死锁 | **S** |
| 26 | NovelAI 响应体二次读取 → `TypeError` 掩盖真实错误 | `imageGeneration.ts:721-728` | 恢复可诊断性 | **S** |
| 27 | `PlotPanel` 草稿 effect 依赖含 `updatedAt` → 后台持久化冲掉正在编辑的内容 | `PlotPanel.tsx:248-250` | 真实数据丢失（用户输入） | **S** |
| 28 | Rust 那一半在 CI 里**从未编译**（无 `cargo`/`tauri`） | `.github/workflows/ci.yml` | 改坏 `src-tauri/src/lib.rs` 会绿着通过 | **S–M** |
| 29 | 3 字节空文件 `Settings/WorldbookManagerModal.tsx` 死代码，但每次 `tsc -b` 都编译 | 该文件；`tsconfig.json:18` | 删掉即可 | **S** |
| 30 | `PromptModulesTab.tsx:1300-1574` 约 275 行死代码（V1 路线已废弃） | 该文件 | 删掉即可 | **S** |

### P1 — 本月（约 3–5 天）

| # | 问题 | 位置 | 收益 | 成本 |
|---|---|---|---|---|
| 20 | 流式每帧重启 `scrollIntoView({smooth})` | `ChatList.tsx:226-229` | 滚动抖动/掉帧 | **S** |
| 21 | `rewriteConfig` 内联三元穿透 `memo`，且与 `getActiveConfig` 逻辑不一致 | `App.tsx` → `ChatList` | 消息列表重渲染 + 行为不一致 | **S** |
| 22 | 伪流式动画不尊重 `prefers-reduced-motion`；O(chunks) 次事件注册 | `sendWorkflow.ts:785-807, 832-877` | 首字延迟 + 动效合规 | **S** |
| 23 | 抽出 `readSseStream`，删约 230 行重复；补齐 3 个缺失的 `onResponseDiagnostics` | `chatCompletionClient.ts` 7 处 | 本层最高性价比；一次补齐诊断 | **S** |
| 24 | Vite dev 代理缓冲整个流 → **流式 bug 本地无法复现** | `vite.config.ts:51,76,101,126` | 恢复可调试性 | **S** |
| 25 | 代理不转发 `request.signal` | 4 个 `*ProxyCore.ts` | 中止不再空转计费 | **S** |
| 26 | 删除 `dbService.ts:187` 多余的第三次全量 normalize | 该行 | 每回合省一次全状态遍历 | **S** |
| 27 | 恢复日志改独立文件 + 回合末 4 次 `saveSetting` 合并 | `desktopSettingsMirror.ts:29-31`、`sendWorkflow.ts:3364-3367` | 每回合少 6 次整份 settings RMW | **S** |
| 28 | 桌面资源镜像改为增量（`id`+`updatedAt`+`size` 短路） | `desktopAssetMirror.ts:58-102` | 桌面模式最大热路径收益：每回合 ~30MB → 0 | **M** |
| 29 | `saveDeltaStorage.ts:216-234` 的 replace 模式把整份历史塞进"delta" | 该处 | 节点体积可预测 | **S** |
| 30 | `clipPath`/渐变字面量跨 36 文件重复 150 份 | 全组件层 | 可维护性（Cmd+Click 可达） | **M** |
| 31 | ZIP 实现两份（存档包 vs 相册归档） | `albumArchive.ts` / `savePackage.ts` | 防止修复分叉 | **S** |
| 32 | 云端指针无 CAS → 设备 B 静默顶掉设备 A | `githubCloudSave.ts:281-291, 499-526` | 多设备数据安全 | **M** |
| 33 | 云备份取消在响应体阶段失效；`transferTimeoutMs` 是死代码 | `githubRequest.ts:92-95` → `githubCloudSave.ts:702-711` | 取消真正生效 | **S** |
| 34 | `lazyWithRetry` 的 `clearReloadMarker` 会在每次成功加载时清标记，叠加 `preloadAll` 可放大重载 | `lazyWithRetry.ts:54` + `App.tsx:49` `[复核]` | 防止重载级联 | **S** |
| 35 | UI 层零行为测试（89 组件 / 37,943 行） | `vitest.config.ts:7`、`tests/` | 渲染层回归保护 | **M** |
| 36 | 120/176 回归脚本仅做源码 grep（61.4% 断言） | `scripts/*-regression.mjs` | 测试有效性 | **M** |
| 37 | 迁移备份从不校验；Storage Manager 导入路径无备份无对话框 | `exportService.ts:61-70, 87-97`、`StorageManager.tsx:450-457` | 迁移可恢复性 | **M** |

### P2 — 下季度

| # | 问题 | 位置 | 收益 | 成本 |
|---|---|---|---|---|
| 38 | 无 ESLint（曾有过，配置丢失，残留 2 处 disable 注释） | 仓库根 | 引用稳定性/悬空 Promise/未使用代码 | **M** |
| 39 | `executeSendWorkflow` 1,838 行、11 阶段、4 段同构重试分支 | `sendWorkflow.ts:1652-3490` | 可测性（当前完全不可测） | **L** |
| 40 | `chunk-app` 1.1 MB 单块（137 模块 / 40,123 行）在首屏关键路径 | `vite.config.ts:147-152` | 回访增量下载/TTI | **M** |
| 41 | 抽出 `usageExtraction.ts`（564 行，占 client 的 22.5%） | `chatCompletionClient.ts:439-1002` | 纯函数，立刻可测 | **M** |
| 42 | 抽出 `upstreamProxy.ts`，4 个 `*ProxyCore.ts` 约 38% 结构性重复；统一 3 份互不一致的 OpenCode URL 归一化器 | `services/ai/` | 删约 200 行 | **M** |
| 43 | `App.tsx` 1,530 行 / `StorageManager` 2,552 行 & 57 `useState` | 两个组件 | 可维护性 | **L** |
| 44 | `providerOptions`/`savedFlash`/`handleSave` 在 9–13 个 settings tab 重复 | `components/features/Settings/` | 一次消灭 13 处重复 | **M** |
| 45 | `isRecord` 20 份、`ToggleRow` 9 份、`Field` 10 份等 91 个重名函数 | 全仓库 | 修复无法同步 | **S** |
| 46 | 拆分 `dbService.ts`（9 个职责，2,552 行） | 该文件 | 让 25 个 `console.warn` 可审计 | **L** |
| 47 | `tsconfig` 缺 `noUncheckedIndexedAccess` / `noImplicitOverride` | `tsconfig.json` | 空值安全 | **M** |
| 48 | 聊天历史与 `世界树`/`图鉴` 条目无上限（快照数量有界、体积无界） | `longSessionRetention.ts`、`models/teyvat/*` | 200 → 2000 回合 | **M** |
| 49 | `presence.ts` 启用前的鉴权/限流/写路径统一 | `functions/api/presence.ts` | 启用前提（当前 disabled） | **M** |
| 50 | 未声明 `engines.node >= 22.18`（12 个脚本依赖类型擦除） | `package.json` | 防环境漂移 | **S** |
| 51 | `docs/` 整体被忽略，导致 `test:all-prompt` 的 28 脚本依据文档不可恢复 | `.gitignore:44` | 可维护性 | **S** |
| 52 | `CONTRIBUTING.md` 不提测试/lint/构建流程 | 该文件 | 贡献者上手 | **S** |

---

## 13. 与项目自有路线图的关系

`PLAYER_EXPERIENCE_ROADMAP.md`（v1.5.0，2026-09-10）覆盖的是**产品体验**：结算回执、统一时间线、人物知识边界、手机端统一、可读性与无障碍、长会话性能、存档信心、图像生成体验。

本报告**不重复**这些。两者的关系是：

- 路线图 P2 第 11 条"长会话性能"提出"继续拆分主应用大包" —— 本报告第 9.4 节给出了它为什么没生效的**具体机制**（`chunk-app` 吞掉了全部 services/hooks/models，且懒加载面板依赖它），以及第 3 节说明为什么**体积门禁没有拦住它**。
- 路线图 P2 第 11 条"列表虚拟化" —— 本报告 9.1 指出在虚拟化之前，**流式滚动本身**就有每帧重复启动平滑动画的问题，这是更前置、更便宜的修复。
- 路线图 P1 第 9 条"无障碍"提到焦点环与减少动态效果 —— 本报告 10.3 指出令牌层（`adventurer-journal-tokens.css`）其实**已经**定义了 reduced-motion 降级，缺口在于**组件没有消费这些令牌**（改为内联 `clipPath` 与内联渐变），这与第 11 节的重复代码问题是同一个根因。

一句话：**路线图描述"要做什么体验"，本报告描述"为什么现有工程基础拦不住退化"。** 两者互补，建议把第 12 节的 P0 项作为路线图实施前的清理批次。
