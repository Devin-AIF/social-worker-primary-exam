const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};
const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';
// 2025中级实务真题的ID是 paper-16044，尝试猜测其 URL
const PAPER_URL = 'https://www.xs507.com/Tiku/exam/paper_id/16044.html?again=1';

async function run() {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录...');
    await page.goto(LOGIN_URL);
    await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(3000);

    console.log(`跳转到试卷 ${PAPER_URL}...`);
    await page.goto(PAPER_URL);
    await page.waitForTimeout(3000);

    // 点击背题模式
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); return (t === '背题模式' || t === '背题' || t === '显示答案');
        });
        if (btn) btn.click();
    });
    await page.waitForTimeout(2000);

    // 跳转到第 2 题 (共享题干案例题)
    console.log('跳转到第 2 题...');
    await page.evaluate(() => {
        const cardBtn = document.querySelector('.bd_dtk, #tiku_sheet, .answer-card-btn');
        if (cardBtn) cardBtn.click();
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
        const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
        if (cards[1]) cards[1].click(); // index 1 is question 2
    });
    await page.waitForTimeout(3000);

    // 触发解析
    await page.evaluate(() => {
        const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
        clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
            if (el.offsetParent !== null || el.innerText.includes('解析') || el.innerText.includes('答案')) el.click();
        }));
    });
    await page.waitForTimeout(2000);

    // 抓取并打印 DOM
    const html = await page.content();
    fs.writeFileSync('debug_q2.html', html);
    console.log('保存到 debug_q2.html 完成。');
    
    // 测试一下 readQuestionData 的逻辑
    const itemType = await page.evaluate(() => document.querySelector('#item_type, .item-type')?.innerText.trim());
    console.log('itemType:', itemType);

    const analysisTexts = await page.evaluate(() => {
        const anaSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution', '.answer-content', '.subject-answer', '.question-answer'];
        let texts = [];
        for (const s of anaSelectors) {
            document.querySelectorAll(s).forEach(el => texts.push(el.innerText.trim()));
        }
        return texts;
    });
    console.log('Found analysis nodes:', analysisTexts.filter(t => t.length > 0));

    await browser.close();
}

run().catch(console.error);