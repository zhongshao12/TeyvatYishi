# New Game API Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在开局确认页清楚显示主模型和可选能力是否已配置，并允许玩家不丢建档草稿地打开 API 设置。

**Architecture:** 纯函数只做本地配置字段判定，不发送网络请求、不展示密钥。向导渲染状态卡并调用设置入口；App 在新建游戏分支承载既有设置弹窗，关闭后保留向导组件。空配置允许继续建档，首回合仍由既有请求错误处理报告接口失败。

**Tech Stack:** React 19、TypeScript、Vitest/jsdom、现有 SettingsModal。

**Spec:** `docs/superpowers/specs/2026-09-23-remaining-player-experience-design.md` 第二批“状态解释与配置引导”。

## Global Constraints

- 不改变已保存的 API/游戏设置结构、酒馆预设优先级或模型供应商路由。
- 不在向导打开时主动调用模型；只有用户在既有设置页主动点击“测试连接”才联网。
- 缺少字段只提示并提供设置入口；玩家可继续建档。UI、日志、测试输出均不回显密钥。
- 保留当前 `codex/` 分支和已有未提交改动；目标文件存在混合 diff 时不做不安全提交。

## Review Focus

- 没有主配置时显示明确警告，但不禁用“开始旅程”。
- `activeConfigId` 指向已删除配置时与当前生成路径一样回退首个配置。
- URL 为相对地址或非 HTTP(S) 协议时显示本地配置问题；localhost 的 HTTP 地址可用。
- 变量 API 局部覆盖字段从主接口继承，不把未填写的覆盖字段误报成缺失。
- 从向导打开设置、保存、关闭后，已输入的旅行者档案不丢失。

---

### Task 1: 本地 API 就绪判定

**Files:**
- Create: `utils/newGameApiReadiness.ts`
- Create: `tests/unit/newGameApiReadiness.test.ts`

**Interfaces:**
- Produces: `evaluateNewGameApiReadiness(apiSettings: API设置, gameSettings: Pick<游戏设置, 'variableApi' | '文生图系统'>): NewGameApiReadiness`，返回主模型、变量处理、图片能力的固定状态和安全中文提示，不含密钥或 URL 原文。

- [ ] **Step 1: 写失败测试。** 覆盖无配置、有效主配置、失效 active ID 回退、缺失字段、非法 URL、localhost URL、变量覆盖继承、生图关闭/开启；断言序列化结果不含配置的密钥。例如：

```ts
const settings = 创建默认游戏设置();
expect(evaluateNewGameApiReadiness({ activeConfigId: null, configs: [] }, settings).main.status).toBe('warning');
expect(evaluateNewGameApiReadiness({ activeConfigId: 'missing', configs: [configuredMain] }, settings).main.status).toBe('ready');
expect(JSON.stringify(evaluateNewGameApiReadiness({ activeConfigId: configuredMain.id, configs: [configuredMain] }, settings))).not.toContain(configuredMain.apiKey);
```
- [ ] **Step 2: 运行 `node node_modules/vitest/vitest.mjs run tests/unit/newGameApiReadiness.test.ts`，确认因新模块不存在而失败。**
- [ ] **Step 3: 实现最小纯函数。** 只读取选中的配置；用 `new URL()` 验证 HTTP(S) Base URL；分别给出 `ready` / `warning` / `disabled` 状态。变量配置按空字段继承主配置；图片未开启显示 `disabled`，开启后按后端已存在的必要字段显示状态，不能把 ComfyUI 的空 API Key 判为必填。接口为：

```ts
interface ReadinessItem { status: 'ready' | 'warning' | 'disabled'; label: string; detail: string }
interface NewGameApiReadiness { main: ReadinessItem; variable: ReadinessItem; image: ReadinessItem }
export function evaluateNewGameApiReadiness(apiSettings: API设置, gameSettings: Pick<游戏设置, 'variableApi' | '文生图系统'>): NewGameApiReadiness;
```
- [ ] **Step 4: 运行定向测试、`node node_modules/typescript/bin/tsc -b --pretty false` 和完整单测。**
- [ ] **Step 5: 若目标文件独立且工作树安全，仅暂存本任务文件提交；否则在执行记录中说明不提交。**

### Task 2: 向导提示与设置入口

**Files:**
- Modify: `components/features/NewGame/NewGameWizard.tsx`
- Modify: `App.tsx`
- Create: `tests/unit/newGameApiReadinessUi.test.ts`

**Interfaces:**
- Consumes: Task 1 `evaluateNewGameApiReadiness`。
- Produces: 向导 `apiSettings?: API设置`、`onOpenApiSettings?: () => void`；在第 4 步展示状态卡与设置按钮。

- [ ] **Step 1: 写失败 UI 测试。** 用真实向导渲染和点击：无配置时展示“主模型未就绪”及设置入口；点击入口调用回调；在同一挂载实例内返回后姓名仍保留；按钮没有主动请求模型；有配置时展示“已配置（尚未测试连接）”。例如：

```ts
await act(async () => root.render(createElement(NewGameWizard, { onStart, onBack, currentTheme: 'mondstadt', apiSettings: { activeConfigId: null, configs: [] }, gameSettings: 创建默认游戏设置(), onOpenApiSettings })));
// 填姓名并逐步点击“下一步”进入总览。
expect(host.textContent).toContain('主模型未就绪');
await act(async () => findButton('打开 API 设置').click());
expect(onOpenApiSettings).toHaveBeenCalledTimes(1);
```
- [ ] **Step 2: 运行 `node node_modules/vitest/vitest.mjs run tests/unit/newGameApiReadinessUi.test.ts`，确认失败是缺少状态卡/入口而非测试环境错误。**
- [ ] **Step 3: 在向导第 4 步新增状态卡，App 向新建游戏分支传入配置和设置回调、渲染既有 SettingsModal；删除仅因配置列表为空就弹 alert 阻止建档的旧门槛。** 设置弹窗与向导同分支并存，不卸载向导；主模型缺项仍在卡片持续提醒。向导属性和核心渲染结构：

```tsx
const readiness = evaluateNewGameApiReadiness(apiSettings ?? { activeConfigId: null, configs: [] }, gameSettings ?? 创建默认游戏设置());
<section aria-label="开局 API 就绪检查">
  <p>主模型{readiness.main.status === 'ready' ? '已配置（尚未测试连接）' : '未就绪'}</p>
  <button type="button" onClick={onOpenApiSettings}>打开 API 设置</button>
</section>
```
- [ ] **Step 4: 运行定向 UI 测试、开局回归脚本、完整单测、TypeScript、变更文件 Lint 和生产构建。**
- [ ] **Step 5: 更新 `PLAYER_EXPERIENCE_ROADMAP.md`，只声明本次确已验证的就绪提示，不宣称整个第二批完成；混合工作树不做不安全提交。**
