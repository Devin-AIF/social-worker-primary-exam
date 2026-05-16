
const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

async function run() {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.waitForTimeout(2000);
    await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(6000);

    console.log('访问 2024 真题...');
    await page.goto('https://www.xs507.com/Tiku/Papers/exam/product_id/317/paper_id/14658/subject_id/107/records_type/2/is_again/1.html');
    await page.waitForTimeout(5000);

    // 选背题模式
    console.log('切换背题模式...');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); 
            return (t === '背题模式' || t === '背题' || t === '显示答案');
        });
        if (btn) btn.click();
    });
    await page.waitForTimeout(3000);

    for (let i = 1; i <= 2; i++) {
        console.log(`\n--- 正在分析第 ${i} 题 ---`);
        
        const btnInfo = await page.evaluate(() => {
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn', '.subject-action a', '.analysis-action a'];
            let btns = [];
            clickSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    btns.push({
                        selector: s,
                        text: el.innerText.trim(),
                        visible: el.offsetParent !== null,
                        html: el.outerHTML,
                        className: el.className,
                        id: el.id
                    });
                });
            });
            return btns;
        });

        console.log(`找到 ${btnInfo.length} 个可能的按钮:`);
        btnInfo.forEach(b => {
            if (b.visible) {
                console.log(`- [VISIBLE] ${b.selector} | Text: ${b.text} | HTML: ${b.html.substring(0, 100)}...`);
            }
        });

        console.log('点击解析按钮...');
        await page.evaluate(() => {
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
            clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
                if (el.offsetParent !== null) el.click();
            }));
        });
        await page.waitForTimeout(5000); // 增加等待时间到 5 秒

        const analysisHtml = await page.evaluate(() => document.querySelector('#analysis')?.innerHTML || 'NOT FOUND');
        console.log('Analysis HTML snippet:', analysisHtml.substring(0, 300));

        if (i < 2) {
            console.log('点击下一题...');
            await page.click('.subject-next, #next_item');
            await page.waitForTimeout(3000);
        }
    }

    await browser.close();
}

run().catch(console.error);
