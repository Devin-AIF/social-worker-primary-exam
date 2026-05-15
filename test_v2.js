const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    console.log(formattedMessage.trim());
}

async function sleep(ms) { await new Promise(resolve => setTimeout(resolve, ms)); }
async function randomSleep(min, max) { await sleep(Math.floor(Math.random() * (max - min + 1)) + min); }

const AUTH = { user: '13510922043', pass: '265567' };
const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';
const OUTPUT_DIR = path.join(__dirname, '抓取结果_测试');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function triggerOfficialAnalysis(page) {
    await page.evaluate(() => {
        const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length) && window.getComputedStyle(el).display !== 'none');
        const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.answer-analysis', '.btn-analysis', '.show-answer', '#show_answer_btn', '.view-solution', '.btn-answer'];
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
        const analysisSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis', '.tiku-analysis', '.answer-detail', '#answer_analysis_detail', '.subject-answer', '.answer-content', '.question-answer', '#answer', '.solution'];
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
        return { type: '问答题', step, title: titleText, analysis: analysisText };
    });
}

async function run() {
    log('开始测试运行...', 'INFO');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        log('登录中...', 'INFO');
        await page.goto(LOGIN_URL);
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);

        // 直接进入目标章节
        const targetUrl = 'https://www.xs507.com/Tiku/Exam/index/product_id/317/know_id/372/records_type/1.html';
        log(`进入章节: ${targetUrl}`, 'INFO');
        await page.goto(targetUrl);
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'test_start.png' });

        const startBtn = await page.$('a.enable.a2, a:has-text("开始做题"), a:has-text("练习模式"), a:has-text("继续做题"), a:has-text("重新做题")');
        if (startBtn) {
            log('点击开始按钮...', 'INFO');
            await startBtn.click();
            await page.waitForTimeout(5000);
            await page.screenshot({ path: 'test_after_start.png' });
        }

        for (let i = 1; i <= 3; i++) {
            log(`正在抓取第 ${i} 题...`, 'INFO');
            await triggerOfficialAnalysis(page);
            await randomSleep(2000, 3000);
            const data = await readQuestionData(page);
            log(`题号: ${data.step} | 解析长度: ${data.analysis.length}`, 'INFO');
            console.log(`解析内容预览: ${data.analysis.substring(0, 50)}...`);

            if (i < 3) {
                const next = await page.$('.subject-next, #next_item');
                if (next) {
                    await next.click();
                    await page.waitForTimeout(3000);
                }
            }
        }

    } catch (e) {
        log(`测试异常: ${e.message}`, 'ERROR');
    } finally {
        await browser.close();
        rl.close();
    }
}

run();
