
const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

const PAPER_ID = '14658';
const PAPER_URL = `https://www.xs507.com/Tiku/Exam/index/paper_id/${PAPER_ID}.html?again=1`;

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

    console.log(`进入真题页面: ${PAPER_URL}`);
    await page.goto(PAPER_URL);
    await page.waitForTimeout(5000);

    // 检查是否有“开始做题”或“练习模式”
    const startBtn = await page.$('a:has-text("开始做题"), a:has-text("练习模式")');
    if (startBtn) {
        console.log('点击开始按钮...');
        await startBtn.click();
        await page.waitForTimeout(3000);
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
            // 清理干扰弹窗
            document.querySelectorAll('.layui-layer-shade, .layui-layer, .layerSaveSuccess, .layui-layer-close').forEach(el => el.remove());
            
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
            clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
                if (el.offsetParent !== null || el.innerText.includes('解析') || el.innerText.includes('答案')) el.click();
            }));
            
            // 强行显示所有可能的解析容器
            const anaSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution'];
            anaSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    el.style.display = 'block';
                    el.style.visibility = 'visible';
                });
            });
        });
        await page.waitForTimeout(3000);

        const analysisData = await page.evaluate(() => {
            const sel = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution'];
            let results = [];
            sel.forEach(s => {
                const els = document.querySelectorAll(s);
                els.forEach((el, idx) => {
                    results.push({
                        selector: s,
                        index: idx,
                        text: el.innerText.trim(),
                        visible: el.offsetParent !== null,
                        html: el.innerHTML.substring(0, 100)
                    });
                });
            });
            return results;
        });

        console.log(`找到 ${analysisData.length} 个可能的解析容器:`);
        analysisData.forEach(d => {
            if (d.text.length > 0) {
                console.log(`- [${d.selector}] 内容: ${d.text.substring(0, 50)}... (长度: ${d.text.length})`);
            } else {
                console.log(`- [${d.selector}] 为空`);
            }
        });

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
