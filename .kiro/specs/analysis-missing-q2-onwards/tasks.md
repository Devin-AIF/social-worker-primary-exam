# Implementation Plan

- [-] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Stale DOM Substring Match Causes Immediate "无解析" on Q2+
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing case: `questionIndex > 1`, `staleFingerprints` contains `"未知|参考答案：1、同伴教育亦称为同伴教学..."` (160 chars), DOM analysis node returns the same analysis text (100-char fingerprint is a substring of the pool entry)
  - Create test file at `tests/bug-condition.test.js` using Node.js built-in `assert` (no external framework needed)
  - Extract `isProbablyStale` logic from `readQuestionData` into a testable helper, or test it via a mock page object
  - Test that when `isBugCondition(X)` is true (past Q1, DOM still shows Q1's analysis, `s.includes(current)` fires, `triggerOfficialAnalysis` times out), the result is `data.analysis === '无解析'` on UNFIXED code
  - Simulate `triggerOfficialAnalysis` returning `false` (poll timeout at 6000ms) and the single retry also returning `false`
  - Simulate `readQuestionData` returning `{ analysis: '无解析', resolvedFingerprint: '未知|无解析' }` because stale content was rejected and no fresh content loaded in time
  - Run test on UNFIXED code: `node tests/bug-condition.test.js`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists, i.e. the system does NOT wait long enough and immediately records "无解析")
  - Document counterexamples found: e.g. `{ questionIndex: 2, domAnalysisRawText: "参考答案：1、同伴教育亦称为同伴教学...", staleFingerprints: ["未知|参考答案：1、同伴教育亦称为同伴教学..."] }` → `data.analysis === '无解析'` instead of the actual Q2 analysis
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Inputs Produce Identical Results
  - **IMPORTANT**: Follow observation-first methodology — observe UNFIXED code behavior for non-buggy inputs first
  - Create test file at `tests/preservation.test.js` using Node.js built-in `assert`
  - **Observe on UNFIXED code**:
    - `staleFingerprints = []`, DOM shows fresh content → `data.analysis !== '无解析'` (Q1 / 2025 paper)
    - `staleFingerprints = []`, `oldAnalysisFingerprint = ''` → `isProbablyStale()` returns `false` for any fingerprint
    - `itemType.includes('共享题干') === true` → `isProbablyStale()` returns `false` even when fingerprint matches pool
    - Push 4 entries to `staleFingerprints` → pool stays at max 3 (FIFO eviction)
    - `data.resolvedFingerprint` already in `staleFingerprints` and `length > 30` → `isRepeatedInHistory === true`
  - Write property-based tests using a simple random generator (no external library):
    - For all `staleFingerprints` arrays of length 0–3 with random entries, and a DOM fingerprint that is NOT a substring of any entry: assert `isProbablyStale()` returns `false`
    - For all `staleFingerprints` arrays with length ≤ 3 after any number of pushes: assert pool size never exceeds 3
    - For `questionIndex === 1` (empty pool): assert result is identical on unfixed and fixed code
    - For 2025-style inputs (DOM clears between questions, no stale match): assert result is identical on unfixed and fixed code
  - Run tests on UNFIXED code: `node tests/preservation.test.js`
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 3. Fix for stale DOM causing "无解析" on Q2 onwards in 2024 papers

  - [ ] 3.1 Change 1 — Extend `triggerOfficialAnalysis` poll timeout and add re-fire on timeout
    - In `crawler_v5.js`, locate `triggerOfficialAnalysis` (around line 130)
    - Increase the `waitForFunction` timeout from `6000` ms to `15000` ms
    - After the `waitForFunction` call, if `result` is falsy (poll timed out), re-fire `trigger()` once more and `await page.waitForTimeout(3000)`
    - The poll condition (`currentFinger !== oldFinger`) and the 3500ms hard wait before the poll are unchanged
    - _Bug_Condition: `isBugCondition(X)` where `X.questionIndex > 1` AND `staleFingerprints` non-empty AND `s.includes(domFingerprint)` AND `triggerOfficialAnalysis` times out_
    - _Expected_Behavior: `triggerOfficialAnalysis` gives the 2024 site up to 15 seconds to replace Q1's lingering analysis with Q2's actual content; re-fires click triggers if still stale after the poll_
    - _Preservation: 2025 papers unaffected (DOM clears immediately, poll resolves quickly); Q1 unaffected (empty stale pool, `oldAnalysisFingerprint = ''`); genuine no-analysis fallback unaffected (poll still returns `false` after 15s if no content loads)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.2 Change 2 — Replace single first-layer retry with a loop of up to 3 attempts in `crawlSubject`
    - In `crawler_v5.js`, locate the first-layer retry block in `crawlSubject` (around line 780): the `if ((data.analysis === '无解析' || data.analysis === '无解析 (抓取冲突已拦截)') && lastAnalysisFingerprint)` block
    - Replace the single retry (one `triggerOfficialAnalysis` call + `randomSleep(1200, 2200)` + one `readQuestionData`) with a loop of up to 3 attempts
    - Use increasing delays: attempt 0 → `randomSleep(2000, 3000)`, attempt 1 → `randomSleep(4000, 5000)`, attempt 2 → `randomSleep(6000, 7000)`
    - Each attempt: call `handlePopup`, call `triggerOfficialAnalysis(page, lastAnalysisFingerprint)`, sleep, then call `readQuestionData` with the same `staleState`
    - Break out of the loop as soon as `retried.analysis !== '无解析'` and `retried.analysis !== '无解析 (抓取冲突已拦截)'`
    - If all 3 attempts fail, fall through to the existing write logic (which writes "无解析" as last resort)
    - _Bug_Condition: same as 3.1_
    - _Expected_Behavior: crawler retries up to 3 times with increasing waits (2s, 4s, 6s), giving the 2024 site sufficient time to load Q2's actual analysis_
    - _Preservation: loop only activates when `data.analysis === '无解析'` AND `lastAnalysisFingerprint` is set; Q1 and 2025 papers never enter this branch under normal conditions; genuine no-analysis fallback preserved after all 3 attempts fail_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_

  - [ ] 3.3 Change 3 (Optional) — Strip `"answer|"` prefix when pushing to `staleFingerprints`
    - In `crawler_v5.js`, locate the block that pushes to `staleFingerprints` after writing a question (around line 870)
    - Before pushing `data.resolvedFingerprint`, strip the answer prefix: `const analysisOnlyFingerprint = data.resolvedFingerprint.replace(/^[^|]*\|/, '')`
    - Use `analysisOnlyFingerprint` for the length check (`> 30`), deduplication check, and the push
    - This makes pool entries pure analysis fingerprints (no `"未知|"` prefix), so `s.includes(current)` comparisons in `isProbablyStale()` are more precise and avoid false positives from the answer prefix
    - No changes needed to `isProbablyStale()` itself — `s.includes(current)` still works correctly with pure analysis fingerprints
    - _Bug_Condition: same as 3.1 (this change reduces false positives but is not the primary fix)_
    - _Expected_Behavior: pool stores only the analysis portion; substring comparisons in `isProbablyStale()` are more accurate_
    - _Preservation: FIFO eviction logic (max 3 entries) unchanged; deduplication check unchanged; 30-char threshold unchanged_
    - _Requirements: 2.2, 3.5, 3.6_

  - [ ] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Stale DOM Triggers Wait-and-Retry, Not Immediate "无解析"
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior: when `isBugCondition(X)` is true, the fixed crawler waits for DOM update and only records "无解析" after all retries are genuinely exhausted
    - Run: `node tests/bug-condition.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — the multi-retry loop and extended timeout now give the 2024 site enough time to load Q2's analysis)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Inputs Produce Identical Results
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `node tests/preservation.test.js`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — 2025 papers, Q1, shared-case exemption, FIFO eviction, and second-layer retry all behave identically to unfixed code)
    - Confirm all tests still pass after fix (no regressions)

- [ ] 4. Checkpoint — Ensure all tests pass
  - Run both test files: `node tests/bug-condition.test.js && node tests/preservation.test.js`
  - Confirm Property 1 (Bug Condition) test passes — bug is fixed
  - Confirm Property 2 (Preservation) tests pass — no regressions
  - Optionally: run the crawler manually against chapter 14658 to verify Q2–Q5 now capture real analyses
  - Optionally: run the crawler against a 2025 paper chapter to verify no regression
  - Ensure all tests pass; ask the user if questions arise
