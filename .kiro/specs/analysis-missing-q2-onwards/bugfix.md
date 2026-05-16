# Bugfix Requirements Document

## Introduction

In `crawler_v5.js`, when crawling a 2024 exam paper chapter (e.g. chapter id 14658), the first question (Q1) has its analysis ("解析") captured correctly, but every subsequent question (Q2–Q5) is recorded as "无解析" (no analysis). The same crawler works correctly for 2025 exam papers.

The root cause is a fingerprint format mismatch combined with an insufficient retry window:

1. After Q1 is written, its `resolvedFingerprint` (format: `"未知|参考答案：..."`, up to 160 chars) is pushed into the `staleFingerprints` pool.
2. When Q2 loads, the 2024 site's DOM still shows Q1's analysis text in the analysis node. `readQuestionData` computes a 100-char raw-text fingerprint from that DOM node and passes it to `isProbablyStale()`.
3. `isProbablyStale()` compares the 100-char DOM fingerprint against each entry in `staleFingerprints`. Because the stale pool entry is `"未知|<analysis text>"` (160 chars) and the DOM fingerprint is just `"<analysis text>"` (100 chars), the check `s.includes(current)` is true — the pool entry *contains* the DOM fingerprint as a substring. The content is correctly identified as stale and discarded.
4. However, the retry window is too short for the 2024 site to replace Q1's lingering analysis with Q2's actual content. `triggerOfficialAnalysis` polls for `currentFinger !== oldFinger` (where `oldFinger` is the 100-char raw text fingerprint), but since the DOM still shows Q1's text, the poll returns `false` and the retry reads the same stale DOM again. Q2–Q5 are all saved as "无解析".
5. The 2025 site clears the analysis DOM between questions, so the stale check never fires there.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the crawler navigates from Q1 to Q2 (and onwards) in a 2024 exam paper chapter AND the 2024 site's DOM still shows Q1's analysis text while Q2's analysis is loading THEN the system discards the DOM content as stale and records the analysis as "无解析"

1.2 WHEN Q1's `resolvedFingerprint` (format `"answer|analysis"`, up to 160 chars) is in `staleFingerprints` AND the analysis DOM node's 100-char raw-text fingerprint is a substring of that pool entry THEN `isProbablyStale()` returns `true` via the `s.includes(current)` branch, causing the content to be rejected even though it may be the current question's own valid analysis

1.3 WHEN the first-layer retry in `crawlSubject` re-triggers `triggerOfficialAnalysis` with `lastAnalysisFingerprint` (the 100-char raw DOM fingerprint from Q1) as `oldAnalysisFingerprint` THEN the poll inside `triggerOfficialAnalysis` waits for `currentFinger !== oldFinger`, but since the 2024 site has not yet updated the DOM, `currentFinger` still equals `oldFinger`, the poll times out returning `false`, and the subsequent `readQuestionData` call reads the same stale DOM — still producing "无解析"

1.4 WHEN the second-layer retry in `crawlSubject` checks `isRepeatedInHistory` THEN it compares `data.resolvedFingerprint` (160-char `"未知|无解析"`) against `staleFingerprints`, which does not match Q1's fingerprint, so the second-layer retry is never triggered for Q2–Q5

### Expected Behavior (Correct)

2.1 WHEN the crawler navigates from Q1 to Q2 in a 2024 exam paper chapter AND the DOM still shows Q1's analysis text THEN the system SHALL wait for the DOM to update with Q2's own analysis content before reading, rather than immediately discarding the stale content and giving up

2.2 WHEN `isProbablyStale()` detects that the current DOM content matches a fingerprint in `staleFingerprints` THEN the system SHALL treat this as a signal to wait and retry for fresh content, not as a final determination that no analysis exists for the current question

2.3 WHEN the retry mechanism re-triggers analysis loading for Q2 THEN the system SHALL use a sufficiently long wait (or a DOM-change poll) so that the 2024 site has time to replace Q1's lingering analysis with Q2's actual analysis before the content is read and written

2.4 WHEN all retry attempts are exhausted and the analysis is still stale or absent THEN the system SHALL record "无解析" as a last resort (preserving existing fallback behavior)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the crawler processes a 2025 exam paper chapter where the DOM clears between questions THEN the system SHALL CONTINUE TO capture all questions' analyses correctly without regression

3.2 WHEN Q1 of any chapter is processed THEN the system SHALL CONTINUE TO capture its analysis correctly (Q1 has an empty `staleFingerprints` pool and is unaffected by this fix)

3.3 WHEN a question genuinely has no analysis on the server (真正无解析) THEN the system SHALL CONTINUE TO record "无解析" after exhausting retries

3.4 WHEN shared-case (共享题干) questions are processed THEN the system SHALL CONTINUE TO apply the existing exemption logic that allows shared analyses across sub-questions

3.5 WHEN `isProbablyStale()` detects cross-question contamination for a question whose `resolvedFingerprint` is already in `staleFingerprints` THEN the system SHALL CONTINUE TO trigger the existing second-layer retry in `crawlSubject`

3.6 WHEN the `staleFingerprints` pool grows beyond 3 entries THEN the system SHALL CONTINUE TO evict the oldest entry (FIFO), keeping the pool size at most 3

---

## Bug Condition (Pseudocode)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type QuestionReadAttempt
         X.domAnalysisRawText    — raw text found in the analysis DOM node (before fingerprinting)
         X.staleFingerprints     — pool of previously-captured resolvedFingerprints
                                   (format: "answer|analysis", up to 160 chars each)
         X.currentQuestion       — question index (1-based)
  OUTPUT: boolean

  // Bug fires when:
  //   (a) we are past Q1 (stale pool is non-empty), AND
  //   (b) the DOM still shows a previous question's analysis text, AND
  //   (c) isProbablyStale() rejects it via the s.includes(current) substring match, AND
  //   (d) the retry window is too short to load the real content
  domFingerprint ← X.domAnalysisRawText.replace(/\s/g, '').substring(0, 100)
  IF X.currentQuestion > 1
     AND X.staleFingerprints is non-empty
     AND EXISTS s IN X.staleFingerprints WHERE s.includes(domFingerprint)
  THEN
    RETURN true
  END IF
  RETURN false
END FUNCTION
```

```pascal
// Property: Fix Checking — stale DOM should trigger a wait/retry, not an immediate "无解析"
FOR ALL X WHERE isBugCondition(X) DO
  result ← readQuestionData'(page, staleState)   // F' = fixed function
  ASSERT result.analysis ≠ '无解析'
         OR allRetriesExhausted(result)           // "无解析" only acceptable after genuine exhaustion
END FOR

// Property: Preservation Checking — non-buggy inputs unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT readQuestionData'(page, staleState) = readQuestionData(page, staleState)   // F' = F
END FOR
```
