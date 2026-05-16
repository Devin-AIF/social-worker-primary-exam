
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

    console.log('访问历年真题列表...');
    // 使用中级实务的 product_id=317
    await page.goto('https://www.xs507.com/Tiku/Product/index/product_id/317/type/1.html');
    await page.waitForTimeout(5000);

    const paperUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => a.innerText.includes('2024') && a.innerText.includes('真题'));
        if (target) {
            const p = target.closest('li, tr, .item, .big');
            if (p) {
                const btn = p.querySelector('a[href*="/exam/"]');
                return btn ? btn.href : target.href;
            }
            return target.href;
        }
        return null;
    });

    console.log('找到的 Paper URL:', paperUrl);
    if (!paperUrl) {
        console.log('未找到 2024 真题链接');
        await page.screenshot({ path: 'paper_list_failed.png' });
        await browser.close();
        return;
    }

    await page.goto(paperUrl + (paperUrl.includes('?') ? '&again=1' : '?again=1'));
    await page.waitForTimeout(5000);

    // 检查是否在做题页
    const hasStep = await page.$('#item_step, .item-step');
    if (!hasStep) {
        console.log('未进入做题页，尝试点击开始按钮...');
        const startBtn = await page.$('a:has-text("开始做题"), a:has-text("练习模式"), a:has-text("继续做题")');
        if (startBtn) {
            await startBtn.click();
            await page.waitForTimeout(5000);
        }
    }

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

    for (let i = 1; i <= 3; i++) {
        console.log(`\n--- 正在处理第 ${i} 题 ---`);
        const step = await page.innerText('#item_step, .item-step').catch(() => 'unknown');
        const title = await page.innerText('#item_title, .item-title, .subject-title').catch(() => 'no title');
        console.log(`Step: ${step}, Title: ${title.substring(0, 50)}...`);

        console.log('触发解析...');
        await page.evaluate(() => {
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
            clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
                if (el.offsetParent !== null || el.innerText.includes('解析') || el.innerText.includes('答案')) el.click();
            }));
        });
        await page.waitForTimeout(3000);

        const analysisData = await page.evaluate(() => {
            const sel = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution'];
            let results = [];
            sel.forEach(s => {
                const els = document.querySelectorAll(s);
                els.forEach((el, idx) => {
                    const text = el.innerText.trim();
                    if (text.length > 0) {
                        results.push({ selector: s, text: text.substring(0, 100) });
                    }
                });
            });
            return results;
        });

        console.log(`找到 ${analysisData.length} 个非空解析容器:`);
        analysisData.forEach(d => console.log(`- [${d.selector}]: ${d.text}...`));

        if (i < 3) {
            console.log('点击下一题...');
            const nextBtn = await page.$('.subject-next, #next_item');
            if (nextBtn) {
                await nextBtn.click();
                await page.waitForTimeout(3000);
            } else {
                console.log('没找到下一题按钮');
                break;
            }
        }
    }

    await browser.close();
}

run().catch(console.error);
