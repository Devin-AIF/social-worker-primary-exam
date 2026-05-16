/**
 * =================================================================================
 * 自动化抓取脚本 V5.0 (全自动登录 + 深度清洗 + 图片本地化)
 * =================================================================================
 */

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

function askUser(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// --- 配置与常量 ---
const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';
const PROJECT_ROOT = __dirname;
const OUTPUT_DIR = path.join(PROJECT_ROOT, '抓取结果_V5'); 
const LOG_FILE = path.join(PROJECT_ROOT, 'crawler.log'); 
const STATUS_FILE = path.join(OUTPUT_DIR, 'completion_status.json'); 
const DEBUG_DIR = path.join(PROJECT_ROOT, 'debug_screenshots'); 
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const ENABLE_DISCUSSION_FALLBACK = true;

// --- 辅助函数 ---
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    process.stdout.write(formattedMessage);
    fs.appendFileSync(LOG_FILE, formattedMessage);
}

function sanitizeFileName(name) {
    return name.replace(/[\\/:\*\?"<>\|]/g, '_').trim();
}

async function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, ms));
}

// --- 核心引擎 ---

async function handlePopup(page) {
    await page.evaluate(() => {
        const shades = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg', '.mask', '.loading-mask', '.hide', '.analysis-lock'];
        shades.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        try {
            localStorage.clear(); sessionStorage.clear();
            document.querySelectorAll('.hide, .hidden').forEach(el => el.classList.remove('hide', 'hidden'));
            const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer', '.answer-content'];
            analysisSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    el.style.display = 'block';
                    el.style.visibility = 'visible';
                    el.style.opacity = '1';
                });
            });
            document.querySelectorAll('[style*="display: none"]').forEach(el => {
                if (el.id !== 'item_star') el.style.display = 'block';
            });
        } catch(e) {}
    });
}

async function safeClick(page, selector, waitAfter = 0) {
    const element = await page.$(selector);
    if (!element) return false;
    await handlePopup(page);
    try {
        await element.click({ force: true, timeout: 5000 });
    } catch (e) {
        await element.evaluate(el => el.click()).catch(() => {});
    }
    if (waitAfter > 0) await page.waitForTimeout(waitAfter + Math.random() * 500);
    return true;
}

async function triggerOfficialAnalysis(page, oldAnalysisFingerprint = '') {
    const trigger = async () => {
        await page.evaluate(() => {
            document.querySelectorAll('.layui-layer-shade, .layui-layer, .layerSaveSuccess, .layui-layer-close').forEach(el => el.remove());
            const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer', '.answer-content'];
            analysisSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    el.style.display = 'block'; el.style.visibility = 'visible'; el.style.opacity = '1';
                });
            });
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
            clickSelectors.forEach(s => document.querySelectorAll(s).forEach(el => { if (el.style.display !== 'none') el.click(); }));
        });
    };
    await handlePopup(page);
    await trigger();
    await page.waitForTimeout(2000);
    return await page.waitForFunction((oldFinger) => {
        const sel = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis', '#analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution'];
        for (const s of sel) {
            const el = document.querySelector(s);
            if (el && el.innerText.trim().length > 5 && !el.innerText.includes('点击查看解析')) {
                const currentFinger = el.innerText.trim().replace(/\s/g, '').substring(0, 100);
                if (!oldFinger || currentFinger !== oldFinger) return true;
            }
        }
        return false;
    }, oldAnalysisFingerprint, { timeout: 3000 }).catch(() => false);
}

async function readQuestionData(page, oldAnalysisFingerprint = '') {
    return page.evaluate(({ ENABLE_DISCUSSION_FALLBACK, oldAnalysisFingerprint }) => {
        const step = (document.querySelector('#item_step, .item-step')?.innerText || '0/0').trim();
        const images = [];
        const processContent = (el, prefix) => {
            if (!el) return '';
            const clone = el.cloneNode(true);
            const junkSelectors = ['.click_analysis', '.err_correct', '.remove_wrong', '.video_analysis', '.subject-action', '.analysis-action', 'button', 'a', '.report-error', '.show_child', '.fr'];
            junkSelectors.forEach(s => clone.querySelectorAll(s).forEach(sub => sub.remove()));
            clone.querySelectorAll('img').forEach((img, idx) => {
                let src = img.getAttribute('src') || img.getAttribute('data-src') || img.src;
                if (!src) return;
                if (src.startsWith('//')) src = 'https:' + src;
                const name = `q_${step.replace(/\//g, '_')}_${prefix}_${idx}.png`;
                images.push({ name, url: src });
                img.replaceWith(` ![图](./images/${name}) `);
            });
            let text = clone.innerText.trim();
            const junkPatterns = [/点击查看解析/g, /收起解析/g, /视频解析/g, /我要纠错/g, /从错题本移除/g, /提交/g, /\[视频解析\]/g, /\[查看解析\]/g, /查看视频/g, /听课/g, /展开解析/g];
            junkPatterns.forEach(p => text = text.replace(p, ''));
            return text.trim();
        };
        const titleEl = document.querySelector('#item_title, .item-title, .subject-title');
        const subTitleEl = document.querySelector('.subject-sub-title, .question-sub-title');
        let stemText = processContent(titleEl, 'stem');
        let titleText = processContent(subTitleEl, 'tit');
        if (!titleText) { titleText = stemText; stemText = ''; }
        const fetchOptions = () => {
            const selectors = ['#item_options li', '.options li', '.question-options li', '.subject-option li', '.option-list li'];
            for (const s of selectors) {
                const items = document.querySelectorAll(s);
                if (items.length > 0) return Array.from(items).map((li, idx) => processContent(li, `opt${idx}`)).join('\n');
            }
            return '';
        };
        const optionsList = fetchOptions();
        let finalAnswer = '未知';
        let finalAnalysis = '无解析';
        const ansSelectors = ['.right', '.answer-yes', '#answer_right', '.correct-answer', '.subject-answer'];
        for (const s of ansSelectors) {
            const el = document.querySelector(s);
            if (el) {
                let t = el.innerText.replace(/^(正确答案|答案)[：:\s]*/, '').trim();
                if (t) { finalAnswer = t; break; }
            }
        }
        const anaSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '#analysis', '.analysis', '.item_analysis', '#item_analysis', '.jiexi-content', '.solution', '.answer-content'];
        let fullAnaText = '';
        for (const s of anaSelectors) {
            const el = document.querySelector(s);
            if (el) {
                fullAnaText = processContent(el, 'ans');
                if (fullAnaText.length > 5) break;
            }
        }
        if (fullAnaText) {
            if (finalAnswer === '未知' && /(参考答案|正确答案)[：:\n]/.test(fullAnaText)) {
                const anaMatch = fullAnaText.match(/(参考解析|题目解析|答案解析|解析)[：:\n]/);
                if (anaMatch) {
                    const parts = fullAnaText.split(anaMatch[0]);
                    finalAnswer = parts[0].replace(/^[\s\S]*?(参考答案|正确答案)[：:\n\s]*/, '').trim();
                    finalAnalysis = parts.slice(1).join(anaMatch[0]).trim();
                } else if (fullAnaText.includes('暂无解析')) {
                    finalAnswer = fullAnaText.split('暂无解析')[0].replace(/^[\s\S]*?(参考答案|正确答案)[：:\n\s]*/, '').trim();
                    finalAnalysis = '无';
                } else {
                    finalAnswer = fullAnaText.replace(/^[\s\S]*?(参考答案|正确答案)[：:\n\s]*/, '').trim();
                    finalAnalysis = '无';
                }
            } else {
                finalAnalysis = fullAnaText.replace(/^(参考解析|答案解析|解析)[：:\n\s]*/i, '').trim();
                if (finalAnalysis === '') finalAnalysis = fullAnaText;
            }
        }
        const titleFinger = titleText.replace(/\s/g, '');
        if (finalAnalysis.replace(/\s/g, '').includes(titleFinger) && finalAnalysis.length < titleText.length + 50) {
            finalAnalysis = '无解析 (抓取冲突已拦截)';
        }
        return {
            type: document.querySelector('#item_type, .item-type')?.innerText.trim() || '题型',
            step, itemId: document.querySelector('#item_id')?.innerText.trim() || '',
            stem: stemText, title: titleText, options: optionsList,
            answer: finalAnswer, analysis: finalAnalysis, images,
            fingerprint: (step + titleText.substring(0, 30)).replace(/\s/g, ''),
            analysisFingerprint: fullAnaText.replace(/\s/g, '').substring(0, 100)
        };
    }, { ENABLE_DISCUSSION_FALLBACK, oldAnalysisFingerprint });
}

async function waitForQuestionChange(page, oldStep, oldItemId) {
    await page.waitForFunction(({ oldStep, oldItemId }) => {
        const currentStep = (document.querySelector('#item_step, .item-step')?.innerText || '').trim();
        const currentId = (document.querySelector('#item_id')?.innerText || '').trim();
        return (currentStep && currentStep !== oldStep) || (currentId && currentId !== oldItemId);
    }, { oldStep, oldItemId }, { timeout: 12000 }).catch(() => {});
    await page.waitForFunction(() => {
        const el = document.querySelector('#item_title, .item-title, .subject-title');
        return el && el.innerText.trim().length > 0;
    }, { timeout: 5000 }).catch(() => {});
    await randomSleep(1000, 1500); 
}

async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    const finalUrl = (questionIndex === 0 && !chapterUrl.includes('again=1')) ? (chapterUrl.includes('?') ? `${chapterUrl}&again=1` : `${chapterUrl}?again=1`) : chapterUrl;
    await page.goto(finalUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await handlePopup(page);
    const startSelectors = ['a.enable.a2', 'a:has-text("开始做题")', 'a:has-text("练习模式")', '#PaperStartTimes'];
    for (const selector of startSelectors) { if (await safeClick(page, selector, 5000)) break; }
    
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); return (t === '背题模式' || t === '背题' || t === '显示答案');
        });
        if (btn) btn.click();
    });
    await randomSleep(3000, 5000);
    await handlePopup(page);

    if (questionIndex > 0) {
        log(`正在跳转到题号: ${questionIndex + 1}`, 'DEBUG');
        await page.evaluate(() => { const cardBtn = document.querySelector('.bd_dtk, #tiku_sheet, .answer-card-btn'); if (cardBtn) cardBtn.click(); });
        await page.waitForTimeout(1000);
        const jumped = await page.evaluate((index) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
            if (cards[index]) { cards[index].click(); return true; }
            return false;
        }, questionIndex);
        if (!jumped) {
             const jumpInput = await page.$('.bd_bt_input');
             if (jumpInput) { await jumpInput.focus(); await jumpInput.fill(String(questionIndex + 1)); await page.keyboard.press('Enter'); }
        }
        await randomSleep(2000, 3000);
    }
}

async function downloadImage(url, dest) {
    if (!url) return;
    try {
        if (url.startsWith('data:image')) {
            const base64Data = url.split(',')[1];
            if (base64Data) { fs.writeFileSync(dest, base64Data, 'base64'); return; }
        }
        let fullUrl = url.startsWith('//') ? `https:${url}` : (url.startsWith('http') ? url : `https://www.xs507.com/${url}`);
        const protocol = fullUrl.startsWith('https') ? https : http;
        await new Promise((resolve, reject) => {
            const request = protocol.get(fullUrl, (response) => {
                if (response.statusCode === 200) {
                    const file = fs.createWriteStream(dest);
                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                } else { reject(new Error(`下载失败: ${response.statusCode}`)); }
            });
            request.on('error', (e) => reject(e));
        });
    } catch (e) { log(`图片下载失败: ${url} -> ${e.message}`, 'WARN'); }
}

const MONITOR = {
    stats: { totalCaptured: 0, noAnalysisCount: 0, startTime: new Date() },
    printSummary() {
        const duration = ((new Date() - this.stats.startTime) / 1000 / 60).toFixed(1);
        log(`\n抓取完成总结:`, 'INFO');
        log(`- 总耗时: ${duration} 分钟`, 'INFO');
        log(`- 成功抓取: ${this.stats.totalCaptured} 题`, 'INFO');
        log(`- 缺失解析: ${this.stats.noAnalysisCount} 题`, 'INFO');
    }
};

async function run() {
    log('>>> 正在启动 Chromium 浏览器...', 'INFO');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        log('尝试自动登录...', 'INFO');
        await page.goto(LOGIN_URL);
        await page.waitForTimeout(2000);
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);
    } catch (e) { log('登录流程可能存在问题，请手动干预', 'WARN'); }

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    let completionStatus = {};
    if (fs.existsSync(STATUS_FILE)) { try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch(e) {} }

    const ALL_SUBJECTS = [
        { name: '2026年初级社会工作者《初级社会工作实务》考试题库', productId: '1525' },
        { name: '2026年中级社会工作者《中级社会工作实务》考试题库', productId: '317' },
        { name: '2026年中级社会工作者《中级社会工作法规与政策》考试题库', productId: '39' },
        { name: '2026年中级社会工作者《中级社会工作综合能力》考试题库', productId: '316' },
        { name: '2026年初级社会工作者《初级社会工作综合能力》考试题库', productId: '1526' },
    ];

    for (let i = 0; i < ALL_SUBJECTS.length; i++) {
        const subject = ALL_SUBJECTS[i];
        log(`开始处理科目: ${subject.name}`, 'INFO');
        
        await page.goto('https://www.xs507.com/Tiku/index.html');
        await randomSleep(2000, 3000);
        try {
            await page.click('a:has-text("切换其他题库")', { timeout: 3000 }).catch(() => {});
            await page.evaluate((pid) => {
                const radio = document.querySelector(`input[name="change_id"][value="${pid}"]`);
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                    document.querySelector('.change-subject-btn')?.click();
                }
            }, subject.productId);
            await page.waitForTimeout(4000);
        } catch(e) {}

        const catDir = path.join(OUTPUT_DIR, sanitizeFileName(subject.name));
        if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });

        const types = ['章节练习', '历年真题', '模拟试卷'];
        for (const type of types) {
            log(`  正在检查分类: ${type}`, 'INFO');
            const typeDir = path.join(catDir, type);
            if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

            const chapters = await page.evaluate((t) => {
                const results = [];
                const block = Array.from(document.querySelectorAll('.product-box')).find(b => b.innerText.includes(t));
                if (block) {
                    block.querySelectorAll('a[href*="know_id"], a[href*="paper_id"]').forEach(a => {
                        const m = a.href.match(/(know|paper)_id=(\d+)/);
                        results.push({ title: a.innerText.trim(), url: a.href, id: m ? m[0] : 'unknown' });
                    });
                }
                return results;
            }, type);

            for (const chapter of chapters) {
                const statusKey = `${subject.name}_${chapter.id}`;
                const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapter.id}`);
                const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
                
                let startFrom = completionStatus[statusKey]?.completed || 0;
                if (completionStatus[statusKey]?.total > 0 && startFrom >= completionStatus[statusKey].total) {
                    log(`    [跳过] ${chapter.title}`, 'INFO');
                    continue;
                }

                if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
                if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });

                log(`    [开始] ${chapter.title} (断点: ${startFrom})`, 'INFO');
                await openChapterAtQuestion(page, chapter.url, startFrom);

                let lastAnalysisFingerprint = '';
                let lastStem = '';
                while (true) {
                    await triggerOfficialAnalysis(page, lastAnalysisFingerprint);
                    const data = await readQuestionData(page, lastAnalysisFingerprint);
                    const [curr, totalNum] = data.step.split('/').map(Number);

                    let md = `## 第 ${curr} 题 [${data.type}]\n\n`;
                    if (data.stem && data.stem !== lastStem) { md += `**【背景】**\n${data.stem}\n\n`; lastStem = data.stem; }
                    md += `**题目：** ${data.title}\n\n`;
                    if (data.options) md += `${data.options}\n\n`;
                    md += `> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                    fs.appendFileSync(outputFile, md);

                    lastAnalysisFingerprint = data.analysisFingerprint;
                    MONITOR.stats.totalCaptured++;
                    if (data.analysis === '无解析') MONITOR.stats.noAnalysisCount++;
                    
                    completionStatus[statusKey] = { completed: curr, total: totalNum };
                    fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2));

                    process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                    for (const img of data.images) { await downloadImage(img.url, path.join(chapterDir, 'images', img.name)); }

                    if (curr < totalNum) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click({ force: true });
                            await waitForQuestionChange(page, old.step, old.id);
                        } else { break; }
                    } else { break; }
                }
                log(`\n    [完成] ${chapter.title}`, 'INFO');
            }
        }
    }
    MONITOR.printSummary();
    await browser.close();
    rl.close();
}

run().catch(e => { console.error(e); rl.close(); });
