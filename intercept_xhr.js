
const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = { user: '13510922043', pass: '265567' };
const TARGET_URL = 'https://www.xs507.com/Tiku/Papers/newExam/product_id/317/paper_id/13738/subject_id/107/records_type/1/is_again/0.html';

async function intercept() {
    console.log('启动 XHR 拦截器...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let foundData = false;

    page.on('response', async response => {
        const url = response.url();
        const request = response.request();
        if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
            try {
                const text = await response.text();
                // 只要包含题目相关的关键词，就保存
                if (text.includes('title') || text.includes('analysis') || text.includes('item') || text.includes('subject')) {
                    console.log('拦截到疑似数据:', url);
                    fs.writeFileSync(`api_response_${Date.now()}.json`, text);
                    foundData = true;
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
    await page.waitForTimeout(8000); // 增加等待时间

    console.log('触发背题模式...');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span')).find(el => 
            ['背题模式', '背题', '显示答案'].includes(el.innerText.trim())
        );
        if (btn) btn.click();
    });
    await page.waitForTimeout(5000);

    if (!foundData) {
        console.log('未通过 XHR 拦截到数据，尝试检查 window 变量...');
        const state = await page.evaluate(() => {
            // 尝试寻找常见的 Vue 或数据变量
            return window.all_items || window.items || window.data || window.questions;
        });
        if (state) {
            console.log('在 window 变量中找到数据!');
            fs.writeFileSync('window_data.json', JSON.stringify(state, null, 2));
        }
    }

    await browser.close();
}

intercept().catch(console.error);
