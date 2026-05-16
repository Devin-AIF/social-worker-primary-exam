
# Analysis Missing Q2 Onwards — Bugfix Design

## Overview

In `crawler_v5.js`, when crawling a 2024 exam paper chapter (e.g. chapter id 14658), Q1's analysis is captured correctly but Q2–Q5 all produce "无解析". The root cause is a two-part failure:

1. **Fingerprint format mismatch**: After Q1 is written, its `resolvedFingerprint` (format `"未知|<analysis text>"`, up to 160 chars) is pushed into `staleFingerprints`. When Q2 loads, the 2024 site's DOM still shows Q1's analysis text. `readQuestionData` computes a 100-char raw-text fingerprint from the DOM node. `isProbablyStale()` fires via `s.includes(current)` — the 160-char pool entry contains the 100-char DOM fingerprint as a substring — so the content is correctly identified as stale and discarded.

2. **Insufficient retry window**: The first-layer retry in `crawlSubject` calls `triggerOfficialAnalysis(page, lastAnalysisFingerprint)` again, but the poll inside waits for `currentFinger !== oldFinger` using the same stale baseline. The 2024 DOM hasn't updated yet, so the poll times out returning `false`, and `readQuestionData` reads the same stale DOM again — still producing "无解析". The second-layer retry (`isRepeatedInHistory`) never fires because `data.resolvedFingerprint` is `"未知|无解析"`, which is not in `staleFingerprints`.

The fix targets two specific locations:

- **`triggerOfficialAnalysis`**: When `oldAnalysisFingerprint` is provided, the function must actively wait for the DOM analysis content to change *away from* the stale fingerprint, not just check once with a short timeout.
- **First-layer retry block in `crawlSubject`** (around line 780): Must loop with increasing wait times when stale content is detected, rather than retrying once with the same parameters.
- **Optionally**: Strip the `"answer|"` prefix when pushing to `staleFingerprints` so the pool stores only the analysis portion, making substring comparisons more precise and avoiding false positives.

The fix must not break 2025 paper crawling, Q1 capture, shared-case (共享题干) exemption, or the genuine "无解析" fallback.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when the crawler navigates past Q1 in a 2024 paper, the DOM still shows Q1's analysis text, `isProbablyStale()` correctly rejects it as stale, but the retry window is too short for the 2024 site to load Q2's actual analysis before the content is read and written.
- **Property (P)**: The desired behavior when the bug condition holds — the crawler SHALL wait for the DOM to update with the current question's own analysis before writing, and SHALL only record "无解析" after all retry attempts are genuinely exhausted.
- **Preservation**: Existing behaviors that must remain unchanged by the fix — 2025 paper crawling, Q1 capture, shared-case exemption, genuine "无解析" fallback, `staleFingerprints` FIFO eviction, and the second-layer `isRepeatedInHistory` retry.
- **`triggerOfficialAnalysis(page, oldAnalysisFingerprint)`**: The function in `crawler_v5.js` (around line 130) that clicks analysis-reveal buttons and polls the DOM for fresh analysis content. Currently polls with a 6-second timeout and returns `false` if the DOM doesn't change.
- **`readQuestionData(page, staleState)`**: The function in `crawler_v5.js` (around line 155) that runs inside the browser context to extract question title, options, answer, and analysis from the DOM. Uses `isProbablyStale()` internally to reject stale content.
- **`isProbablyStale(fingerprint)`**: An inner function inside `readQuestionData` that checks whether a candidate fingerprint matches `oldAnalysisFingerprint` (exact match) or any entry in `staleFingerprints` (exact or substring match via `s.includes(current)` / `current.includes(s)`).
- **`staleFingerprints`**: A FIFO pool (max 3 entries) in `crawlSubject` that stores `resolvedFingerprint` values from recently written questions. Format: `"answer|analysis"`, up to 160 chars each.
- **`resolvedFingerprint`**: The composite fingerprint `"${finalAnswer}|${finalAnalysis}".replace(/\s/g,'').substring(0,160)` returned by `readQuestionData` and stored in `staleFingerprints` after a question is written.
- **`analysisFingerprint`**: The 100-char raw-text fingerprint of the analysis DOM node, returned by `readQuestionData` and stored as `lastAnalysisFingerprint` in `crawlSubject`. Used as `oldAnalysisFingerprint` in the next question's `triggerOfficialAnalysis` call.
- **`lastAnalysisFingerprint`**: The variable in `crawlSubject`'s main loop that holds the previous question's `analysisFingerprint`. Passed to `triggerOfficialAnalysis` and `readQuestionData` for stale detection.
- **2024 site behavior**: The 2024 exam site does NOT clear the analysis DOM between questions. Q1's analysis text lingers in the DOM while Q2's analysis is loading, causing the stale detection to fire.
- **2025 site behavior**: The 2025 exam site clears the analysis DOM between questions, so `isProbablyStale()` never fires and the bug does not occur.

---

## Bug Details

### Bug Condition

The bug manifests when the crawler navigates from Q1 to Q2 (and onwards) in a 2024 exam paper chapter. The 2024 site's DOM still shows Q1's analysis text while Q2's analysis is loading. `readQuestionData` computes a 100-char raw-text fingerprint from the DOM node and passes it to `isProbablyStale()`. The stale pool contains Q1's `resolvedFingerprint` in the format `"未知|<analysis text>"` (up to 160 chars). Because `s.includes(current)` is true (the 160-char pool entry contains the 100-char DOM fingerprint as a substring), the content is rejected as stale. The first-layer retry then calls `triggerOfficialAnalysis` again with the same `lastAnalysisFingerprint` baseline, but the 2024 DOM hasn't updated yet, so the poll times out and the same stale DOM is read again — producing "无解析".

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type QuestionReadAttempt
         X.questionIndex         — 1-based question number (Q1 = 1, Q2 = 2, ...)
         X.domAnalysisRawText    — raw innerText of the analysis DOM node at read time
         X.staleFingerprints     — pool of resolvedFingerprints from previously written questions
                                   (format: "answer|analysis", up to 160 chars each)
         X.lastAnalysisFingerprint — 100-char raw-text fingerprint from the previous question's DOM
  OUTPUT: boolean

  // Bug fires when ALL of the following hold:
  //   (a) we are past Q1 (stale pool is non-empty)
  //   (b) the DOM still shows a previous question's analysis text
  //   (c) isProbablyStale() rejects it via the s.includes(current) substring match
  //   (d) the retry window is too short to load the real content

  domFingerprint ← X.domAnalysisRawText.replace(/\s/g, '').substring(0, 100)

  IF X.questionIndex > 1
     AND X.staleFingerprints is non-empty
     AND EXISTS s IN X.staleFingerprints WHERE s.includes(domFingerprint)
     AND triggerOfficialAnalysis_timesOut(X.lastAnalysisFingerprint)
  THEN
    RETURN true
  END IF
  RETURN false
END FUNCTION
```

### Examples

- **Q2 in chapter 14658**: DOM shows Q1's analysis text (`"参考答案：1、同伴教育亦称为同伴教学..."`). `domFingerprint` = first 100 chars of that text. `staleFingerprints[0]` = `"未知|参考答案：1、同伴教育亦称为同伴教学..."` (160 chars). `s.includes(current)` is `true`. Content rejected. Retry times out. Result: "无解析". **Expected**: wait for DOM to update, then read Q2's actual analysis.
- **Q3–Q5 in chapter 14658**: Same pattern. `staleFingerprints` still contains Q1's fingerprint (never evicted because Q2–Q5 all produce `"未知|无解析"` which is only 8 chars, below the 30-char threshold for pool insertion). Result: "无解析" for all. **Expected**: each question's own analysis captured correctly.
- **Q1 in any chapter**: `staleFingerprints` is empty. `isProbablyStale()` returns `false`. Analysis captured correctly. **Expected (unchanged)**: continues to work.
- **2025 paper, any question**: DOM clears between questions. `domFingerprint` does not match any pool entry. `isProbablyStale()` returns `false`. **Expected (unchanged)**: continues to work.
- **Edge case — genuinely missing analysis**: After all retries are exhausted and the DOM still shows no valid analysis (or shows a placeholder), the system records "无解析". **Expected (unchanged)**: fallback preserved.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- 2025 paper crawling must continue to capture all questions' analyses correctly without regression (DOM clears between questions; stale check never fires).
- Q1 of any chapter must continue to be captured correctly (`staleFingerprints` is empty; unaffected by this fix).
- Questions that genuinely have no analysis on the server must continue to be recorded as "无解析" after all retries are exhausted.
- Shared-case (共享题干) questions must continue to apply the existing exemption logic that allows shared analyses across sub-questions.
- The second-layer `isRepeatedInHistory` retry in `crawlSubject` must continue to fire when `data.resolvedFingerprint` is already in `staleFingerprints`.
- The `staleFingerprints` FIFO eviction (max 3 entries) must continue to work correctly.

**Scope:**
All inputs that do NOT involve the bug condition (i.e., where `isBugCondition(X)` returns `false`) must be completely unaffected by this fix. This includes:
- 2025 paper questions (DOM clears between questions)
- Q1 of any chapter (empty stale pool)
- Questions where `isProbablyStale()` returns `false` for any other reason
- Questions where `triggerOfficialAnalysis` succeeds within the existing timeout

**Note:** The actual expected correct behavior for buggy inputs is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

---

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are confirmed (not merely hypothesized) by the debug log:

1. **`resolvedFingerprint` format includes the answer prefix**: `staleFingerprints` stores `"未知|参考答案：..."` (160 chars). The DOM fingerprint is just `"参考答案：..."` (100 chars). The `s.includes(current)` check in `isProbablyStale()` correctly identifies this as stale — this part is working as intended. The real problem is what happens *after* the stale detection.

2. **`triggerOfficialAnalysis` retry uses the same stale baseline**: The first-layer retry in `crawlSubject` calls `triggerOfficialAnalysis(page, lastAnalysisFingerprint)` where `lastAnalysisFingerprint` is Q1's 100-char DOM fingerprint. The poll inside `triggerOfficialAnalysis` waits for `currentFinger !== oldFinger`. But the 2024 DOM still shows Q1's text, so `currentFinger === oldFinger`, the poll times out after 6 seconds returning `false`, and `readQuestionData` reads the same stale DOM again.

3. **Single retry is insufficient for the 2024 site's load time**: The 2024 site may need more than 6–9 seconds (3.5s hard wait + 6s poll timeout) to replace Q1's lingering analysis with Q2's actual content. A single retry with the same parameters cannot overcome this.

4. **`staleFingerprints` pool never grows past Q1's entry for this chapter**: Because Q2–Q5 all produce `"未知|无解析"` (8 chars, below the 30-char threshold), they are never added to the pool. The pool stays at `["未知|参考答案：..."]` for the entire chapter, so the stale check fires on every question.

5. **Second-layer retry (`isRepeatedInHistory`) never fires**: It checks `staleFingerprints.includes(data.resolvedFingerprint)`. Since `data.resolvedFingerprint` is `"未知|无解析"` and the pool contains Q1's long fingerprint, there is no match. The second-layer retry is bypassed entirely.

---

## Correctness Properties

Property 1: Bug Condition — Stale DOM Triggers Wait-and-Retry, Not Immediate "无解析"

_For any_ `QuestionReadAttempt` X where `isBugCondition(X)` returns `true` (i.e., past Q1, DOM still shows a previous question's analysis, `isProbablyStale()` fires via substring match, and the 2024 site has not yet loaded the current question's analysis), the fixed crawler SHALL wait for the DOM to update with the current question's own analysis content and SHALL only record "无解析" if all retry attempts are genuinely exhausted without the DOM ever showing valid, non-stale content.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation — Non-Buggy Inputs Produce Identical Results

_For any_ `QuestionReadAttempt` X where `isBugCondition(X)` returns `false` (i.e., 2025 papers, Q1, questions where `isProbablyStale()` does not fire, or questions where `triggerOfficialAnalysis` succeeds within the existing timeout), the fixed crawler SHALL produce exactly the same result as the original crawler, preserving all existing analysis capture, stale detection, shared-case exemption, FIFO eviction, and fallback behaviors.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

---

## Fix Implementation

### Changes Required

Assuming the root cause analysis above is correct:

**File**: `crawler_v5.js`

#### Change 1 — `triggerOfficialAnalysis`: Extend poll timeout and use stale-aware waiting

**Function**: `triggerOfficialAnalysis(page, oldAnalysisFingerprint)`

**Current behavior**: Fires click triggers, waits 3.5s, then polls for `currentFinger !== oldFinger` with a 6-second timeout. Returns `false` if the DOM doesn't change within 6 seconds.

**Specific Changes**:
- Increase the `waitForFunction` timeout from `6000` ms to `15000` ms (or make it configurable). This gives the 2024 site more time to replace Q1's lingering analysis with Q2's actual content.
- Optionally: re-fire the click triggers mid-poll (after ~5 seconds) if the DOM hasn't changed yet, to handle cases where the first click was swallowed by a popup or race condition.
- The poll condition itself (`currentFinger !== oldFinger`) is correct and does not need to change.

**Implementation sketch**:
```javascript
async function triggerOfficialAnalysis(page, oldAnalysisFingerprint = '') {
    const trigger = async () => { /* unchanged */ };
    await handlePopup(page);
    await trigger();
    await page.waitForTimeout(3500);
    const result = await page.waitForFunction((oldFinger) => {
        // ... unchanged poll logic ...
    }, oldAnalysisFingerprint, { timeout: 15000 }).catch(() => false);  // ← 6000 → 15000
    if (!result) {
        // Re-fire triggers once more if poll timed out, then wait a bit longer
        await trigger();
        await page.waitForTimeout(3000);
    }
    return result;
}
```

#### Change 2 — First-layer retry in `crawlSubject`: Loop with increasing waits

**Location**: `crawlSubject`, around line 780 (the `if (data.analysis === '无解析' || ...)` block)

**Current behavior**: Retries once with the same `lastAnalysisFingerprint` and a 1.2–2.2s sleep. If the retry still produces "无解析", gives up.

**Specific Changes**:
- Replace the single retry with a loop of up to N attempts (suggested: 3 attempts).
- Each attempt: re-trigger analysis, wait with increasing delay (e.g., 2s, 4s, 6s), then re-read.
- Break out of the loop as soon as a non-stale, non-"无解析" result is obtained.
- After exhausting all attempts, fall through to the existing write logic (which will write "无解析" as the last resort).

**Implementation sketch**:
```javascript
if ((data.analysis === '无解析' || data.analysis === '无解析 (抓取冲突已拦截)') && lastAnalysisFingerprint) {
    const MAX_STALE_RETRIES = 3;
    const STALE_RETRY_DELAYS = [2000, 4000, 6000];
    for (let attempt = 0; attempt < MAX_STALE_RETRIES; attempt++) {
        await handlePopup(page);
        await triggerOfficialAnalysis(page, lastAnalysisFingerprint);
        await randomSleep(STALE_RETRY_DELAYS[attempt], STALE_RETRY_DELAYS[attempt] + 1000);
        const retried = await readQuestionData(page, {
            oldAnalysisFingerprint: lastAnalysisFingerprint,
            staleFingerprints,
            oldTitleFingerprint: lastTitleFingerprint
        });
        if (retried.analysis !== '无解析' && retried.analysis !== '无解析 (抓取冲突已拦截)') {
            data = retried;
            break;
        }
    }
}
```

#### Change 3 (Optional) — `staleFingerprints` pool: Store only the analysis portion

**Location**: `crawlSubject`, the block that pushes to `staleFingerprints` after writing a question (around line 870)

**Current behavior**: Pushes `data.resolvedFingerprint` which is `"${finalAnswer}|${finalAnalysis}".replace(/\s/g,'').substring(0,160)`.

**Specific Changes**:
- Strip the `"answer|"` prefix before storing, so the pool contains only the analysis portion (up to 160 chars of the analysis text, without the answer prefix).
- This makes the pool entry format match the DOM fingerprint format more closely, reducing false substring matches.
- Update `isProbablyStale()` accordingly if the comparison logic needs to change (though with this change, `s.includes(current)` would still work correctly since the pool entry would now be a pure analysis fingerprint).

**Implementation sketch**:
```javascript
// When pushing to staleFingerprints:
const analysisOnlyFingerprint = data.resolvedFingerprint.replace(/^[^|]*\|/, '');  // strip "answer|" prefix
if (analysisOnlyFingerprint && analysisOnlyFingerprint.length > 30) {
    if (!staleFingerprints.includes(analysisOnlyFingerprint)) {
        staleFingerprints.push(analysisOnlyFingerprint);
        if (staleFingerprints.length > 3) staleFingerprints.shift();
    }
}
```

**Note**: Change 3 is optional and complementary. Changes 1 and 2 are the primary fix. Change 3 reduces the risk of false positives in `isProbablyStale()` but is not strictly required to fix the bug.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

Because `crawler_v5.js` runs against a live website with Playwright, automated unit tests must mock the browser page object. Property-based tests can generate synthetic `staleState` inputs to verify `isProbablyStale()` and the retry logic in isolation.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate the `readQuestionData` call with a mock page whose analysis DOM node returns Q1's text, and a `staleState` where `staleFingerprints` contains Q1's `resolvedFingerprint`. Assert that the result is "无解析" on unfixed code (confirming the bug) and non-"无解析" on fixed code (confirming the fix).

**Test Cases**:
1. **Stale DOM substring match test**: Call `isProbablyStale` with a 100-char fingerprint that is a substring of a 160-char `staleFingerprints` entry (format `"未知|<analysis>"`). Assert it returns `true` on both unfixed and fixed code (this behavior is correct and must be preserved).
2. **Single retry insufficient test**: Simulate `triggerOfficialAnalysis` returning `false` (poll timeout) and the first-layer retry also returning `false`. Assert that on unfixed code, `data.analysis === '无解析'`. (Will fail on fixed code — that's the fix.)
3. **Multi-retry success test**: Simulate `triggerOfficialAnalysis` returning `false` on the first two attempts but `true` on the third (DOM updates after ~8 seconds). Assert that on fixed code, `data.analysis !== '无解析'`.
4. **Genuine no-analysis test**: Simulate `triggerOfficialAnalysis` always returning `false` and the DOM never showing valid content. Assert that after all retries, `data.analysis === '无解析'` (fallback preserved).

**Expected Counterexamples** (on unfixed code):
- `data.analysis === '无解析'` for Q2–Q5 even when the DOM eventually loads valid content after ~8 seconds.
- Possible causes: single retry with 6-second poll timeout is insufficient; 2024 site needs more time.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result ← crawlSubject_fixed(page, staleState)   // F' = fixed function
  ASSERT result.analysis ≠ '无解析'
         OR allRetriesExhausted(result)           // "无解析" only acceptable after genuine exhaustion
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT crawlSubject_original(page, staleState) = crawlSubject_fixed(page, staleState)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (varying `staleFingerprints` contents, `oldAnalysisFingerprint` values, DOM content lengths).
- It catches edge cases that manual unit tests might miss (e.g., fingerprints exactly at the 30-char threshold, pool at max size of 3).
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for non-buggy inputs (2025 papers, Q1, empty stale pool), then write property-based tests capturing that behavior.

**Test Cases**:
1. **2025 paper preservation**: Simulate `staleFingerprints = []` and DOM showing fresh content. Verify `data.analysis !== '无解析'` on both unfixed and fixed code.
2. **Q1 preservation**: Simulate `staleFingerprints = []` and `oldAnalysisFingerprint = ''`. Verify identical results on unfixed and fixed code.
3. **Shared-case exemption preservation**: Simulate `itemType.includes('共享题干') === true`. Verify `isProbablyStale()` returns `false` on both unfixed and fixed code.
4. **FIFO eviction preservation**: Push 4 entries to `staleFingerprints` and verify the pool stays at max 3 entries on both unfixed and fixed code.
5. **Second-layer `isRepeatedInHistory` preservation**: Simulate `data.resolvedFingerprint` already in `staleFingerprints`. Verify the second-layer retry fires on both unfixed and fixed code.

### Unit Tests

- Test `isProbablyStale()` with exact-match fingerprints (should return `true`).
- Test `isProbablyStale()` with substring-match fingerprints (100-char DOM fingerprint inside 160-char pool entry — should return `true`).
- Test `isProbablyStale()` with fingerprints below the 30-char threshold (should return `false`).
- Test `isProbablyStale()` with shared-case exemption active (should return `false`).
- Test the multi-retry loop: verify it breaks early on first success and exhausts all attempts before falling back to "无解析".
- Test `triggerOfficialAnalysis` with extended timeout: verify it returns `true` when DOM updates after 10 seconds.

### Property-Based Tests

- Generate random `staleFingerprints` arrays (0–3 entries, varying lengths) and random DOM fingerprints. Verify that `isProbablyStale()` returns `true` if and only if the DOM fingerprint is a substring of any pool entry (or exact match), and `false` otherwise — on both unfixed and fixed code.
- Generate random `resolvedFingerprint` values and verify FIFO eviction keeps pool size ≤ 3 on both unfixed and fixed code.
- Generate random sequences of question reads (some buggy, some not) and verify that non-buggy reads produce identical results on unfixed and fixed code (preservation property).

### Integration Tests

- Run the crawler against chapter 14658 (2024 paper) and verify Q2–Q5 all have non-"无解析" analyses after the fix.
- Run the crawler against a 2025 paper chapter and verify all questions continue to be captured correctly (regression check).
- Run the crawler against a chapter with a genuinely missing analysis and verify "无解析" is still recorded after all retries (fallback check).
- Run the crawler against a shared-case (共享题干) chapter and verify the exemption logic continues to work correctly.
