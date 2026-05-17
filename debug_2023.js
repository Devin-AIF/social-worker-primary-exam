
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = { user: '13510922043', pass: '265567' };
const TARGET_URL = 'https://www.xs507.com/Tiku/Papers/newExam/product_id/317/paper_id/13738/subject_id/107/records_type/1/is_again/0.html';

async function debug() {
    console.log('启动调试浏览器...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('正在登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(5000);

    console.log('进入 2023 真题页面...');
    await page.goto(TARGET_URL);
    await page.waitForTimeout(5000);

    console.log('触发背题模式...');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span')).find(el => 
            ['背题模式', '背题', '显示答案'].includes(el.innerText.trim())
        );
        if (btn) btn.click();
    });
    
    // 给网页足够的加载时间
    console.log('等待 10 秒让解析完全加载...');
    await page.waitForTimeout(10000);

    console.log('捕获原始数据...');
    const rawData = await page.evaluate(() => {
        const analysisBox = document.querySelector('#analysis');
        const itemListBox = document.querySelector('#itemlist');
        const answerQaBox = document.querySelector('.answer-qa');

        return {
            analysisHtml: analysisBox ? analysisBox.innerHTML : '未找到 #analysis',
            analysisText: analysisBox ? analysisBox.innerText : '未找到 #analysis',
            itemListHtml: itemListBox ? itemListBox.innerHTML : '未找到 #itemlist',
            answerQaHtml: answerQaBox ? answerQaBox.innerHTML : '未找到 .answer-qa'
        };
    });

    fs.writeFileSync('debug_raw_2023.json', JSON.stringify(rawData, null, 2));
    console.log('原始数据已保存到 debug_raw_2023.json');

    await page.screenshot({ path: 'debug_2023_final.png', fullPage: true });
    console.log('截图已保存到 debug_2023_final.png');

    await browser.close();
}

debug().catch(console.error);
