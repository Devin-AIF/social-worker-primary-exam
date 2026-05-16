
const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

const PAPER_URL = 'https://www.xs507.com/Tiku/Exam/index/paper_id/14658.html?again=1';

async function debug() {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录中...');
    await page.goto('https://www.xs507.com/Home/login/account.html');
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(5000);

    console.log('进入 2024 真题页面...');
    await page.goto(PAPER_URL);
    await page.waitForTimeout(5000);

    // 点击开始或练习模式
    const startBtn = await page.$('a:has-text("开始做题"), a:has-text("练习模式")');
    if (startBtn) await startBtn.click();
    await page.waitForTimeout(3000);

    // 切换到背题模式
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span')).find(el => 
            ['背题模式', '背题', '显示答案'].includes(el.innerText.trim())
        );
        if (btn) btn.click();
    });
    await page.waitForTimeout(3000);

    for (let i = 1; i <= 3; i++) {
        console.log(`\n--- 正在分析第 ${i} 题 ---`);
        
        const step = await page.innerText('#item_step, .item-step').catch(() => 'unknown');
        console.log(`当前题号: ${step}`);

        // 尝试触发解析
        console.log('触发解析按钮...');
        await page.evaluate(() => {
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
            clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
                if (el.offsetParent !== null) {
                    console.log('点击了:', s);
                    el.click();
                }
            }));
        });
        await page.waitForTimeout(2000);

        // 提取解析区域内容
        const analysisData = await page.evaluate(() => {
            const sel = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution'];
            const results = [];
            sel.forEach(s => {
                const el = document.querySelector(s);
                if (el) {
                    results.push({
                        selector: s,
                        text: el.innerText.trim().substring(0, 100) + '...',
                        visible: el.offsetParent !== null,
                        display: window.getComputedStyle(el).display
                    });
                }
            });
            return results;
        });
        console.log('解析区域状态:', JSON.stringify(analysisData, null, 2));

        // 截图留存
        await page.screenshot({ path: `debug_q${i}.png` });

        // 点击下一题
        console.log('点击下一题...');
        const nextBtn = await page.$('.subject-next, #next_item');
        if (nextBtn) {
            await nextBtn.click();
            await page.waitForTimeout(3000);
        } else {
            console.log('未找到下一题按钮');
            break;
        }
    }

    await browser.close();
}

debug().catch(console.error);
