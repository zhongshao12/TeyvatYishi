# 31 项问题逐项收口验收

对应 `PROJECT_AUDIT_2026-10-09.md`，本次用户再次要求全部修完后汇报。2026-10-09 重新检查修复落点、具体反例测试和联合门禁，清单内 **31/31 已落实并通过自动化验收，无待实施项**。没有用“全量测试通过”替代逐项检查。

上轮业务补丁已经在工作区，本次复核未发现这 31 项内需要追加的实现缺口，因此保留既有修复，不为制造改动重复重写。新增本验收索引，原审查证据和修复记录保留。代码尚未由本任务提交、合并或推送。

## 验收矩阵

测试文件均在 `tests/unit/`，脚本均在 `scripts/`。每项状态“完成”指已实现且对应自动化行为证据通过，不等同于真实供应商/全设备验收。

| ID | 已核对的修复与验收行为 | 对应验收证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 桌面完整增量读取与云导出、图片载荷、缺依赖拒绝 | storageAuditRepair.test.ts：S01 | 完成 |
| S02 | 预校验后重建；隐藏基线；坏依赖不清原数据；自包含备份脱离镜像恢复 | storageAuditRepair.test.ts：S02 | 完成 |
| S03 | delta-only/隐藏节点图片不被清理；缺依赖 fail-closed | storageAuditRepair.test.ts：S03 | 完成 |
| S04 | JSON 省略业务键后正式增量仍恢复正式聊天 | storageAuditRepair.test.ts：S04 | 完成 |
| S05 | 同 ID 正文修改、图片追加不误判为原样聊天前缀 | storageAuditRepair.test.ts：S05 | 完成 |
| S06 | 目录按 ID 并集，桌面冲突优先，隐藏节点计数正确 | storageAuditRepair.test.ts：S06 | 完成 |
| S07 | 独立实例的存档/增量索引不互相覆盖；锁失败释放、超时不偷锁 | storageAuditRepair.test.ts：S07；Rust 排他创建接线核对 | 完成 |
| P01 | NPC/contact 不同 ID 仍收到生成文本，并将记忆写给正确角色 | courierAuditRepair.test.ts：P01 | 完成 |
| P02 | 明确 NPC ID 优先，不给前置同名角色写回信/记忆/好感 | courierAuditRepair.test.ts：P02 | 完成 |
| P03 | 群私会话 ID 独立；旧重复 ID 重载不丢会话 | courierAuditRepair.test.ts：P03 | 完成 |
| P04 | 删除群聊的持久化意图挡住迟到作业，真正新会话仍允许 | courierAuditRepair.test.ts：P04 | 完成 |
| P05 | 删除联系人不被原著补齐/种子/迟到任务复活，显式重加有效 | courierAuditRepair.test.ts：P05；courierContactTools.test.ts | 完成 |
| P06 | 本地来信不擅自使用玩家未公开地点与天气 | courierAuditRepair.test.ts：P06；courierNaturalMessages.test.ts | 完成 |
| A01 | 先有正文再收到协议 error 时拒绝完成，不能成功结算半截正文 | chatCompletionStreamErrors.test.ts；chatCompletionRequestLifecycle.test.ts | 完成 |
| A02 | 15/225 回合事件来源可追溯，不完整摘要不能退休原文，650 条未覆盖记录不丢 | memoryCompressionCoverage.test.ts；archiveEntryLimits.test.ts；irminsulPromotion.test.ts | 完成 |
| A03 | 同材料不同归档的两次失败有两个可独立重试入口 | memoryCompressionCoverage.test.ts：different failed archive | 完成 |
| A04 | 模型目录响应头/正文/缓存读取接受取消并共用有界超时 | modelCatalogCancellation.test.ts；modelCacheCredentialSafety.test.ts | 完成 |
| A05 | 多次部分预设切换后关闭，恢复原始未设置字段，含 JSON 丢失 undefined 的情况 | tavernPresetSamplingRestore.test.tsx | 完成 |
| A06 | 未知兼容端点和原生 Gemini 不发送未证实扩展字段；已确认端点按能力投递 | chatCompletionSamplingCapabilities.test.ts；chatCompletionTopP.test.ts | 完成 |
| W01 | 发送前日志等待期间切档，不将旧历史与旧输入写进新档；调用链等待后均有守卫 | workflowLiveWrites.test.ts；settlement-live-base-regression.mjs；发送链路核对 | 完成 |
| W02 | 元素结算基于 live 旅人，熟练度增加不回退并发资料修改 | workflowLiveWrites.test.ts；recoveryTailParity.test.ts | 完成 |
| W03 | 未来约定、条件和回忆不推进时间，实际复合耗时仍累计；模型证据同口径 | narrativeFactBoundaries.test.ts；时间相关全量回归 | 完成 |
| W04 | 正常/恢复/重试仅将已确认公开事实交独立模型，保留新事实与任务元数据 | steambirdTaskIntegration.test.ts；recoveryTailParity.test.ts；reroll-regression.mjs | 完成 |
| W05 | 恢复使用正常领域任务：记忆、NPC/剧情/图鉴、手机、元素；任务标记幂等且 live 编辑不丢 | recoveryTailParity.test.ts；postSettlementRecovery.test.ts；postSettlementRecoveryCommitCas.test.ts；workflow-recovery-phase-regression.mjs | 完成 |
| W06 | 未选择的旅行者仅开局排除，后续真实相遇保留 | narrativeFactBoundaries.test.ts：unselected canonical sibling | 完成 |
| W07 | 同物品多事件累计；“全部”、逗号承接、连续使用按有序剩余库存结算 | narrativeFactBoundaries.test.ts；inventory-variable-regression.mjs | 完成 |
| W08 | 斗地主同行记忆携带统一世界时刻，归一化 JSON 往返不丢 | doudizhuSettlement.test.ts | 完成 |
| T01 | 临时草稿不阻断正式 lint，正式项目类型化规则未关闭 | 全量 ESLint：退出 0，0 errors | 完成 |
| T02 | 库存/reroll 门禁执行真实行为，不再只锁旧代码拼写 | inventory-variable-regression.mjs；reroll-regression.mjs | 完成 |
| T03 | 临时装载器递归处理相对/别名/export/动态 import/环，缺依赖不静默跳过 | story-weaving-regression.mjs；regression-module-loader-regression.mjs | 完成 |
| T04 | 新后台与恢复模块登记到统一工作流清单，完整性断言有效 | workflow-sources-integrity-regression.mjs | 完成 |

W05 同时核对了最终补充的并发边界：等待期间好感 10→15 后叠加回信 +2 得到 17，旧日志重放不重复增加；迟到结果不复活基线中已被删除的 NPC，任务真正新建的 NPC 仍可追加。

## 本次重新执行的门禁

```powershell
$env:TEMP = 'C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/.tmp-regression'
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run --reporter=dot
node scripts/run-all-regressions.mjs
node node_modules/typescript/bin/tsc -b --force --pretty false
node node_modules/eslint/bin/eslint.js .
node node_modules/vite/bin/vite.js build
node scripts/bundle-size-regression.mjs
# 在 src-tauri 目录
cargo test --lib
cargo check
```

- 23:14:46 开始的全量单测：**280 文件 / 1927 用例通过，exit 0**。
- 全量脚本：**192/192 通过，exit 0**。
- TypeScript：0 类型错误，exit 0。
- ESLint：0 errors / 151 既有 warnings，exit 0。
- Vite：2226 modules，exit 0；无 app-content ↔ app-core 循环分包。
- Rust：13/13 测试通过，cargo check 通过且无警告。
- Bundle 门禁通过：index 223.9 KiB、最大 app-core 1152.0 KiB、总 JS 2887.8 KiB、gzip 901.9 KiB，均在既有预算内。
- 本任务代码的 tracked diff 空白检查通过。排除其他任务的两份 `完全破限模式` 文档 EOF 空行，不修改这些并行工作；不将整个工作区空白检查冒称全绿。

## 验收边界

本清单不存在等待实施的代码项；151 条 lint warning、分包体积提示和真实设备/API 验收不被冒充为这 31 项中的未修部分，也不被冒称已清零。真实 Windows 全产品重启/崩溃、真实模型回复质量、移动端软键盘及大数据规模性能尚未验证；完整说明见 [交付报告](2026-10-09-repair-delivery.md)。没有重置玩家存档，也没有操作真实模型账号。
