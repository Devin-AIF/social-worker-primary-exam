const fs = require('fs');
const path = require('path');

// Mock functions from crawler_v4.js
function sanitizeFileName(name) {
    return name.replace(/[\\/:"*?<>|]/g, '_');
}

function getStatusKey(subjectName, catName, chapterTitle, chapterId) {
    return `${subjectName}_${catName}_${chapterTitle}_${chapterId}`;
}

// Test cases
const tests = [
    { s: 'Subject/Name', c: 'Category:Test', t: 'Chapter?Title', id: '123' },
    { s: '2026年初级社会工作者《初级社会工作实务》考试题库', c: '历年真题', t: '2024年真题', id: 'paper-14660' }
];

console.log('--- Path and Key Verification ---');
tests.forEach(test => {
    const sSan = sanitizeFileName(test.s);
    const cSan = sanitizeFileName(test.c);
    const tSan = sanitizeFileName(test.t);
    const key = getStatusKey(test.s, test.c, test.t, test.id);
    
    console.log(`Original: ${test.s} | ${test.c} | ${test.t}`);
    console.log(`Sanitized: ${sSan} | ${cSan} | ${tSan}`);
    console.log(`Status Key: ${key}`);
    console.log('---');
});

// Check if completion_status.json is readable
const STATUS_FILE = '/Users/devin_aif/Downloads/抓取题目/抓取结果_V4/completion_status.json';
try {
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    console.log(`Successfully read completion_status.json. Found ${Object.keys(status).length} keys.`);
    
    // Check if any finished subjects are present
    const finishedSubjects = Object.keys(status).filter(k => k.startsWith('SUBJECT_FINISHED_'));
    console.log(`Finished Subjects: ${finishedSubjects.length}`);
    finishedSubjects.forEach(s => console.log(` - ${s}`));

} catch (e) {
    console.error(`Failed to read completion_status.json: ${e.message}`);
}
