# Multi Provider Client Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a stable routing boundary for the multi-model client so provider selection no longer lives inside the 2,500-line transport implementation.

**Architecture:** Add a pure `providerRouting.ts` policy module responsible for resolving explicit provider configuration, endpoint inference, and guarded Claude-compatible routing. `chatCompletionClient.ts` remains the transport facade and consumes a typed `ChatProvider` result.

**Tech Stack:** TypeScript 5.8, Vitest 3, fetch-based provider transports

---

### Task 1: Lock provider routing behavior

- [x] Add `tests/unit/providerRouting.test.ts` before production code.
- [x] Cover explicit providers, endpoint inference for Ark/OpenCode/DeepSeek/Gemini/MiMo, generic OpenAI compatibility, and Claude-compatible mode/model guards.
- [x] Run `pnpm vitest run tests/unit/providerRouting.test.ts` and confirm the missing module fails first.

### Task 2: Extract provider routing

- [x] Add `services/ai/providerRouting.ts` exporting:

```ts
export type ChatProvider = 'mimo' | 'ark' | 'opencode' | 'deepseek' | 'gemini' | 'claude' | 'openai_compatible';
export function isLikelyClaudeModel(model: string): boolean;
export function shouldUseClaudeMessagesApi(config: API配置项): boolean;
export function detectChatProvider(config: API配置项): ChatProvider;
```

- [x] Remove the duplicate routing functions from `services/ai/chatCompletionClient.ts`, import `detectChatProvider`, and replace all `detectProvider` call sites.
- [x] Update Claude compatibility source regression to inspect the routing module while retaining a client integration assertion.
- [x] Run `pnpm vitest run tests/unit/providerRouting.test.ts` plus the provider-specific regression scripts.

### Task 3: Verify transport compatibility

- [x] Run `pnpm build`.
- [x] Run the full unit test suite to catch provider transport regressions.
- [x] Record the passing checks; this workspace has no Git metadata, so no commit step is available.
