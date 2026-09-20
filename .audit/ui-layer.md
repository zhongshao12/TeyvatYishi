# UI / Rendering Architecture Audit — KaiTuoYiShi (`yuanshen`)

React 19 + TypeScript + Vite + Tailwind. Read-only static analysis, no builds or tests run.
Every claim below cites `file:line` I opened myself, or a repo-wide sweep whose headline numbers I re-verified independently.

---

## 0. Method, and three corrections to the brief's premises

I opened (fully or in outline): `App.tsx`, `index.tsx`, `hooks/useGame.ts`, `hooks/useGameState.ts` (the whole file), `hooks/useTeyvatRuntime.ts`, `models/teyvat/state.ts`, `models/teyvat/runtimeSlices.ts` (relevant parts), `hooks/useGame/sendWorkflow.ts` (streaming + snapshot regions), `utils/streamingMessageStore.ts`, `utils/rafCoalescedSetter.ts`, `utils/lazyWithRetry.ts`, `utils/saveRuntimeCompactor.ts`, `utils/longSessionRetention.ts`, all of `components/features/Chat/*`, `components/layout/GameView.tsx`, `components/ui/Modal.tsx`, `components/ui/ErrorBoundary.tsx`, plus repo-wide regex sweeps via PowerShell over all 403 `.ts/.tsx` files (excluding `node_modules`, `.pnpm-store`, `.tmp-*`).

**Correction 1 — "~24 separate `useState` slices" is out of date.** `hooks/useGameState.ts` now has exactly **14** `useState` calls (`:896, :972-:982, :987, :988`). All of 旅人 / 背包 / 世界 / chatHistory / 记忆 / 手机 / 世界树 / 蒸汽鸟报 / 图鉴 / NPC / 相册 / 剧情 / 剧情编织 / variableBatches / queueTasks / 任务 / turnCount come from **one** `useState<TeyvatGameState>` in `hooks/useTeyvatRuntime.ts:26`. The "parallel `game` object" is not a parallel source of truth — it *is* the source, and the legacy slices are derived adapters. This is materially better than the brief assumes, and §5 analyses the real (different) problem.

**Correction 2 — "116 `<button>` without `type` inside forms causes accidental submits" is not a real risk here.** The repo contains **zero `<form>` elements** (regex `<form\b` over all 403 files → 0). Without a form ancestor, a submit-type button has no submit target, so the practical impact is ~nil. Count re-verified: 408 `<button>` total, **118 without `type=`** (brief said 116 — same ballpark).

**Correction 3 — "only 1 `htmlFor`" understates label coverage.** There are 50 `<label>` elements and only 1 uses `htmlFor` (`components/features/SaveLoad/SaveMigrationDialog.tsx:77`), but this codebase overwhelmingly uses **implicit association by wrapping**: `<label className="block">{label}{children}</label>` (e.g. `components/features/Settings/ApiSettings.tsx:1488-1500`, `components/features/GameSystems/album/workspaces.tsx:2097`, `components/layout/AppPanels.tsx:157-168`). Implicit wrapping is valid HTML and works with AT. The 1-vs-50 raw ratio is misleading.

**Correction 4 — "10 `React.memo`" is 9.** Exact inventory: `ChatList.tsx:60`, `InputArea.tsx:45`, `MessageRenderers.tsx:354,405,528`, `TurnItem.tsx:92`, `LeftPanel.tsx:32`, `RightMenu.tsx:17`, `TopBar.tsx:23`. Note what is **not** in that list: `ChatList` itself, `GameView`, `SystemDrawer`, and **every single file** under `components/features/GameSystems/`, `components/features/SaveLoad/`, and `components/features/Settings/`.

---

## 1. The #1 rendering performance risk

### 1a. What the code gets right (say it plainly)

The token-streaming path is genuinely well designed. **`App` does not re-render per token.**

```
index.tsx:20-26        <ErrorBoundary><App/></ErrorBoundary>
App.tsx:333            const { state, actions } = useGame();
App.tsx:814-976        topBar / leftPanel / rightPanel / chatArea  ← plain JSX element objects,
                                                       re-created on every App render
App.tsx:1215-1222      <GameView topBar leftPanel rightPanel chatArea />
GameView.tsx:19-41     passthrough; {chatArea} lands inside <main>
App.tsx:860-874        <ChatList messages={state.chatHistory} npcRecords={state.NPC} traveler={state.旅人} album={state.相册} … />
```

The only subscriber to stream text is `ChatList`:

```tsx
// components/features/Chat/ChatList.tsx:126
const streamingMessage = useStreamingMessage();
```
```ts
// utils/streamingMessageStore.ts:24-26
export function useStreamingMessage(): string {
  return useSyncExternalStore(subscribeStreamingMessage, getStreamingMessage, getStreamingMessage);
}
```

The writer is frame-coalesced and paced:

```ts
// hooks/useGame/sendWorkflow.ts:2300-2321 (inside onDelta)
streamMessageSetter.set(streamedText);          // :2300 non-streaming mode
…
previewText += chunk;
streamMessageSetter.set(previewText);           // :2321
await waitStreamingPreviewDelay(14, abortController.signal);
```
```ts
// utils/rafCoalescedSetter.ts:31-40
const set = (value: string) => {
  pending = value;
  if (rafId != null) return;
  rafId = requestAnimationFrame(() => { rafId = null; const next = pending; pending = null; if (next != null) commit(next); });
};
```
I verified there is **no React state write inside `onDelta`** (`sendWorkflow.ts:2297-2331` touches only `streamedText`, `previewEpoch`, `previewText`, `visibilityPublisher`, `streamMessageSetter`). So during the stream itself App does not re-render, and the memo shield in front of the transcript holds.

Also already-good: history is windowed to the last 20 assistant turns (`ChatList.tsx:31-42, 157, 185-192`), turns are opt-in contained via `content-visibility` (`TurnItem.tsx:37-40` + `deferOffscreen` at `ChatList.tsx:82`), and the leaf renderers are memoized (`MessageRenderers.tsx:405, 528`).

### 1b. Exactly what re-renders per token, and the cost of each

Per animation frame (~60/s while streaming) **two components re-render**: `ChatList`, and the streaming `TurnItem`.

**(1) `ChatList` body — cheap.** Its 8 hooks are cache hits while `messages` identity is unchanged (`ChatList.tsx:181-202`), so this is element allocation for one subtree.

**(2) The streaming `TurnItem` — forced, correct.** `ChatList.tsx:298-314` builds a **new object literal every frame**:
```tsx
{streamingMessage && (
  <TurnItem
    message={{
      id: 'streaming',
      role: 'assistant',
      content: streamingMessage,
      timestamp: Date.now(),          // new identity, every frame
      isStreaming: true,
    }}
    isStreaming … />
)}
```
This defeats `memo(TurnItemImpl)` (`TurnItem.tsx:92`) — which is what we want, since the content changed. The cost is inside it.

**(3) `StreamingPreview` re-parses the entire accumulated buffer every frame.**
```tsx
// components/features/Chat/MessageRenderers.tsx:711-725
export function StreamingPreview({ content, … }) {
  const bodyText = useMemo(() => extractStreamingNarrativeBody(content), [content]);
  …
  <BodyBlock content={bodyText} … />
}
```
`extractStreamingNarrativeBody` (`:602-656`) is a **full O(n) rescan from offset 0 on every frame**: a char-by-char state machine (`:608-654`) that, for **every already-closed body block**, allocates `raw.slice(itemStart, itemEnd)` (`:641`) and runs `JSON.parse` (`:641`). A 20-block body at 60 fps = ~1,200 `JSON.parse` + slice allocations per second, for output that is byte-identical between frames (the function only ever emits *closed* blocks — the partial tail is discarded).

Then `BodyBlock` (`:549-594`) re-runs:
- `parseBodyLines(content, traveler, userInput)` (`:550` → `:163-201`): `normalizeInlineSpeakerTags` on the full text, then `split(/\r?\n/)` + `flatMap` with 4 regexes (`NARR_RE/DIAG_RE/INNER_RE/NAMED_DIAG_RE`, `:104-107`) and per-line `extractFullQuotedSpeech` / sound-effect set lookups;
- `buildNpcLookupMap(npcRecords)` (`:552`) — memoized on `npcRecords`, survives normally;
- the `.map` at `:557-591` allocating one element per line, and **per dialogue line, unmemoized work every frame**: `lookupNpc`, `isProtagonist`, `nameToColor` (hash loop, `:302-308`), `读取NPC头像` ×2, `getDefaultBuiltinAvatar`, and `解析相册资源引用(album, …)` (`:562-569`).

**(4) One forced synchronous layout per frame.**
```tsx
// components/features/Chat/ChatList.tsx:226-229
useLayoutEffect(() => {
  if (pendingHistoryAnchorRef.current) return;
  forceLatestMessage();
}, [forceLatestMessage, historyWasReplaced, loading, streamingMessage, visibleMessages.at(-1)?.id]);
```
`streamingMessage` is in the dep array, so this fires **every frame**, and `forceLatestMessage` (`:151-155`) calls `bottomRef.current?.scrollIntoView({ block: 'end' })`. Inside a layout effect this forces style+layout on a scroll container whose height is changing, before paint. Two separate defects:
- **Perf:** unconditional forced reflow each frame during streaming.
- **UX/correctness:** it ignores `nearBottomRef` (`:129, 139-141`). Scrolling up mid-stream is impossible — the view is yanked back to the bottom every frame, which makes the "回到底部" FAB (`:343-358`) dead code during streaming.

### 1c. The bigger risk: every game-state tick re-renders the whole visible transcript

Per-frame streaming cost is bounded. The unbounded cost is this chain:

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
The author's comment names the exact hazard — but the memo key `[game]` does not hold still:

```ts
// hooks/useTeyvatRuntime.ts:32-34
const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
  setGame((current) => updateTeyvatState(current, updater));
}, []);
// :11-16  updateTeyvatState = normalizeTeyvatGameState(updater(current))
```
```ts
// models/teyvat/state.ts:87-113 — always returns a NEW root object and re-runs 16 normalizers
export function normalizeTeyvatGameState(input: unknown): TeyvatGameState {
  const base = createEmptyTeyvatGameState();
  return { ...base, universe: 'teyvat', schemaVersion: TEYVAT_SCHEMA_VERSION,
    turnCount: …, 旅行者: normalizeTravelerProfile(raw.旅行者), 世界: normalizeTeyvatWorld(raw.世界),
    NPC: normalizeTeyvatNpcRecords(raw.NPC), … 对话: normalizeConversationLog(raw.对话), … };
}
```
```ts
// models/teyvat/runtimeSlices.ts:428-455 — rebuilds EVERY entry object, on every tick
export function normalizeConversationLog(value: unknown): ConversationLog {
  const raw = isRecord(value) ? value : {};
  return { entries: Array.isArray(raw.entries) ? raw.entries.flatMap((entry) => { … return [{ id: …, role, content, … }]; }) : [] };
}
```

So **one `相册` write or one `queueTasks` push re-normalizes the entire game state, including the full conversation log**, and then re-runs all 11 legacy adapters over the new `game` identity. `toLegacyChat` (`useGameState.ts:384-422`) is the expensive one — per message it allocates a fresh object and fresh `parsedResponse.body/choices/factCandidates/continuation` arrays (`:387-395`), a fresh `debugContext.messages` map (`:407`), a fresh `narrativeImages` map (`:420`), and for the snapshot carrier a full `toLegacyTurnCheckpoint` (`:405` → `:363-382`, which itself does `createEmptyTeyvatGameState()` + `normalizeTeyvatGameState()`). `toLegacyTraveler` (`:229-250`), `mapTeyvatNpcsToLegacy` (`:522`), `toLegacyAlbum` (`:601-612`) likewise return fresh objects/arrays every call.

Consequence chain, all memoization defeated despite being written correctly:

| Defeated memo | Site | Why |
|---|---|---|
| `ChatHistoryList` | `ChatList.tsx:60` | `messages` array identity new every tick → prop compare fails |
| `TurnItem` (×20 visible) | `TurnItem.tsx:92` | every `message` object is new |
| `parseBodyLines` | `MessageRenderers.tsx:550` | deps `[content, traveler, userInput]`; `traveler` is new every tick |
| `buildNpcLookupMap` | `MessageRenderers.tsx:552` | `NPC` array is new every tick |
| `DialogueBubble` / `NarrationLine` | `MessageRenderers.tsx:405,528` | `color`/`fontSize` survive, but per-line avatar resolution re-runs upstream |
| `TopBar` / `LeftPanel` / `RightMenu` | `TopBar.tsx:23`, `LeftPanel.tsx:32`, `RightMenu.tsx:17` | all four slices they receive are new every tick |

Triggering ticks are frequent: `setQueueTasks` (`sendWorkflow.ts:759`), narrative image generation writing `相册` (`:956`, `:3253`), NPC compression (`:3192`, `:3229`), `updateGameState` (`:2938`, `:3324`), every memory/variable commit, plus any panel interaction. Each one re-parses **every visible AI turn's body** and rebuilds the NPC map, the album lookups, and the whole transcript's React subtree.

### 1d. The concrete fix (in priority order)

**F1 — stop normalizing the whole state on every mutation** (`hooks/useTeyvatRuntime.ts:32-34`). Normalization already happens inside the setters themselves (`withLegacyChat` calls `normalizeConversationLog`, `useGameState.ts:427`; `withLegacyAlbum` calls `归一化相册系统`, `:615`; `applyLegacyWorldState` calls `normalizeTeyvatWorld`, `:304`; `set剧情` calls `normalizeNarrativeRuntime` via `fromLegacyPlot`, `:955`), and `replaceGameState` (`:28-30`) remains the normalization boundary for load/migration. So:
```ts
const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
  setGame((current) => {
    const next = updater(current);
    if (next === current) return current;                 // no-op updaters bail out
    return import.meta.env.DEV ? normalizeTeyvatGameState(next) : next;
  });
}, []);
```
Benefit: removes 16 whole-state normalizer passes per tick. **Effort S**, but needs a regression pass over `tests/unit/teyvatRuntimeReducer.test.ts` (it asserts normalized shapes).

**F2 — memoize the legacy adapters per slice** (`hooks/useGameState.ts:900-912`). With F1 in place, untouched slices keep their reference across unrelated updates, so:
```ts
const chatHistory   = useMemo(() => toLegacyChat(game),        [game.对话]);
const 旅人          = useMemo(() => toLegacyTraveler(game),   [game.旅行者]);
const 世界          = useMemo(() => toLegacyWorld(game),      [game.世界]);
const 相册          = useMemo(() => toLegacyAlbum(game),      [game.相册]);
const NPC           = useMemo(() => mapTeyvatNpcsToLegacy(game), [game.NPC]);
```
plus the same for 记忆 / 剧情 / 剧情编织 / variableBatches / queueTasks / 任务. Benefit: a `queueTasks` or `相册` tick no longer touches `chatHistory`/`旅行者`/`NPC` identities → the transcript memos hold. **Effort S.** If F1 is deemed too risky, the fallback is a self-registering `WeakMap` cache inside `normalizeConversationLog` (`cache.set(input, out); cache.set(out, out);`) so re-normalizing an already-normalized object returns the same reference — **Effort S, lower risk, partial benefit.**

**F3 — make the streaming preview parse incrementally** (`MessageRenderers.tsx:711-713`). `extractStreamingNarrativeBody` only ever returns *closed* blocks, so its output is stable between the frames where no new block closes. Cache on the consumed prefix instead of on the raw string:
```ts
// utils/streamingBodyCache.ts
let lastRaw = ''; let lastConsumed = 0; let lastText = '';
export function extractStreamingNarrativeBodyCached(raw: string): string {
  if (raw === lastRaw) return lastText;
  if (raw.startsWith(lastRaw.slice(0, lastConsumed))) { /* still inside the same partial block */ }
  … // return lastText when no new block closed; otherwise recompute + update cache
}
```
When the output string is reference-equal, `BodyBlock`'s `useMemo([content])` (`:550`) is a cache hit and React bails on all previously-rendered lines — per-frame cost drops from O(all lines) to O(1) plus the new line. **Effort M.**

**F4 — throttle the auto-scroll and respect the user's scroll position** (`ChatList.tsx:226-229, 151-155`). Move `forceLatestMessage()` out of the per-frame `useLayoutEffect`: drive it from a `useEffect` keyed on the *committed message count* (`visibleMessages.length`), and inside it early-return when `nearBottomRef.current === false`, coalescing with `requestAnimationFrame`. **Effort S.** Fixes both the forced reflow and the "can't scroll up while streaming" bug.

**F5 — wrap `ChatList` in `memo`** (`ChatList.tsx:125`) and make `App`'s `rewriteConfig` prop stable (`App.tsx:873` recomputes `configs.find(...)` inline — it returns an existing object so identity is usually stable, but it should be a `useMemo`). Benefit: App re-renders caused purely by scalar state (`loading`, `workflowHint`, `pendingVariable`, `showSettings`, theme) stop re-rendering the transcript. **Effort S.**

Expected combined effect: per-frame streaming work becomes O(new text) instead of O(total text + total DOM), and unrelated state ticks stop re-rendering the transcript at all. That is the single highest-value change in this report.

---

## 2. `App.tsx` — 1530 lines, 19 `useState`, 18 `useMemo`, 22 `useCallback`, 7 `useEffect`, 0 `memo`

### 2a. What it actually does — section map

| Lines | Concern |
|---|---|
| 1-72 | 52 imports; `:53-72` **20 `lazyWithRetry` chunk declarations** |
| 75-282 | 5 pure decorative overlay components: `JourneyLaunchOverlay` (75), `HomeJourneyOverlay` (123), `SaveLoadOverlay` (163), `BookOpenOverlay` (205), `MysteryChatModal` (248) — ~200 lines of starfield/particle CSS art |
| 283-330 | **mid-file imports** (`:283-297`) and 20 animation-timing constants + `wait`/`prefersReducedMotion` helpers (`:299-330`) |
| 332-336 | `useGame()` + `pendingMemoryDraftCount` (a filter over 记忆.失败草稿 on every render) |
| 337-354 | **18 UI `useState`**: 12 boolean modal flags, `settingsInitialTab`, `activeSystem`, 4 transition flags, `recoveryJournal`, `showCommandPalette` |
| 356-367 | 2 bootstrap effects (recovery journal check, idle tavern-preset preload) |
| 371-480 | courier instant-reply workflow (`handleCourierReplyRequest`) — ~110 lines of async orchestration + `updateGameState` surgery, `useCallback(..., [state])` **so it is a new identity on every render** (`:480`) |
| 482-514 | recovery resume/dismiss handlers (`[actions, recoveryJournal, state]` at `:508` — also unstable) |
| 516-552 | derived data: token totals (`:516-520`), keyboard shortcut map (`:521-536`), **command-palette registry mutation during render** (`:538-552`: `clearCommands()` + 8× `registerCommand()` + `listCommands()` inside a `useMemo`) |
| 554-561 | `recoveryBannerElement` |
| 563-571 | game-panel idle preload (see §7-P2.3 for the canceller bug) |
| 573-590 | `storyConflictFacts` memo |
| 592-709 | **18 small event handlers** (`handleMenuSelect`…`handleHomeMysteryChat`), incl. 3 nearly identical transition choreographers `handleHomeNewGame`/`handleHomeLoadSave`/`handleHomeWorldbookManager` (`:670-704`) |
| 711-774 | 8 derived memos: `currentStoryChapter`, `latestRecallSummary`, `latestRecallFullContent`, `latestActiveTask`, `actionOptions`, `canReroll`, `narrativeImageManualEnabled`, `recoveryDraft` — three of them (`:717-746`) each do `[...state.chatHistory].reverse().find(...)` |
| 776-811 | 3 effects (opening-trigger auto-send, GitHub OAuth callback, idle Codex preload) |
| 813-976 | **`topBar` / `leftPanel` / `rightPanel` / `chatArea` slot JSX** — 164 lines, incl. a 56-line prop bag into `renderSystemPanel` (`:916-971`) |
| 979-1136 | **home view** (`DesktopHomeScreen`/`LandingPage` + 8 modals) — 158 lines, largely duplicated with the game view's modal block |
| 1139-1210 | **new-game view** + `handleStartGame` (`:1152-1190`) |
| 1213-1372 | **game view** (`GameView` + `MobileQuickMenu` + 6 modals) |
| 1377-1529 | `renderSystemPanel(id, ctx)` — a 150-line, 40-field context type + switch over 12 system panels |

### 2b. Should it be split? Yes — but the split is mostly *mechanical*, and the win is maintainability, not FPS

`App` is a router + modal orchestrator + slot composer. The 21 `useCallback`s are legitimate (all passed to `memo`'d children), and `actions` from `useGame` are identity-stable by design (`useGame.ts:66-69` `stateRef`, `:537-567` memoized), so App's inline handlers are not the perf problem — §1c is. What App does badly is **volume**: 3 view branches × 8 modals with the `SettingsModal` prop bag copy-pasted verbatim twice (`:1082-1130` and `:1241-1284`).

### 2c. Concrete decomposition

| New file | Moves from App.tsx | Contents |
|---|---|---|
| `components/layout/overlays/*.tsx` | 75-282 | 5 decorative overlays; also hoist `:299-330` timing constants into `overlays/timings.ts` |
| `hooks/useAppModals.ts` | 337-354 | one `useReducer` or a single `{modals, open, close}` object instead of 12 booleans; returns `openSettings(tab?)`, `openSaveLoad()`, … |
| `hooks/useCourierReply.ts` | 371-480 | courier instant-reply workflow (uses `actions` + a `stateRef`-style read so it stops depending on `state`) |
| `hooks/useWorkflowRecovery.ts` | 353, 356-362, 482-514, 554-561 | recovery journal state + resume/dismiss + banner element |
| `hooks/useAppCommands.ts` | 538-552 | command registry (must move out of the render body) |
| `components/layout/GameShellSlots.tsx` | 813-976 | `topBar`/`leftPanel`/`rightPanel`/`chatArea` as real components — see §7-P1.2 |
| `components/layout/SystemPanelHost.tsx` | 908-973, 1377-1529 | `SystemDrawer` + `renderSystemPanel` + its 40-field context type |
| `components/layout/ModalsHost.tsx` | 979-1079, 1224-1371 | all 8 modals in **one** place, with a `view` prop instead of duplicating the `SettingsModal` bag |
| `views/HomeView.tsx`, `views/NewGameView.tsx`, `views/GameViewRoute.tsx` | 979-1136, 1139-1210, 1213-1372 | the three branches |
| `data/animationTimings.ts` | 299-330 | constants |

Result: `App.tsx` ≈ 180 lines (`useGame` → modal host → view switch). **Effort M** (mechanical, low risk, no behaviour change). Do it *after* §1's fixes so the render-frequency changes land first.

---

## 3. Component size & cohesion (>1000-line files)

Line counts below are from `read` (the tool's total), which is authoritative; note `Get-Content | Measure-Object -Line` under-counts because it skips blank lines.

### 3.1 `components/features/Settings/PromptModulesTab.tsx` — **3466 lines**, 16 components in one file, 19 `useState`, 2 `useEffect`, 7 `useMemo`, **0 `useCallback`, 0 `memo`**

| Lines | Concern |
|---|---|
| 30-112 | 8 module predicates + 3 registries (`CALIBRATION_SYSTEM_GROUPS:36`, `WRITING_STYLE_MODULE_IDS:56`, `CATEGORY_COLOR_VAR:104`) |
| 128-201 | SillyTavern sampling-param codec (`extractSamplingParams:130`, `applySamplingParams:146`, `computePresetSwitchApiChange:167`) |
| 205-321 | ST plumbing: slot ids, macro regexes, world_info readers, regex readers/labels |
| 323-368 | `TogglePill` |
| **370-1297** | **`PromptModulesTab` — a 927-line component**: state 374-416, memos 384-424, effects 375-381/425-497, preset import/switch/delete/rename 499-971, tavern-mode JSX 973-1160, module-mode JSX 1162-1297 |
| 1300-1457 | `PresetSwitcher` — **dead code**, no call site repo-wide |
| 1458-1574 | `V1PresetEntriesPanel` — **dead code**; `:423-424` comment says the V1 route is abandoned |
| 1575-2449 | **`V2PresetSwitcher` — 875 lines** (slot table 1851-2100, world_info 2100-2170, regex inspector + dry-run 2170-2445) |
| 2450-2509 / 2510-2546 | `V2PresetStructurePreview` / `MacroInspector` |
| 2549-2948 | `ModuleList`, `SystemGroupSection`, `ModifyLayer` (dnd-kit), `SortableModuleItem`, `ModuleItem` |
| 2949-3192 | `EditorPanel` (243 lines) |
| 3193-3205 / 3207-3409 / 3410-3465 | `Field` / `AddCustomModuleModal` / `SCOPE_OPTIONS` + `ScopeChips` |

Split: `promptModules/moduleMeta.ts` (30-112, 205-321) · `promptModules/samplingParams.ts` (128-201) · `promptModules/hooks/usePromptPresetLibrary.ts` (374-497, 499-971) · `promptModules/hooks/useModuleDraft.ts` (module CRUD + reorder) · `promptModules/V2PresetSwitcher.tsx` → `SlotTable.tsx` / `PresetWorldInfoPanel.tsx` / `RegexInspector.tsx` (1575-2449) · `ModuleListPanel.tsx` (2549-2948) · `ModuleEditorPanel.tsx` (2949-3192) · `AddCustomModuleModal.tsx` (3207-3409). **Delete 1300-1574 (275 lines).** Effort M.

### 3.2 `components/features/Settings/StorageManager.tsx` — **2552 lines**, **57 `useState`**, 4 `useEffect`, 5 `useMemo`, 0 `memo`

`StorageManagerTab` alone spans **:94-1089 (996 lines)** with 57 `useState` (`:95-151`) and 37 async handlers (`:153-888`): save/load/export/import (305-470), desktop probe + 5 directory openers (470-604), update check/install (604-634), mirror/asset/index repair (634-735), diagnostic reports (735-890). Then `DesktopStorageStatus` (`:1415-2202`) is **788 lines with a 55-prop signature** (destructured `:1415-1484`, typed `:1485-1555`), reached from the 55-prop call site at `:947-1017`. `:30-77` is 21 separate `@/services/desktop/*` imports.

Genuinely good: the 21 pure formatters at `:2237-2390` and `:2503-2551` (`formatDesktopSaveMirrorHealth`, `isRestorableDesktopBackup`, `formatSize`, …) contain no JSX and are trivially unit-testable, and `buildSaveTreeGroups` is already extracted to `utils/saveTreeView.ts:29`.

Split: `storage/useSaveCatalog.ts` (catalog + repair + save/load/delete/export/import) · `storage/useDesktopStorage.ts` (`:111-151, 470-888` → returns one `{state, actions}` object, **which is what collapses the 55-prop drill**) · `storage/desktopFormat.ts` (`:2237-2390, 2503-2551`) · `storage/DesktopStorageStatus.tsx` with signature `({ state, actions })`, further split into `DesktopUpdatePanel` / `DesktopMirrorPanel` / `DesktopBackupPanel` / `DesktopDiagnosticsPanel` · `storage/SaveTreePanel.tsx` (`:1149-1340, 2400-2502`). Target: 2552 → ~900. **Effort L.**

### 3.3 `components/features/Settings/ApiSettings.tsx` — **1501 lines**, 16 `useState`, 6 `useEffect`, 2 `useMemo`, 0 `memo`

`ApiSettingsOverviewTab` is **`:411-1486` — a single 1076-line component** (15 `useState` at `:412-427`, 5 `useEffect` at `:435-475`, handlers 477-774, JSX 776-1486 covering: header, new-config row, config list aside, basic fields, model select, aux-API form 1219-1315, max-output tier 1317-1375, recommendation card, connection test, save button). `ApiSettingsTab` (`:282-409`) additionally re-implements `SettingsModal`'s nav shell (mobile `<select>` `:336-347`, desktop `<aside>` `:351-378`), and the `ApiSubview` union (`:79`) duplicates the `apiSubViews` registry keys (`:81-90`).

Split: `api/apiProfile.ts` (pure codec, `:27-57, 59, 186-280`) · `api/useApiProfileSlots.ts` · `api/useAuxApiProfile.ts` (`:92-119, 423-427, 469-495, 660-722`) · `ApiConfigListPanel.tsx` (925-1030) · `ApiConfigDetailForm.tsx` (1032-1215) · `AuxApiForm.tsx` (1219-1315) · `MaxOutputTierPicker.tsx` (1317-1375) · `ConnectionTestPanel.tsx` (1410-1460) · shared `Settings/ui/SubViewShell.tsx`. Target: 1501 → ~350. **Effort L.**

### 3.4 `components/features/GameSystems/album/workspaces.tsx` — **2771 lines**, 22 exported components + ~40 pure functions

Concerns: workspace chrome (60-165), character-anchor workspace + panel (167-576), `CreateWorkspace` + draft canvas (646-958), 2 modals (960-1127), generation-parameter forms (1129-1249), 5 pure atoms (1251-1365), scene/snapshot/courier workspaces + `SceneCreationWorkspaceShell` (1476-2042), 7 UI primitives (2068-2116), and **~700 lines of pure data builders (2118-2771)** with zero hooks/JSX.

Rendering risk: `:209-216` four `records.filter(...)` + a fifth inline at `:336`; `:1141-1149/:1202-1210` rebuild `filter`/object arrays per render; `:1564-1574` creates 3N closures + a nested O(N) map per keystroke inside `context.characters.map`; `:1602-1603` runs `JSON.stringify(..., null, 2)` **inside JSX** (evaluated even while the `<details>` at `:1597` is collapsed). No `content-visibility` on `EntryGrid` (`:622-643`) even though the sibling gallery does have it (`libWorkspace.tsx:194,198`).

Split: `album/workspaces/model.ts` ← 1387-1474 + 2118-2771 (~700 lines, the highest-value single extraction in the whole audit) · `primitives.tsx` ← 578-606, 1251-1365, 2068-2116 · `tabs.tsx` ← 60-142 · `anchors.tsx` ← 144-391, 423-576 · `generation.tsx` ← 646-958, 1129-1249, 1367-1385 · `modals.tsx` ← 960-1127 · `scene.tsx` ← 1476-2066; keep `workspaces.tsx` as a re-export barrel so `AlbumPanel.tsx:44-56`, `libWorkspace.tsx:8-17`, `taskWorkspace.tsx:5` keep working. **Effort M.**

### 3.5 `components/features/GameSystems/PlotPanel.tsx` — **1657 lines**, 11 `useState`, 4 `useEffect`, 10 `useMemo`, 0 `memo`, **23 of the repo's 118 `type`-less buttons**

Concerns: status maps + draft/anchor builders (44-174), state (176-250), **~350 lines of persistence/import/export/decompose orchestration (252-600)**, JSX (602-933), then 16 pure presentational components (935-1657: `HeaderCard`, `StatCard`, `SeriesControl`, `SeriesTree` — unwindowed, `SegmentDetail`, `ManualEditor`, `ConflictPanel`, `CanonDeviationJournal`, …). Only `PlotPanel` is stateful; all 16 inner components are pure props-in/JSX-out — the cheapest large-file split in the repo.

Rendering: `:618-619` two full `.reduce` traversals over all chapters/segments **in JSX props**; `:194` `visibleSeries` unmemoized; `:1069`, `:1140` `.filter` inside render; 10 index-based keys at `:1296, 1302, 1306, 1359, 1372, 1385, 1398, 1411, 1486, 1508` — six of them keyed on **user-editable AI-parsed strings** (`` key={`${event.事件名}_${index}`} ``), so editing a name remounts siblings and drops focus in adjacent inputs. Also `:248-250`:
```tsx
useEffect(() => { setDraft(selectedSegment ? draftFromSegment(selectedSegment) : null); },
          [selectedSegment?.id, selectedSegment?.updatedAt]);
```
Any persist that bumps `updatedAt` silently discards an in-progress manual edit.

Split: `plot/model.ts` (44-174) · `plot/usePlotPanel.ts` (179-250) · `plot/PlotAtoms.tsx` (935-1046) · `plot/SeriesControl.tsx` (1048-1113) · `plot/SeriesTree.tsx` (1115-1213) · `plot/SegmentDetail.tsx` (1215-1431) · `plot/SegmentEditor.tsx` (1433-1517) · `plot/PlotStates.tsx` (1519-1528, 1530-1583, 1646-1657) · `plot/CanonDeviationJournal.tsx` (1585-1644). **Effort M.**

### 3.6 `components/features/SaveLoad/SaveLoadModal.tsx` — **1520 lines**, 19 `useState`, 5 `useEffect`, 6 `useMemo`, 0 `memo`

Concerns: import-preview union + 3 clip constants (1-58), state + focus save/restore (60-99), catalog subscribe/repair (101-158), CRUD + export (160-328), **a correct memo chain (330-386)**, modal shell (388-457), import-preview cards (459-516), left aside + metrics + mini tree map (518-659), tab bar (661-675), list body with 6 states (677-785), right tree selector (788-801), migration dialog portal (804-817), then 17 pure components (821-1412) and 4 async preview helpers (1464-1519).

Rendering: `:359-360` two `.reduce` in the render body outside the memo chain; `:502` `buildSaveTreeTimeline(group)` called **inside the JSX `.map`** so it rebuilds for every tree on every render; `:377-386` `formatTime` re-created per render and passed to `SaveRow` (`:1124, 1215, 1246`) — the most-repeated component in the modal.

Split: `saveLoad/saveListParts.tsx` (821-966, 1041-1072, 1376-1412, 1428-1432) · `saveLoad/SaveTreeParts.tsx` (968-1039, 1136-1374) · `saveLoad/ImportPreviewSection.tsx` (459-482, 804-817) · `saveLoad/saveImportPreview.ts` (35-51, 1464-1519) · `saveLoad/saveListModel.ts` (1414-1462). Target ≈ 450. **Effort M.**

### 3.7 Other >1000-line components not in the brief

- `components/features/GameSystems/CompanionPanel.tsx` — **1247 lines**, 6 `useState`, 0 `memo`; concerns: roster/detail/graph shell (108-234), 4 detail tabs (406-605), visual + NSFW archive panels (607-797), ~700 lines of small presentational helpers (799-1247). 8 index-based keys, four of them on user-editable text (`:843, 1022, 1066, 1141, 1168`).
- `components/features/GameSystems/AlbumPanel.tsx` — **1481 lines**, **34–35 `useState` in one component**, 0 `memo`, and **no inner components at all**: ~1000 lines of handlers + a 300-line JSX tab switch (`:1182-1481`). Render-body work: `:164` and `:193` `find` over all entries/records on every render (i.e. every keystroke in any of the 34 fields), `:364-395` **two full `evaluateReferenceInjection({...album})` service calls in the render body**, `:1326/1381/1417` re-running `generateTargets.find(...)`. Split into `useAlbumPanelState` / `useAlbumGeneration` / `useAlbumAnchors` / `useAlbumPrompt` + one connected component per tab branch. **Effort L.**
- `components/features/ImageGeneration/ImageRuleTemplateEditor.tsx` — ~1400 lines, 22 separate `clipPath: smallClip` uses, one per form control (the clearest case for the shared `Field` primitive in §4).

---

## 4. Duplication in the Settings panels — quantified

All counts below are from repo-wide regex sweeps over `components/features/Settings/**` + `WorldbookManagerModal.tsx`; the three headline numbers (9 / 12 / clip constants) I re-verified with an independent sweep.

### 4.1 `providerOptions` — **9 copies, 3 incompatible shapes**

| # | Site | Shape | Entries |
|---|---|---|---|
| 1 | `ApiSettings.tsx:61-72` | `{value,label,defaultBaseUrl,defaultModel}` | 10 |
| 2 | `IrminsulSettingsTab.tsx:13-24` | same | 10 |
| 3 | `MemorySystemSettings.tsx:13-24` | same | 10 |
| 4 | `CodexSettingsTab.tsx:18-29` | `{value,label}` | 10 |
| 5 | `CourierSystemSettingsTab.tsx:17-28` | `{value,label}` | 10 |
| 6 | `SteambirdSystemSettingsTab.tsx:18-29` | `{value,label}` | 10 |
| 7 | `StoryWeavingSettingsTab.tsx:15-26` | `{value,label}` | 10 |
| 8 | `VariableUpdateSettings.tsx:17-28` | `{value,label}` | 10 |
| 9 | `ImageGenerationSettingsTab.tsx:56-68` | `{value: AI提供商 \| '', label}` | **11** (prepends `跟随主 API`) |

Copies 1-3 are byte-identical; copies 4-8 are byte-identical to each other. Adding one provider today means editing 9 files, and 9 render sites depend on them (`ApiSettings.tsx:953, 1107, 1233`, `CodexSettingsTab.tsx:235`, `CourierSystemSettingsTab.tsx:225`, `IrminsulSettingsTab.tsx:412`, `ImageGenerationSettingsTab.tsx:410`, `MemorySystemSettings.tsx:183`, `SteambirdSystemSettingsTab.tsx:205`, `StoryWeavingSettingsTab.tsx:164`, `VariableUpdateSettings.tsx:162`).

### 4.2 clip-path polygons — **88 `polygon(` literals = 33 hoisted consts + 55 inline, across 22 files**

- `clipPath` mentions inside Settings: **435**; `polygon(`: **88**; references to a hoisted const: **380**.
- The 55 inline literals collapse to **10 distinct strings / 8 real shapes**: corner cut at N=2 (×3), 3 (×5), 4 (×18), 6 (×11), 7 (×1), 8 (×11), 10 (×3), 12 (×1), plus **2 rectangle no-ops** (`SettingsModal.tsx:233` `'polygon(0 0, 100% 0, 100% 100%, 0 100%)'` and `ApiSettings.tsx:154` `'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0)'` — clip-paths that do nothing).
- **The same identifier means different shapes in different files**: `VisualSettingsTab.tsx:9-10` declares `smallClip` as **8px**, whereas everywhere else `smallClip` is 6px; `StorageManager.tsx:89-92` declares `cardClip` as **8px** whereas everywhere else `cardClip` is 10px. That is a live drift hazard, not just noise.
- `smallClip` alone is re-declared in **22 files** (`ApiSettings.tsx:74-77`, `PromptModulesTab.tsx:202-203`, `StorageManager.tsx:89-92`, `GameSettings.tsx:16-17`, `CodexSettingsTab.tsx:13-16`, `CourierSystemSettingsTab.tsx:12-15`, `ExtraFeaturesSettingsTab.tsx:9-10`, `ImageGenerationSettingsTab.tsx:31-32`, `IrminsulSettingsTab.tsx:26-27`, `MemorySystemSettings.tsx:26-27`, `NsfwSettingsTab.tsx:11-12`, `SteambirdSystemSettingsTab.tsx:13-16`, `StoryWeavingSettingsTab.tsx:12-13`, `ThemeSettings.tsx:4-5`, `VariableManager.tsx:22-25`, `VariableUpdateSettings.tsx:12-15`, `VisualSettingsTab.tsx:9-10`, `ContextViewer.tsx:13-14`, `TokenStatsPanel.tsx:10`, `KeyboardShortcutsTab.tsx:10`, `NotificationSettingsTab.tsx:9`, `ApiErrorReportsTab.tsx:8-9`). Outside Settings the same pattern continues in `SaveLoadModal.tsx:55-58`, `RecoveryBanner.tsx:10-11`, `DesktopHomeScreen.tsx:47-48`, `NewGameWizard.tsx:40`, `VariableDrawer.tsx:14`.

### 4.3 The "save button + `savedFlash`" block — **12 copies, 3 divergent variants**

`const [savedFlash, setSavedFlash] = useState(false)` at `ApiSettings.tsx:421`, `CodexSettingsTab.tsx:54`, `CourierSystemSettingsTab.tsx:43`, `GameSettings.tsx:90`, `ImageGenerationSettingsTab.tsx:145`, `IrminsulSettingsTab.tsx:57`, `MemorySystemSettings.tsx:41`, `NsfwSettingsTab.tsx:20`, `SteambirdSystemSettingsTab.tsx:44`, `StoryWeavingSettingsTab.tsx:34`, `VariableManager.tsx:299`, `VariableUpdateSettings.tsx:44`.

The flash + timeout logic is copy-pasted verbatim with only the message text and delay differing (`CodexSettingsTab.tsx:111-121` vs `CourierSystemSettingsTab.tsx:97-107`, same body, same 1800 ms; delays are 1800/1600/1400 ms across files). The button JSX comes in two shapes — variant A `w-full py-3 text-sm font-serif tracking-[0.4em]` + `cardClip` (7 files, e.g. `CodexSettingsTab.tsx:334-349`, `IrminsulSettingsTab.tsx:274-290`, `MemorySystemSettings.tsx:396-425`), variant B `sticky bottom-0` + `tracking-[0.32em]` + `smallClip` (`GameSettings.tsx:514-535`, `ImageGenerationSettingsTab.tsx:482-503`, `NsfwSettingsTab.tsx:93-114`) — and two files diverge further (`CourierSystemSettingsTab.tsx:334` hard-codes `boxShadow` with no `savedFlash` branch; `ApiSettings.tsx:1467-1469` uses a different gradient variable). The `{kind:'error'}` banner markup is copied **6 times verbatim** (`CodexSettingsTab.tsx:351-362`, `IrminsulSettingsTab.tsx:294-305`, `SteambirdSystemSettingsTab.tsx:321-332`, `CourierSystemSettingsTab.tsx:341-352`, `VariableUpdateSettings.tsx:316-327`, `MemorySystemSettings.tsx:415-424`). Message shape is inconsistent three ways: `{kind, text}` object, plain string tested with `.includes('失败')`, plain string tested with `.startsWith('保存失败')`. A 13th save path, `ExtraFeaturesSettingsTab.tsx:40-42`, has no flash at all.

### 4.4 Other repeated blocks

| Pattern | Copies | Sites |
|---|---|---|
| `Field` / `FieldRow` label wrapper | 9 | `PromptModulesTab.tsx:3193-3205`, `GameSettings.tsx:540-552`, `CodexSettingsTab.tsx:371-380`, `IrminsulSettingsTab.tsx:574+`, `CourierSystemSettingsTab.tsx:360-369`, `SteambirdSystemSettingsTab.tsx:340-349`, `StoryWeavingSettingsTab.tsx:261-270`, `VariableUpdateSettings.tsx:335+`, `ImageGenerationSettingsTab.tsx:984-992`, `ApiSettings.tsx:1488-1500` |
| `ToggleRow` switch row (inner switch markup byte-identical) | 9 | `GameSettings.tsx:554-611`, `NsfwSettingsTab.tsx:119-176`, `ExtraFeaturesSettingsTab.tsx:137-190`, `CodexSettingsTab.tsx:382-434`, `ImageGenerationSettingsTab.tsx:993-1007`, `CourierSystemSettingsTab.tsx:371-423`, `SteambirdSystemSettingsTab.tsx:351-403`, `StoryWeavingSettingsTab.tsx:272-314`, `VariableUpdateSettings.tsx:357-412`; plus a 10th as `TogglePill` (`PromptModulesTab.tsx:323-368`) and an 11th inline (`PromptModulesTab.tsx:1022-1046`) |
| `handleFetchModels` + `{modelOptions, loadingModels, fetchMessage}` triple | 8 | `CodexSettingsTab.tsx:50-52, 78-109`, `CourierSystemSettingsTab.tsx:39-41, 69-95`, `SteambirdSystemSettingsTab.tsx:40-42, 72-98`, `StoryWeavingSettingsTab.tsx:31-32, 58-84`, `VariableUpdateSettings.tsx:40-42, 73-99`, `MemorySystemSettings.tsx:37-38, 86-106`, `ApiSettings.tsx:416-417, 693-741` |
| `buildXModelLookupConfig` + `ModelLookupConfigInput` | 3 | `CodexSettingsTab.tsx:37-41`, `CourierSystemSettingsTab.tsx:30-34`, `SteambirdSystemSettingsTab.tsx:31-35` |
| `Section` card (byte-identical pair) | 2 | `MemorySystemSettings.tsx:488-508` ≡ `IrminsulSettingsTab.tsx:552-572` |
| Tab registry | 3 | `SettingsModal.tsx:82-95`, `ApiSettings.tsx:81-90`, `ImageGenerationSettingsTab.tsx:39-47` |

Wholesale duplication estimate: **~2,300-2,500 lines** of the ~15,000 Settings lines are copy-paste, removable with no behaviour change.

### 4.5 The exact shared API to introduce

```ts
// data/aiProviders.ts  — replaces 9 arrays
export interface AiProviderMeta { value: AI提供商; label: string; defaultBaseUrl: string; defaultModel: string }
export const AI_PROVIDERS: readonly AiProviderMeta[];
export const AI_PROVIDER_OPTIONS: readonly { value: AI提供商; label: string }[];                    // label-only projection
export const AI_PROVIDER_OPTIONS_WITH_INHERIT: readonly { value: AI提供商 | ''; label: string }[];  // prepends 跟随主 API
export function findProvider(p: AI提供商): AiProviderMeta | undefined;
```

```ts
// components/features/Settings/ui/clip.ts  — replaces 33 consts + 55 inline literals
export const clipPolygon = (n: number): string =>
  `polygon(${n}px 0, 100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 ${n}px)`;
export const clipCard = clipPolygon(10);
export const clipSmall = clipPolygon(6);
export const clipXs = clipPolygon(4);
```

```tsx
// components/features/Settings/ui/SettingsSaveButton.tsx  — replaces 12 copies / 3 variants / 6 banners
export type SaveMessage = { kind: 'info' | 'error'; text: string };
export function useSaveFlash(delayMs = 1800): { savedFlash: boolean; flash(): void; reset(): void };
export function SettingsSaveButton(props: {
  savedFlash: boolean;
  label: string;                       // '◆ 保存游戏设定' | '◆ 保 存 配 置' | …
  savedLabel?: string;                 // default '✓ 已 保 存'
  variant?: 'wide' | 'sticky';
  disabled?: boolean;
  message?: SaveMessage | string | null;
  onSave: () => void | Promise<void>;
}): JSX.Element;
```

```tsx
// components/features/Settings/ui/Field.tsx  — collapses §4.4 rows 1-2
export function Field(props: { label: string; hint?: string; tone?: 'accent' | 'muted' | 'arcane'; children: React.ReactNode }): JSX.Element;
export function ToggleRow(props: { label: string; desc: string; checked: boolean; disabled?: boolean;
  tone?: 'accent' | 'arcane'; clip?: 'small' | 'sm'; onChange: (v: boolean) => void }): JSX.Element;
export function SectionCard(props: { title?: string; children: React.ReactNode }): JSX.Element;

// components/features/Settings/hooks/useModelListFetcher.ts  — replaces 8 copies
export function useModelListFetcher<T extends Pick<API配置项, 'provider' | 'baseUrl' | 'apiKey' | 'model'>>(
  buildLookupConfig: (input: T, id: string, name: string) => API配置项,
): { modelOptions: string[]; loading: boolean; message: SaveMessage | null;
     fetchModels(input: T): Promise<void>; reset(): void };
```

---

## 5. State management architecture

### 5.1 The premise needs restating

There is **one** `useState<TeyvatGameState>` (`hooks/useTeyvatRuntime.ts:26`) holding every game slice, plus **14** scalar `useState`s in `useGameState.ts` for genuinely view-level concerns (view, apiSettings, gameSettings, currentTheme, worldbooks, hasSave, loading, workflowHint, workflowStatus, liveRecallSummary, liveRecallFullContent, pendingVariable, pendingOpeningTrigger, interruptedWorkflow). `game` and the legacy slices cannot "disagree" in the sense of holding divergent values — the slices are pure functions of `game`, recomputed in one memo (`useGameState.ts:900-912`).

### 5.2 Three real problems the design does have

**(a) The adapter layer is O(entire state) on every tick, and it destroys referential stability.** This is §1c. `updateGameState` normalizes the whole game state on every call (`useTeyvatRuntime.ts:32-34` → `updateTeyvatState:11-16` → `normalizeTeyvatGameState`, `models/teyvat/state.ts:87-113`, which rebuilds the full conversation log per `runtimeSlices.ts:428-455`), and then `legacyView` re-derives all 11 slices (`useGameState.ts:900-912`) with deep copies (`toLegacyChat:384-422`, `toLegacyAlbum:601-612`, `toLegacyTraveler:229-250`). Net effect: writing one album asset invalidates the identity of `chatHistory`, `旅人`, `NPC` — and therefore invalidates every `memo` boundary in the UI. **This, not the number of `useState`s, is the architectural cost.**

**(b) There are two parallel state APIs with different semantics for the same data.** `state.set相册(next)` and `state.updateGameState(c => ({...c, 相册: next}))` coexist and are used interchangeably (`App.tsx:934` vs `App.tsx:926, 929, 960, 961`; `sendWorkflow.ts:2938, 3324` vs `:956`). The legacy `setX` path round-trips through `toLegacy*` → `withLegacy*` (`useGameState.ts:921-971`), which is lossy-by-construction in places — e.g. `withLegacyChat:427-464` only writes back a fixed whitelist of fields, so any field present on a legacy message but absent from that whitelist is silently dropped on write. Two APIs also means two mental models for where normalization happens.

**(c) Scalar state and game state are updated in the same async workflows, so "one turn" spans 6-8 separate renders by construction.** Not a bug, but it is why per-tick cost matters: the workflows in `sendWorkflow.ts` interleave `state.setLoading` / `setWorkflowHint` (cheap, don't touch `game`) with `setQueueTasks` / `set相册` / `setNPC` / `updateGameState` (`:759, 956, 3192, 3229, 3253, 2938, 3324`) — each of the latter re-renders the whole transcript today.

### 5.3 Would `useReducer` or a context+selector store be materially better?

**`useReducer`: no, not materially.** `game` is already a single object mutated through one `setGame(current => …)` — the reducer shape is essentially present. Converting to `useReducer` would not by itself fix (a), because the cost is in `normalizeTeyvatGameState` + the adapters, not in dispatch mechanics. The one thing a real reducer would buy is the ability to make *slice-level* bail-outs explicit (`if (nextSlice === state.X) return state`), which you can get with far less churn by fixing (a) directly.

**A context + selector store (Zustand/`useSyncExternalStore` with selectors): yes, materially better for the render path — and the codebase has already proven the pattern works.** `utils/streamingMessageStore.ts` + `utils/toastStore.ts` are exactly this: module singleton + `useSyncExternalStore` (`streamingMessageStore.ts:16-26`), consumed by `ChatList.tsx:126` and `ToastHost.tsx:12`, and callable from non-React service code (`sendWorkflow.ts` pushes toasts at `:2806, 3021, 3199, 3235, 3269, 3410`). The streaming render path is fast *precisely because* it bypasses `App`/`useGameState`. Generalizing that pattern to `game` would let a component subscribe to `s => s.相册` and re-render only when the album identity changes, with no adapter layer at all.

**Honest cost/benefit:**

| Option | Work | Risk | Payoff |
|---|---|---|---|
| **A. Fix identity preservation only** (§1c F1+F2) | ~40 lines in `useTeyvatRuntime.ts` + `useGameState.ts` | Low — behaviour unchanged, only reference stability | Removes O(state) work per tick and restores every existing `memo`. **Best value/effort in this report.** |
| **B. Collapse the dual API** — make `updateGameState` the only writer, keep `setX` as a thin `useCallback` over it (they already are, `useGameState.ts:921-971`), and delete the round-trip adapters for read paths by having components consume *native* `game` slices | M-L: every `state.旅人` / `state.chatHistory` read site changes shape (hundreds of sites) | Medium-high | Removes ~700 lines of adapters, kills the lossy-writeback class of bug, and makes (A) unnecessary for the slices that migrate |
| **C. Full context+selector store for `game`** | L: reintroduce ~15 slice hooks, migrate read sites incrementally (React context per slice or one store + `useStore(selector)`) | Medium | Per-slice subscriptions; no adapter layer; scales to future panels. Overkill as a first step, natural endpoint after B |
| **D. `useReducer`** | S | Low | Almost nothing on its own — skip unless bundled with C |

**Recommended sequence:** A now (days), B incrementally per slice starting with `旅人`/`相册`/`NPC` (which have the fewest read sites and the highest identity churn), then reconsider C only if profiling still shows App-wide re-render pressure. Do **not** do a big-bang rewrite: `useGameState.ts` is 1256 lines of load/migration compatibility with real tests, and the adapter layer is also the *save/load* boundary (`toLegacyTurnCheckpoint`/`fromLegacyTurnCheckpoint`, `:326-382`) — a rewrite risks save compatibility, which is the one thing this app cannot lose.

### 5.4 Concrete migration sketch for (A)

```ts
// hooks/useTeyvatRuntime.ts:32-34
const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
  setGame((current) => {
    const next = updater(current);
    if (next === current) return current;
    return import.meta.env.DEV ? normalizeTeyvatGameState(next) : next;   // normalize at boundaries only
  });
}, []);
```
```ts
// hooks/useGameState.ts:900-912 — replace the single object memo with per-slice memos
const 旅人        = useMemo(() => toLegacyTraveler(game),       [game.旅行者]);
const 世界        = useMemo(() => toLegacyWorld(game),          [game.世界]);
const chatHistory = useMemo(() => toLegacyChat(game),           [game.对话]);
const 记忆        = useMemo(() => toLegacyMemory(game),         [game.记忆]);
const NPC         = useMemo(() => mapTeyvatNpcsToLegacy(game),  [game.NPC]);
const 相册        = useMemo(() => toLegacyAlbum(game),          [game.相册]);
const 剧情        = useMemo(() => toLegacyPlot(game.叙事.plotNodes), [game.叙事.plotNodes]);
const 剧情编织    = useMemo(() => toLegacyStoryWeaving(game.叙事.storyWeaving), [game.叙事.storyWeaving]);
const variableBatches = useMemo(() => toLegacyVariableBatches(game.叙事.variableBatches), [game.叙事.variableBatches]);
const queueTasks  = useMemo(() => toLegacyQueue(game),          [game.后台队列]);
const 任务        = useMemo(() => toLegacyQuest(game),          [game.任务]);
```
Guard rails: (1) `normalizeTeyvatGameState` must still run on `replaceGameState` (`useTeyvatRuntime.ts:28-30`) and after save load / legacy migration; (2) the per-slice setters already normalize their own slice (`useGameState.ts:304, 427, 615`), so malformed AI output is still contained; (3) add a dev-only assertion that `game` slices are structurally valid after each update, then run `tests/unit/teyvatRuntimeReducer.test.ts` and the save round-trip tests.

---

## 6. Accessibility gaps — ranked by real user-facing impact

Repo-wide counts over 403 files: 408 `<button>` (118 without `type=`), 17 `onClick` on non-interactive elements, 1 `htmlFor`, 5 `tabIndex`, 70 `aria-label`, 24 `role=`, 50 `<label>`, 0 `<img>` without `alt`, **0 `<form>`**.

### Rank 1 — Escape does nothing in 7 of the app's ~12 dialogs (real, high impact)

`closeTopModal()` (`components/ui/Modal.tsx:78-82`) dispatches a synthetic Escape that only `Modal`'s own document listener (`:109-117`) understands. Seven dialog-like overlays declare modality without implementing it: `SettingsModal.tsx:224-225`, `SaveLoadModal.tsx:390-391`, `WorldbookManagerModal.tsx:213-214`, `GitHubCloudSaveModal.tsx:258-259`, `SystemDrawer.tsx:25`, `CourierModal.tsx:260`, `CodexManagerModal.tsx:115` (plus `ChatBookmarksPanel.tsx:14`). Four of them copy `Modal`'s overlay class string **verbatim** (`teyvat-modal-overlay fixed inset-0 z-50 flex items-stretch justify-center p-0 md:items-center md:p-4`) while omitting everything that makes it a modal: no focus trap, no focus restore, no Escape. Result: for a keyboard user, Esc closes the settings opened from the command palette but not the settings opened from the right rail, and Tab walks out of the dialog into the page behind. **Rank 1 because it is broken behaviour in the most-used surfaces, and the fix already exists in-repo.**

### Rank 2 — Focus is not trapped in those same dialogs (same root cause)

Consequence of the above. `Modal` does this correctly (`:106-107` initial focus, `:118-136` Tab wrap with a real visibility filter `:59-71`, `:139-152` restore-into-remaining-modal), and those helpers are unit-tested (`tests/unit/modalFocusBehavior.test.ts:13-43`). The other 7 dialogs get nothing.

### Rank 3 — `<div onClick>` backdrops with no keyboard path (17 sites; 3 real)

Most of the 17 are modal backdrops where a real close button and Escape both exist, so they are acceptable with a `role="presentation"`. Genuinely broken ones:
- `components/features/Variable/VariableDrawer.tsx:92-102` — backdrop `<div onClick={() => setOpen(false)}>` with no role/tabIndex/keys, and `SystemDrawer` (which the comment at `:91` claims it mirrors) has no backdrop handler at all.
- `components/features/Chat/CommandPalette.tsx:22` — `onMouseDown` dismissal on the overlay; Escape only works because it is bound to the inner input (`:30-35`), so dismissal dies if focus leaves the input.
- `components/features/Settings/ContextViewer.tsx:142` — **`<tr onClick>`** with no keyboard equivalent; the worst of the three.
- `components/features/Chat/InputArea.tsx:176` — `<span onClick>` to expand the workflow hint, no role/keys (this one is inside the hot input area, so it is also the most-seen).

Two `role="switch"` spans are done properly (`PromptModulesTab.tsx:2908`, `WorldbookManagerModal.tsx:1220` — both have `tabIndex` + `aria-checked`).

### Rank 4 — Unlabeled inputs (2)

`components/features/Chat/CommandPalette.tsx:25-39` — the command input has only a `placeholder` (not an accessible name); also `inputRef` (`:15`) is declared and never used. `TravelerProfileModal.tsx:70-80` — the hidden `<input type="file">` has no label, but it is `display:none`/non-focusable and reached through a labelled button, so severity is low.

### Rank 5 — the 118 `type`-less buttons: **not a user-facing bug today**

Because `<form>` count is 0, these cannot submit anything. It is still worth a mechanical sweep (9 of them are in high-traffic shell components: `Modal.tsx:187`, `ErrorBoundary.tsx:81`, `SystemDrawer.tsx:60`, `RightMenu.tsx:66,129`, `TopBar.tsx:133`, `LandingPage.tsx:318,383`, `VariableDrawer.tsx:57`) — it costs minutes and prevents a nasty surprise if a `<form>` is ever introduced. But it should **not** be presented as an accessibility defect on par with Rank 1.

### Rank 6 — `htmlFor`: mostly a false alarm

49 of 50 labels use implicit wrapping (`<label …>{text}{input}</label>`), which is valid and AT-friendly. Only `SaveMigrationDialog.tsx:77` uses explicit `htmlFor` + `id`. Nothing to fix.

### Rank 7 — `Icons.tsx` uses emoji for 22 "icons"

`components/ui/Icons.tsx` is a flat object of emoji strings, has **zero production importers** (only `stories/Icons.stories.tsx:2`), so it is dead code. The real icon strategy is inline text glyphs (`◆ ✦ ◇ ❖ ⬡ …`) plus one `lucide-react` import (`SettingsModal.tsx:17`). Emoji-as-icon would be an AT problem if it were used; it is not.

---

## 7. Prioritized recommendations

Effort: S ≈ <half a day, M ≈ 1-3 days, L ≈ 1-2 weeks. Ordered by value/effort.

### P0 — do these first (each is small and removes a whole class of cost)

**1. Stop normalizing the entire game state on every mutation.**
`hooks/useTeyvatRuntime.ts:32-34`. Normalize only at boundaries (`replaceGameState` already does, `:28-30`); the per-slice setters already normalize their own slice (`useGameState.ts:304, 427, 615`). Benefit: removes 16 whole-state normalizer passes + a full conversation-log rebuild (`models/teyvat/runtimeSlices.ts:428-455`) per state tick. **Effort S.**
**2. Memoize the 11 legacy adapters per slice.** `hooks/useGameState.ts:900-912`. Benefit: an album/queue/memory write stops invalidating `chatHistory`/`旅人`/`NPC` identity, which restores `ChatHistoryList` (`ChatList.tsx:60`), all 20 `TurnItem`s (`TurnItem.tsx:92`), `parseBodyLines` and `buildNpcLookupMap` (`MessageRenderers.tsx:550,552`), and `TopBar`/`LeftPanel`/`RightMenu`. This is the single biggest rendering win available. **Effort S.** (Depends on 1; if 1 is deferred, use the self-registering `WeakMap` cache in `normalizeConversationLog` instead.)
**3. Remove the per-frame forced scroll + respect user scroll position.** `ChatList.tsx:226-229, 151-155`. Drop `streamingMessage` from the layout-effect deps, gate on `nearBottomRef.current`, coalesce with rAF. Fixes a per-frame forced reflow *and* the "can't scroll up while streaming" bug that makes the FAB at `:343-358` dead. **Effort S.**
**4. Make the streaming preview incremental.** `MessageRenderers.tsx:711-713` + `extractStreamingNarrativeBody:602-656`. Cache on the consumed closed-block prefix so frames that add no closed block reuse the previous string; `BodyBlock`'s memo (`:550`) then bails and only the new line renders. Removes ~1,200 `JSON.parse`/sec plus a full re-parse of every line at 60 fps. **Effort M.**
**5. Fix the dropped `onToggleBookmark` — a real dead button.** `ChatList.tsx:283-295` never passes `onToggleBookmark`, though it is declared (`:15`), forwarded to `ChatHistoryList` (`:48, 64, 84`) and used by `TurnItem.tsx:236`. **The 书签 button on every historical AI turn currently does nothing.** Add `onToggleBookmark={onToggleBookmark}` at `:285`. **Effort S (5 minutes).**

### P1 — structural, high value

**1. `memo` the containers that own the biggest DOM subtrees.** `ChatList` (`ChatList.tsx:125`, plus memoize `rewriteConfig` at `App.tsx:873`), `GameView` (`GameView.tsx:19`), `SystemDrawer` (`SystemDrawer.tsx`), `MobileQuickMenu`, `DesktopHomeScreen`, `LandingPage`. Benefit: App re-renders from scalar state (`loading`, `workflowHint`, `pendingVariable`, `showSettings`, theme) stop touching the transcript and the shell. **Effort S.**
**2. Compose `topBar`/`leftPanel`/`rightPanel`/`chatArea` as components, not JSX objects.** `App.tsx:813-976`. Today they are new element objects on every App render, and they are passed as props into `GameView` — so `GameView` can never be memoized usefully, and each slot is rebuilt unconditionally. Extract `ChatArea`, `TopBarSlot`, `LeftPanelSlot`, `RightPanelSlot` that read `state` themselves. **Effort M.**
**3. Fix the dropped game-panel preload.** `App.tsx:563-571` returns `preloadAll`'s canceller from an effect keyed on `[state.turnCount]`; the cleanup cancels the pending idle callback and the `gamePanelsPreloadedRef` guard (`:565`) prevents rescheduling, so if `turnCount` advances before the idle callback fires (window up to 4 s, `lazyWithRetry.ts:80`), the 12-panel preload never happens. Also `preloadAll`'s canceller only flips a flag and never calls `cancelIdleCallback` (`:85`). **Effort S.**
**4. Route the 7 hand-rolled dialogs through `Modal` (or export a `useModalStack`).** `SettingsModal.tsx:224`, `SaveLoadModal.tsx:390`, `WorldbookManagerModal.tsx:213`, `GitHubCloudSaveModal.tsx:258`, `SystemDrawer.tsx:25`, `CourierModal.tsx:260`, `CodexManagerModal.tsx:115`. Buys Escape, focus trap, focus restore and the stack semantics that `Modal.tsx:12, 78-82, 106-152` already implements and tests, for free. **Effort M.**
**5. Wrap each lazy panel in its own error boundary.** All 14 `<Suspense>` sites in App.tsx have fallbacks (complete coverage), but the only boundary is the root one (`index.tsx:22`), so a second chunk failure after the one allowed reload (`lazyWithRetry.ts:58`) escalates to a full-screen "时间线校准中断" and loses the session. Add a small `PanelErrorBoundary` with a retry that resets state. **Effort M.**

### P2 — cohesion and duplication (maintainability; do them steadily)

**1. Extract the pure model layer from `album/workspaces.tsx`** (`:1387-1474` + `:2118-2771` → `album/workspaces/model.ts`, keep the file as a barrel). ~700 lines leave a 2771-line file with zero behaviour change and the album logic becomes unit-testable. **Effort S.**
**2. Ship the Settings shared primitives** — `data/aiProviders.ts` (9 copies), `Settings/ui/clip.ts` (33 consts + 55 inline literals, and it fixes the `smallClip`=8px vs 6px / `cardClip`=8px vs 10px drift), `SettingsSaveButton` + `useSaveFlash` (12 copies, 3 variants, 6 verbatim banners), `Field`/`ToggleRow`/`SectionCard` (9+9+2 copies), `useModelListFetcher` (8 copies). ~2,300-2,500 of ~15,000 Settings lines removed. **Effort M.**
**3. Split `App.tsx`** per §2c into `views/*`, `ModalsHost`, `GameShellSlots`, `SystemPanelHost`, `hooks/useAppModals|useCourierReply|useWorkflowRecovery|useAppCommands`, `overlays/*`, `data/animationTimings.ts` → ~180 lines. Note `App.tsx:538-552` mutates a global command registry **during render** (`clearCommands()` + 8× `registerCommand()` inside `useMemo`) — move it to an effect. **Effort M.**
**4. Split `StorageManagerTab` (`:94-1089`, 57 `useState`) into `useSaveCatalog` + `useDesktopStorage`,** and give `DesktopStorageStatus` (`:1415-2202`, 788 lines, **55 props**) a `({state, actions})` signature. This is the worst cohesion case in the repo. **Effort L.**
**5. Split `ApiSettingsOverviewTab` (`:411-1486`, 1076 lines)** into `apiProfile.ts` (pure, `:186-280`), `useApiProfileSlots`, `useAuxApiProfile`, `ApiConfigListPanel`, `ApiConfigDetailForm`, `AuxApiForm`, `MaxOutputTierPicker`, `ConnectionTestPanel`. **Effort L.**
**6. Split `AlbumPanel`'s 34-`useState` container** (`:100-1163`) into 4 hooks + per-tab connected components, and memoize the render-body work at `:164, 193, 364-395` (including two full `evaluateReferenceInjection` calls). **Effort L.**

### P3 — mechanical cleanups (batch them into one sweep)

**1. Delete dead code (~426 lines + stubs):** `components/features/Settings/WorldbookManagerModal.tsx` is **3 bytes** (the real one is `components/features/Worldbook/WorldbookManagerModal.tsx`); `PromptModulesTab.tsx:1300-1574` (`PresetSwitcher` + `V1PresetEntriesPanel`, no call sites; `:423-424` says the V1 route is abandoned); `components/ui/Icons.tsx` (22 emoji, only a Storybook importer); `TopBar.tsx:41` computes `buildHeadlines(steambird)` every render and `headlines` is never used (grep finds only `:41` and the definition at `:271`); `CommandPalette.tsx:15` unused `inputRef`; `MobileQuickMenu.tsx:109-113` passes an `item` prop whose `onClick` is never read. **Effort S.**
**2. Replace the 17 index-based keys with stable ids,** prioritizing the six in `PlotPanel.tsx:1359,1372,1385,1398,1411,1508` and `CompanionPanel.tsx:843,1168` that are keyed on **user-editable** names and currently remount siblings (dropping focus) while the user types. **Effort S.**
**3. Add `type="button"` to the 118 buttons** (9 are in shell primitives). Not a live bug (no `<form>` exists) but cheap insurance. **Effort S.**
**4. Apply `content-visibility` to the card grids that lack it** — `workspaces.tsx:622-643` (`EntryGrid`), `taskWorkspace.tsx:74`, `SaveLoadModal.tsx:1206-1221` — using the pattern already proven at `libWorkspace.tsx:194,198`. **Effort S.**
**5. Retire the 21 native `confirm`/`alert`/`prompt` calls** (12 in `PlotPanel.tsx:328, 387, 392, 399, 402, 405, 479, 511, 520, 533, 588, 591`; 4 in `SaveLoadModal.tsx:191, 205, 225, 242`; 3 in `MemoryPanel.tsx:78, 95, 112`; plus `InventoryPanel.tsx:133`, `libWorkspace.tsx:214`) behind a shared `ConfirmDialog`/`PromptDialog` + `useConfirm()` promise API — they are unstyled, blocking, and break the app's visual language. **Effort M.**
**6. Memoize the cheap-but-frequent render-body scans:** `PlotPanel.tsx:618-619` (two `.reduce` in JSX props), `SaveLoadModal.tsx:359-360` and `:502` (`buildSaveTreeTimeline` inside the JSX `.map`), `AlbumPanel.tsx:164, 193, 364-395`, `GameView.tsx:21` (two linear `天气列表.find`s per shell render), `LeftPanel.tsx:261-270`, `LandingPage.tsx:59`. **Effort S.**

---

## 8. Genuinely well-architected — do not "fix" these

- **`components/ui/Modal.tsx` is the best-engineered file in the UI layer.** Modal *stack* (`:12, 104, 141-142`), initial focus into the first *visible* focusable (`:106-107`), Tab trap with a real visibility check that walks `getComputedStyle` up the ancestor chain and has a jsdom escape hatch (`:59-71, 118-136`), focus restore that returns into the remaining top modal (`:139-152`), Escape confined to the top of the stack with `stopPropagation` so the global shortcut cannot double-close (`:111-117`), and `closeTopModal()` (`:78-82`) synthesizing an Escape so "Esc closes only the top" has exactly **one** implementation. The focus logic is exported as **pure functions** (`:23, 30, 45`) and unit-tested (`tests/unit/modalFocusBehavior.test.ts:13-43`). This is a design most codebases get wrong.
- **`utils/streamingMessageStore.ts` (26 lines) is the reason streaming is smooth.** Module singleton + `useSyncExternalStore` (`:16-26`), fed by a rAF-coalescing setter (`utils/rafCoalescedSetter.ts:31-40`), so token text never touches React state and therefore never re-renders `App`. `utils/toastStore.ts` + `ToastHost.tsx` apply the same pattern and are callable from non-React service code (`sendWorkflow.ts:2806, 3021, 3199, 3235, 3269, 3410`).
- **`hooks/useGame.ts:66-69` + `:537-567`** — a `stateRef` kept in a layout effect plus `useCallback(…, [])` for every action means `actions` is identity-stable forever, so the many `memo`'d layout components receive stable callbacks. Deliberate and correct.
- **`ChatList`'s history isolation (`:59-101`) and windowing (`:31-42, 157-192`)** — the comment "Isolated history list: scroll chrome (nearBottom / FAB) must not remap TurnItems" describes a real optimization, correctly implemented, plus `content-visibility` on off-screen turns (`TurnItem.tsx:37-40`).
- **`hooks/useGameState.ts:898-899`** — the comment above `legacyView` names the exact `React.memo`-invalidation hazard (which §1c shows is still live because the memo key churns, but the diagnosis and the shape of the fix are right). `:914` ("直接切片是 game 内部引用…无需 memo") shows the author knew which slices needed memoizing and which did not.
- **`utils/lazyWithRetry.ts`** — single-flight with reset-on-reject (`:39-49`), a URL-marker-bounded single reload (`:25-34`) with cleanup on success (`:54`), `preload()` that never leaks an unhandled rejection (`:63-69`), and `preloadAll` on `requestIdleCallback` with a timeout (`:74-86`). 20 lazy chunks, all 20 with a `<Suspense>` fallback.
- **The GameSystems folder has real pure-function layers**, not just JSX: `workspaces.tsx:2118-2771` (~700 lines of builders with no hooks), `PlotPanel.tsx:99-174`, `InventoryPanel.tsx:68-92` (all five derived views memoized on narrow deps), `SaveLoadModal.tsx:330-386` (one correct memo chain with precise deps), `StorageManager.tsx:2237-2390` + `:2503-2551` (21 pure formatters), and already-extracted shared modules (`data/modelRecommendations.ts`, `services/ai/apiTools.ts`, `utils/saveTreeView.ts`).
- **`workspaces.tsx:1922-2042` `SceneCreationWorkspaceShell`** is the one successful layout abstraction in the GameSystems folder: three workspaces (`:1612-1715`, `:1717-1781`, `:1783-1797`) are 60-100-line configurations of it rather than copies.
- **`workspaces.tsx` + `AlbumPanel` run heavy archive I/O off the render thread** (`exportAlbumInWorker` / `importAlbumInWorker`, progress funnelled to state) and wrap album-wide mutations in `useTransition` (`AlbumPanel.tsx:154, 692, 1246`) — a multi-MB ZIP import cannot jank the panel.
- **`components/features/Settings/SettingsModal.tsx:82-95` + `:128-136`** — one tab registry with icons/subtitles and centralised persistence callbacks, and `TavernPresetsSettingsTab.tsx:14-16` is a correct 16-line mode wrapper rather than a copy. `IrminsulSettingsTab.tsx:366-550` `ApiSection` is the parameterized override block the other 6 model-override tabs should copy.
- **`vite.config.ts:147-161` `manualChunks`** does exact package-name matching with a comment about the pnpm `.pnpm/<pkg>@<ver>/node_modules/<pkg>` layout trap and the `lucide-react`-vs-`react` substring bug it avoids. Worth noting the trade-off: it forces all `/services/`, `/hooks/`, `/models/` into one `chunk-app`, so opening the first panel pulls that whole shared chunk.

---

## 9. Summary of new bugs found (not perf)

| Bug | Site | Impact |
|---|---|---|
| `onToggleBookmark` dropped when rendering the history list | `ChatList.tsx:283-295` (declared/forwarded at `:15, 48, 64, 84`; used at `TurnItem.tsx:236`) | The 书签 button on every historical AI turn is a no-op |
| Auto-scroll ignores user scroll position during streaming | `ChatList.tsx:226-229` → `:151-155` | Cannot read back while the AI is writing; the 回到底部 FAB (`:343-358`) can never take effect |
| Game-panel idle preload can be silently cancelled and never retried | `App.tsx:563-571` + `lazyWithRetry.ts:74-86` | First-time open of the 12 system panels may hit an un-warmed chunk |
| `PlotPanel` draft effect discards in-progress edits | `PlotPanel.tsx:248-250` (deps include `updatedAt`) | Typing in the manual editor can be wiped by a background persist |
| Two clip constants named the same mean different shapes | `VisualSettingsTab.tsx:9-10` (8px) vs 21 other files (6px); `StorageManager.tsx:89-92` (8px) vs others (10px) | Silent visual drift; a "fix one file" change breaks another screen |
| Command registry mutated during render | `App.tsx:538-552` (`clearCommands()` + `registerCommand()` inside `useMemo`) | Global side effect in the render phase; unsafe under concurrent rendering |
| Two `clipPath` values are rectangle no-ops | `SettingsModal.tsx:233`, `ApiSettings.tsx:154` | Dead style, misleading to future readers |
| Dead file: `components/features/Settings/WorldbookManagerModal.tsx` | 3 bytes on disk | Two files with the same name; imports resolve to `features/Worldbook/…` (`App.tsx:57`) |
