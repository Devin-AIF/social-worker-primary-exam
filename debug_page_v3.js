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

        // Subject ID 317: 中级社会工作实务
        const targetUrl = 'https://www.xs507.com/Tiku/Exam/index/product_id/317/know_id/372/records_type/1.html';
        console.log('Navigating to:', targetUrl);
        await page.goto(targetUrl);
        await page.waitForTimeout(5000);

        // Click "Start" if needed
        const startBtn = await page.$('a.enable.a2, a:has-text("开始做题"), a:has-text("练习模式"), a:has-text("继续做题"), a:has-text("重新做题")');
        if (startBtn) {
            console.log('Clicking start button...');
            await startBtn.click();
            await page.waitForTimeout(5000);
        }

        // Trigger analysis
        console.log('Triggering analysis...');
        await page.evaluate(() => {
            const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length) && window.getComputedStyle(el).display !== 'none');
            const buttons = Array.from(document.querySelectorAll('a, button, span, div'))
                .filter(el => {
                    const t = (el.innerText || '').trim();
                    return (t === '查看解析' || t === '解析' || t === '查看答案' || t === '参考答案' || t === '显示答案') && isVisible(el);
                });
            console.log(`Found ${buttons.length} potential buttons`);
            buttons.forEach(el => el.click());
        });
        await page.waitForTimeout(5000);

        const html = await page.content();
        fs.writeFileSync('debug_final_v3.html', html);
        console.log('Debug final v3 saved.');

    } catch (e) {
        console.error('Debug failed:', e);
    } finally {
        await browser.close();
    }
}

debug();
