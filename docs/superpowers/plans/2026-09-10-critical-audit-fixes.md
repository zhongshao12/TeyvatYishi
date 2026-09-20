# Critical Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the confirmed credential leak and repair the desktop updater repository configuration before addressing lower-severity audit findings.

**Architecture:** Sanitize diagnostic URLs at the persistence boundary so every current and future API caller is protected. Keep the public GitHub repository identifier consistent across the Tauri updater, runtime release information, and release scripts.

**Tech Stack:** TypeScript, Vitest, Tauri JSON configuration, Node.js release scripts.

---

### Task 1: Sanitize API error report URLs

**Files:**
- Create: `tests/unit/apiErrorReportService.test.ts`
- Modify: `services/ai/apiErrorReportService.ts`
- Modify: `scripts/api-error-reports-regression.mjs`

- [ ] **Step 1: Write the failing test**

Add behavior tests that require `key`, `api_key`, `apikey`, `access_token`, and `token` query parameters to be replaced with `[REDACTED]`, while preserving non-secret parameters and tolerating relative or malformed URLs.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm exec vitest run tests/unit/apiErrorReportService.test.ts`

Expected: FAIL because `sanitizeApiErrorReportUrl` does not exist yet and the original secret-bearing URL is returned by the test fallback.

- [ ] **Step 3: Implement the persistence-boundary sanitizer**

Export `sanitizeApiErrorReportUrl(value: string | undefined)` from `apiErrorReportService.ts` and apply it when assigning `ApiErrorReport.requestUrl`. Parse absolute URLs with `URL`, scrub known secret query keys case-insensitively, and use a conservative regular-expression fallback for non-standard values.

- [ ] **Step 4: Run focused and regression tests**

Run: `npm exec vitest run tests/unit/apiErrorReportService.test.ts`

Run: `node scripts/api-error-reports-regression.mjs`

Expected: both PASS.

### Task 2: Point desktop releases at the public repository

**Files:**
- Create: `tests/unit/desktopReleaseRepository.test.ts`
- Modify: `services/desktop/desktopReleaseInfo.ts`
- Modify: `scripts/desktop-release-rules.mjs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the failing repository consistency test**

Read all three release configuration sources and require `zhongshao12/TeyvatYishi`; reject the obsolete `LingYuYue1/KaiTuoYiShi` identifier.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm exec vitest run tests/unit/desktopReleaseRepository.test.ts`

Expected: FAIL because all three sources still reference the old repository.

- [ ] **Step 3: Update the three configuration sources**

Replace the obsolete repository identifier in the Tauri updater endpoint, runtime desktop release info, and Node release rules.

- [ ] **Step 4: Run focused and desktop regression tests**

Run: `npm exec vitest run tests/unit/desktopReleaseRepository.test.ts`

Run: `node scripts/desktop-edition-regression.mjs`

Expected: both PASS.

### Task 3: Verify the first critical batch

**Files:**
- Verify only; no production changes.

- [ ] **Step 1: Run TypeScript and build checks**

Run: `npm run build`

Expected: PASS outside the restricted sandbox. If esbuild reports `spawn EPERM`, record it as an environment limitation and run `npx tsc -b` separately.

- [ ] **Step 2: Inspect the diff and credential patterns**

Run: `git diff --check`

Run: `rg -n "LingYuYue1/KaiTuoYiShi|models\\?key=" services scripts src-tauri`

Expected: no old repository references; Gemini may still use a key in its upstream request URL, but no persisted diagnostic URL may retain it.
