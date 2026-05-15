const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        log('登录中...');
        await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', '13510922043');
        await page.fill('input[placeholder*="密码"]', '265567');
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);

        // Subject 317: 中级实务
        // Go to Tikulist and switch
        log('切换题库...');
        await page.goto('https://www.xs507.com/Tiku/Tikulist/index.html');
        await page.evaluate(() => {
            const radio = document.querySelector('input[value="317"]');
            if (radio) radio.click();
        });
        await page.click('button:has-text("确认"), a:has-text("确认切换")').catch(() => {});
        await page.waitForTimeout(5000);

        // Find "第一章　社会工作服务通用模式"
        log('寻找章节...');
        const chapter = await page.$('a:has-text("第一章　社会工作服务通用模式")');
        if (!chapter) {
            // Try searching in the page
            await page.goto('https://www.xs507.com/Tiku/Product/index/product_id/317/subject_id/1/type/3.html').catch(() => {});
            await page.waitForTimeout(3000);
        }
        
        const targetChapter = await page.$('a:has-text("第一章　社会工作服务通用模式")');
        if (targetChapter) {
            log('进入章节');
            await targetChapter.click();
            await page.waitForTimeout(5000);
        } else {
            log('未找到章节');
            return;
        }

        const startBtn = await page.$('a.enable.a2, a:has-text("开始做题"), a:has-text("练习模式")');
        if (startBtn) {
            log('点击开始按钮');
            await startBtn.click();
            await page.waitForTimeout(5000);
        }

        log('当前 URL: ' + page.url());
        
        // Trigger analysis
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('a, button, span, div'))
                .filter(el => {
                    const t = el.innerText.trim();
                    return t === '查看解析' || t === '解析' || t === '查看答案' || t === '参考答案' || t === '显示答案';
                });
            btns.forEach(b => b.click());
        });
        await page.waitForTimeout(3000);

        const data = await page.evaluate(() => {
            const getStep = () => {
                const stepEl = document.querySelector('#item_step, .item-step');
                return stepEl ? stepEl.innerText.trim() : '0/0';
            };
            const analysisSelectors = ['.analysis', '#answer_analysis', '.subject-answer', '.answer-content', '.solution'];
            let ans = '无解析';
            for (const s of analysisSelectors) {
                const el = document.querySelector(s);
                if (el && el.innerText.trim().length > 10) { ans = el.innerText.trim(); break; }
            }
            return { step: getStep(), analysis: ans };
        });

        log(`题号: ${data.step} | 解析长度: ${data.analysis.length}`);
        if (data.analysis.length > 20) log('解析提取成功!');
        else log('解析提取失败: ' + data.analysis);

    } catch (e) {
        log(`异常: ${e.message}`, 'ERROR');
    } finally {
        await browser.close();
    }
}

run();
