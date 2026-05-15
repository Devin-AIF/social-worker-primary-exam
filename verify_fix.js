const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

async function triggerOfficialAnalysis(page) {
    await page.evaluate(() => {
        const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length) && window.getComputedStyle(el).display !== 'none');
        const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.answer-analysis', '.btn-analysis', '.show-answer', '#show_answer_btn', '.view-solution', '.btn-answer', '.view-answer'];
        for (const s of clickSelectors) {
            document.querySelectorAll(s).forEach(el => { if (isVisible(el)) el.click(); });
        }
        const textButtons = Array.from(document.querySelectorAll('a, button, span, div'))
            .filter(el => {
                const t = (el.innerText || '').trim();
                return (t === '查看解析' || t === '解析' || t === '参考解析' || t === '答案解析' || t === '查看答案' || t === '参考答案' || t === '显示答案') && isVisible(el);
            });
        textButtons.forEach(el => el.click());
    });
    await page.waitForTimeout(2000);
}

async function readQuestionData(page) {
    return page.evaluate(() => {
        const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length) && window.getComputedStyle(el).display !== 'none');
        const getStep = () => {
            const sel = ['#item_step', '.item-step', '.question-step', '.subject-step', '.step', '.step-num'];
            for (const s of sel) {
                const el = document.querySelector(s);
                if (el && el.innerText.includes('/')) return el.innerText.trim();
            }
            return '0/0';
        };
        const step = getStep();
        const titleEl = document.querySelector('#item_title, .item-title, .subject-title, .question-title');
        const titleText = titleEl ? titleEl.innerText.trim() : '无标题';
        
        let analysisText = '无解析';
        const analysisSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis', '.tiku-analysis', '.answer-detail', '#answer_analysis_detail', '.subject-answer', '.answer-content', '.question-answer', '#answer', '.solution', '.jiexi-content'];
        for (const s of analysisSelectors) {
            const el = document.querySelector(s);
            if (el && isVisible(el)) {
                const t = el.innerText.trim();
                if (t.length > 5 && !t.includes('点击查看解析')) {
                    analysisText = t;
                    break;
                }
            }
        }
        return { step, title: titleText, analysis: analysisText };
    });
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

        const targetUrl = 'https://www.xs507.com/Tiku/Exam/index/product_id/317/know_id/372/records_type/1.html';
        log(`进入章节: ${targetUrl}`);
        await page.goto(targetUrl);
        await page.waitForTimeout(5000);

        const startBtn = await page.$('a.enable.a2, a:has-text("开始做题"), a:has-text("练习模式"), a:has-text("继续做题"), a:has-text("重新做题")');
        if (startBtn) {
            log('点击开始按钮');
            await startBtn.click();
            await page.waitForTimeout(5000);
        }

        for (let i = 1; i <= 2; i++) {
            log(`抓取第 ${i} 题...`);
            await triggerOfficialAnalysis(page);
            await page.waitForTimeout(2000);
            const data = await readQuestionData(page);
            log(`结果: 题号=${data.step}, 解析长度=${data.analysis.length}`);
            if (data.analysis.length > 10) log(`解析成功!`);
            else log(`解析失败: ${data.analysis}`);

            const next = await page.$('.subject-next, #next_item');
            if (next) {
                await next.click();
                await page.waitForTimeout(3000);
            }
        }
    } catch (e) {
        log(`异常: ${e.message}`, 'ERROR');
    } finally {
        await browser.close();
    }
}

run();
