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

        // Trigger Recitation Mode
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
                .find(el => (el.innerText || '').trim() === '背题模式' && el.offsetParent !== null);
            if (btn) btn.click();
        });
        await page.waitForTimeout(3000);

        const info = await page.evaluate(() => {
            const results = [];
            const all = document.querySelectorAll('*');
            all.forEach(el => {
                if (el.innerText && el.innerText.includes('参考答案') && el.children.length < 5) {
                    results.push({
                        tag: el.tagName,
                        className: el.className,
                        id: el.id,
                        text: el.innerText.substring(0, 100)
                    });
                }
            });
            return results;
        });

        console.log('Found elements with "参考答案":');
        console.log(JSON.stringify(info, null, 2));

    } catch (e) {
        console.error('Debug failed:', e);
    } finally {
        await browser.close();
    }
}

debug();
