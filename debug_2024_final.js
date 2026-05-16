
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
    await page.waitForTimeout(5000);

    console.log('\n--- 分析当前题 (2024 真题) ---');
    
    // 截图
    await page.screenshot({ path: 'debug_2024_q1_before_click.png', fullPage: true });

    // 尝试找出并点击“显示解析”按钮（使用 Playwright 的真实点击）
    const clickAnalysisBtn = await page.locator('.click_analysis, :text("点击查看解析")').first();
    if (await clickAnalysisBtn.isVisible()) {
        console.log('找到可见的解析按钮，正在点击...');
        await clickAnalysisBtn.click();
    } else {
        console.log('解析按钮不可见，尝试强制点击...');
        await page.evaluate(() => {
            const btn = document.querySelector('.click_analysis, :text("点击查看解析")');
            if (btn) {
                btn.style.display = 'block';
                btn.click();
            }
        });
    }

    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'debug_2024_q1_after_click.png', fullPage: true });

    const content = await page.evaluate(() => {
        return {
            title: document.querySelector('.subject-title, .item-title')?.innerText.trim(),
            analysis: document.querySelector('#analysis, .analysis')?.innerText.trim(),
            allText: document.body.innerText.substring(0, 5000)
        };
    });

    console.log('Title:', content.title);
    console.log('Analysis:', content.analysis);
    console.log('Is Analysis in body?', content.allText.includes('参考答案') || content.allText.includes('解析'));

    // 保存 HTML 以便深度分析
    fs.writeFileSync('debug_2024_page.html', await page.content());

    await browser.close();
}

run().catch(console.error);
