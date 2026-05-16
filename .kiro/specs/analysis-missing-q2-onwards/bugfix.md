# Bugfix Requirements Document

## Introduction

In `crawler_v5.js`, when crawling a 2024 exam paper chapter (e.g. chapter id 14658), the first question (Q1) has its analysis ("解析") captured correctly, but every subsequent question (Q2–Q5) is recorded as "无解析" (no analysis). The same crawler works correctly for 2025 exam papers.

The root cause is that Q1's `resolvedFingerprint` — a long string (> 30 chars) built from its answer and analysis text — is pushed into the `staleFingerprints` pool after Q1 is written. When Q2 loads, the 2024 site's DOM still shows Q1's analysis text in the analysis node while Q2's content is loading. `isProbablyStale()` finds Q1's fingerprint in the pool, correctly identifies the DOM content as stale, and discards it. However, no subsequent retry successfully loads Q2's actual analysis before the question is written, so Q2–Q5 are all saved with "无解析". The 2025 site clears the analysis DOM between questions, so the stale check never fires there.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the crawler navigates from Q1 to Q2 (and onwards) in a 2024 exam paper chapter AND the 2024 site's DOM still shows Q1's analysis text while Q2's analysis is loading THEN the system discards the DOM content as stale and records the analysis as "无解析"

1.2 WHEN Q1's `resolvedFingerprint` (length > 30) is added to `staleFingerprints` AND a subsequent question's analysis DOM node contains text that matches or is included in that fingerprint THEN the system treats the content as a cross-question contamination and rejects it, even if it is the current question's own valid analysis

1.3 WHEN the first-layer retry in `crawlSubject` re-triggers `triggerOfficialAnalysis` with `lastAnalysisFingerprint` (Q1's fingerprint) as the `oldAnalysisFingerprint` argument THEN `isProbablyStale()` still rejects Q1's lingering text, and no fresh analysis content is loaded within the retry window, leaving the analysis as "无解析"

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

3.5 WHEN `isProbablyStale()` detects cross-question contamination for a question whose title fingerprint has already changed THEN the system SHALL CONTINUE TO trigger the existing second-layer retry in `crawlSubject`

---

## Bug Condition (Pseudocode)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type QuestionReadAttempt
         X.domAnalysisText    — raw text found in the analysis DOM node
         X.staleFingerprints  — pool of previously-captured resolvedFingerprints
         X.currentQuestion    — question index (1-based)
  OUTPUT: boolean

  // Bug fires when:
  //   (a) we are past Q1 (stale pool is non-empty), AND
  //   (b) the DOM still shows a previous question's analysis text, AND
  //   (c) the retry window is too short to load the real content
  IF X.currentQuestion > 1
     AND X.staleFingerprints is non-empty
     AND isProbablyStale(normalizeFingerprint(X.domAnalysisText), X.staleFingerprints) = true
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
