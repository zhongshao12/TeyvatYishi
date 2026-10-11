# 提瓦特异世：全流程代码审查（2026-10-09）

## 结论

当前版本能通过类型检查、全部单测和生产构建，但仍不能据此认为业务流程可靠。本轮归并出 **31 项待处理事项：14 项 P1 行为缺陷、16 项 P2 行为/工具链问题、1 项 P2 供应商契约风险（合并两种供应商的参数投递问题）**。

最重要的风险集中在桌面增量存档、异步切档、手机身份映射、记忆压缩和恢复流程。优先解决数据可靠性，不宜先做界面重写或大范围清理。

本轮只分析，**没有修改游戏实现、提交、合并、上传，也没有操作真实玩家存档或调用付费模型**。新增本报告；构建和测试生成了常规输出。保留原工作区全部未提交改动。

## 一、审查口径与范围（Routing Decision）

- 审查快照：分支 `codex/npc-affinity-memory-consistency`，HEAD `93123763f06ca38a87be29477fe990c4dcbecac9`，包括当前未提交代码，不能仅用该提交号重现本轮结果。
- 方法：`code-quality-workflow` 的只读 AUDIT/SWEEP，分模块独立核查；用 `systematic-debugging` 验证可疑故障，再由主审去重和判级。
- 范围：开局/读档/保存、主回合与恢复、时间和背包结算、模型适配与取消、预设投递、手机/联系人/群聊/同行记忆、世界树压缩、剧情与图鉴衔接、斗地主结算、组件边界、桌面存储及构建门禁。
- 扫描主线目录约 403 个生产 TS/TSX 文件；对关键调用链深入核查。**不声称逐字阅读每份静态资源，不声称完成全部真实设备、供应商和 Windows 桌面故障验收。**
- 排除生成物、依赖和打包输出；B08/B09 按用户已有分工，不在本轮提出实现修改。
- 证据分为：①真实业务函数的合成状态复现；②可到达调用链/明确数据契约矛盾；③请求与官方 schema 不匹配。第三类仅列兼容风险，不冒充真实供应商 400。
- P1：核心行为错误，应优先修复；P2：边界错误、非阻断风险或工具链问题。涉及有条件的数据删除风险，并不表示已经证明用户现有存档受损。

## 二、实跑验证

| 检查 | 本轮结果 | 说明 |
| --- | --- | --- |
| TypeScript | `tsc -b --force --pretty false` 通过 | 无类型错误 |
| 全量单测 | **269 文件 / 1816 用例通过** | 不覆盖所有跨会话、真实磁盘序列化场景 |
| 全量脚本回归 | **187/191 通过** | 4 项失败见 T02–T04 |
| Vite 生产构建 | 通过，2221 modules | 没有此前 app-content ↔ app-core 循环分包警告 |
| Bundle 体积门禁 | 全部通过 | index 223.9 KiB；最大 app-core 1128.4 KiB；总 JS 2832.7 KiB；gzip 883.5 KiB |
| ESLint | **1 error / 151 warnings** | 唯一 error 是临时 `.superpowers` 文件的项目解析配置问题，不是游戏运行崩溃 |
| 业务定向诊断 | 多项真实函数复现 | 内存编译、合成 fetch、JSON 文件适配器、fake-indexeddb；不使用玩家真实数据 |
| Rust / 真实 Tauri | 本轮未实跑 | 不能沿用旧报告数字冒充本轮结果 |

Windows 默认临时目录曾造成 esbuild 的 ACL 环境失败。重定向 TEMP/TMP 至工作区可写目录后重新执行；最终 187/191 是重跑结果，不把首次权限失败或构建期间的瞬时产物缺失计为业务缺陷。

构建仍有大块体积提示以及 failureCenterStore 静态/动态导入混用提示；它们不是构建失败，也没有足够测量证明它们就是页面卡顿的根因。

## 三、必须先修（Must Fix Now）

### S01 · P1 · 桌面增量档读取和云导出返回占位数据

位置：[dbService.ts:362](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/dbService.ts:362)、同文件 393 行；[desktopSaveMirror.ts:424](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/desktop/desktopSaveMirror.ts:424)。

桌面优先读取分支只恢复图片，不重建 base + delta。保存端已能写出删掉旅行者、手机、对话等字段的增量占位档，因此 loadSave 和 loadSaveForCloudTransfer 得到的不是完整游戏状态。

复现：完整基线后新增自动档，读回结果 `mode=delta, chatCount=0, travelerPresent=false`；云导出也为 chat=0、assets=0。仅针对走该桌面增量路径的档，不意味着所有 Web 普通档都异常。

修复方向：所有读档、导出、备份共用完整节点物化器；依赖缺失时明确失败，禁止把占位档当有效整档交给上层。门禁：桌面实际 JSON 往返、自动档读回和云导出语义等价。

### S02 · P1 · 从桌面重建缓存可能删除唯一增量内容

位置：[dbService.ts:793](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/dbService.ts:793)，关联 759–785 行；[desktopSaveDeltaMirror.ts:86](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/desktop/desktopSaveDeltaMirror.ts:86)。

重建入口读取可见镜像占位档，只恢复资源便调用 replaceAllSaves。后者清空 IDB 的 saves/assets/deltas，再依据占位档生成不出完整 delta；替换桌面 delta 镜像时又删除旧增量。隐藏基线不在普通可见档列表中。操作前备份也依赖 S01 的读取，并非可靠的自包含全量备份。

合成文件系统复现：恢复返回成功数量 2，但恢复链上原有增量被清除。若没有独立完整备份，存在不可恢复的数据损失风险；没有对用户真实文件执行该操作。

修复方向：先完整解析所有节点及隐藏基线并校验，再原子替换；失败保持原数据；备份必须自包含。修复前桌面版不建议使用“从桌面恢复/重建缓存”。

### S03 · P1 · 资源清理把增量档图片误认成孤立资源

位置：[dbService.ts:861](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/dbService.ts:861)，删除出口 [desktopAssetMirror.ts:208](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/desktop/desktopAssetMirror.ts:208)。

collectReferencedDesktopAssetIds 发现桌面档后直接从占位相册收集 ID 并 continue，跳过 delta 重建。只在增量档新增的图片因此不进入引用集合。

复现：图片仅由后续自动增量档引用，清理后桌面图片文件不存在。IDB 副本可能暂时救回，但不能保证始终存在。修复：清理前物化所有有效节点，并在引用解析不完整时禁止删除。门禁：delta-only 图片、隐藏基线图片、缺失依赖时 fail-closed。

### S04 · P1 · 真实 JSON 序列化后增量占位档误走 Legacy 分支

位置：[saveDeltaStorage.ts:182](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/utils/saveDeltaStorage.ts:182)，类型判定 303–307 行。

buildDeltaOnlyStoredSave 将手机等字段设成 undefined，实际 JSON.stringify 会省略这些键；isFormalSave 却要求 `'手机' in save`，于是正式占位档被判成 Legacy。恢复出的正式对话仍停在基线，追加聊天进入另一套兼容字段。

复现：JSON 往返后正式对话预期 2 条，实际 1 条，另一条进入 legacyChat。当前手动覆写测试的 structuredClone 保留 undefined 属性，不能代表磁盘 JSON。修复：以 universe/schema/storageMode 等显式判别，不以被有意省略的业务字段判别；覆盖手动档依赖物化与实际 JSON 契约。

### W01 · P1 · 发送前切档仍会被旧聊天历史污染

位置：[sendPreparationStage.ts:87](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/sendPreparationStage.ts:87)、[sendWorkflow.ts:697](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/sendWorkflow.ts:697)。

等待恢复日志持久化及动态导入后，没有立即验证 session/abort，再用旧 state.chatHistory 生成 updatedHistory 并 setChatHistory。之后阶段才检查闸门；异常回滚又会避开已切换的存档，不能撤掉刚才的旧历史写入。

真实 prepareSendTurn + 延迟持久化替身复现：等待期间将活体历史切成 B 档，释放等待后历史被写成 A 档旧消息 + A 档输入。修复：每个等待后的第一次写入前检查会话，最好用同一 owner 的带条件提交；门禁覆盖前置两次日志等待、懒加载、停止与切档。

### W02 · P1 · 元素结算整体覆盖后台期间编辑的旅人资料

位置：[elementalSettlementStage.ts:38](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/elementalSettlementStage.ts:38)，调用位于 [sendWorkflow.ts:963](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/sendWorkflow.ts:963)。

元素结算在后台任务等待后才执行，但 travelerForMastery 来自旧 variableOverrides/state。增加熟练度时 set旅人 整体替换旧档案，而不是只把元素增量合并到 live traveler。

复现：活体姓名已改为“玩家刚编辑的新名字”，旧快照姓名为“旧名字”；正文旅行者释放风元素后熟练度 10→12，姓名却回到“旧名字”。修复：读取 live 根并以字段增量结算；保留并发编辑、元素觉醒和天赋新增，写入时检查 session。

### W03 · P1 · 时间解析把将来约定、条件句当成已经流逝

位置：[variableFacts.ts:626](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/utils/variableFacts.ts:626)、1037/1142 行。

耗时与跨日提取扫描整段正文，没有充分区分已经发生的叙事、角色说话中的计划和条件。

真实函数复现：`安柏说：三天后我们会在蒙德重逢。你点头答应。` 被结算 next_day=3；`如果两小时后雨停了，就可以出发。` 被结算 elapsed=120。对照：实际“三天过去后，再过两个小时”正确累计 4440 分钟。

影响日期、旅行天数、约定触发和每日关系奖励。修复：统一时间事实证据边界，计划/条件/回忆不推进时钟；正文与模型均按同一规则校验。

### W04 · P1 · 恢复和报纸重试绕过“公开事实 + 独立 AI”边界

位置：[postSettlementRecoveryWorkflow.ts:195](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/postSettlementRecoveryWorkflow.ts:195)、[sendWorkflow.ts:478](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/sendWorkflow.ts:478)、[steambirdWorkflow.ts:13](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/steambirdWorkflow.ts:13)。

正常路径已使用确认公开事实和独立 AI，但恢复、失败重试仍直接把玩家输入 + 全正文包装成“公开见闻”，调用本地摘句器，不调用配置模型。replaceSteambirdNews 又只返回 articles，丢掉 confirmedFacts/generationTasks 等元数据。恢复的已执行判定拿文章摘要与完整正文比较，也不能可靠防重复。

复现：输入“这是我与丽莎之间的秘密，请不要告诉任何人”，本地结果 status=published，内容仍为该秘密；原公开事实和任务记录消失。这里是游戏内公开信息边界错误，不声称已发送到外部报纸服务。

修复：正常、恢复、重试共用冻结的公开事实任务；保留元数据、身份、时刻和幂等键，拒绝临时把原文标成公开。

### W05 · P1 · settlement_committed 的恢复尾部不等价于正常完成

位置：[variableCalibrationStage.ts:210](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/variableCalibrationStage.ts:210)、[postSettlementRecoveryWorkflow.ts:120](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/postSettlementRecoveryWorkflow.ts:120)。

正常路径在写入 settlement_committed 日志后，还进行 NPC 整理、剧情节点同行记忆、图鉴解锁、压缩、后台手机/新闻、元素结算。恢复路径只重建其中一部分，末尾直接自动存档；没有调用正常的元素结算、剧情节点 NPC 记忆和图鉴运行时解锁等任务。

可到达反例：旅行者释放风元素，提交后、元素阶段前中断；正常路径应 +2 熟练度，恢复没有该阶段。剧情档案已推进也可能未对应解锁图鉴/写入角色记忆。这是调用链证据，未声称完成真实进程终止故障注入。

修复：建立可重复执行的尾任务清单及逐任务完成标记；正常/恢复只使用同一实现；测试每个提交后中断点，而非只检查“最终有自动档”。

### P01 · P1 · 主动来信角色 ID 不一致，AI 文本和记忆都可能丢失

位置：[courierBackgroundJobs.ts:306](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/courierBackgroundJobs.ts:306)、[courierService.ts:375](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/courierService.ts:375)。

seed 使用 NPC ID，投递后消息及 participantIds 使用 contact ID。AI 替换要求 participantIds 包含 seed.senderId；记忆提取又要求 message.senderId === seed.senderId，两个条件均可能不成立。

复现：seed=npc_a，bubble/contact=contact_npc_a，成功 AI 文本未进入会话；同行记忆数量仍 0。解释“已经生成却仍像模板”“来信后人物不记得”的一种确定原因，不意味着所有不回复都由它造成。

修复：明确 NPC/contact 两种 ID 的映射，按 sourceSeedId 找到目标后校验规范 NPC 身份。门禁覆盖原著、普通 NPC、已存在联系人三种身份。

### P02 · P1 · 同名角色抢先匹配，回信/好感/记忆写错人

位置：[courierBackgroundJobs.ts:531](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/courierBackgroundJobs.ts:531)，群聊同类入口 442–443 行。

find 条件把精确 ID 和姓名匹配并列 OR；前面的同名 NPC 会抢在后面的正确 npcId 前命中。

复现：联系人明确指向 target NPC，但 npc_other 排在前且同名；回信后 other 记忆 +1、好感 120→122，target 不变。修复：ID 优先独立查找，仅无可用身份时才进行明确的别名归一；不能用姓名覆盖已知不同 ID。

### P03 · P1 · 自动群聊与私聊生成相同 conversation ID

位置：[courierService.ts:948](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/courierService.ts:948)。

查找区分 private/group，但创建都使用 courier_conv_${senderId}。允许剧情创建群聊时，先群聊再私聊能得到两条不同类型、相同 ID 的会话。

后果：appendCourierMessage 更新多条同 ID 会话；Map 合并只保留一条。修复：会话 ID 必须包含独立身份，不复用发件人作为不同会话的 ID；门禁覆盖群→私、私→群以及保存重载。

### A01 · P1 · HTTP 200 流式错误被当作成功完成

位置：[chatCompletionClient.ts:1296](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/chatCompletionClient.ts:1296)，OpenAI 兼容流有同类问题。

流中已经输出部分正文后出现供应商 error，解析器没有抛错，仍 onDone 并返回半截正文。

按 [Claude 官方流式错误格式](https://platform.claude.com/docs/en/build-with-claude/streaming#errors) 构造 partial story + overloaded_error，实测返回 partial story、onDone=1/onError=0；兼容流 error payload 同样复现。合成传输证明客户端处理错误，不等于真实供应商已发生该错误。

修复：所有适配器识别协议失败事件并拒绝 Promise，保留诊断且不调用成功结束；测试“先有正文后失败”，避免半截正文进入正常变量结算。

### A02 · P1 · 本地记忆摘要漏掉后九回合，晋升后世界树也无法恢复

位置：[memoryCompression.ts:146](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/memoryCompression.ts:146)、[memoryUtils.ts:577](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/memoryUtils.ts:577)、[irminsulPromotion.ts:36](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/irminsulPromotion.ts:36)。

本地 fallback 对一批 15 条只选前 6 条、每条约 96 字，却移除整批即时记忆。长玩家输入还会挤掉后面的实际结果。后续晋升把含原文的短期归档退休，但中期摘要并未覆盖这些事件。

复现：15 个互异事件只保留 1–6；逐回合跑 225 回合后，世界树只剩一个 medium 归档，宣称覆盖 15 个来源，第 7 个独立事件已不在主记忆或世界树。仍可能从聊天正文重建，故不是说所有证据都永久消失。

修复：每个来源必须有事实覆盖；摘要不能覆盖时保留来源归档，不将“摘要成功”混同为“所有来源已可退休”。门禁至少逐回合跑 225 回合并保留承诺、获得物品、节点结果等关键事实。

## 四、下一批边界问题（P2 Findings）

### S05 · P2 · 对话增量只比较消息 ID，不识别原消息的修改

位置：[saveDeltaStorage.ts:249](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/utils/saveDeltaStorage.ts:249)。同 ID 被当成未修改前缀，增量只保存尾部。复现：同 ID 修改正文/增加 narrativeImages，恢复后仍为旧正文、图片数量 0。正文生图补图和恢复路径均能修改已有消息。应比较持久化内容指纹或记录消息补丁。

### S06 · P2 · 存档目录按总数量二选一，隐藏另一侧的独有节点

位置：[saveCatalog.ts:89](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/storage/saveCatalog.ts:89)。desktop=[10]、IDB=[1,2] 时整体选择 IDB，新桌面节点 10 不在界面；隐藏基线也影响 totalStoredCount。应按节点 ID/版本/完整性协调，不能用数量判断哪个目录完整。

### S07 · P2 · 跨实例更新桌面索引仍可能丢条目

位置：[desktopSaveMirror.ts:152](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/desktop/desktopSaveMirror.ts:152)、185 行。ID 预留已经排他，但索引 read-modify-write 没有跨实例整体锁。并发镜像两个不同 ID，实际文件都在，索引却仅列 [2]。同一 JS 上下文队列不保护两个应用实例；应事务化索引或在写后协调合并。这里是目录丢项，不是文件已经被删除。

### W06 · P2 · 开局排除另一位旅行者的逻辑扩大到所有后续剧情

位置：[state.ts:89](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/models/teyvat/state.ts:89)、153 行。每次 normalize 都 prune 未选中的原著旅行者，而非仅清理开局自动种子。

复现：选择荧为开局伙伴，第 100 回合已明确遇见深渊中的空，带相遇记录的空 NPC 仍被删掉；相应手机关联也被清理。用户要求的是不凭空多出开局伙伴，不应阻止后来真实遇见另一位旅行者。应限制开局清理边界并尊重后续事实。

### W07 · P2 · 背包正文兜底对重复事件和“物品全部”计算错误

位置：[variableFacts.ts:1598](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/utils/variableFacts.ts:1598)、1653/1669 行。仅在变量模型漏报、启用正文兜底时发生：`你收下两枚苹果。你收下三枚苹果。` 原始提取 2 和 3，合并却只保留 2；`你把苹果全部交给安柏。` 背包有 10，兜底扣 1；两次消费也只识别第一个。

应把同回合多个已发生事件累计，同时与模型已有事实去重，支持前置与后置的“全部”；不能简单对所有同名事实相加，避免模型与正文双计。

### W08 · P2 · 斗地主新增同行记忆没有统一世界时刻

位置：[doudizhu/settlement.ts:49](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/doudizhu/settlement.ts:49)。写入只有 id/turn/summary/source/relatedNpcIds，没有 worldMoment。该旁路没有满足已明确要求的日期、世界、天气、地点、旅行天数元数据契约。应从活体世界时钟生成时刻，不用 Date.now 冒充游戏时间；重载也要保留。

### P04 · P2 · 已解散群聊被迟到后台结果复活

位置：[courierService.ts:76](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/courierService.ts:76)。mergeCourierSystemUpdates 在 live 不含会话时无条件接收旧 taskResult。复现：解散后会话数 0，合并旧任务又变 1。需区分“新任务新建”和“用户删除”；用删除版本/墓碑或任务基线差异保护用户操作。

### P05 · P2 · 删除原著联系人后会被自动重新添加

位置：[courier.ts:478](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/models/teyvat/courier.ts:478)。删除只移除 contacts，normalize/update 根据已遇见原著 NPC 又补回联系人，没有手动删除意图记录。复现：contacts=[]、已遇见安柏仍存在，归一化得到 contact_npc_amber。需保留可恢复的用户删除/屏蔽状态，不能把“缺失”统一解释为“应自动添加”。

### P06 · P2 · 本地来信直接知道未公开地点与天气

位置：[courierService.ts:495](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/courierService.ts:495)、559 行。全局 environment 被填入“听说你到了{place}，那边{weatherHint}”，没有发送者知情证据。复现：远方角色只有喝茶约定，仍提到玩家未透露的秘密地点/天气。AI 提示词的知识边界不能保护这个本地模板出口；应只填入角色确知事实。

### A03 · P2 · 相同材料的第二个失败记忆归档没有重试入口

位置：[memoryUtils.ts:491](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/hooks/useGame/memoryUtils.ts:491)、750–758 行。失败草稿按 kind+checksum 去重，忽略不同 archiveEntryId。30 条相同材料产生两个 pending 归档，却只有一份重试草稿且只指向第一个。应按目标身份去重或保存全部目标，重试后所有目标都有确定状态。

### A04 · P2 · DeepSeek 空正文恢复的模型目录请求不可及时取消

位置：[deepSeekRecovery.ts:157](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/deepSeekRecovery.ts:157)、[openAICompatibleModels.ts:103](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/openAICompatibleModels.ts:103)。正文恢复转向目录请求时，没有贯穿 signal 或有界超时。合成挂起目录 fetch 后 abort，目录 init.signal=false，任务仍等待直至释放请求。不能将短时间观察本身当作“无限挂起”证明；源码无信号/超时给出了无界等待风险。应覆盖目录响应头和正文，并在取消后停止候选请求。

### A05 · P2 · 关闭酒馆预设仍残留其采样参数

位置：[PromptModulesTab.tsx:164](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/components/features/Settings/PromptModulesTab.tsx:164)、207 行。恢复备份复用部分覆盖函数 `params.field ?? config.field`，原来 undefined 的字段无法删除。

复现：主配置原本只有 temperature=0.8，预设写 topP=0.4/maxContext=99999；切走后两个字段仍在，而备份已清空。应分别实现“部分应用”和“完整恢复”，覆盖未设置值与多次切换。

### A06 · P2 契约风险 · 把扩展采样参数无差别送给原生供应商

位置：[chatCompletionClient.ts:544](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/services/ai/chatCompletionClient.ts:544)、547/1434/1917 行。这里合并记录两项供应商风险，不算已实测拒绝：

1. OpenAI 兼容传输实际发送 repetition_penalty/max_context_tokens；[OpenAI Chat 官方参数 schema](https://developers.openai.com/api/reference/resources/chat) 未列这两个字段。
2. Gemini 实际 generationConfig 含 repetitionPenalty；[Google GenerationConfig schema](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig) 列 presencePenalty/frequencyPenalty，但无该字段。

已证实请求构造与标准契约不一致，严格服务端存在拒绝风险；未使用真实供应商测出 400，部分扩展网关可能支持。应按供应商明确能力白名单投递，保留玩家配置但不要向未知端点盲发扩展字段。不在此建议擅自增加用户已经否决的发送前硬上限。

### T01 · P2 · 临时审查产物进入 ESLint，使 lint 退出失败

位置：[eslint.config.mjs:7](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/eslint.config.mjs:7)。`.superpowers/sdd/2026-10-03-public-steambird/client-phase-index.ts` 被通配包含但不在 project service 中。唯一 error 来自该解析问题。应隔离临时产物并明确 lint 范围；不要禁掉全项目类型检查来消除它。

### T02 · P2 · 两条回归门禁仍锁定旧实现字符串

位置：[inventory-variable-regression.mjs:66](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/scripts/inventory-variable-regression.mjs:66)、[reroll-regression.mjs:112](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/scripts/reroll-regression.mjs:112)。分别报 guarded root commit 与报纸写入闸门失败。当前结算已有新的提交身份检查；正常报纸任务已有 owner.isCurrent 守卫和 assertWorkflowActive，但不再匹配旧 state.set蒸汽鸟报 字符串。

这两项失败**不能直接当成已证实主路径无闸门**，也不能直接删除断言。应改为行为门禁，验证切档不写入和单次提交。W01/W02/W04 是另外有真实行为证据的漏洞，不能靠门禁变绿掩盖。

### T03 · P2 · 剧情回归的临时模块装载缺少依赖

位置：[story-weaving-regression.mjs](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/scripts/story-weaving-regression.mjs)。实跑缺少 `.tmp-story-weaving-regression/prompts/subsystems/steambirdPrompt.mjs`，ERR_MODULE_NOT_FOUND；因此没有执行到预期剧情验证。应递归覆盖相对/别名依赖，或使用统一 TS 装载机制，不能宣称这条已证明剧情行为正确或错误。

### T04 · P2 · 新报纸工作流未登记到工作流完整性清单

位置：[workflow-sources-integrity-regression.mjs](C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/scripts/workflow-sources-integrity-regression.mjs)。`hooks/useGame/postTurnSteambirdTask.ts` 被工作流 import，但不在 WORKFLOW_FILES / WORKFLOW_OUT_OF_SCOPE；实跑门禁失败。应登记到分包/视图边界，或明确说明有意排除，而非让清单失去约束。

## 五、重构与体验优化信号（Refactor Signals / Slimming Opportunities）

这些是由上述缺陷支持的优化方向，不是新增的已证实运行错误，也不建议本轮整体重写。

### 1. 一个权威节点读取器，解决桌面/IDB/云传输多套读取逻辑

S01–S07 已跨过“同域多个边界错误”的重构门槛。应统一节点物化、依赖校验、资源引用收集和导出；保留两种存储实现，但让它们服从同一个完整存档契约。任何清理/重建必须先验证，无需等用户点击危险操作才发现依赖不全。

删减分类：State Duplication / Compatibility Path。不能现在直接删除 Legacy 或桌面 fallback；先建立真实 JSON、自包含备份、跨实例及故障中断门禁。

### 2. 正常回合、恢复、重试共用任务实现

W04/W05 显示重复流程已经分叉，不再只是文件过大。优先把任务输入/输出/幂等键/会话条件定义清楚，再迁移具体任务；避免继续复制一份“简化恢复版”。保留已有开关，不把恢复顺带变成额外付费请求。

### 3. 用增量提交减少覆盖和重渲染

W02 和现有大协调器说明整片快照回写仍有风险。App.tsx 1634 行、useGameState.ts 1352 行、sendWorkflow.ts 1166 行、variableFacts.ts 2730 行、chatCompletionClient.ts 2156 行；**行数本身不是 bug**。优先抽出权威状态 owner、提交契约和供应商能力边界，而非纯搬运代码再加一层包装。

用户体验上，手机/同伴只订阅所需切片，长消息列表增量渲染，避免每次后台写入都重做整张人物关系数据；要先量测 React 提交耗时、长任务、列表规模及峰值内存，再决定缓存或虚拟列表。

### 4. 角色身份统一，删除意图独立保留

P01–P05 共同指向 NPC ID、contact ID、conversation ID 的职责混用。一个规范 NPC 身份对应档案和记忆，联系人是通信实体，会话是独立聊天空间；备注/姓名只供展示或受控别名，不作为存档身份。删除联系人/解散群聊用可恢复的意图记录，后台任务不能复活。

### 5. 把“失败”“半成功”“仍在等待”清楚展示

对模型目录、流式中途失败、部分群成员失败、pending 记忆归档、依赖缺失存档统一提供阶段、目标、原因和安全重试入口。保留已有失败结算中心，先补漏报和错误成功状态，不再加一套错误面板。

### 6. 先保证记忆可追溯，再改善召回体验

给压缩显示覆盖回合范围、来源数量、摘要是否完整、失败目标；保留来源指针和世界时刻。结果压缩必须保留关键变化，不能只展示“压缩完成”。可加入按角色/地点/日期检索与来源回看；是否进一步压缩应由覆盖门禁决定。

### 7. 预设展示“实际发送了什么”

沿用已有投递诊断，明确启用的预设、有效采样参数、覆盖来源、未支持参数及本次格式/字数验证。A05/A06 解决的是确定残留和协议边界；不能承诺任何模型百分之百遵守所有预设文风。

## 六、暂不动的范围（Do Not Touch Yet）

- B08/B09 的实现，按用户分工交由其他任务；本轮不混入修复。
- 原著资源及双源剧情正文：没有证据说明某份资源可直接删/覆盖，不做批量同步。
- 已修复的 app-content ↔ app-core 循环分包、已通过的新开局章节字段容错，不重新当作当前错误。
- 通用 prefill：当前主剧情明确不启用真实前缀、已以风格样例投递；不能仅因某函数未调用就断言酒馆预设整体无效。
- 现有代理域名限制、Presence、Rust 保存机制：未找到足够证据新增断言漏洞；本轮未完成真实部署安全审计。
- 自动压缩或发送前硬上限：用户已明确暂不设硬上限；优化不能擅自改变这一选择。
- 不因文件大或 warning 多而删除有调用关系的兼容模块、静态资源、生成管线。

## 七、建议修复顺序与验收门禁（Verification Gates）

| 顺序 | 范围 | 必须通过的行为验收 |
| --- | --- | --- |
| 1 | S01–S04，随后 S05–S07 | 桌面真实 JSON 节点读回；依赖覆写后旧节点保持；恢复/清理不丢 delta 和图片；缺依赖拒绝；自包含备份；跨实例索引一致 |
| 2 | W01/W02/A01 | 所有等待点切档不写新档；停止不提交；并发旅人编辑不被元素结算覆盖；先有文字后 error 不成功 |
| 3 | P01–P06 | 不同 NPC/contact ID 正确投递、写记忆；同名不同 ID 不串人；群私 ID 唯一；删除不复活；未知地点不外泄 |
| 4 | W03/W07/W06/W08 | 计划/条件不推进时间；实际复合跳时正确；同物品多事件累计；全部扣完；后续能遇见另一旅行者；旁路记忆有游戏时刻 |
| 5 | A02–A05，W04/W05 | 225 回合记忆覆盖；多个失败归档均可重试；目录取消有界；预设参数完整恢复；每个提交后中断点恢复与正常完成等价 |
| 6 | A06，T01–T04 | 官方协议请求形状、扩展网关能力；lint 不被临时文件阻断；191/191 行为回归；正常打包与体积门禁 |
| 7 | 真实体验验收 | Windows 重启/占用/终止；真实供应商取消及流中失败；窄屏键盘、长聊天、群成员多、存档多、相册多的耗时和内存 |

每批先补能在旧实现变红的行为测试，再改实现。不得为凑全绿删除历史断言、把真实失败改 skipped 或改成固定成功；旧字符串断言可以迁成更强行为契约。

## 八、验证缺口与残余风险（Verification Gaps / Residual Risk）

没有使用真实 API 密钥，也没有消费真实模型额度；角色回话质量、真实供应商接受/拒绝扩展参数、端到端取消时延仍需专门验收。没有真实 Windows 文件占用/崩溃注入，也没有完成移动端软键盘/触摸/真实视口验收。

合成桌面适配器保留 JSON 序列化语义，比 structuredClone 更贴近文件，但不是 Rust/Tauri 的替代品。重构后仍需要桌面回归。UI 可读性与卡顿不应仅凭源码、bundle 警告或单测结果宣称已修复。

其他测试未报错的模块只能说明已执行门禁通过，不能证明没有隐藏错误。本报告是当前工作树的已证实高风险清单，不是无缺陷保证。

## 九、门禁建议（Gate Recommendation / Optimization Eligibility）

**有条件的定向修复可以进入实施；不建议先发布为“全部问题修复完毕”，不建议先做大范围瘦身或重写。**

优先阻断 S02/S03 的危险操作，建立自包含备份并统一完整节点读取，再处理会话竞态。需保护已存在档案与存档；涉及旧档修复时必须先备份，不能静默重置或批量覆盖。用户本轮仅请求分析，以上均为建议，尚未实施。
