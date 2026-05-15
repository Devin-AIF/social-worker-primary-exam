const { chromium } = require('playwright');
const fs = require('fs');

async function debug() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('Logging in...');
        await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', '13510922043');
        await page.fill('input[placeholder*="密码"]', '265567');
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);

        const targetUrl = 'https://www.xs507.com/Tiku/NewKnows/index?product_id=317&subject_id=107&know_id=372&itemtype=0&num=9999&type=1&again=0';
        console.log('Navigating to target chapter...');
        await page.goto(targetUrl);
        await page.waitForTimeout(5000);

        // Jump to question 6
        console.log('Jumping to Q6...');
        await page.evaluate(() => {
            const cardBtn = document.querySelector('.bd_dtk, .answer-card-btn, #tiku_sheet');
            if (cardBtn) cardBtn.click();
        });
        await page.waitForTimeout(1000);
        await page.evaluate(() => {
            const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
            if (cards[5]) cards[5].click();
        });
        await page.waitForTimeout(3000);

        // Trigger Recitation Mode
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
                .find(el => (el.innerText || '').trim() === '背题模式' && el.offsetParent !== null);
            if (btn) btn.click();
        });
        await page.waitForTimeout(3000);

        const analysisInfo = await page.evaluate(() => {
            const results = [];
            const sel = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis', '#analysis', '.tiku-analysis', '.subject-answer', '.answer-content'];
            sel.forEach(s => {
                const els = document.querySelectorAll(s);
                els.forEach((el, idx) => {
                    results.push({
                        selector: s,
                        index: idx,
                        visible: !!(el.offsetParent || el.getClientRects().length),
                        text: el.innerText.substring(0, 200)
                    });
                });
            });
            return results;
        });

        console.log('Analysis Selectors check for Q6:');
        console.log(JSON.stringify(analysisInfo, null, 2));

    } catch (e) {
        console.error('Debug failed:', e);
    } finally {
        await browser.close();
    }
}

debug();
