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
            log('正在进入产品索引页...');
            await page.goto('https://www.xs507.com/Tiku/Product/index/product_id/317/type/3.html').catch(() => {});
            await page.waitForTimeout(5000);
            
            const categoryLink = await page.$('a:has-text("章节练习")');
            if (categoryLink) {
                log('点击章节练习分类...');
                await categoryLink.click();
                await page.waitForTimeout(5000);
            }
            await page.screenshot({ path: 'product_list_v2.png' });
        }
        
        const targetChapter = await page.$('a:has-text("做题")');
        if (targetChapter) {
            const containerText = await page.evaluate(() => {
                const container = document.querySelector('.question-conten-list, .product-box, #main-tiku-box');
                return container ? container.innerText : 'Container not found';
            });
            log('容器文本: ' + containerText.substring(0, 500));
        }
        if (!targetChapter) {
            const allLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => a.innerText.trim()).filter(t => t.length > 0));
            log('页面链接列表: ' + allLinks.join(' | '));
        }
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
            const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length) && window.getComputedStyle(el).display !== 'none');
            const btns = Array.from(document.querySelectorAll('a, button, span, div'))
                .filter(el => {
                    const t = el.innerText.trim();
                    return (t === '查看解析' || t === '解析' || t === '查看答案' || t === '参考答案' || t === '显示答案') && isVisible(el);
                });
            btns.forEach(b => b.click());
        });
        
        log('等待解析内容加载...');
        await page.waitForFunction(() => {
            const el = document.querySelector('.analysis, #answer_analysis, .subject-answer, .answer-content, .solution');
            return el && el.innerText.trim().length > 20 && !el.innerText.includes('点击查看解析');
        }, { timeout: 8000 }).catch(() => log('解析加载超时'));

        const data = await page.evaluate(() => {
            const getStep = () => {
                const stepEl = document.querySelector('#item_step, .item-step');
                return stepEl ? stepEl.innerText.trim() : '0/0';
            };
            const analysisSelectors = ['.analysis', '#answer_analysis', '.subject-answer', '.answer-content', '.solution'];
            let ans = '无解析';
            for (const s of analysisSelectors) {
                const els = Array.from(document.querySelectorAll(s));
                for (const el of els) {
                    const t = el.innerText.trim();
                    if (t.length > 20 && !t.includes('点击查看解析')) {
                        ans = t;
                        return { step: getStep(), analysis: ans };
                    }
                }
            }
            return { step: getStep(), analysis: ans };
        });

        log(`题号: ${data.step} | 解析长度: ${data.analysis.length}`);
        console.log('--- 解析内容 ---');
        console.log(data.analysis);
        console.log('----------------');
        if (data.analysis.length > 20) log('解析提取成功!');
        else log('解析提取失败: ' + data.analysis);

    } catch (e) {
        log(`异常: ${e.message}`, 'ERROR');
    } finally {
        await browser.close();
    }
}

run();
