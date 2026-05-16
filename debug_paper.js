const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(3000);

    console.log('访问历年真题列表...');
    await page.goto('https://www.xs507.com/Tiku/Product/index/product_id/317/subject_id/128/type/1.html');
    await page.waitForTimeout(3000);

    const paperUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => a.href.includes('14658') && (a.innerText.includes('做题') || a.innerText.includes('练习') || a.innerText.includes('模式') || a.closest('tr')));
        if (target) {
            const p = target.closest('li, tr, .item, .big');
            if (p) {
                const practiceBtn = p.querySelector('a[href*="/exam/"][href*="records_type/1"]');
                const examBtn = p.querySelector('a[href*="/exam/"]');
                if (practiceBtn) return practiceBtn.href;
                if (examBtn) return examBtn.href;
            }
            return target.href;
        }
        return null;
    });

    console.log('Paper URL:', paperUrl);
    if (!paperUrl) {
        await browser.close();
        return;
    }

    await page.goto(paperUrl + (paperUrl.includes('?') ? '&again=1' : '?again=1'));
    await page.waitForTimeout(5000);

    // 选背题模式
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); return (t === '背题模式' || t === '背题' || t === '显示答案');
        });
        if (btn) btn.click();
    });
    await page.waitForTimeout(3000);

    // 跳到第二题
    console.log('跳到第二题...');
    await page.evaluate(() => {
        const next = document.querySelector('.subject-next, #next_item');
        if (next) next.click();
    });
    await page.waitForTimeout(3000);

    console.log('点击解析...');
    await page.evaluate(() => {
        const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
        clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
            if (el.offsetParent !== null || el.innerText.includes('解析') || el.innerText.includes('答案')) el.click();
        }));
    });
    
    console.log('等待 8 秒...');
    await page.waitForTimeout(8000);

    const title = await page.evaluate(() => document.querySelector('.title, .item-title, .subject-title')?.innerText || '');
    console.log('Title:', title);
    
    const analysisTexts = await page.evaluate(() => {
        const anaSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution', '.answer-content', '.subject-answer', '.question-answer'];
        let texts = [];
        for (const s of anaSelectors) {
            document.querySelectorAll(s).forEach(el => {
                if (el.innerText && el.innerText.trim().length > 0) {
                    texts.push(el.innerText.trim());
                }
            });
        }
        return texts;
    });
    console.log('Analysis found:');
    analysisTexts.forEach(t => console.log(t.substring(0, 100) + '...'));

    await browser.close();
}

run().catch(console.error);