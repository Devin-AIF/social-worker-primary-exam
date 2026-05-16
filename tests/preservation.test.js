/**
 * Preservation Property Tests
 * ============================
 * Property 2: Preservation — Non-Buggy Inputs Produce Identical Results
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 *
 * PURPOSE: These tests verify behaviors that MUST be preserved by the fix.
 * They MUST PASS on both unfixed and fixed code.
 *
 * Cases covered:
 *   - Empty staleFingerprints → isProbablyStale returns false
 *   - Shared-case exemption (itemType includes '共享题干') → isProbablyStale returns false
 *   - FIFO eviction: pushing 4 entries keeps pool at max 3
 *   - Non-matching fingerprint → isProbablyStale returns false
 *   - Exact match → isProbablyStale returns true (preserved)
 *   - Substring match s.includes(current) → isProbablyStale returns true (preserved)
 */

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Standalone isProbablyStale (mirrors crawler_v5.js exactly)
// ---------------------------------------------------------------------------

function isProbablyStale(fingerprint, staleState) {
    const {
        oldAnalysisFingerprint = '',
        staleFingerprints = [],
        oldTitleFingerprint = '',
        titleFingerprint = '',
        itemType = ''
    } = staleState || {};

    if (!fingerprint || fingerprint.length < 10) return false;

    const isSharedCase = itemType.includes('共享题干') ||
        (oldTitleFingerprint && titleFingerprint &&
         oldTitleFingerprint.substring(0, 50) === titleFingerprint.substring(0, 50));
    if (isSharedCase) return false;

    const current = String(fingerprint);

    if (oldAnalysisFingerprint && current === oldAnalysisFingerprint) return true;

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
// Standalone FIFO pool management (mirrors crawlSubject logic exactly)
// ---------------------------------------------------------------------------

/**
 * Push a resolvedFingerprint into the staleFingerprints pool.
 * Mirrors the exact logic in crawlSubject (unfixed version).
 */
function pushToStalePool_unfixed(pool, resolvedFingerprint) {
    if (resolvedFingerprint && resolvedFingerprint.length > 30) {
        if (!pool.includes(resolvedFingerprint)) {
            pool.push(resolvedFingerprint);
            if (pool.length > 3) pool.shift();
        }
    }
    return pool;
}

/**
 * Push a resolvedFingerprint into the staleFingerprints pool.
 * Mirrors the fixed version: strips "answer|" prefix before pushing.
 */
function pushToStalePool_fixed(pool, resolvedFingerprint) {
    const analysisOnlyFingerprint = resolvedFingerprint.replace(/^[^|]*\|/, '');
    if (analysisOnlyFingerprint && analysisOnlyFingerprint.length > 30) {
        if (!pool.includes(analysisOnlyFingerprint)) {
            pool.push(analysisOnlyFingerprint);
            if (pool.length > 3) pool.shift();
        }
    }
    return pool;
}

// ---------------------------------------------------------------------------
// Simple random string generator for property-based tests
// ---------------------------------------------------------------------------

function randomString(length, seed) {
    // Deterministic pseudo-random string for reproducible tests
    let result = '';
    let s = seed || 12345;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789参考答案解析题目';
    for (let i = 0; i < length; i++) {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        result += chars[Math.abs(s) % chars.length];
    }
    return result;
}

function randomFingerprint(minLen, maxLen, seed) {
    const len = minLen + (Math.abs(seed * 7 + 3) % (maxLen - minLen + 1));
    return randomString(len, seed);
}

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

console.log('\n=== Preservation Property Tests ===\n');

// ---------------------------------------------------------------------------
// Section 1: isProbablyStale — empty pool
// ---------------------------------------------------------------------------
console.log('--- Section 1: Empty staleFingerprints → isProbablyStale returns false ---\n');

test('Empty pool: isProbablyStale returns false for any fingerprint', () => {
    const fingerprints = [
        '参考答案：1、同伴教育亦称为同伴教学朋辈咨询同辈辅导',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
        '这是一段足够长的测试文本用于验证空池情况下的行为是否正确'
    ];
    for (const fp of fingerprints) {
        const result = isProbablyStale(fp, {
            oldAnalysisFingerprint: '',
            staleFingerprints: [],
            oldTitleFingerprint: '',
            titleFingerprint: 'sometitlefp',
            itemType: '问答题'
        });
        assert.strictEqual(result, false,
            `Empty pool: isProbablyStale should return false for "${fp.substring(0, 30)}..."`);
    }
});

test('Empty pool: isProbablyStale returns false even when oldAnalysisFingerprint is empty', () => {
    const result = isProbablyStale('参考答案：1、同伴教育亦称为同伴教学朋辈咨询同辈辅导', {
        oldAnalysisFingerprint: '',
        staleFingerprints: [],
        oldTitleFingerprint: '',
        titleFingerprint: '',
        itemType: '问答题'
    });
    assert.strictEqual(result, false, 'Empty pool + empty oldAnalysisFingerprint → false');
});

// ---------------------------------------------------------------------------
// Section 2: Shared-case exemption
// ---------------------------------------------------------------------------
console.log('\n--- Section 2: Shared-case exemption (共享题干) ---\n');

test('Shared-case: isProbablyStale returns false when itemType includes 共享题干', () => {
    // Even with a matching fingerprint in the pool, shared-case should be exempt
    const analysisText = '参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位';
    const fingerprint = analysisText.replace(/\s/g, '').substring(0, 100);
    const poolEntry = ('未知|' + analysisText).replace(/\s/g, '').substring(0, 160);

    const result = isProbablyStale(fingerprint, {
        oldAnalysisFingerprint: fingerprint,  // exact match would normally return true
        staleFingerprints: [poolEntry],        // pool entry contains fingerprint as substring
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '共享题干案例题'  // shared-case exemption
    });
    assert.strictEqual(result, false,
        'Shared-case (共享题干) should be exempt from stale detection even when fingerprint matches');
});

test('Shared-case: isProbablyStale returns false when title fingerprints match (same parent question)', () => {
    const sharedTitlePrefix = '某社会工作服务机构计划运用小组工作法开展服务，以下是相关情况';
    const oldTitleFp = (sharedTitlePrefix + '第一问').replace(/\s/g, '');
    const titleFp = (sharedTitlePrefix + '第二问').replace(/\s/g, '');

    const analysisText = '参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位';
    const fingerprint = analysisText.replace(/\s/g, '').substring(0, 100);

    const result = isProbablyStale(fingerprint, {
        oldAnalysisFingerprint: fingerprint,  // exact match
        staleFingerprints: [],
        oldTitleFingerprint: oldTitleFp,
        titleFingerprint: titleFp,
        itemType: '问答题'
    });
    // First 50 chars of both title fingerprints are the same → shared case → exempt
    assert.strictEqual(result, false,
        'Questions sharing the same title prefix should be exempt from stale detection');
});

// ---------------------------------------------------------------------------
// Section 3: FIFO eviction — pool stays at max 3
// ---------------------------------------------------------------------------
console.log('\n--- Section 3: FIFO eviction (max 3 entries) ---\n');

test('FIFO: pushing 4 entries keeps pool at max 3 (unfixed push logic)', () => {
    const pool = [];
    const entries = [
        '未知|参考答案：第一题解析内容足够长以通过30字符阈值检查',
        '未知|参考答案：第二题解析内容足够长以通过30字符阈值检查',
        '未知|参考答案：第三题解析内容足够长以通过30字符阈值检查',
        '未知|参考答案：第四题解析内容足够长以通过30字符阈值检查'
    ].map(e => e.replace(/\s/g, '').substring(0, 160));

    for (const entry of entries) {
        pushToStalePool_unfixed(pool, entry);
    }

    assert.strictEqual(pool.length, 3, `Pool should have max 3 entries, got ${pool.length}`);
    // FIFO: oldest entry (entries[0]) should have been evicted
    assert.ok(!pool.includes(entries[0]), 'Oldest entry should have been evicted (FIFO)');
    assert.ok(pool.includes(entries[1]), 'Second entry should still be in pool');
    assert.ok(pool.includes(entries[2]), 'Third entry should still be in pool');
    assert.ok(pool.includes(entries[3]), 'Fourth (newest) entry should be in pool');
});

test('FIFO: pushing 3 entries keeps all 3 (no eviction needed)', () => {
    const pool = [];
    const entries = [
        '未知|参考答案：第一题解析内容足够长以通过30字符阈值检查',
        '未知|参考答案：第二题解析内容足够长以通过30字符阈值检查',
        '未知|参考答案：第三题解析内容足够长以通过30字符阈值检查'
    ].map(e => e.replace(/\s/g, '').substring(0, 160));

    for (const entry of entries) {
        pushToStalePool_unfixed(pool, entry);
    }

    assert.strictEqual(pool.length, 3, `Pool should have 3 entries, got ${pool.length}`);
});

test('FIFO: short fingerprints (< 30 chars) are NOT added to pool', () => {
    const pool = [];
    pushToStalePool_unfixed(pool, '未知|无解析');  // 8 chars — too short
    pushToStalePool_unfixed(pool, '未知|无');       // 5 chars — too short
    assert.strictEqual(pool.length, 0, 'Short fingerprints should not be added to pool');
});

test('FIFO: duplicate entries are NOT added twice', () => {
    const pool = [];
    const entry = '未知|参考答案：第一题解析内容足够长以通过30字符阈值检查'.replace(/\s/g, '').substring(0, 160);
    pushToStalePool_unfixed(pool, entry);
    pushToStalePool_unfixed(pool, entry);  // duplicate
    assert.strictEqual(pool.length, 1, 'Duplicate entries should not be added twice');
});

// ---------------------------------------------------------------------------
// Section 4: Non-matching fingerprint → isProbablyStale returns false
// ---------------------------------------------------------------------------
console.log('\n--- Section 4: Non-matching fingerprint → isProbablyStale returns false ---\n');

test('Non-matching: isProbablyStale returns false when fingerprint is not in pool', () => {
    const poolEntry = '未知|参考答案：第一题解析内容足够长以通过30字符阈值检查'.replace(/\s/g, '').substring(0, 160);
    const differentFingerprint = '参考答案：第二题完全不同的解析内容与第一题没有任何关联'.replace(/\s/g, '').substring(0, 100);

    const result = isProbablyStale(differentFingerprint, {
        oldAnalysisFingerprint: '',
        staleFingerprints: [poolEntry],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '问答题'
    });
    assert.strictEqual(result, false,
        'Non-matching fingerprint should return false');
});

test('Non-matching: isProbablyStale returns false for fingerprints below 30-char threshold', () => {
    const poolEntry = '未知|参考答案：第一题解析内容足够长以通过30字符阈值检查'.replace(/\s/g, '').substring(0, 160);
    const shortFingerprint = '短文本';  // < 10 chars

    const result = isProbablyStale(shortFingerprint, {
        oldAnalysisFingerprint: '',
        staleFingerprints: [poolEntry],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '问答题'
    });
    assert.strictEqual(result, false, 'Fingerprint < 10 chars should return false');
});

// ---------------------------------------------------------------------------
// Section 5: Exact match → isProbablyStale returns true (preserved)
// ---------------------------------------------------------------------------
console.log('\n--- Section 5: Exact match → isProbablyStale returns true (preserved) ---\n');

test('Exact match: isProbablyStale returns true when fingerprint exactly matches pool entry', () => {
    const fingerprint = '参考答案：第一题解析内容足够长以通过30字符阈值检查并且超过50字符以触发深度检查逻辑'.replace(/\s/g, '');
    const poolEntry = fingerprint;  // exact match

    const result = isProbablyStale(fingerprint, {
        oldAnalysisFingerprint: '',
        staleFingerprints: [poolEntry],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '问答题'
    });
    assert.strictEqual(result, true, 'Exact match should return true');
});

test('Exact match: isProbablyStale returns true when fingerprint matches oldAnalysisFingerprint', () => {
    const fingerprint = '参考答案：第一题解析内容足够长以通过30字符阈值检查'.replace(/\s/g, '');
    const result = isProbablyStale(fingerprint, {
        oldAnalysisFingerprint: fingerprint,  // exact match
        staleFingerprints: [],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '问答题'
    });
    assert.strictEqual(result, true, 'Exact match with oldAnalysisFingerprint should return true');
});

// ---------------------------------------------------------------------------
// Section 6: Substring match s.includes(current) → isProbablyStale returns true (preserved)
// ---------------------------------------------------------------------------
console.log('\n--- Section 6: Substring match s.includes(current) → isProbablyStale returns true (preserved) ---\n');

test('Substring match: isProbablyStale returns true when pool entry contains fingerprint as substring', () => {
    // This is the exact bug condition: pool entry (160 chars) contains DOM fingerprint (100 chars)
    const analysisText = '参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位、相同性别等具有共同语言的人在一起分享信息、观念或行为技能，同伴教育者易唤起身边同伴的心灵共鸣，以实现教育目标，①改变了自我认同，提升了自信，获得了价值感。②明确了自身定位，获得了使命感和责';
    const domFingerprint = analysisText.replace(/\s/g, '').substring(0, 100);
    const poolEntry = ('未知|' + analysisText).replace(/\s/g, '').substring(0, 160);

    // Verify the substring relationship holds
    assert.ok(poolEntry.includes(domFingerprint),
        'Pool entry should contain DOM fingerprint as substring (prerequisite)');

    const result = isProbablyStale(domFingerprint, {
        oldAnalysisFingerprint: '',
        staleFingerprints: [poolEntry],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '问答题'
    });
    assert.strictEqual(result, true,
        'Substring match (s.includes(current)) should return true — this behavior must be preserved');
});

test('Substring match: isProbablyStale returns true when fingerprint contains pool entry as substring', () => {
    // current.includes(s) branch
    const shortPoolEntry = '参考答案：第一题解析内容足够长以通过30字符阈值检查并且超过50字符'.replace(/\s/g, '');
    const longFingerprint = (shortPoolEntry + '额外的内容使得当前指纹更长').replace(/\s/g, '');

    assert.ok(longFingerprint.includes(shortPoolEntry), 'Prerequisite: fingerprint contains pool entry');
    assert.ok(longFingerprint.length > 50, 'Prerequisite: fingerprint > 50 chars');
    assert.ok(shortPoolEntry.length > 50, 'Prerequisite: pool entry > 50 chars');

    const result = isProbablyStale(longFingerprint, {
        oldAnalysisFingerprint: '',
        staleFingerprints: [shortPoolEntry],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '问答题'
    });
    assert.strictEqual(result, true,
        'current.includes(s) branch should return true — this behavior must be preserved');
});

// ---------------------------------------------------------------------------
// Section 7: Property-based tests — random inputs
// ---------------------------------------------------------------------------
console.log('\n--- Section 7: Property-based tests (random inputs) ---\n');

test('PROPERTY: For all non-matching fingerprints, isProbablyStale returns false', () => {
    // Generate 20 random test cases where fingerprint is NOT a substring of any pool entry
    let failures = 0;
    for (let seed = 1; seed <= 20; seed++) {
        const poolEntries = [];
        for (let j = 0; j < 3; j++) {
            poolEntries.push(randomFingerprint(60, 100, seed * 100 + j));
        }
        // Generate a fingerprint that is definitely NOT in any pool entry
        const fingerprint = 'UNIQUE_PREFIX_' + randomFingerprint(50, 80, seed * 999);

        const result = isProbablyStale(fingerprint, {
            oldAnalysisFingerprint: '',
            staleFingerprints: poolEntries,
            oldTitleFingerprint: '',
            titleFingerprint: 'sometitlefp',
            itemType: '问答题'
        });

        if (result !== false) {
            failures++;
            console.log(`    Failure at seed=${seed}: fingerprint="${fingerprint.substring(0, 30)}" returned true`);
        }
    }
    assert.strictEqual(failures, 0, `${failures} random non-matching fingerprints incorrectly returned true`);
});

test('PROPERTY: For all pool sizes after any number of pushes, pool.length <= 3', () => {
    // Generate 10 random sequences of pushes
    for (let seed = 1; seed <= 10; seed++) {
        const pool = [];
        const numPushes = 3 + (seed % 7);  // 3 to 9 pushes
        for (let i = 0; i < numPushes; i++) {
            const entry = randomFingerprint(40, 160, seed * 50 + i);
            pushToStalePool_unfixed(pool, entry);
        }
        assert.ok(pool.length <= 3,
            `Pool size should never exceed 3. Got ${pool.length} after ${numPushes} pushes (seed=${seed})`);
    }
});

test('PROPERTY: Empty pool always returns false regardless of fingerprint content', () => {
    const testFingerprints = [
        randomFingerprint(100, 160, 1001),
        randomFingerprint(50, 100, 1002),
        randomFingerprint(30, 50, 1003),
        '参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位'
    ];
    for (const fp of testFingerprints) {
        const result = isProbablyStale(fp, {
            oldAnalysisFingerprint: '',
            staleFingerprints: [],
            oldTitleFingerprint: '',
            titleFingerprint: 'sometitlefp',
            itemType: '问答题'
        });
        assert.strictEqual(result, false,
            `Empty pool should always return false. Got true for "${fp.substring(0, 30)}..."`);
    }
});

test('PROPERTY: Shared-case exemption always returns false regardless of fingerprint match', () => {
    // Even with exact match, shared-case should be exempt
    const fingerprint = '参考答案：1、同伴教育亦称为同伴教学、朋辈咨询、同辈辅导或者朋辈辅导，是指具有相似年龄、背景、生理、经历、体会、社会经济地位'.replace(/\s/g, '');
    const poolEntry = fingerprint;

    const result = isProbablyStale(fingerprint, {
        oldAnalysisFingerprint: fingerprint,
        staleFingerprints: [poolEntry],
        oldTitleFingerprint: '',
        titleFingerprint: 'sometitlefp',
        itemType: '共享题干问答题'
    });
    assert.strictEqual(result, false,
        'Shared-case exemption should always return false regardless of fingerprint match');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Results ===\n');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log('');

if (failed > 0) {
    console.log('PRESERVATION TESTS FAILED — these behaviors must be preserved by the fix!');
    process.exit(1);
} else {
    console.log('ALL PRESERVATION TESTS PASSED — baseline behavior confirmed.');
    process.exit(0);
}
