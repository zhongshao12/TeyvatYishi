# A01–A06 AI / memory repair evidence (2026-10-09)

## Authorization and gates

The user authorized repair of `PROJECT_AUDIT_2026-10-09.md`. This slice owns A01–A06 only. Existing dirty edits in `chatCompletionClient.ts` and `PromptModulesTab.tsx` were preserved; storage, phone, workflow recovery, state, variable settlement, B08/B09, dependencies, real model APIs, keys, and player saves were not changed by this slice. No commit/push was made.

Skills used: `code-quality-workflow`, `systematic-debugging`, `test-driven-development` (including testing anti-patterns), `verification-before-completion`. Root causes were reproduced using real business functions with synthetic fetch / memory state before production fixes.

Gate decisions: A01/A03/A05/A06 are **Local Fix / Local Fix Only** on their respective behavior paths. A02 and A04 are **Local Fix / Staged Refactor**, limited to source-coverage/retention and catalog lifecycle ownership respectively. A02 was explicitly expanded to `models/teyvat/irminsul.ts` to protect the 600-entry boundary. No rewrite or schema migration. Each stage uses focused tests; original data deletion is only allowed with exact identity, layer, turn, and complete textual fact coverage. Narrow/remove this slice's edits if focused verification regresses; never revert shared dirty work.

## RED → GREEN evidence

| Item | Reproduced RED before implementation | Behavior / decision | GREEN evidence |
| --- | --- | --- | --- |
| A01 | `chatCompletionStreamErrors.test.ts`: 6/6 failed because HTTP 200 partial story resolved successfully after error frames | Shared SSE parsing rejects protocol error payloads and `response.failed`; no `onDone`, one `onError`, diagnostic error report, body teardown. Covers compatible Chat, Claude, Gemini and OpenCode Responses/Messages/Gemini | New 6 + lifecycle 9 passed |
| A02 | Local 15-turn long-input test lost settled result; 225-turn test lost event 7; exact IDs/turns still removed incomplete source. Retry-path additional RED retained an unjustified active coverage claim. Capacity RED dropped originals at 601/650 records | One bounded local excerpt per material, no first-6/8 source cutoff; short excerpts prioritize narrative results. Excerpts explicitly refer to full source archives. Complete fact clauses must match source text, in addition to identity/layer/turn checks; incomplete summaries retain originals and do not claim active complete coverage. Normalizer capacity is soft for uncovered originals; only proven covered sources can be trimmed; pending archives and anchors remain protected | 15/225-turn tests; medium excerpt <2500 characters; incomplete retry; full API promotion and replay; 650-entry JSON roundtrip/re-normalization; proven-covered/pending capacity tests passed |
| A03 | Two failed batches of 15 identical items produced one draft instead of two | Failure-draft deduplication includes `archiveEntryId`; each target has an independent retry and resolved status | Two archives separately retried with real retry function; both active, both drafts resolved |
| A04 | 5 RED tests: stream/non-stream catalog fetch had no signal, catalog body hung after abort, headers had no deadline, pre-aborted cached lookup still succeeded | Optional signal propagated from both chat entrypoints through recovery and cached lookup. One default 45-second deadline spans candidate headers and response body, and abort immediately stops candidates/fallback attempts; reader/listener/timer cleanup | 6 lifecycle tests (including added body-timeout verification), cache credential test, request lifecycle 9 passed |
| A05 | UI switch first → second → off left `topP=0.7` despite undefined original backup | Preserve partial apply, but restore all snapshot keys explicitly, including unset values omitted by JSON serialization; original backup survives repeated switches | UI JSON-serialized backup/repeated switch test plus imported selection/save tests: 6 passed |
| A06 | 5/5 RED tests sent unverified OpenAI/Gemini extension fields | Explicit endpoint capabilities: only `openai_compatible` + HTTPS `openrouter.ai/api/v1` sends documented `repetition_penalty`. No verified endpoint for `max_context_tokens`, so it is omitted. Gemini native and OpenCode Gemini omit `repetitionPenalty`. Stored config values remain intact; message content and output token budgets are not capped/truncated by `maxContext` | Capability 5 + top_p 5 + Tavern request delivery 6 passed |

A02 existing tests that asserted a single upper archive now supply genuinely complete textual API coverage. Their valid full-promotion, provenance and replay assertions remain. Unverifiable legacy capacity tests now assert retention rather than silent deletion. The 650-record focused suite completed in 38 ms in the final run; this is a small synthetic check, not a production benchmark.

## Final focused verification

PowerShell, `login:false`; `TEMP`/`TMP` set to workspace `.tmp-regression`. esbuild spawning required the normal sandbox escalation. An earlier final-run attempt was not executed because approval review hit a usage limit; the user requested continuation after restoration. The fresh continuation run succeeded:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/chatCompletionStreamErrors.test.ts tests/unit/chatCompletionRequestLifecycle.test.ts tests/unit/memoryCompressionCoverage.test.ts tests/unit/irminsulPromotion.test.ts tests/unit/postNarrativeMemoryStage.test.ts tests/unit/memoryWorldMoment.test.ts tests/unit/archiveEntryLimits.test.ts tests/unit/modelCatalogCancellation.test.ts tests/unit/modelCacheCredentialSafety.test.ts tests/unit/tavernPresetSamplingRestore.test.tsx tests/unit/importedTavernPresetSelection.test.ts tests/unit/tavernImportedPresetSave.test.ts tests/unit/chatCompletionSamplingCapabilities.test.ts tests/unit/chatCompletionTopP.test.ts tests/unit/tavernPresetRequestDelivery.test.ts
```

**15 files / 77 tests passed, exit 0**, 2026-10-09 22:39:15 (2.82 s Vitest duration). `git diff --check` for owned tracked files passed (only repository LF→CRLF notices). Scoped ESLint on the 6 non-overlapping production files and 5 new focused test files passed with exit 0 and no findings.

The skill's default full-worktree scope check includes staged/unstaged and untracked shared work: 108 files / 4566 known lines, one unknown-line audit artifact, exit 1 against a single-stage 5-file/200-line preset. This is not evidence of an isolated slice staying inside that aggregate preset; this is an explicitly approved batch with other concurrent repairs and pre-existing dirty work. Final diff inspection of this slice found only authorized behavior paths and their tests. Main agent owns global typecheck, full tests, scripts, build, and final combined scope review.

## Sources and residual risks

Verified parameter schemas: [OpenAI Chat](https://developers.openai.com/api/reference/resources/chat), [Gemini GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig), [OpenRouter parameters](https://openrouter.ai/docs/api_reference/parameters). OpenRouter documents `repetition_penalty`, not `max_context_tokens`; this is request-contract verification, not a real provider 400 test.

- No real-provider/key or live-player-save acceptance was performed.
- Textual source coverage is intentionally conservative: synonymous paraphrases may keep original archives rather than retire them. Large uncovered archives can grow on disk/in memory beyond 600; originals are not indiscriminately added to the model context. Existing bounded recall remains in place. No unlimited full-source summaries or new send-blocking ceiling was added.
- Already lost historic source text cannot be reconstructed by these fixes. Existing old archives lacking verifiable coverage are retained.
- Additional extended gateways require a documented capability entry; unknown endpoints do not receive unverified extension fields.
