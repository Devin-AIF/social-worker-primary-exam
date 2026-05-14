const fs = require('fs');
const path = require('path');

const statusFile = '/Users/devin_aif/Downloads/抓取题目/抓取结果_V4/completion_status.json';

if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let count = 0;
    for (const key in status) {
        const item = status[key];
        if (item.completed >= item.total && item.total > 0 && !item.isFinished) {
            item.isFinished = true;
            count++;
        }
    }
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    console.log(`Migration complete. Updated ${count} entries with isFinished: true.`);
} else {
    console.log('Status file not found.');
}
