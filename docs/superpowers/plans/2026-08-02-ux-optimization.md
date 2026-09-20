# 开拓轶事 体验优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 逐任务实施。步骤使用 checkbox（- [x]）跟踪。每个工作流是独立可交付单元，建议按 W1 → W4 → W5 → ... 顺序执行；同一阶段内无依赖的工作流可并行。

**Goal:** 按《体验优化建议文档》落地全部功能：P0 四项（剧情任务系统、回合回放与书签、全局快捷键、Token 用量统计）、P1 十四项、P2 六项，全部接入现有模型/服务/存档/回归体系。

**Architecture:** 复用既有分层：models（中文领域模型 + 归一化）→ services（纯逻辑）→ hooks/useGame（回合工作流）→ components（面板/弹窗）→ data + prompts/cot（预设与提示词）→ scripts（静态回归）+ tests/unit（Vitest）。新功能统一接入存档打包/差量存储/运行时压缩三处，统一走 lazyWithRetry 懒加载与 queueTasks 展示，统一配回归脚本。

**Tech Stack:** 既有栈（React 19 / TS / Vite / Tailwind / IndexedDB）+ Vitest 3 + 静态回归体系；桌面通知用 Web Notification（Tauri 端预留 capability）。

---

## 0. 执行原则

- 每项先写回归/单测，运行确认失败，再实现，再运行确认通过。
- 每项独立提交；无 git 仓库时以检查点汇总替代 commit。
- 验收命令统一：pnpm build、pnpm test:unit、对应回归脚本。
- 新面板必须 lazyWithRetry 懒加载并加入 preloadAll；新系统接入 gameMenu。
- 存档相关字段必须同步 models/settings.ts 存档数据、services/savePackage.ts、utils/saveDeltaStorage.ts、utils/saveRuntimeCompactor.ts 四处。
- 隐私/安全类（密钥、CSP、OAuth、云存档加密）不涉及。

## 1. 总体路线与依赖

```text
阶段一 P0（先交付高价值）
  W1 剧情任务系统（独立，最大）
  W2 回合回放与书签（独立）
  W3 全局快捷键（独立）
  W4 Token 用量统计（独立）
阶段二 P1（按依赖分组，可并行）
  W5 上下文可视化 → 依赖 W4 的 token 估算工具
  W6 通知（独立）
  W7 命令面板 → 依赖 W3 的按键注册表
  W8 导入导出（独立）
  W9 存档树可视化（独立）
  W10 关系网图（独立）
  W11 时间线视图（独立）
  W12 群聊增强（独立）
  W13 消息虚拟化 + 图片懒加载（独立）
  W14 角色一致性辅助（独立）
  W15 开局模板库（独立）
  W16 续玩提示（独立）
  W17 模型快捷切换（独立）
  W18 正文润色（独立）
阶段三 P2（概要，另行展开）
  W19 生图批量与一致性 / W20 地图与势力图 / W21 读档预览与周报 / W22 离线 PWA / W23 首启引导
```

---

## 2. 阶段一：P0

### W1 剧情任务系统（对应 A1）

**目标：** 结构化任务清单：进行中/已完成/已放弃；目标进度自动结算；完成发奖励；与剧情编织弱关联；完整接入存档。

**Files:**
- Create: models/quest.ts、services/questService.ts、hooks/useGame/questWorkflow.ts、data/questPresets.ts、data/questWorldbook.ts、prompts/cot/questCot.ts、prompts/cot/questOutputFormat.ts、components/features/GameSystems/QuestPanel.tsx
- Modify: models/settings.ts（存档数据 任务? + 游戏设置 任务系统）、models/queueTask.ts（+quest）、models/chat.ts（questUpdates?）、services/ai/responseParser.ts、hooks/useGame/sendWorkflow.ts、hooks/useGame/systemPromptBuilder.ts、data/gameMenu.ts、App.tsx、components/features/GameSystems/SystemPanels.tsx、services/savePackage.ts、utils/saveDeltaStorage.ts、utils/saveRuntimeCompactor.ts
- Test: scripts/quest-state-machine-regression.mjs、scripts/quest-prompt-parsing-regression.mjs、scripts/quest-save-regression.mjs、tests/unit/questService.test.ts

- [x] **任务 1：任务模型（models/quest.ts）**
  定义 任务状态（未开始/进行中/已完成/已失败/已放弃）、任务目标类型（达成/收集/交谈/前往/击杀/时间）、任务来源（主线/支线/自定义/来信）、任务奖励类型（物品/好感/记忆/新闻/命途）；
  提供 创建空任务系统、归一化任务系统（状态枚举校验、数量取整、全部目标完成强制已完成）。

- [x] **任务 2：任务服务（services/questService.ts）**
  实现 解析任务更新命令（<任务更新> 内的 接取/目标/进展/完成/放弃 行）；
  实现 结算任务进展（交谈=正文/NPC 事实命中、前往=世界.当前地点匹配、收集=背包数量、击杀/达成=关键词或变量路径）；
  实现 完成任务并生成奖励命令（物品 append 背包、好感 add NPC.好感度、记忆 append 记忆.即时）；
  单测 tests/unit/questService.test.ts 覆盖解析、结算、完成奖励三条路径。

- [x] **任务 3：预设与提示词（data/questPresets.ts、data/questWorldbook.ts、prompts/cot/questCot.ts、prompts/cot/questOutputFormat.ts）**
  开局主线任务「登上星穹列车」（交谈列车组成员、前往星穹列车）；
  世界书模块导出 QUEST_WORLD_BOOK_PROMPT（列出进行中任务，禁止替玩家完成）；
  CoT 与输出格式定义 <任务更新> 协议，规则：不重复已有任务/目标、每回合最多新增 1 任务 2 目标、进展只能增加。

- [x] **任务 4：回合工作流接入（models/chat.ts、responseParser.ts、systemPromptBuilder.ts、sendWorkflow.ts、queueTask.ts）**
  解析后回复 增加 questUpdates?: string[]；responseParser 抽取 <任务更新> 块；
  systemPromptBuilder 在 任务系统.enabled 时注入任务模块与进行中清单；
  sendWorkflow 在变量结算后调用 questWorkflow 的回合结算步骤：解析 → 接取/进展/完成/放弃 → 结算目标 → 奖励命令经 reduceVariableCommands 执行 → pushQueueTask(state, quest, success/failed)；
  失败保留恢复日志可重试。
  **联动决策（已确认）**：任务关联的分段被标记为「已偏离」时，任务保持进行中，玩家可在任务面板手动放弃。

- [x] **任务 5：任务面板与菜单（data/gameMenu.ts、QuestPanel.tsx、SystemPanels.tsx、App.tsx）**
  gameMenu 增加 quest 入口（放在 inventory 之后，glyph ⚑）；
  QuestPanel 三栏（进行中/已完成/已放弃），任务卡显示目标清单+进度条+奖励预览+放弃按钮；
  SystemPanels 与 App.tsx 注册，App 用 lazyWithRetry 懒加载并加入 preloadAll。

- [x] **任务 6：存档接入（models/settings.ts、savePackage.ts、saveDeltaStorage.ts、saveRuntimeCompactor.ts）**
  存档数据 增加 任务?: import(./quest).任务系统；savePackage 增 systems/quests.json；
  saveDeltaStorage fields/counters 增加 任务/quests；saveRuntimeCompactor 压缩（已完成/已放弃各保留 50 条）；
  回归 quest-save-regression.mjs 断言四处一致。

- [x] **任务 7：回归脚本**
  quest-state-machine-regression.mjs：断言模型状态流转、questService 结算/奖励、QuestPanel 三栏、gameMenu 入口、sendWorkflow 消费 questUpdates；
  quest-prompt-parsing-regression.mjs：断言 questCot/questOutputFormat/questWorldbook 协议与 systemPromptBuilder 注入。

**验收：** 新开局出现「登上星穹列车」；交谈/抵达后目标自动完成并发放奖励；AI 可创建支线任务；放弃/完成状态读档后保持；pnpm build、pnpm test:unit、三个新回归全绿。

---

### W2 回合回放与剧情书签（对应 A2）

**目标：** 玩家可标记关键回合书签，可跳转回看；提供按筛选的剧情回放视图。

**Files:**
- Modify: models/chat.ts（聊天消息 增加 bookmark?: { title: string; note?: string; createdAt: number }）、components/features/Chat/ChatList.tsx（消息操作菜单）、components/features/Chat/ChatBookmarksPanel.tsx（新）、components/features/Chat/StoryReplayModal.tsx（新）、hooks/useGame/historyWindow.ts（筛选辅助）
- Test: scripts/story-bookmark-regression.mjs、scripts/story-replay-view-regression.mjs

- [x] **任务 1：模型与状态**：聊天消息增加可选 bookmark 字段；创建/删除书签走 state.setChatHistory 不可变更新；存档兼容（旧消息无字段）。
- [x] **任务 2：书签侧栏**：ChatBookmarksPanel 列出书签（标题/回合/备注），点击跳转对应消息（滚动定位）；空态提示。
- [x] **任务 3：回放视图**：StoryReplayModal 全屏阅读，按 回合范围/地点/角色 筛选（复用 historyWindow 窗口逻辑），正文只读渲染；
  默认按书签/最近 20 回合展示。
- [x] **任务 4：回归**：断言 bookmark 字段存在、面板注册、筛选函数存在、存档打包兼容 bookmark。

**验收：** 任意消息可加书签并跳转；回放视图筛选正确；回归通过。

---

### W3 全局快捷键（对应 F1）

**目标：** 常用操作键盘化，快捷键可自定义。

**Files:**
- Create: hooks/useGame/useKeyboardShortcuts.ts、data/keyboardShortcutDefaults.ts、components/features/Settings/KeyboardShortcutsTab.tsx
- Modify: App.tsx（挂载）、components/features/Settings/SettingsModal.tsx（注册页签）、models/settings.ts（游戏设置 增加 keyboardShortcuts? 映射）
- Test: scripts/keyboard-shortcuts-regression.mjs

- [x] **任务 1：默认映射**：Ctrl+R 重 roll、Ctrl+S 手动存档、Ctrl+O 系统抽屉、Ctrl+M 手机、Ctrl+K 命令面板（W7 未完成前先占位）、Esc 关顶层弹窗；不覆盖输入框/文本域（排除 target 为 input/textarea/contentEditable）。
- [x] **任务 2：hook**：useKeyboardShortcuts(handlers) 在 App 挂载；handlers 从 actions 映射；设置持久化到 gameSettings.keyboardShortcuts。
- [x] **任务 3：设置页**：KeyboardShortcutsTab 列出动作-按键组合，可改键与恢复默认。
- [x] **任务 4：回归**：断言默认表、输入框排除、设置字段与页面注册。

**验收：** 游戏中快捷键生效且不干扰打字；设置页可改键。

---

### W4 Token 用量统计（对应 I1）

**目标：** 每回合记录并展示输入/输出 token，按系统拆分统计，输入框附近显示本回合消耗。

**Files:**
- Modify: models/chat.ts（回合Token消耗 扩展 usage 明细字段）、hooks/useGame/sendWorkflow.ts（汇总各阶段 usage）、services/ai/chatCompletionClient.ts（统一返回 usage）、components/features/Chat/TokenMeter.tsx（新）、models/settings.ts（Token 统计设置：启用/预算）
- Create: utils/tokenUsageStats.ts（会话累计与按系统拆分）、components/features/Settings/TokenStatsPanel.tsx（新）
- Test: scripts/token-usage-regression.mjs、tests/unit/tokenUsageStats.test.ts

- [x] **任务 1：usage 归一化**：chatCompletionClient 流式/非流式统一提取 promptTokens/completionTokens（含 usage 字段缺失兜底估算 estimateTextTokens）。
- [x] **任务 2：统计工具**：tokenUsageStats 提供 累计(会话)、按系统拆分（main_story/variable/news/phone/quest）、回合记录追加；单测覆盖累加与估算兜底。
- [x] **任务 3：UI**：TokenMeter 在输入区显示本回合消耗与累计；TokenStatsPanel 在设置页展示按系统表格与预算提醒（超预算黄色提示，不阻断）。
- [x] **任务 4：回归**：断言 usage 字段、统计函数、TokenMeter 注册与预算提醒。

**验收：** 回合结束输入区显示 token；设置页按系统展示统计；超预算提醒。

---

## 3. 阶段二：P1

### W5 提示词上下文可视化（对应 B3）

**Files:** Modify hooks/useGame/systemPromptBuilder.ts（返回构成明细）、components/features/Settings/ContextViewer.tsx；Test: scripts/context-composition-regression.mjs。

- [x] **任务 1**：buildSystemPrompt 返回 { prompt, sections: { worldbook, memory, zhiku, news, npc, quest, main }, chars, tokens }；sections 由各注入块长度统计。
- [x] **任务 2**：ContextViewer 展示构成条形图与截断位置（使用估算 token，复用 W4 工具）。
- [x] **任务 3**：回归断言 sections 结构与字符统计存在。

**验收：** 每次发送前可查看上下文构成占比；ContextViewer 显示完整明细。

---

### W6 桌面与浏览器通知（对应 C2）

**Files:** Create utils/notifications.ts、components/features/Settings/NotificationSettingsTab.tsx；Modify models/settings.ts（游戏设置 增加 通知设置）、hooks/useGame/sendWorkflow.ts（回合收尾触发）、components/features/Settings/SettingsModal.tsx；Test: scripts/notifications-regression.mjs。

- [x] **任务 1**：notifications 封装 Web Notification（权限请求、静默时段、事件类型开关）。**平台决策（已确认）**：桌面端只做 Web Notification，不接入 Tauri notification 插件；isDesktop 分支返回 noop 并注释 capability 需求，留接口后续扩展。
- [x] **任务 2**：回合收尾在 手机来信/新闻更新/生图完成/任务更新 时按设置触发通知（去重：同类型 60 秒冷却）。
- [x] **任务 3**：设置页：事件开关、静默时段、总开关。
- [x] **任务 4**：回归断言封装、冷却与设置字段。

**验收：** 浏览器通知按事件弹出；设置可关闭；冷却生效。

---

### W7 命令面板（对应 F2）

**Files:** Create utils/commandRegistry.ts、components/features/Chat/CommandPalette.tsx；Modify App.tsx、components/features/Chat/InputArea.tsx（/ 触发）、utils/lazyWithRetry.ts 不涉及；Test: scripts/command-palette-regression.mjs。

- [x] **任务 1**：commandRegistry 注册命令（跳系统、开设置、存档、reroll、搜智库、搜伙伴），返回 { id, label, keywords, run }。**搜索决策（已确认）**：智库搜索只匹配条目标题与别名，不做全文搜索。
- [x] **任务 2**：输入框首字符 / 时打开 CommandPalette，过滤匹配，Enter 执行，Esc 关闭；W3 的 Ctrl+K 绑定同一入口。
- [x] **任务 3**：回归断言注册表与触发。

**验收：** 输入 / 弹出面板，可跳转与执行操作。

---

### W8 导入导出增强（对应 F3）

**Files:** Create services/exportService.ts；Modify services/savePackage.ts（复用打包器）、components/features/SaveLoad/SaveLoadModal.tsx（导出菜单）、components/features/Worldbook/WorldbookManagerModal.tsx（世界书导出）、components/features/NewGame/NewGameWizard.tsx（Markdown/Word 导入入口）；Test: scripts/export-service-regression.mjs。

- [x] **任务 1**：exportService 导出剧情 Markdown（回合列表：用户/AI 正文、时间戳、书签标记）与 JSON（完整聊天结构）。
- [x] **任务 2**：单系统导出：角色档案包、世界书包、相册包（复用 savePackage 的 zip 工具与路径表）。
- [x] **任务 3**：导入：Markdown 解析为剧情文本导入（复用 TXT 切分逻辑），Word 先按 docx 文本抽取（仅读段落文本）。
- [x] **任务 4**：回归断言导出结构、zip 路径与 Markdown 解析。

**验收：** 可导出剧情/角色/世界书/相册包；Markdown 可回导。

---

### W9 存档树可视化（对应 E1）

**Files:** Modify utils/saveTreeView.ts（渲染数据模型）、components/features/SaveLoad/SaveLoadModal.tsx（分支时间线视图）、hooks/useGame/saveLoadWorkflow.ts（分叉/对比辅助）；Test: scripts/save-tree-visualization-regression.mjs。

- [x] **任务 1**：saveTreeView 输出节点图（parent/children、手动/自动、当前高亮、分支点）。
- [x] **任务 2**：UI 时间线视图替换/新增于存档列表：点击节点加载；「从此分叉」新建分支节点（复用既有分支语义）。
- [x] **任务 3**：双节点对比：关键字段（回合/地点/背包数量/好感/任务）差异列表。
- [x] **任务 4**：回归断言视图模型与对比函数。

**验收：** 分支时间线可视化，可分叉、可对比两节点。

---

### W10 好感度与关系可视化（对应 A5）

**Files:** Modify components/features/GameSystems/CompanionPanel.tsx（关系图子页）、utils/variableFacts.ts（好感事件提取）；Create utils/relationshipGraph.ts；Test: scripts/relationship-graph-regression.mjs。

- [x] **任务 1**：relationshipGraph 从 NPC 列表生成节点/边（好感阈值着色、同行/敌对/暧昧标记）。
- [x] **任务 2**：好感变化历史：从 variableBatches 提取 NPC 好感 add/set 命令，按回合排序。
- [x] **任务 3**：CompanionPanel 新增关系图页（SVG 布局，点击节点跳档案）。
- [x] **任务 4**：回归断言图结构与事件提取。

**验收：** 关系网图可看，好感变化可追溯。

---

### W11 时间线视图（对应 B1）

**Files:** Create components/features/GameSystems/TimelinePanel.tsx、utils/timelineBuilder.ts；Modify data/gameMenu.ts（+timeline）、App.tsx、SystemPanels.tsx；Test: scripts/timeline-view-regression.mjs。

- [x] **任务 1**：timelineBuilder 合并 回合时间（world.当前日期）、新闻条目、剧情编织.时间线事件、记忆.长期，按时间排序。
- [x] **任务 2**：TimelinePanel 横向时间轴，按 地点/势力/类型 过滤，点击跳正文或新闻。
- [x] **任务 3**：gameMenu 注册 timeline 面板并懒加载。
- [x] **任务 4**：回归断言合并器与面板注册。

**验收：** 事件按时间轴展示，可过滤与跳转。

---

### W12 群聊体验增强（对应 C1）

**Files:** Modify models/phone.ts（会话 增加 announcement?/members 权限字段可选）、components/features/Phone/PhoneModal.tsx、services/ai/phoneService.ts（群公告上下文）；Test: scripts/phone-group-enhancements-regression.mjs。

- [x] **任务 1**：群公告（会话字段 + 头部展示 + 编辑入口，仅成员可改）。
- [x] **任务 2**：群名修改、退出/解散（解散仅创建者；退出从 participantIds 移除）。
- [x] **任务 3**：@ 成员（消息内容解析 @名称 高亮）、快捷 emoji 回复、图片消息（复用相册条目引用）。
- [x] **任务 4**：群聊时间线视图（按回合归档，复用 localArchive）。
- [x] **任务 5**：回归断言字段、操作函数与 UI 入口。

**验收：** 群公告/改名/退出/解散/@/表情/图片可用。

---

### W13 消息虚拟化与图片懒加载（对应 H1/H2）

**Files:** Modify components/features/Chat/ChatList.tsx（虚拟窗口）、components/features/GameSystems/AlbumPanel.tsx（IntersectionObserver 懒加载）、utils/albumObjectUrl.ts（Blob 缓存字节上限）、components/features/GameSystems/album/taskWorkspace.tsx（SafeAlbumImage 懒加载）；Test: scripts/message-windowing-regression.mjs、scripts/album-lazy-load-regression.mjs。

- [x] **任务 1**：ChatList 在消息超过 200 条时启用窗口渲染（可视区上下各 30 条缓冲，滚动重建），保持自动滚动到底行为；窗口边界用 historyWindow 常量对齐。
- [x] **任务 2**：SafeAlbumImage 增加 loading=lazy 与 IntersectionObserver 占位（data URL 占位）。
- [x] **任务 3**：albumObjectUrl 运行时缓存设上限（默认 64MB），超限按 LRU 释放 ObjectURL。
- [x] **任务 4**：回归断言窗口常量、懒加载标记与缓存上限。

**验收：** 500 回合会话滚动流畅；相册图片滚动加载；缓存不超上限。

---

### W14 角色一致性辅助（对应 A4）

**Files:** Modify models/npc.ts（NPC 增加 玩家纠正记录?: string[]）、hooks/useGame/systemPromptBuilder.ts（注入纠正记录）、components/features/GameSystems/CompanionPanel.tsx（性格速览卡 + OOC 标记按钮）、utils/npcArchiveEnrichment.ts（追加记录归一化）；Test: scripts/npc-consistency-assist-regression.mjs。

- [x] **任务 1**：模型与归一化：玩家纠正记录 数组字段，旧档兜底。
- [x] **任务 2**：OOC 标记：消息操作菜单「标记跑偏」→ 把该条回复摘要追加到目标 NPC 纠正记录，写回并存档。
- [x] **任务 3**：注入：systemPromptBuilder 在 NPC 档案段落后附 玩家纠正记录（最多 3 条）。
- [x] **任务 4**：性格速览卡：档案头部展示 说话方式/性格/关系/最近 3 条相关记忆（复用同行记忆）。
- [x] **任务 5**：回归断言字段、注入与 UI 入口。

**验收：** 可标记 OOC，下一回合提示词带上纠正，档案可查看速览。

---

### W15 开局模板库（对应 F4）

**Files:** Modify data/characterPresets.ts、data/journeyPresets.ts（模板结构）、components/features/NewGame/NewGameWizard.tsx（模板页）、models/settings.ts（游戏设置 增加 开局模板? 存档）；Test: scripts/opening-template-library-regression.mjs。

- [x] **任务 1**：模板结构：{ id, name, 旅人, 难度/命途/阵营/起始场景/开局文本, tags }。
- [x] **任务 2**：向导新增模板选择页：官方模板 + 玩家保存模板；一键套用后仍可手动修改。
- [x] **任务 3**：保存当前开局为模板（命名 + 标签），持久化到游戏设置。
- [x] **任务 4**：回归断言模板结构、套用与保存。

**验收：** 可保存/套用自定义开局模板。

---

### W16 续玩提示（对应 G1）

**Files:** Modify App.tsx（首页）、hooks/useGameState.ts（轻量预览辅助）、components/layout/DesktopHomeScreen.tsx 与 LandingPage.tsx（续玩卡）；Test: scripts/resume-prompt-regression.mjs。

- [x] **任务 1**：useGameState 提供 buildResumePreview(save)：回合数、当前地点、当前剧情分段、最近 3 回合摘要（复用 buildImmediateStoryReview 或消息摘要）。
- [x] **任务 2**：首页展示续玩卡（最近存档），点击继续直接读档；无存档时不显示。
- [x] **任务 3**：回归断言预览函数与首页入口。

**验收：** 启动首页显示上次进度摘要，一键继续。

---

### W17 模型快捷切换（对应 I2）

**Files:** Modify components/layout/TopBar.tsx（模型徽标）、services/ai/connectionTestPolicy.ts（复用测试）、components/features/Settings/ApiSettings.tsx（配置档案选择）；Test: scripts/model-quick-switch-regression.mjs。

- [x] **任务 1**：TopBar 显示当前主模型名（apiSettings.activeConfigId 对应档案），点击弹出档案列表。
- [x] **任务 2**：切换前调用测试接口（connectionTestPolicy），失败提示并保持原档案；成功则 setApiSettings 并提示。
- [x] **任务 3**：回归断言徽标、切换逻辑与测试调用。

**验收：** 顶栏一键切换主模型，失败不切换。

---

### W18 正文润色与重述（对应 I3）

**Files:** Create services/ai/rewriteService.ts、prompts/cot/rewriteCot.ts；Modify components/features/Chat/ChatList.tsx（消息操作菜单）、models/chat.ts（不新增字段，仅展示用）；Test: scripts/rewrite-service-regression.mjs。

- [x] **任务 1**：rewriteService.rewriteBody(config, body, mode) 支持 润色/扩写/缩写/换一种说法；非流式调用，返回新正文。
- [x] **任务 2**：提示词模块 rewriteCot 定义四种模式边界（不改变事实、不新增设定）。
- [x] **任务 3**：消息菜单「改写正文」→ 模式选择 → 结果以预览弹窗展示，确认后仅更新该消息 content/parsedResponse.body（不重跑回合副作用）。
- [x] **任务 4**：回归断言服务、提示词与菜单。

**验收：** 任意已生成正文可原地改写，不影响游戏状态。

---

## 4. 阶段三：P2 概要

| 工作流 | 对应 | 目标 | 前置 | 实施要点 |
| --- | --- | --- | --- | --- |
| W19 | D1/D2 | 批量生成与角色一致性 | W13 懒加载 | 队列加 batchId 分组；角色面部参考图集合与生成选择 |
| W20 | B2 | 地点/势力可视化 | W11 时间线 | 智库层级数据驱动树图与势力连线 |
| W21 | E2/G3 | 读档预览与游玩周报 | W1 任务、W2 摘要 | 读档前轻量预览；周报聚合新闻/记忆/变量批次 |
| W22 | H3 | 离线 PWA | 构建稳定 | public/sw.js 缓存应用壳，桌面版不启用 |
| W23 | G2 | 首启引导 | W3/W15 | tutorialSteps 数据 + 引导遮罩 |

P2 工作流实施前需单独展开为详细任务（沿用本文档结构），此处只锁定目标与依赖。

---

## 5. 风险与已确认决策

- **W1 与剧情编织联动**：任务挂在分段上时，分段被跳过/偏离的处理规则需要产品决策；默认：分段已偏离时任务保持进行中，玩家可手动放弃。
- **W4 token 估算**：流式响应可能缺 usage，用 estimateTextTokens 兜底，精度不足属预期。
- **W13 虚拟化**：消息窗口与 reroll/快照回滚交互复杂；默认仅在消息数超过 200 时启用，并保留完整 DOM 模式开关。
- **W12 图片消息**：相册引用地址需在手机上下文可用；默认只支持已有相册条目，不做手机内上传。
- **已确认决策 1**：快捷键默认值按优化文档建议，设置页可改；如与用户习惯冲突以设置为准。
- **已确认决策 2**：命令面板的智库搜索只匹配标题与别名，不做全文搜索。
- **已确认决策 3**：W6 通知在 Tauri 桌面端仅使用 Web Notification，不接入 Tauri notification 插件，桌面端留接口。

---

## 6. 最终验收清单

- [x] W1-W4（P0）全部交付：任务系统、书签回放、快捷键、Token 统计可用。
- [x] W5-W18（P1）全部交付并各配回归脚本。
- [x] pnpm build 通过；pnpm test:unit 覆盖率 ≥ 70%；全量回归在 Node 22.18+ 全绿。
- [x] 所有新增存档字段完成 savePackage/saveDeltaStorage/saveRuntimeCompactor 三处接入。
- [x] 新面板全部 lazyWithRetry + preloadAll；新菜单项已注册。
- [x] CHANGELOG 按 v1.4 记录各工作流交付。
- [x] 体验优化建议文档中各条目标注完成状态。

---

*计划基于 2026-08-02 的《体验优化建议文档》整理，执行时以该文档与代码现状为准。*
