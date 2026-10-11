# 手机审查问题修复证据（P01–P06，2026-10-09）

## 范围、决定与行为契约

用户授权修复 `PROJECT_AUDIT_2026-10-09.md` 全部问题；本切片仅负责 P01–P06。
使用 code-quality-workflow、systematic-debugging、test-driven-development（含 writing-good-tests / testing-anti-patterns）和 verification-before-completion。

决定：手机模块为 Local Fix；按身份、会话、用户删除意图、知识边界分阶段 Local Fix Only。没有模块重写。
允许文件：courierService、courierBackgroundJobs、courier model、联系人删除按钮及对应测试；禁止改 state.ts、存储、主回合编排、依赖、B08/B09。
每项只修改已有行为路径（各项生产增量约 10–60 行）；持久化仅增加旧档可缺省的删除意图数组。

契约：NPC ID 是记忆/好感的身份；contact ID 是通讯身份；conversation ID 是聊天空间身份。姓名只作展示或唯一的遗留别名，不覆盖已有明确 NPC ID。当前手机状态拥有玩家操作；后台结果不得复活联系人/群。显式手动添加可恢复联系人。保留旧会话消息、未知额外数据的原有处理、正常新后台会话与未改动会话的引用。旧档缺省删除意图为空；实际 JSON 往返保留新增意图。
P06 的变更仅阻止本地来信把全局 environment 的 location/weather 当成发件人已知事实；已给定的种子事实仍用于来信，AI 提示词/供应商知识约束不是本切片重写范围。

删除安全：仅在玩家原有删除/解散入口记录可恢复意图，不删除 NPC 档案或历史私聊；不操作真实存档。回滚只撤本切片增量，保留原 dirty changes；验证发现跨模块失败或需要重写时停止并交主协调者。

## RED → GREEN

所有测试使用合成状态。只有外部模型传输 `chatCompletion` 替换为固定合成文本，真实投递、回信、归一化、合并、记忆/好感与 React 联系人界面均参与执行。没有真实 API、玩家存档或网络调用。

| ID | RED 证据 | 最小修复及 GREEN 证据 |
| --- | --- | --- |
| P01 | 首跑三种身份（原著安柏、普通 NPC、既有自定义联系人）仍收到本地模板而非成功 AI 文本；群身份补测收到 `player, contact_target, npc_target, npc_other`，重复发件人且成员非联系人 ID；NPC catalog 暂缺时重复新建已有联系人 | 按 sourceSeedId + 可验证的发件人 contact/NPC 身份替换；按同一身份提取投递记忆，重跑幂等；群成员已有 NPC ID 映射至 contact ID；contact.npcId 可独立于 NPC catalog 复用联系人。三种身份的正文/记忆 + 群成员 + catalog 暂缺用例通过 |
| P02 | 私聊/群聊同名前置 NPC 的好感 120→122，正确 NPC 未改变；显式缺失 npcId 被同名档案阻止建档；seed 建档补测返回空而不是 `npc_target`；新 sender NPC ID 根据来信标题误采用不同 npcId 的同名联系人 | 统一 ID 优先查找；明确 npcId 缺失不降级姓名，建对应 ID；仅身份缺省时使用唯一别名，不用来信标题覆写明确 contact NPC 身份。私聊、群聊、建档、seed 建档、投递入口同名联系人、NPC 名称等于他人 ID、reconcile 保留明确 ID 用例通过 |
| P03 | 群→私、私→群创建两条会话却只有一个 ID；旧 JSON 档重复 ID 的补测也失败 | 新会话 ID 包含类型/发送人/独立种子；归一化修复旧重复 ID并按类型修复 seed targetId，不丢任何会话。两种顺序、实际 JSON 重载、Map 合并、追加隔离及旧冲突档用例通过 |
| P04 | 解散群后合并旧任务重新出现 `thread` | 持久化 deletedConversationIds，加 taskBase 与 live 差异保护，过滤已删除群对应种子；旧空基线迟到任务也受墓碑保护，正常新会话仍允许。两类迟到基线 + 正常新会话对照通过 |
| P05 | 真实 CourierContactTools 删除安柏后 JSON 重载/reconcile 又得到 `contact_npc_amber`；补测被屏蔽种子仍 pending、过滤迟到气泡却增加 unread=1；旧无 npcId 联系人再次补回安柏 | 删除服务记录 deletedContactIds/deletedNpcIds，仅旧无 NPC ID 的原著联系人另记录 deletedLegacyCanonicalNames；归一化、原著补齐、投递、迟到合并遵循意图。明确手动添加解除对应意图；被屏蔽到期 seed dismissed；没有追加气泡则不累计 unread。真实 UI、JSON 重载、canon reconcile、stale task、scheduled delivery、manual restore、pending/unread、遗留联系人边界通过 |
| P06 | 远方喝茶约定的本地 location_change 来信直接包含 `玩家未公开的秘密密室` 和 `诡异紫色暴风雪` | 本地位置来信只使用种子事实/一般关心，不填入全局地点/天气；未知地点/天气断言与既有自然来信测试通过 |

## 实跑记录

统一命令前置（PowerShell login:false）：

```powershell
$env:TEMP = 'C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/.tmp-regression'
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run <下面列出的定向文件>
```

esbuild 启动需 require_escalated，仅运行本地合成测试。

- 19:03:07，首跑 `courierAuditRepair.test.ts`：12 用例，11 失败 / 1 新会话对照通过，exit 1，均为预期业务断言失败。
- 19:03:51，`courierContactTools.test.ts`：3 用例，新增真实删除/reconcile 用例失败，既有 2 例通过，exit 1。
- 19:05:25，首轮修复 7 文件 / 41 例通过，exit 0。既有 courierImmediateReply 错误分支的报告持久化输出 `indexedDB is not defined`（Node fixture 无 IDB），不是新修复用例错误。
- 19:06:40，补边界：16 例中 seed sender registration、blocked pending、stale unread 共 3 失败；19:07:34 全 16 例通过。
- 19:08:02，旧 JSON duplicate IDs 补测失败（19 例中 1 失败）；19:08:34 修复后 8 文件 / 49 例通过，输出无告警。
- 19:09:50，群成员映射补测失败（20 例中 1 失败）；19:10:20 定向 9 文件 / 70 例通过，exit 0，输出无告警。
- 19:12:24，旧无 NPC ID 原著联系人删除补测失败（21 例中 1 失败）；19:13:02 定向 9 文件 / 71 例通过，exit 0，输出无告警。
- 19:15:00，catalog 暂缺与同名联系人标题覆写补测失败（23 例中 2 失败）；19:15:30 最终定向 9 文件 / 73 例通过，exit 0，输出无告警。

最终定向文件：`courierAuditRepair.test.ts`、`courierContactTools.test.ts`、`courierLetterModel.test.ts`、`courierGroupLifecycle.test.ts`、`courierNaturalMessages.test.ts`、`courierReplyClaim.test.ts`、`courierReplyCommit.test.ts`、`courierGroupGuardAndAvatar.test.ts`、`courierModalBehavior.test.ts`（均在 tests/unit）。

## 范围检查与残余门禁

生产范围仅四个文件（services/ai/courierService.ts、hooks/useGame/courierBackgroundJobs.ts、models/teyvat/courier.ts、components/features/Courier/CourierContactTools.tsx）；两份测试及本记录。没有提交、推送、加依赖、调用真实模型、操作真实存档。
models/teyvat/courier.ts 的既有 getDefaultBuiltinAvatar 导入与头像回退 dirty changes 未修改/撤销。
最后 `git diff --check -- <手机范围五个已跟踪文件>` exit 0，仅 Git 既有 LF→CRLF 工作树提醒，没有空白错误；范围通过实际 diff 审计，不把整个 dirty 工作树归因于本修复。
全量类型检查、测试、构建与工作树整体 patch-scope 由主协调者统一运行；这里的定向 GREEN 不冒充全量或真实设备验收。
