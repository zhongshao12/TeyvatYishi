# 手机内容、人物资料与回合存档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 不提交或推送 Git，保留当前分支已有改动。

**Goal:** 修复手机内部文本泄漏，统一照片入口与人物视觉资料，并安全区分同名旅程、保留十个不同回合。

**Architecture:** 手机共享净化器分别处理可知事实与聊天输出；照片读取本次玩家需求，不读取整段账本。外貌校正和图鉴展示采用纯函数投影，角色阅读权限不改变 AI 知识权限。存档保留按 rootId 与不同回合分组，稳定编号独立于玩家姓名。

**Tech Stack:** React 19、TypeScript、Vitest/jsdom、IndexedDB、现有桌面存档镜像与增量存储。

## 执行约束

规格：`docs/superpowers/specs/2026-10-10-phone-facts-save-history-design.md`，用户已确认。

使用当前 `codex/npc-affinity-memory-consistency` 分支，不创建不含既有改动的空白 worktree。每个任务先红证再实现，再规格与质量审查；实施任务顺序执行，不并发修改共享文件。审核可读取当前工作区，不能把本轮之前的改动误认作本轮实现。

Windows 构建统一使用已存在的 `.tmp-regression`：

```powershell
$env:TEMP='C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/.tmp-regression'
$env:TMP=$env:TEMP
pnpm test
```

## Task 1：手机事实与聊天输出净化

**Files:** 新增 `utils/courierTextSanitizer.ts`；修改 `services/ai/courierService.ts`、`services/ai/courierLetterModel.ts`、手机消息展示/写入调用点；新增 `tests/unit/courierTextSanitizer.test.ts`，扩展 `tests/unit/courierAuditRepair.test.ts`。

- [x] 写红证：现有 `sanitizeCourierSeedFact` 与本地来信输入混合 XML/关系账本后仍泄漏；保持正常事实可用于人设回复。

```ts
expect(sanitizeCourierSeedFact('Complete. <char_seven>琴:【七维关系状态】 好感: 100</char_seven>')).toBe('');
expect(composeCourierLetterLocally(contextWithOnlyInternalSeed)).not.toMatch(/char_seven|七维|Complete|约定的事别忘/);
```

- [x] 运行 `pnpm exec vitest run tests/unit/courierTextSanitizer.test.ts tests/unit/courierAuditRepair.test.ts`，记录污染用例失败原因。
- [x] 建立共享纯函数清理内部完整/残缺块及调度元数据；聊天模式不把第三人称种子当台词。接入种子、模型结果、本地降级、角色记忆和历史展示；空/无可靠正文显式失败或安全降级。不改好感度、年龄与角色知识范围。
- [x] 重新运行上述测试及现有手机模型/记忆测试，确认有效聊天不被误删、污染不回流。
- [x] 规格审查与代码质量审查；修正问题后再进入 Task 2。

## Task 2：精简照片需求与聊天完成后的统一入口

**Files:** 修改 `services/courierPhoto.ts`、`components/features/Courier/useCourierPhotoGeneration.ts`、`CourierModal.tsx`、`CourierMessageTimeline.tsx`；必要时新增 `CourierPhotoAction.tsx`；扩展 `tests/unit/courierPhoto.test.ts`、`courierPhotoGeneration.test.tsx` 并新增入口交互测试。

- [x] 写红证：最近聊天中的关系状态不能出现在照片预览；只读取当前交流相关玩家需求；手机主界面只有一个照片操作入口，等待/失败回复期间不可生成。

```ts
expect(readCourierPhotoContext(phone, target)).toContain('在窗边拍照');
expect(readCourierPhotoContext(phone, target)).not.toMatch(/七维|char_seven|好感|Complete/);
```

- [x] 运行 `pnpm exec vitest run tests/unit/courierPhoto.test.ts tests/unit/courierPhotoGeneration.test.tsx` 和新增入口测试，确认红证。
- [x] 手机专用草稿仅组合需求、姓名、性别、外貌和细项，沿用精简与字符上限；不继承大段肖像模板/聊天原文。移除每行按钮，单一入口按真实排队、输入与失败状态判断完成；群聊仅选当前交流实际参与者。
- [x] 保留 session/冻结目标、取消、原子提交和引用存储；扩展切档、延迟投递、已有照片与并发更新用例并运行照片全部测试。
- [x] 规格及质量审查，无未解决问题后进入 Task 3。

## Task 3：结构化外貌校正与可读角色图鉴

**Files:** 新增 `utils/npcAppearanceReconciliation.ts`；修改人物规范化/写回与图鉴展示入口，包含 `utils/npcWriteBack.ts`、`services/ai/npcAppearanceEstimate.ts`、`components/features/Codex/productionAdapter.ts`、`CodexManagerModal.tsx`、`App.tsx`；新增 `tests/unit/npcAppearanceReconciliation.test.ts`、`codexCharacterVisibility.test.tsx`。

- [x] 写红证：外貌概述与已记录发色/瞳色/数值冲突；图鉴中锁定角色无法阅读，也没有当前 NPC 外貌细项。

```ts
expect(reconciledAppearance).toContain('绿色');
expect(reconciledAppearance).not.toContain('红色眼眸');
expect(codexAfterViewing.unlockedEntryIds).toEqual(codexBeforeViewing.unlockedEntryIds);
```

- [x] 运行新增测试确认红证。
- [x] 用统一校正规则在实际资料边界校正对应描述、保留发型配件及来源；不凭空补全、不改手动锚点、不绕过私密字段门禁。角色条目展示可读/searchable，叠加当前 NPC 公共细项；规范 ID/别名匹配，不自动创建同伴/联系人，不修改 AI 检索解锁权限。
- [x] 运行新增测试、人物写回、档案补全、图鉴检索和生图资料现有测试；确认展示与写回一致。
- [x] 规格及质量审查后进入 Task 4。

## Task 4：稳定旅程编号与十个不同回合的保留

**Files:** 修改 `services/storage/saveRetention.ts`、存档 summary/tree 展示与必要的编号持久化入口，包含 `services/storage/saveCatalog.ts`、`services/dbService.ts`、`utils/saveTreeView.ts`、`components/features/SaveLoad/SaveLoadModal.tsx`；新增 `tests/unit/saveRoundRetention.test.ts`、`saveJourneyLabel.test.ts`，扩展存档轮换行为测试。

- [x] 写红证：11 个回合且最新回合多次写入时，旧实现只保留六个节点；同名旅程重排不应交换编号；各旅程互相隔离。

```ts
expect(new Set(kept.map(save => save.turnCount)).size).toBe(10);
expect(kept.every(save => save.turnCount >= 2)).toBe(true);
expect(labelBeforeSaving).toBe(labelAfterReordering);
```

- [x] 运行新增测试确认红证。
- [x] 自动保留按 rootId 与有效 turnCount 选择最新十个不同回合，同回合多写不挤占回合；不覆盖分支，旧缺失回合数保守处理。维持手动保存策略和增量基底依赖保护。
- [x] 持久化稳定的旅程序号/分配记录，存档列表与详情统一使用展示名；不改实际玩家姓名，旧 rootId 缺失按原安全隔离分组，不凭名称合并。
- [x] 运行纯函数测试及 IndexedDB/桌面回归，证明窗口内节点可读取、不同 root/分支不互相覆盖、增量依赖保留。
- [x] 规格与质量专项审查；本轮最终交叉审查与全量验证另行进行。

## 最终验证与交付

- [x] `pnpm exec tsc -b --force`：零 TypeScript 错误。
- [x] 以 `.tmp-regression` TEMP 运行 `pnpm test`：读取最终退出码与各阶段完整结果；不并发构建。
- [x] 对本轮修改文件执行 scoped ESLint；区分既有警告与新增错误。
- [x] 根据规格逐项验收并更新本文件勾选；记录红证、绿证、未验证真实 API/设备和旧删除记录限制到 `docs/reviews/2026-10-10-phone-facts-save-history.md`。
- [x] 汇报实际完成范围和验证数字，不把修改代码等同于真实供应商端到端验证，不执行 Git 提交/合并/推送。
- [x] 独立整体交叉复审：2026-10-11 新建只读审查者完成整体复审及修复后定向复审，结论 Ready to merge: Yes；先前额度中断不算通过。发现、红绿及限制见 `docs/reviews/2026-10-11-independent-workspace-review.md`。本轮合并是用户后续明确要求，不改变原计划禁止自行推送的边界。
