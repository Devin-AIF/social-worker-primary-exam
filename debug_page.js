const { chromium } = require('playwright');
const fs = require('fs');

async function debug() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('Logging in...');
        await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
        await page.fill('input[placeholder*="手机号"]', '13510922043');
        await page.fill('input[placeholder*="密码"]', '265567');
        await page.click('.login-form-btn');
        await page.waitForTimeout(5000);

        // Navigate to the specific chapter/question mentioned by the user
        // Subject ID 317 is "2026年中级社会工作者《中级社会工作实务》"
        // Chapter ID know-372
        const targetUrl = 'https://www.xs507.com/Tiku/Exam/index/product_id/317/know_id/372/records_type/1.html';
        console.log('Navigating to target chapter...');
        await page.goto(targetUrl);
        await page.waitForTimeout(5000);

        // Click "Start" if needed
        const startBtn = await page.$('a.enable.a2, a:has-text("开始做题"), a:has-text("练习模式")');
        if (startBtn) {
            console.log('Clicking start button...');
            await startBtn.click();
            await page.waitForTimeout(5000);
        }

        // Capture HTML before triggering
        const htmlBefore = await page.content();
        fs.writeFileSync('debug_before.html', htmlBefore);

        // Try to trigger analysis
        console.log('Triggering analysis...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('a, button, span, div'))
                .filter(el => {
                    const t = (el.innerText || '').trim();
                    return (t === '查看解析' || t === '解析' || t === '查看答案' || t === '参考答案');
                });
            buttons.forEach(el => el.click());
        });
        await page.waitForTimeout(3000);

        // Capture HTML after triggering
        const htmlAfter = await page.content();
        fs.writeFileSync('debug_after.html', htmlAfter);

        console.log('Debug files saved.');
    } catch (e) {
        console.error('Debug failed:', e);
    } finally {
        await browser.close();
    }
}

debug();
