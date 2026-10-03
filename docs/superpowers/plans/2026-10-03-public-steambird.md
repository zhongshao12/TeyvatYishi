# 公开事实 AI 蒸汽鸟报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 蒸汽鸟报确实调用独立模型，所有入口只投递经确认公开的事实，重试/恢复不重复报道、不跨档写入。

**Architecture:** 公开事实门禁与文章生成分开；一个异步任务服务供正常、开局、恢复、重试共用。模型只能收到冻结公开事实，不收到完整正文或根状态。

**Tech Stack:** TypeScript、React、既有 chatCompletionNonStream、设置/失败中心、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-03-public-steambird-design.md`（用户已确认）。

## Global Constraints

- 只使用已确认公开的事件；未知可见性、私聊、普通群聊、亲密档案、内心独白、未执行计划不入模型。
- 标题最多 40 字，导语最多 180 字，正文最多 600 字；超长结果校验失败，不句中粗暴截断伪装成功。
- 世界时间来自已提交时刻；createdAt/updatedAt 是传输时间；失败不以本地摘句伪装模型成功。
- 不涉及 B08、B09、不新增发送硬上限、不强制全部 NPC 知道报纸内容、不自动删除旧文章。
- 不增加模型依赖、不使用真实 API key 做自动测试、不推送 GitHub。

## Review Focus

- 开局压力/玩家介入与普通群聊是私有配置，不因“开局报纸”变公开（Task 1、3）。
- 公开地点的私谈、否定“没有公开”和转述计划，不能自动确认（Task 1）。
- API 配置部分覆盖和主配置继承，实际请求出口与设置一致（Task 2）。
- 重试时世界已前进或已经切档，冻结事实/时刻保留且旧结果不写新档（Task 3）。
- 模型关联合法事实 ID 不等于逐句真实性证明；标记 AI 生成与来源，不承诺绝无幻觉（Task 2、4）。

## 文件职责

- 新 `services/steambirdPublicFacts.ts`：确认与来源校验，和模型请求彻底分开。
- `services/ai/steambirdModel.ts`：独立配置解析、请求/结果校验。
- 新 `hooks/useGame/postTurnSteambirdTask.ts`：冻结输入、幂等调用、结果 delta。
- 现有正常/开局/恢复/重试模块：调用共用任务，负责所属 session 的提交。
- `models/teyvat/steambird.ts`：事实确认记录、文章来源、重试载荷的可靠存档。

### Task 1: 公开事实门禁与存档

**Files:** 新 `services/steambirdPublicFacts.ts`、`tests/unit/steambirdPublicFacts.test.ts`；修改 `models/teyvat/steambird.ts`、`models/teyvat/narrativeTurn.ts`、`models/teyvat/runtimeSlices.ts`、`services/ai/narrativeTurnParser.ts`、`prompts/narrative/mainPrompt.ts`、`prompts/narrative/openingPrompt.ts`；正文格式说明只给正文模型，不向全部子系统重复注入。

**Interfaces:**

- `ConfirmedSteambirdFact`: `id`, `settlementId`, `turn`, `title`, `detail`, `worldMoment`, `channel: 'public_announcement' | 'public_event' | 'player_confirmed'`, `evidence`, `confirmation: 'explicit_public_marker' | 'player'`。
- `confirmSteambirdFact(candidate, { history, moment, playerConfirmed }): ConfirmedSteambirdFact | null`。
- `selectUnreportedPublicFacts(news, { firstTurn, lastTurn }): ConfirmedSteambirdFact[]`。
- news 增加可选确认事实列表；旧 articles 继续完整保留，不冒充新格式已校验。
- 自动确认只支持正文独立叙述块开头的明确 `公开公告：` 或 `公开事件：` 标记，证据必须来自该块；没有标记一律等待玩家确认。对话块、否定/假设/计划不能借词命中。生成提示词说明仅实际面对公众成立的事实可用标记，不能把私有信息塞进标题绕过门禁。

- [ ] **Step 1:** 写失败测试：私下图书馆谈话、公共广场私谈、手机私聊/群聊、读者旁白、未公开计划返回 null；实际公开标记或玩家确认可以通过。
- [ ] **Step 2:** 测试不在正文中的证据、转述/否定公开、未知时刻、同名角色/跨档事实 ID、归一化往返；确认门禁只存已核对的事实正文，不使用候选随意夹带的私密标题/详情。运行新测试观察失败。
- [ ] **Step 3:** 实现保守确认、存档归一化与已报道去重。没有证据的旧记录仍留在旧文章中，但不会被选作新请求输入。
- [ ] **Step 4:** 单测转绿，并断言仅事实白名单对象可进入请求（对象不含 phone、matureArchive、fullState、userInput 或完整 body）。
- [ ] **Step 5:** 审阅可见性边界，独立本地提交。

### Task 2: 真正的独立模型与严格结果校验

**Files:** 修改 `services/ai/steambirdModel.ts`、`services/ai/chatCompletionClient.ts`、`prompts/subsystems/steambirdPrompt.ts`、`hooks/useGame/steambirdWorkflow.ts`、`models/teyvat/steambird.ts`；新 `tests/unit/steambirdModelGeneration.test.ts`。

**Interfaces:**

- `resolveSteambirdApiConfig(override: 蒸汽鸟报API覆盖, main: API配置项 | null): API配置项 | null`，留空字段继承主 API，非空覆盖生效，明确数值 0 不能被真假判断丢掉；采样值沿用既有安全规范化。
- `generateSteambirdArticles(config, { publicFacts, promptModules, signal, maxEntries, onPhase? }): Promise<ValidatedSteambirdDraft[]>`。
- `ChatCompletionRequest.onRequestPhase?: (phase: 'connecting' | 'receiving') => void`：统一出口在请求开始、收到响应头时回调；报纸校验开始时回调 `onPhase('validating')`。诊断回调异常不能改变请求或其他模块行为。
- `ValidatedSteambirdDraft`: `title`, `lead`, `body`, `sourceFactIds`；模型返回 `publicArticles`。拒绝私有字段、未知来源 ID、空引用、非法对象、超长文本；本地赋予稳定 ID/状态/时刻，模型不能直接改完整报紙状态。

- [ ] **Step 1:** 使用本地假 fetch 验证调用次数为 1、URL/model 实际来自独立覆盖，消息只含确认事实和 steambird 适用提示词。无有效配置时错误可见，不回退本地成功。
- [ ] **Step 2:** 加入部分配置继承、非法来源、privateFacts/fullState、40/180/600 字边界与超一字、空结果、API 400、正文停滞、取消测试。运行并观察现实现失败。
- [ ] **Step 3:** 用统一非流式客户端完成请求；结果经严格校验后返回 draft，不在 AI 服务里直接改根状态。通过提示词约束只概括来源，界面仍标模型生成及来源关联的局限。
- [ ] **Step 4:** 模型测试与 `chatCompletionRequestLifecycle` 测试通过，取消不遗留监听器；不使用真实供应商端点。
- [ ] **Step 5:** 独立本地提交。

### Task 3: 共用任务、恢复与精准重试

**Files:** 新 `hooks/useGame/postTurnSteambirdTask.ts`、`tests/unit/steambirdTaskIntegration.test.ts`；修改 `hooks/useGame/postTurnBackgroundTasks.ts`、`hooks/useGame/openingSteambirdStage.ts`、`hooks/useGame/variableCalibrationStage.ts`、`hooks/useGame/postSettlementRecoveryWorkflow.ts`、`hooks/useGame/sendWorkflow.ts`；更新现有开局/重试时刻测试。

**Interfaces:**

- `SteambirdTaskInput`: `sessionId`, `settlementId`, `turn`, `worldMoment`, `facts`, `config`, `promptModules`, `maxEntries`, `signal`；重试载荷使用已冻结 facts/moment，不重新扫描完整历史。
- `runPostTurnSteambirdTask(input): Promise<{ status: 'success' | 'skipped' | 'failed'; articles: SteambirdArticle[]; reason?: string }>`。
- 幂等键按 settlement ID＋来源事实 ID 集合生成；文章按 ID delta 合并，活体已编辑文章保留。不存在新事实/未到间隔时零 API 调用。
- 失败中心保存稳定任务归属与可重试载荷；成功清理同一任务失败状态。旧版本没有确认载荷的失败项不从全文自动重建，提示确认公开事实后重试。

- [ ] **Step 1:** 同一冻结输入分别从正常、开局、恢复、重试调用，断言事实/时刻/模型出口一致；开局玩家介入配置不能直接变新闻。
- [ ] **Step 2:** 添加跨档迟到结果、等待期间编辑文章、同档新增文章、世界前进后重试、重复恢复与保存失败测试；应保留旧文/编辑，不重复文章，不投递私密全文。运行反例。
- [ ] **Step 3:** 替换所有本地摘句入口，共用异步任务与 session/delta 守卫。失败进统一中心；未确认事实不进入生成。
- [ ] **Step 4:** 保留旧回归意图，改为行为测试真正异步调用。全量单测、类型检查、完整回归与构建通过；不提高顶层体量门禁。
- [ ] **Step 5:** 独立本地提交，列出所有迁移入口。

### Task 4: 公开确认 UI 与可取消连接测试

**Files:** 修改 `components/features/GameSystems/SteambirdPanel.tsx`、`components/features/Settings/SteambirdSystemSettingsTab.tsx`；新 `tests/unit/steambirdPublicFactsUi.test.tsx`、`tests/unit/steambirdConnectionCancellation.test.tsx`。

**Interfaces:** 报纸页通过当前 session 的根更新动作提交事实确认；取消测试使用本次专属 AbortController，不中止主回合；复用统一模型函数与脱敏错误报告。

- [ ] **Step 1:** UI 测试断言未知可见性显示未确认，玩家确认后才加入；旧文章显示来源未校验，新文章可查看来源事实与世界时间。
- [ ] **Step 2:** 连接测试阶段显示连接/接收/校验和耗时；点击取消后显示已取消、无悬挂请求，关闭设置/切换配置也终止旧测试，迟到结果不能覆盖新测试。
- [ ] **Step 3:** 修改旧“读取全文/世界状态/旧报道”说明为实际行为；显示跳过/成功/可重试失败；标明 AI 生成与真实性校验局限。
- [ ] **Step 4:** UI 测试转绿，再以 390×844、768×1024、1024×768 视口检查确认表、来源说明和取消按钮可读可操作。真实键盘/设备仍另记未验证，不以 jsdom 代替真实验收。
- [ ] **Step 5:** 更新使用说明，独立本地提交。

## 执行交接

建议在当前任务按 Task 1→4 执行，先守住公开事实边界再接模型。书面计划待用户确认；没有公开事实时跳过属于预期行为，不以本地模板填充。不自动合并 main 或推送 GitHub。
