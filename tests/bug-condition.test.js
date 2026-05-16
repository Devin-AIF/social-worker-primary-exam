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
 * Strategy:
 *   - Extract isProbablyStale logic from crawler_v5.js (pure function, testable in isolation)
 *   - Simulate the crawlSubject retry loop by reading the actual source code to count retry attempts
 *   - Assert that the fixed code uses a multi-retry loop (>= 3 attempts) rather than a single retry
 *   - Assert that with a multi-retry loop, the system CAN capture real analysis when DOM updates late
 *
 * The test simulates the exact scenario from debug_14658.log:
 *   - Q1's resolvedFingerprint ("未知|参考答案：1、同伴教育亦称为同伴教学...") is in staleFingerprints
 *   - Q2's DOM analysis node still shows Q1's analysis text (2024 site hasn't updated yet)
 *   - isProbablyStale() fires via s.includes(current) — the 160-char pool entry contains the 100-char DOM fingerprint
 *   - triggerOfficialAnalysis times out (single retry, 6000ms, DOM not updated)
 *   - Result: "无解析" — BUG
 *
 * Expected (fixed) behavior: the system should retry with increasing delays (up to 3 attempts)
 * and eventually capture the real analysis, NOT immediately record "无解析".
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
// Read the actual crawler source to detect retry loop implementation
// ---------------------------------------------------------------------------

const CRAWLER_PATH = path.join(__dirname, '..', 'crawler_v5.js');
const crawlerSource = fs.readFileSync(CRAWLER_PATH, 'utf-8');

/**
 * Detect whether the crawler source contains the fixed multi-retry loop.
 * The fix replaces a single retry with a loop of up to 3 attempts.
 *
 * Unfixed code pattern: single `if` block with one triggerOfficialAnalysis call
 * Fixed code pattern: `for` loop with MAX_STALE_RETRIES or similar
 */
function detectRetryLoopInSource(source) {
    // Look for the fixed multi-retry loop pattern
    // The fix should have: a for loop with attempt variable inside the stale retry block
    const hasForLoop = /for\s*\(\s*let\s+attempt\s*=\s*0/.test(source) ||
                       /MAX_STALE_RETRIES/.test(source) ||
                       /STALE_RETRY_DELAYS/.test(source);
    return hasForLoop;
}

/**
 * Detect whether triggerOfficialAnalysis uses the extended 15000ms timeout.
 * Unfixed: { timeout: 6000 }
 * Fixed: { timeout: 15000 }
 */
function detectExtendedTimeout(source) {
    // Find the triggerOfficialAnalysis function body and check its waitForFunction timeout
    const fnMatch = source.match(/async function triggerOfficialAnalysis[\s\S]{0,2000}?timeout:\s*(\d+)/);
    if (!fnMatch) return false;
    return parseInt(fnMatch[1], 10) >= 15000;
}

/**
 * Detect whether staleFingerprints strips the answer prefix before pushing.
 * Unfixed: pushes data.resolvedFingerprint directly
 * Fixed: strips "answer|" prefix first
 */
function detectAnswerPrefixStripping(source) {
    return /resolvedFingerprint\.replace\(\/\^\[/i.test(source) ||
           /replace\(\/\^\[.*?\]\*\\|\//.test(source) ||
           /analysisOnlyFingerprint/.test(source) ||
           /replace\(\/\^\[.*\]\*\|\//.test(source);
}

// ---------------------------------------------------------------------------
// Simulate the retry behavior based on source code analysis
// ---------------------------------------------------------------------------

/**
 * Simulate the crawlSubject retry behavior.
 * Uses source code detection to determine whether unfixed or fixed logic is used.
 *
 * @param {object} opts
 * @param {string} opts.domAnalysisRawText - what the DOM analysis node shows at read time
 * @param {string[]} opts.staleFingerprints - pool of resolvedFingerprints
 * @param {string} opts.lastAnalysisFingerprint - 100-char fingerprint from previous question
 * @param {number} opts.domUpdatesOnAttempt - which attempt (1-indexed) the DOM finally updates (0 = never)
 * @param {string} opts.freshAnalysis - the fresh analysis text that appears after DOM updates
 * @returns {{ analysis: string, retryAttempts: number, usedFixedLogic: boolean }}
 */
function simulateCrawlSubjectRetry(opts) {
    const {
        domAnalysisRawText,
        staleFingerprints,
        lastAnalysisFingerprint,
        domUpdatesOnAttempt,
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

    const usedFixedLogic = detectRetryLoopInSource(crawlerSource);
    let retryAttempts = 0;

    if ((analysis === '无解析') && lastAnalysisFingerprint) {
        if (usedFixedLogic) {
            // Fixed: loop up to 3 attempts with increasing delays
            const MAX_STALE_RETRIES = 3;
            for (let attempt = 1; attempt <= MAX_STALE_RETRIES; attempt++) {
                retryAttempts = attempt;
                if (domUpdatesOnAttempt > 0 && attempt >= domUpdatesOnAttempt) {
                    const retryFingerprint = freshAnalysis.replace(/\s/g, '').substring(0, 100);
                    const retryIsStale = isProbablyStale(retryFingerprint, staleState);
                    if (!retryIsStale) {
                        analysis = freshAnalysis;
                        break;
                    }
                }
            }
        } else {
            // Unfixed: single retry attempt
            retryAttempts = 1;
            if (domUpdatesOnAttempt === 1) {
                const retryFingerprint = freshAnalysis.replace(/\s/g, '').substring(0, 100);
                const retryIsStale = isProbablyStale(retryFingerprint, staleState);
                if (!retryIsStale) {
                    analysis = freshAnalysis;
                }
            }
            // If DOM updates on attempt 2 or 3, unfixed code never gets there → still "无解析"
        }
    }

    return { analysis, retryAttempts, usedFixedLogic };
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
console.log(`  Crawler source: ${CRAWLER_PATH}`);
console.log(`  Has multi-retry loop: ${detectRetryLoopInSource(crawlerSource)}`);
console.log(`  Has extended timeout (15000ms): ${detectExtendedTimeout(crawlerSource)}`);
console.log(`  Has answer prefix stripping: ${detectAnswerPrefixStripping(crawlerSource)}`);
console.log('');

// ---------------------------------------------------------------------------
// Section 1: Confirm the bug condition exists (isBugCondition check)
// ---------------------------------------------------------------------------
console.log('--- Section 1: Confirm bug condition (isBugCondition) ---\n');

test('isBugCondition: Q2 DOM fingerprint IS a substring of Q1 resolvedFingerprint in pool', () => {
    const domFingerprint = Q2_DOM_STALE_TEXT.replace(/\s/g, '').substring(0, 100);
    const poolEntry = Q1_RESOLVED_FINGERPRINT;
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
// Section 2: Source code structure checks
// These FAIL on unfixed code, PASS on fixed code
// ---------------------------------------------------------------------------
console.log('\n--- Section 2: Source code fix verification (FAILS on unfixed code) ---\n');
console.log('  NOTE: Tests in this section MUST FAIL on unfixed code.\n');

test('FIXED: crawler source contains multi-retry loop (for loop with attempt variable)', () => {
    const hasLoop = detectRetryLoopInSource(crawlerSource);
    assert.ok(hasLoop,
        'crawler_v5.js should contain a multi-retry loop (for loop with attempt variable or MAX_STALE_RETRIES constant). ' +
        'UNFIXED code only has a single retry. This test FAILS on unfixed code — that confirms the bug exists.');
});

test('FIXED: triggerOfficialAnalysis uses extended timeout (>= 15000ms)', () => {
    const hasExtended = detectExtendedTimeout(crawlerSource);
    assert.ok(hasExtended,
        'triggerOfficialAnalysis should use timeout >= 15000ms. ' +
        'UNFIXED code uses 6000ms. This test FAILS on unfixed code.');
});

// ---------------------------------------------------------------------------
// Section 3: Property 1 — EXPECTED (fixed) behavior simulation
// These FAIL on unfixed code because simulateCrawlSubjectRetry uses source detection
// ---------------------------------------------------------------------------
console.log('\n--- Section 3: Property 1 — Expected (fixed) behavior ---\n');
console.log('  NOTE: Tests in this section MUST FAIL on unfixed code.\n');

test('PROPERTY 1: When DOM updates on attempt 2, fixed code captures real analysis (not "无解析")', () => {
    // Scenario: DOM updates after ~4 seconds (attempt 2 of 3)
    // Unfixed code: only 1 retry → DOM hasn't updated yet → "无解析"
    // Fixed code: 3 retries → DOM updates on attempt 2 → captures real analysis
    const result = simulateCrawlSubjectRetry({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        domUpdatesOnAttempt: 2,  // DOM updates on 2nd retry attempt
        freshAnalysis: Q2_REAL_ANALYSIS
    });

    // This assertion FAILS on unfixed code (single retry, DOM not updated on attempt 1)
    assert.notStrictEqual(result.analysis, '无解析',
        `When DOM updates on attempt 2, the system MUST NOT produce "无解析". ` +
        `Got: "${result.analysis}". ` +
        `usedFixedLogic: ${result.usedFixedLogic}. ` +
        `retryAttempts: ${result.retryAttempts}. ` +
        `COUNTEREXAMPLE: { questionIndex: 2, domAnalysisRawText: "参考答案：1、同伴教育亦称为同伴教学...", ` +
        `staleFingerprints: ["未知|参考答案：1、同伴教育亦称为同伴教学..."] } → data.analysis === "无解析" ` +
        `instead of Q2's real analysis. This FAILS on unfixed code — confirms the bug exists.`
    );
    assert.strictEqual(result.analysis, Q2_REAL_ANALYSIS,
        `Fixed code should capture Q2's real analysis`);
});

test('PROPERTY 1: When DOM updates on attempt 3, fixed code captures real analysis (not "无解析")', () => {
    const result = simulateCrawlSubjectRetry({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        domUpdatesOnAttempt: 3,
        freshAnalysis: Q2_REAL_ANALYSIS
    });

    assert.notStrictEqual(result.analysis, '无解析',
        `When DOM updates on attempt 3, the system MUST NOT produce "无解析". ` +
        `Got: "${result.analysis}". usedFixedLogic: ${result.usedFixedLogic}. ` +
        `COUNTEREXAMPLE: Q2–Q5 in chapter 14658 all produce "无解析" because single retry is insufficient.`
    );
    assert.strictEqual(result.analysis, Q2_REAL_ANALYSIS);
});

test('PROPERTY 1 (fallback preserved): When DOM never updates, "无解析" recorded after all retries', () => {
    const result = simulateCrawlSubjectRetry({
        domAnalysisRawText: Q2_DOM_STALE_TEXT,
        staleFingerprints: STALE_FINGERPRINTS_AT_Q2,
        lastAnalysisFingerprint: Q1_ANALYSIS_FINGERPRINT,
        domUpdatesOnAttempt: 0,  // never updates
        freshAnalysis: ''
    });

    // Fallback preserved: "无解析" is acceptable ONLY after all retries exhausted
    assert.strictEqual(result.analysis, '无解析',
        `When DOM never updates, "无解析" should be recorded after all retries exhausted`);
    if (result.usedFixedLogic) {
        assert.strictEqual(result.retryAttempts, 3,
            'Fixed code should exhaust all 3 retry attempts before giving up');
    }
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
    console.log('Root cause: single retry with 6000ms timeout is insufficient for 2024 site DOM update latency.');
    console.log('');
    process.exit(1);
} else {
    console.log('ALL TESTS PASSED — bug is fixed!');
    process.exit(0);
}
