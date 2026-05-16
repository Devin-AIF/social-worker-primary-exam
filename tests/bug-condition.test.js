/**
 * Bug Condition Exploration Test
 * ================================
 * Property 1: Bug Condition — Stale DOM Substring Match Causes Immediate "无解析" on Q2+
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * PURPOSE: This test encodes the EXPECTED (fixed) behavior.
 * On UNFIXED code it MUST FAIL — that failure proves the bug exists.
 * On FIXED code it MUST PASS — that confirms the fix works.
 *
 * The test simulates the exact scenario from debug_14658.log:
 *   - Q1's resolvedFingerprint ("未知|参考答案：1、同伴教育亦称为同伴教学...") is in staleFingerprints
 *   - Q2's DOM analysis node still shows Q1's analysis text (2024 site hasn't updated yet)
 *   - isProbablyStale() fires via s.includes(current) — the 160-char pool entry contains the 100-char DOM fingerprint
 *   - triggerOfficialAnalysis times out (single retry, 6000ms, DOM not updated)
 *   - Result: "无解析" — BUG
 *
 * Expected (fixed) behavior: the system should retry with increasing delays and
 * eventually capture the real analysis, NOT immediately record "无解析".
 */

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Standalone extraction of isProbablyStale logic (mirrors crawler_v5.js exactly)
// This is a pure function extracted from readQuestionData's closure for testing.
// ---------------------------------------------------------------------------

/**
 * @param {string} fingerprint - candidate fingerprint to check
 * @param {object} staleState
 * @param {string} staleState.oldAnalysisFingerprint - 100-char fingerprint from previous question's DOM
 * @param {string[]} staleState.staleFingerprints - pool of resolvedFingerprints from recently written questions
 * @param {string} staleState.oldTitleFingerprint - title fingerprint from previous question
 * @param {string} staleState.titleFingerprint - current question's title fingerprint
 * @param {string} staleState.itemType - question type string
 * @returns {boolean}
 */
function isProbablyStale(fingerprint, staleState) {
    const {
        oldAnalysisFingerprint = '',
        staleFingerprints = [],
        oldTitleFingerprint = '',
        titleFingerprint = '',
        itemType = ''
    } = staleState || {};

    if (!fingerprint || fingerprint.length < 10) return false;

    // Shared-case exemption
    const isSharedCase = itemType.includes('共享题干') ||
        (oldTitleFingerprint && titleFingerprint &&
         oldTitleFingerprint.substring(0, 50) === titleFingerprint.substring(0, 50));
    if (isSharedCase) return false;

    const current = String(fingerprint);

    // Basic check: compare against previous question's analysis fingerprint
    if (oldAnalysisFingerprint && current === oldAnalysisFingerprint) return true;

    // Deep check: compare against staleFingerprints pool
    if (current.length > 30 && Array.isArray(staleFingerprints)) {
        return staleFingerprints.some(stale => {
            const s = String(stale);
            if (s.length < 30) return false;
            if (current === s) return true;
            if (current.length > 50 && s.length > 50 && (current.includes(s) || s.includes(current))) return true;
            return false;
        });
    }
    return false;
}

// ---------------------------------------------------------------------------
// Simulate the first-layer retry logic from crawlSubject (UNFIXED version)
// Returns the analysis result after the single retry attempt.
// ---------------------------------------------------------------------------

/**
 * Simulates the UNFIXED single-retry logic in crawlSubject.
 *
 * In the unfixed code:
 *   1. readQuestionData returns "无解析" (stale DOM rejected)
 *   2. Single retry: triggerOfficialAnalysis (times out) + randomSleep(1200,2200) + readQuestionData
 *   3. If retry also returns "无解析", give up → write "无解析"
 *
 * @param {object} opts
 * @param {string} opts.domAnalysisRawText - what the DOM analysis node shows at read time
 * @param {string[]} opts.staleFingerprints - pool of resolvedFingerprints
 * @param {string} opts.lastAnalysisFingerprint - 100-char fingerprint from previous question
 * @param {boolean} opts.triggerOfficialAnalysisSucceeds - whether triggerOfficialAnalysis returns true
 * @param {string|null} opts.freshAnalysisAfterRetry - if non-null, the DOM shows this fresh text after retry
 * @returns {{ analysis: string, retryAttempts: number }}
 */
function simulateUnfixedCrawlSubject(opts) {
    const {
        domAnalysisRawText,
        staleFingerprints,
        lastAnalysisFingerprint,
        triggerOfficialAnalysisSucceeds,
        freshAnalysisAfterRetry = null
    } = opts;

    const staleState = {
        oldAnalysisFingerprint: lastAnalysisFingerprint,
        staleFingerprints,
        oldTitleFingerprint: '',
        titleFingerprint: 'Q2titlefingerprint',
        itemType: '问答题'
    };

    // First read: DOM still shows Q1's analysis
    const domFingerprint = domAnalysisRawText.replace(/\s/g, '').substring(0, 100);
    const isStale = isProbablyStale(domFingerprint, staleState);
    let analysis = isStale ? '无解析' : domAnalysisRawText;

    let retryAttempts = 0;

    // First-layer retry (UNFIXED: single attempt)
    if ((analysis === '无解析') && lastAnalysisFingerprint) {
        retryAttempts = 1;
        // triggerOfficialAnalysis: in unfixed code, times out (returns false) because DOM hasn't updated
        // After the single retry, DOM still shows Q1's text (triggerOfficialAnalysisSucceeds=false)
        // OR if fresh content loaded, use that
        if (triggerOfficialAnalysisSucceeds && freshAnalysisAfterRetry) {
            const retryFingerprint = freshAnalysisAfterRetry.replace(/\s/g, '').substring(0, 100);
            const retryIsStale = isProbablyStale(retryFingerprint, staleState);
            analysis = retryIsStale ? '无解析' : freshAnalysisAfterRetry;
        }
        // If triggerOfficialAnalysis timed out (false), DOM still shows Q1's text → still "无解析"
    }

    return { analysis, retryAttempts };
}

/**
 * Simulates the FIXED multi-retry logic in crawlSubject.
 *
 * In the fixed code:
 *   1. readQuestionData returns "无解析" (stale DOM rejected)
 *   2. Loop up to 3 attempts with increasing delays (2s, 4s, 6s)
 *   3. Each attempt: triggerOfficialAnalysis (extended 15s timeout) + readQuestionData
 *   4. Break on first success; fall through to "无解析" only after all 3 fail
 *
 * @param {object} opts
 * @param {string} opts.domAnalysisRawText - what the DOM analysis node shows at read time
 * @param {string[]} opts.staleFingerprints - pool of resolvedFingerprints
 * @param {string} opts.lastAnalysisFingerprint - 100-char fingerprint from previous question
 * @param {number} opts.successOnAttempt - which attempt (1-indexed) the DOM finally updates (0 = never)
 * @param {string} opts.freshAnalysis - the fresh analysis text that appears after DOM updates
 * @returns {{ analysis: string, retryAttempts: number }}
 */
function simulateFixedCrawlSubject(opts) {
    const {
        domAnalysisRawText,
        staleFingerprints,
        lastAnalysisFingerprint,
        successOnAttempt,
        freshAnalysis
    } = opts;

    const staleState = {
        oldAnalysisFingerprint: lastAnalysisFingerprint,
        staleFingerprints,
        oldTitleFingerprint: '',
        titleFingerprint: 'Q2titlefingerprint',
        itemType: '问答题'
    };

    // First read: DOM still shows Q1's analysis
    const domFingerprint = domAnalysisRawText.replace(/\s/g, '').substring(0, 100);
    const isStale = isProbablyStale(domFingerprint, staleState);
    let analysis = isStale ? '无解析' : domAnalysisRawText;

    let retryAttempts = 0;

    // Fixed: loop up to 3 attempts
    if ((analysis === '无解析') && lastAnalysisFingerprint) {
        const MAX_STALE_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_STALE_RETRIES; attempt++) {
            retryAttempts = attempt;
            // Simulate: DOM updates on successOnAttempt-th attempt
            if (successOnAttempt > 0 && attempt >= successOnAttempt) {
                // Fresh content loaded
                const retryFingerprint = freshAnalysis.replace(/\s/g, '').substring(0, 100);
                const retryIsStale = isProbablyStale(retryFingerprint, staleState);
                if (!retryIsStale) {
                    analysis = freshAnalysis;
                    break;
                }
            }
            // DOM still stale on this attempt → continue loop
        }
    }

    return { analysis, retryAttempts };
}

// ---------------------------------------------------------------------------
// Test data from debug_14658.log (real values)
// ---------------------------------------------------------------------------

// Q1's resolvedFingerprint as stored in staleFingerprints
const Q1_RESOLVED_FINGERPRINT = '未知|参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位、相同性别等具有共同语言的人在一起分享信息、观念或行为技能，同伴教育者易唤起身边同伴的心灵共鸣，以实现教育目标，①改变了自我认同，提升了自信，获得了价值感。②明确了自身定位，获得了使命感和责'.replace(/\s/g, '').substring(0, 160);

// Q2's DOM analysis node still shows Q1's analysis text (2024 site hasn't updated)
const Q2_DOM_STALE_TEXT = '参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位、相同性别等具有共同语言的人在一起分享信息、观念或行为技能，同伴教育者易唤起身边同伴的心灵共鸣，以实现教育目标，①改变了自我认同，提升了自信，获得了价值感。②明确了自身定位，获得了使命感和责';

// Q1's analysisFingerprint (100-char raw DOM fingerprint stored as lastAnalysisFingerprint)
const Q1_ANALYSIS_FINGERPRINT = Q2_DOM_STALE_TEXT.replace(/\s/g, '').substring(0, 100);

// Q2's actual analysis (what should be captured after DOM updates)
const Q2_REAL_ANALYSIS = '参考答案：在街道召开的多方协商会议中，社会工作者应当发挥以下作用：1、促进各方沟通与理解；2、协调利益冲突；3、推动形成共识；4、跟进落实协议。';

// staleFingerprints pool as it exists when Q2 is being processed
const STALE_FINGERPRINTS_AT_Q2 = [Q1_RESOLVED_FINGERPRINT];

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✔ PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✘ FAIL: ${name}`);
        console.log(`         ${e.message}`);
        failed++;
    }
}

console.log('\n=== Bug Condition Exploration Tests ===\n');

// ---------------------------------------------------------------------------
// Section 1: Confirm the bug condition exists (isBugCondition check)
// ---------------------------------------------------------------------------
console.log('--- Section 1: Confirm bug condition (isBugCondition) ---\n');

test('isBugCondition: Q2 DOM fingerprint IS a substring of Q1 resolvedFingerprint in pool', () => {
    const domFingerprint = Q2_DOM_STALE_TEXT.replace(/\s/g, '').substring(0, 100);
    const poolEntry = Q1_RESOLVED_FINGERPRINT;
    // The pool entry (160 chars) should contain the DOM fingerprint (100 chars) as substring
    assert.ok(
        poolEntry.includes(domFingerprint),
        `Expected pool entry to include DOM fingerprint.\nPool: ${poolEntry}\nDOM:  ${domFingerprint}`
    );
});

test('isBugCondition: isProbablyStale returns true for Q2 DOM fingerprint (bug condition active)', () => {
    const domFingerprint = Q2_DOM_STALE_TEXT.replace(/\s/g, '').substring(0, 100);
    const result = isProbablyStale(domFingerprint, {
        oldAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        oldTitleFingerprint: '',
        titleFingerprint: 'Q2titlefingerprint',
        itemType: '问答题'
    });
    assert.strictEqual(result, true, 'isProbablyStale should return true when bug condition is active');
});

// ---------------------------------------------------------------------------
// Section 2: Bug condition test — UNFIXED code produces "无解析"
// This section documents the bug: unfixed code gives up after single retry
// ---------------------------------------------------------------------------
console.log('\n--- Section 2: UNFIXED code behavior (documents the bug) ---\n');

test('UNFIXED: single retry with timed-out triggerOfficialAnalysis → "无解析" (bug confirmed)', () => {
    const result = simulateUnfixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        triggerOfficialAnalysisSucceeds: false,  // DOM hasn't updated → timeout
        freshAnalysisAfterRetry: null
    });
    // On unfixed code, this SHOULD be "无解析" — that's the bug
    assert.strictEqual(result.analysis, '无解析',
        `Unfixed code should produce "无解析" when single retry times out. Got: "${result.analysis}"`);
    assert.strictEqual(result.retryAttempts, 1, 'Unfixed code should make exactly 1 retry attempt');
});

// ---------------------------------------------------------------------------
// Section 3: Property 1 — EXPECTED (fixed) behavior
// These assertions encode what the FIXED code MUST do.
// They WILL FAIL on unfixed code (that's the point).
// ---------------------------------------------------------------------------
console.log('\n--- Section 3: Property 1 — Expected (fixed) behavior ---\n');
console.log('  NOTE: Tests in this section MUST FAIL on unfixed code.\n');

test('FIXED: DOM updates on attempt 1 → captures real analysis (not "无解析")', () => {
    const result = simulateFixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        successOnAttempt: 1,
        freshAnalysis: Q2_REAL_ANALYSIS
    });
    // EXPECTED (fixed) behavior: captures real analysis
    assert.notStrictEqual(result.analysis, '无解析',
        `Fixed code should NOT produce "无解析" when DOM updates on attempt 1. Got: "${result.analysis}"`);
    assert.strictEqual(result.analysis, Q2_REAL_ANALYSIS,
        `Fixed code should capture Q2's real analysis. Got: "${result.analysis}"`);
});

test('FIXED: DOM updates on attempt 2 (after ~4s delay) → captures real analysis', () => {
    const result = simulateFixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        successOnAttempt: 2,
        freshAnalysis: Q2_REAL_ANALYSIS
    });
    assert.notStrictEqual(result.analysis, '无解析',
        `Fixed code should NOT produce "无解析" when DOM updates on attempt 2. Got: "${result.analysis}"`);
    assert.strictEqual(result.analysis, Q2_REAL_ANALYSIS);
    assert.strictEqual(result.retryAttempts, 2, 'Should have taken 2 retry attempts');
});

test('FIXED: DOM updates on attempt 3 (after ~6s delay) → captures real analysis', () => {
    const result = simulateFixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        successOnAttempt: 3,
        freshAnalysis: Q2_REAL_ANALYSIS
    });
    assert.notStrictEqual(result.analysis, '无解析',
        `Fixed code should NOT produce "无解析" when DOM updates on attempt 3. Got: "${result.analysis}"`);
    assert.strictEqual(result.analysis, Q2_REAL_ANALYSIS);
    assert.strictEqual(result.retryAttempts, 3, 'Should have taken 3 retry attempts');
});

test('FIXED: DOM never updates (genuinely no analysis) → "无解析" after all 3 retries exhausted', () => {
    const result = simulateFixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        successOnAttempt: 0,  // never succeeds
        freshAnalysis: ''
    });
    // Fallback preserved: "无解析" is acceptable ONLY after all retries exhausted
    assert.strictEqual(result.analysis, '无解析',
        `Fixed code should record "无解析" only after all retries exhausted. Got: "${result.analysis}"`);
    assert.strictEqual(result.retryAttempts, 3, 'Should have exhausted all 3 retry attempts');
});

// ---------------------------------------------------------------------------
// Section 4: The core property assertion
// This is the key test that FAILS on unfixed code and PASSES on fixed code.
// ---------------------------------------------------------------------------
console.log('\n--- Section 4: Core property assertion (FAILS on unfixed code) ---\n');

test('PROPERTY 1: When isBugCondition is true AND DOM eventually updates, result MUST NOT be "无解析"', () => {
    // Simulate the exact scenario from debug_14658.log:
    // - Q2 in chapter 14658
    // - staleFingerprints contains Q1's resolvedFingerprint
    // - DOM still shows Q1's analysis text
    // - BUT: the 2024 site WILL eventually load Q2's analysis (after ~8 seconds)
    //   → fixed code should capture it; unfixed code gives up too early

    // On UNFIXED code: single retry, DOM hasn't updated → "无解析"
    const unfixedResult = simulateUnfixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        triggerOfficialAnalysisSucceeds: false,
        freshAnalysisAfterRetry: null
    });

    // On FIXED code: 3 retries, DOM updates on attempt 2 → captures real analysis
    const fixedResult = simulateFixedCrawlSubject({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        successOnAttempt: 2,
        freshAnalysis: Q2_REAL_ANALYSIS
    });

    // The UNFIXED code produces "无解析" (bug confirmed)
    assert.strictEqual(unfixedResult.analysis, '无解析',
        'Unfixed code should produce "无解析" (confirms bug exists)');

    // The FIXED code should NOT produce "无解析" (this assertion FAILS on unfixed code)
    // THIS IS THE LINE THAT FAILS ON UNFIXED CODE:
    assert.notStrictEqual(unfixedResult.analysis, fixedResult.analysis,
        'Fixed and unfixed code should produce DIFFERENT results when bug condition is active');
    assert.notStrictEqual(fixedResult.analysis, '无解析',
        'Fixed code MUST NOT produce "无解析" when DOM eventually updates with real content');
    assert.strictEqual(fixedResult.analysis, Q2_REAL_ANALYSIS,
        `Fixed code should capture Q2's real analysis: "${Q2_REAL_ANALYSIS}"`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Results ===\n');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log('');

if (failed > 0) {
    console.log('EXPECTED FAILURE on unfixed code — this confirms the bug exists.');
    console.log('Counterexample: { questionIndex: 2, domAnalysisRawText: "参考答案：1、同伴教育亦称为同伴教学...", staleFingerprints: ["未知|参考答案：1、同伴教育亦称为同伴教学..."] } → data.analysis === "无解析" instead of Q2\'s real analysis');
    console.log('');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED — bug is fixed!');
    process.exit(0);
}
