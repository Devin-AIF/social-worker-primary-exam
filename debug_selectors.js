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

        const targetUrl = 'https://www.xs507.com/Tiku/Exam/index/product_id/317/know_id/372/records_type/1.html';
        console.log('Navigating to target chapter...');
        await page.goto(targetUrl);
        await page.waitForTimeout(5000);

        const startBtn = await page.$('a.enable.a2, a:has-text("开始做题"), a:has-text("练习模式")');
        if (startBtn) {
            await startBtn.click();
            await page.waitForTimeout(5000);
        }

        // Trigger Recitation Mode
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
                .find(el => (el.innerText || '').trim() === '背题模式' && el.offsetParent !== null);
            if (btn) btn.click();
        });
        await page.waitForTimeout(3000);

        // Capture HTML of the question area
        const container = await page.$('.subject-box, #item_form, .question-box');
        if (container) {
            const html = await container.innerHTML();
            fs.writeFileSync('question_structure.html', html);
            console.log('Question structure saved.');
        } else {
            const body = await page.content();
            fs.writeFileSync('full_page.html', body);
            console.log('Full page saved.');
        }

    } catch (e) {
        console.error('Debug failed:', e);
    } finally {
        await browser.close();
    }
}

debug();
