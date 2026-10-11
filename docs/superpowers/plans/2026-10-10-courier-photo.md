# 手机照片与人物视觉资料 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 修复 NPC 生图信息缺项，并在手机中提供玩家确认的照片生成和相册归档。

**Architecture:** 人物视觉事实在纯函数层统一读取，模型和精简层使用同一结构。手机新增独立照片面板和生成 hook，复用现有队列/接口/资源表；消息只存图片引用，提交通过 session 和目标身份守卫。

**Tech Stack:** React、TypeScript、Vitest/jsdom、现有 imageGeneration 与 imageTaskQueue，无新依赖。

## Task 1：人物视觉资料

Files: `utils/imageCharacterFacts.ts`（新增）、`utils/imagePromptRules.ts`、`utils/imagePromptCompaction.ts`、`services/ai/imagePromptTokenizer.ts`、`services/ai/storySnapshotPipeline.ts`、`components/features/GameSystems/album/workspaces.tsx`、`components/features/GameSystems/AlbumPanel.tsx`；tests: `tests/unit/imageCharacterFacts.test.ts`。

- [x] 红证：构造女 NPC，概括外貌未写发色，`外貌档案.发色.value = '银白'`、`瞳色.value = '紫'`，验证最终 compact 提示词包含姓名、性别、银白、紫；缺失数值不出现，关闭锚点不强制恢复锚点。
- [x] 运行 `pnpm exec vitest run tests/unit/imageCharacterFacts.test.ts`，确认因遗漏字段失败。后续补充旅人顶层身高丢失、快照模型虚构数值/冲突颜色的红证。
- [x] 建立 `readImageCharacterFacts(character)` 视觉资料读取，输出姓名/性别/appearanceDetails；`readImagePromptCharacter` 携带这些字段。当地模板、档案 sourceText、转化器 input 和回传 compact 使用同一资料；不发送普通照片无关私密档案。精简为姓名/性别/结构化辨识事实预留空间，不覆盖锚点。共享纯模型清理器同时覆盖转化器、快照逐角色及场景输出，手动/本地路径不受影响。
- [x] 运行新用例及 `tests/unit/imagePromptAutoCompaction.test.ts`，需求复核、代码复核后完成。修复模型单位/三围顺序缺陷；新增真实相册 UI 溢出错误回归，失败显示原因并保留草稿和旧解析结果。独立需求复核与最终代码复核通过。

## Task 2：照片引用与纯状态合并

Files: `models/teyvat/courier.ts`、`services/courierPhoto.ts`（新增）；tests: `tests/unit/courierPhoto.test.ts`。

- [x] 红证：消息附加 `{entryId:'e', assetId:'a', npcId:'n'}` 经 normalize/load 后仍在；原文不变；不同 sender/NPC、缺失目标、已有照片不得覆盖；合并期间新增消息不能丢。
- [x] 为 `CourierMessage` 增加可选 `photo` 引用，用严格字符串白名单规范化；`resolveCourierPhotoTarget(courier, npcs, conversationId, messageId)` 按联系人 ID→npcId 找到真实发言者；`attachCourierPhoto(previous,target,photo)` 按 ID 合并，不替换整个旧会话。联系人实际 `contact` 角色与兼容 `assistant` 角色均可用，系统/玩家消息不可用。
- [x] 运行 `pnpm exec vitest run tests/unit/courierPhoto.test.ts tests/unit/courierWorldMomentDisplay.test.tsx`。

## Task 3：受确认约束的生图和编辑面板

Files: `components/features/Courier/useCourierPhotoGeneration.ts`、`components/features/Courier/CourierPhotoComposer.tsx`、`hooks/useCourierPhotoCommit.ts`（新增）、`CourierMessageTimeline.tsx`、`CourierModal.tsx`、`App.tsx`；tests: `tests/unit/courierPhotoGeneration.test.tsx`、`tests/unit/courierPhotoCommit.test.tsx`。

- [x] 红证：真实手机渲染目标角色“生成照片”按钮；打开不调用图片 API；确认普通接口后生成图片并写入相册、当前消息引用。网络出口使用受控延迟替身，切 session/删消息后释放结果，验证两边不提交。
- [x] App 向手机传入 imageSettings、onAlbumChange（任务状态）与 onCommitPhoto（同一根状态的同步 CAS 确认）。独立 hook 使用 `globalImageTaskQueue`、`generateImage` 和取消信号；local preview 使用 `buildNpcImagePrompt` + current message context + `compactImagePrompts`；引用图沿用生产参考图辅助函数，不导入庞大相册 workspaces。
- [x] composer 只在确认后调用生图，按钮禁用防连点；错误保留草稿，取消中止。结果先核验 live session/目标，再创建相册 asset/entry，通过单一根状态事务同时更新相册与手机；不采用两个 setter 的半提交。photo 字段只含引用。timeline 用 `解析相册资源引用` 渲染图片及放大查看。事务拒绝时任务标取消，不虚报成功。
- [x] 运行真实组件 jsdom UI 测试，覆盖取消、失败重试、已有照片、group sender、未配置接口和非 NPC 消息；完成需求与代码复核。新增预览改绑失效、不可变活体目标删除及启用生图后的消息 memo 回归。

## Task 4：集成验证与交付

- [x] `pnpm exec tsc -b --force`；范围 ESLint 0 错误、7 条既有 warning。
- [x] 设置 TEMP/TMP 到本项目 `.tmp-regression` 后 `pnpm test`，最终命令 exit 0：291 文件 / 2059 单测、192/192 脚本回归、构建及发布/体积门禁通过。完整结果与既有 warning 见交付记录。
- [x] 若新增 chunk 触发体积门禁，按现有动态载入边界延迟照片面板，不提高门禁阈值。实测触发后，将只有手机/相册/正文插图懒入口使用的 courierPhoto、imagePromptTokenizer、storySnapshotPipeline 交回 Rollup 的自然分包；保留体积预算不变。
- [x] 编写 `docs/reviews/2026-10-10-courier-photo.md`，说明操作、验证数字和未调用真实模型的边界。不提交或合并已有工作区。
