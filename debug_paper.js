const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

async function run() {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(3000);

    const PAPER_URL = 'https://www.xs507.com/Tiku/Product/detail/paper_id/14658.html';
    console.log(`跳转到试卷详情页 ${PAPER_URL}...`);
    await page.goto(PAPER_URL);
    await page.waitForTimeout(3000);

    // 点击开始做题
    await page.evaluate(() => {
        const startSelectors = ['a.enable.a2', 'a:has-text("开始做题")', 'a:has-text("练习模式")', '#PaperStartTimes'];
        for (const selector of startSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.click();
                break;
            }
        }
    });
    await page.waitForTimeout(4000);

    // 点击背题模式
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); return (t === '背题模式' || t === '背题' || t === '显示答案');
        });
        if (btn) btn.click();
    });
    await page.waitForTimeout(2000);

    // 跳转到第 2 题
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
    await page.waitForTimeout(3000);

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
            document.querySelectorAll(s).forEach(el => {
                if (el.innerText && el.innerText.trim().length > 0) {
                    texts.push(el.innerText.trim());
                }
            });
        }
        return texts;
    });
    console.log('Found analysis nodes:', analysisTexts);

    await browser.close();
}

run().catch(console.error);