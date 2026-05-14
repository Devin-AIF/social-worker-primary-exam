const fs = require('fs');
const path = require('path');

const statusFile = '/Users/devin_aif/Downloads/抓取题目/抓取结果_V4/completion_status.json';

const ALL_SUBJECTS = [
    '2026年初级社会工作者《初级社会工作实务》考试题库',
    '2026年中级社会工作者《中级社会工作实务》考试题库',
    '2026年中级社会工作者《中级社会工作法规与政策》考试题库',
    '2026年中级社会工作者《中级社会工作综合能力》考试题库',
    '2026年初级社会工作者《初级社会工作综合能力》考试题库',
];

if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    
    // 1. Mark chapters as finished
    for (const key in status) {
        const item = status[key];
        if (item.completed >= item.total && item.total > 0 && !item.isFinished) {
            item.isFinished = true;
        }
    }

    // 2. Try to mark subjects as finished
    // We can only do this if we are reasonably sure we finished them.
    // For "初级社会工作实务", it looks like many chapters are finished.
    // I'll mark it as finished if at least one chapter is finished AND none are unfinished.
    for (const subjectName of ALL_SUBJECTS) {
        const subjectKeys = Object.keys(status).filter(k => k.startsWith(subjectName + '_'));
        if (subjectKeys.length > 0) {
            const allFinished = subjectKeys.every(k => status[k].isFinished);
            if (allFinished) {
                status[`SUBJECT_FINISHED_${subjectName}`] = {
                    isFinished: true,
                    updatedAt: new Date().toLocaleString()
                };
                console.log(`Marked Subject [${subjectName}] as finished.`);
            }
        }
    }

    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    console.log('Migration complete.');
}
