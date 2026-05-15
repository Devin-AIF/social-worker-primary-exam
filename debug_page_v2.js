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
        await page.waitForTimeout(6000);

        // Subject ID 317: 中级社会工作实务
        // TIKU_LIST_URL
        console.log('Switching to subject 317...');
        await page.goto('https://www.xs507.com/Tiku/Tikulist/index.html');
        await page.waitForTimeout(3000);
        
        // Try to find the radio for 317
        await page.evaluate((pid) => {
            const radio = document.querySelector(`input[name="change_id"][value="${pid}"]`);
            if (radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.dispatchEvent(new Event('click', { bubbles: true }));
            }
        }, '317');
        await page.waitForTimeout(3000);

        // Click confirm if present
        const confirmBtn = await page.$('button:has-text("确认"), a:has-text("确认切换")');
        if (confirmBtn) await confirmBtn.click();
        await page.waitForTimeout(5000);

        // Navigate to 章节练习
        // Based on script logic: https://www.xs507.com/Tiku/Product/index/product_id/317/subject_id/XXX/type/3.html
        // Let's just find the link on the page
        const chapterLink = await page.$('a:has-text("章节练习")');
        if (chapterLink) {
            console.log('Clicking 章节练习...');
            await chapterLink.click();
            await page.waitForTimeout(5000);
        }

        // Find "第一章　社会工作服务通用模式"
        const specificChapter = await page.$('a:has-text("第一章　社会工作服务通用模式")');
        if (specificChapter) {
            console.log('Clicking target chapter...');
            await specificChapter.click();
            await page.waitForTimeout(5000);
        }

        // Final question page
        console.log('At question page. URL:', page.url());
        
        // Trigger analysis
        console.log('Triggering analysis...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('a, button, span, div'))
                .filter(el => {
                    const t = (el.innerText || '').trim();
                    const isVisible = !!(el.offsetParent || el.getClientRects().length);
                    return (t === '查看解析' || t === '解析' || t === '查看答案' || t === '参考答案') && isVisible;
                });
            console.log(`Found ${buttons.length} potential buttons`);
            buttons.forEach(el => el.click());
        });
        await page.waitForTimeout(5000);

        const html = await page.content();
        fs.writeFileSync('debug_final.html', html);
        console.log('Debug final saved.');

    } catch (e) {
        console.error('Debug failed:', e);
    } finally {
        await browser.close();
    }
}

debug();
