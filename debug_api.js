
const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = { user: '13510922043', pass: '265567' };
const TARGET_URL = 'https://www.xs507.com/Tiku/Papers/newExam/product_id/317/paper_id/13738/subject_id/107/records_type/1/is_again/0.html';

async function intercept() {
    console.log('启动 API 拦截器...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 监听所有响应
    page.on('response', async response => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        if (contentType.includes('application/json') || url.includes('json') || url.includes('get') || url.includes('item')) {
            try {
                const text = await response.text();
                if (text.includes('title') || text.includes('analysis') || text.includes('item')) {
                    console.log('发现疑似数据接口:', url);
                    fs.appendFileSync('intercepted_apis.log', `URL: ${url}\nResponse: ${text.substring(0, 1000)}...\n\n`);
                }
            } catch (e) {}
        }
    });

    console.log('正在登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(5000);

    console.log('进入目标页面...');
    await page.goto(TARGET_URL);
    await page.waitForTimeout(5000);

    console.log('触发背题模式...');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span')).find(el => 
            ['背题模式', '背题', '显示答案'].includes(el.innerText.trim())
        );
        if (btn) btn.click();
    });

    console.log('手动翻页几题以触发更多 API...');
    for (let i = 0; i < 3; i++) {
        await page.click('.subject-next').catch(() => {});
        await page.waitForTimeout(3000);
    }

    console.log('拦截完成，请检查 intercepted_apis.log');
    await browser.close();
}

intercept().catch(console.error);
