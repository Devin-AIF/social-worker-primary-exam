/**
 * =================================================================================
 * 自动化抓取脚本 V5.0 (全自动登录 + 深度清洗 + 图片本地化 + 稳健导航)
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
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

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

function getCompletedCount(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const matches = content.match(/## 第 \d+ 题/g);
        return matches ? matches.length : 0;
    } catch (e) {
        return 0;
    }
}

function buildStableChapterKey(chapter) {
    if (chapter.id) return chapter.id;
    const encoded = Buffer.from(chapter.url || chapter.title || '').toString('base64');
    return `url-${encoded.replace(/[+/=]/g, '').slice(0, 24)}`;
}

// --- 核心引擎 ---

async function handlePopup(page) {
    await page.evaluate(() => {
        const shades = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg', '.mask', '.loading-mask', '.analysis-lock', '.layerFeedback', '.layui-layer'];
        shades.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    }).catch(() => {});
}

async function installDomGuard(page) {
    await page.evaluate(() => {
        if (window.__crawlerDomGuardInstalled) return;
        window.__crawlerDomGuardInstalled = true;
        const cleanup = () => {
            const popups = ['.layerSaveSuccess', '.layui-layer-shade', '.layui-layer', '#video_analysis_ratelimit_overlay', '.layerFeedback', '#popup_box_bg', '.mask', '.loading-mask'];
            popups.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        };
        cleanup();
        const observer = new MutationObserver(cleanup);
        observer.observe(document.body, { childList: true, subtree: true });
    }).catch(() => {});
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

/**
 * 触发官方解析 (增强版：带指纹校验)
 */
async function triggerOfficialAnalysis(page, lastContentFp = '') {
    await page.evaluate(() => {
        // 1. 清理容器但不隐藏
        const anaSelectors = ['.analysis', '#answer_analysis', '#analysis', '.answer-content', '.jiexi-content'];
        anaSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
            if (!el.innerText.trim().includes('正在加载')) el.innerHTML = '';
        }));

        // 2. 点击触发按钮
        const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn', '.view-answer'];
        clickSelectors.forEach(s => {
            document.querySelectorAll(s).forEach(btn => {
                const text = (btn.innerText || '').trim();
                if (btn.offsetParent !== null && /解析|答案|显示|查看/.test(text)) btn.click();
            });
        });
    });

    // 3. 等待内容刷新且指纹不同
    for (let i = 0; i < 8; i++) {
        const currentFp = await page.evaluate(() => {
            const el = document.querySelector('.analysis, #answer_analysis, #analysis, .answer-content');
            return el ? el.innerText.trim().substring(0, 100).replace(/\s/g, '') : '';
        });
        if (currentFp && currentFp.length > 5 && currentFp !== lastContentFp) return true;
        await page.waitForTimeout(800);
    }
    return false;
}

async function readQuestionData(page) {
    return await page.evaluate(() => {
        const getStepText = () => {
            // A. 答题卡推算 (最稳健)
            const curLi = document.querySelector('#tiku_sheet_card li.cur, .answer-card li.cur, .dtk_list li.cur');
            const allLis = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
            if (curLi && allLis.length > 0) {
                const idx = Array.from(allLis).indexOf(curLi) + 1;
                return `${idx}/${allLis.length}`;
            }
            // B. 选择器
            const specific = document.querySelector('#item_step, .item-step, .subject-step, .item_type_pos');
            if (specific) {
                const m = specific.innerText.match(/(\d+)\s*\/\s*(\d+)/);
                if (m && m[1] !== '0') return m[0].replace(/\s/g, '');
            }
            // C. 正则搜寻
            const bodyMatch = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/);
            if (bodyMatch && bodyMatch[1] !== '0') return bodyMatch[0].replace(/\s/g, '');
            return '0/0';
        };

        const stepRaw = getStepText();
        const images = [];

        const processContent = (el, prefix) => {
            if (!el) return '';
            const clone = el.cloneNode(true);
            const junkSelectors = ['.err_correct', '.remove_wrong', '.video_analysis', '.subject-action', '.analysis-action', '.report-error', '.show_child', '.fr'];
            junkSelectors.forEach(s => clone.querySelectorAll(s).forEach(sub => sub.remove()));
            
            clone.querySelectorAll('img').forEach((img, idx) => {
                let src = img.getAttribute('src') || img.getAttribute('data-src') || img.src;
                if (!src) return;
                if (src.startsWith('//')) src = 'https:' + src;
                const name = `q_${stepRaw.replace(/\//g, '_')}_${prefix}_${idx}.png`;
                images.push({ name, url: src });
                img.replaceWith(` ![图](./images/${name}) `);
            });

            let text = (clone.innerText || '').trim();
            const junkPatterns = [/点击查看解析/g, /收起解析/g, /视频解析/g, /我要纠错/g, /提交/g, /展开解析/g];
            junkPatterns.forEach(p => text = text.replace(p, ''));
            return text.trim();
        };

        const titleEl = document.querySelector('#item_title, .item-title, .subject-title');
        const titleText = processContent(titleEl, 'tit');
        const itemType = document.querySelector('#item_type, .item-type')?.innerText.trim() || '题型';

        const fetchOptions = () => {
            const selectors = ['#item_options li', '.options li', '.question-options li'];
            for (const s of selectors) {
                const items = document.querySelectorAll(s);
                if (items.length > 0) return Array.from(items).map(li => processContent(li, 'opt')).join('\n');
            }
            return '';
        };

        let finalAnswer = '未知';
        let finalAnalysis = '无解析';

        // 提取答案
        const ansSelectors = ['.right_answer', '#right_answer', '.answer-yes', '.correct-answer', '.subject-answer'];
        for (const s of ansSelectors) {
            const el = document.querySelector(s);
            if (el && el.innerText.trim().length > 0) {
                const text = el.innerText.replace(/正确答案[：:\s]*/, '').trim();
                if (text && text.length < 500) { finalAnswer = text; break; }
            }
        }

        // 提取解析
        const anaSelectors = ['.analysis', '#answer_analysis', '#analysis', '.answer-content', '.jiexi-content'];
        for (const s of anaSelectors) {
            const el = document.querySelector(s);
            if (el && el.innerText.trim().length > 10) {
                const candidate = processContent(el, 'ans');
                if (candidate && !titleText.includes(candidate.substring(0, 30))) {
                    finalAnalysis = candidate;
                    break;
                }
            }
        }

        return {
            type: itemType, step: stepRaw, title: titleText, 
            options: fetchOptions(), answer: finalAnswer, analysis: finalAnalysis, 
            images,
            fingerprint: (titleText.substring(0, 50) + stepRaw).replace(/\s/g, ''),
            contentFingerprint: (finalAnalysis.substring(0, 100) + finalAnswer + stepRaw).replace(/\s/g, '')
        };
    });
}

// --- 导航与进度控制 ---

async function waitForQuestionReady(page) {
    const ready = await page.waitForFunction(() => {
        const title = document.querySelector('#item_title, .item-title, .subject-title');
        const answerBox = document.querySelector('.answer-content, .analysis, #answer_analysis');
        const hasStep = !!document.querySelector('#item_step, .item-step, .answer-card li');
        return title && title.innerText.trim().length > 0 && answerBox && hasStep;
    }, { timeout: 20000 }).catch(() => false);
    if (ready) {
        await installDomGuard(page);
        await handlePopup(page);
    }
    return ready;
}

async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    const finalUrl = (questionIndex === 0 && !chapterUrl.includes('again=1')) ? (chapterUrl.includes('?') ? `${chapterUrl}&again=1` : `${chapterUrl}?again=1`) : chapterUrl;
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await randomSleep(3000, 5000);
    await handlePopup(page);

    const startBtns = ['a:has-text("开始做题")', 'a:has-text("练习模式")', 'a.enable.a2'];
    for (const s of startBtns) { if (await safeClick(page, s, 3000)) break; }
    
    // 强制切换背题模式
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span')).find(el => /背题|显示答案/.test(el.innerText));
        if (btn) btn.click();
    });
    await randomSleep(2000, 3000);
    await waitForQuestionReady(page);

    if (questionIndex > 0) {
        log(`正在通过答题卡跳转至第 ${questionIndex + 1} 题...`, 'DEBUG');
        await page.evaluate(() => { document.querySelector('.bd_dtk, #tiku_sheet, .answer-card-btn')?.click(); });
        await page.waitForTimeout(1000);
        const jumped = await page.evaluate((idx) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
            if (cards[idx]) { cards[idx].click(); return true; }
            return false;
        }, questionIndex);
        if (!jumped) {
             const jumpInput = await page.$('.bd_bt_input');
             if (jumpInput) { await jumpInput.fill(String(questionIndex + 1)); await page.keyboard.press('Enter'); }
        }
        await randomSleep(3000, 5000);
        await waitForQuestionReady(page);
    }
}

async function downloadImage(url, dest) {
    if (!url) return;
    try {
        if (url.startsWith('data:image')) {
            const buffer = Buffer.from(url.split(',')[1], 'base64');
            fs.writeFileSync(dest, buffer);
            return;
        }
        let fullUrl = url.startsWith('//') ? `https:${url}` : (url.startsWith('http') ? url : `https://www.xs507.com/${url}`);
        await new Promise((resolve, reject) => {
            const protocol = fullUrl.startsWith('https') ? https : http;
            protocol.get(fullUrl, (res) => {
                if (res.statusCode === 200) {
                    const stream = fs.createWriteStream(dest);
                    res.pipe(stream);
                    stream.on('finish', () => { stream.close(); resolve(); });
                } else reject(new Error(res.statusCode));
            }).on('error', reject);
        });
    } catch (e) { log(`图片下载失败: ${url} -> ${e.message}`, 'WARN'); }
}

const MONITOR = {
    stats: { totalCaptured: 0, noAnalysisCount: 0, startTime: new Date() },
    printSummary() {
        const duration = ((new Date() - this.stats.startTime) / 1000 / 60).toFixed(1);
        log(`\n抓取完成总结: 耗时 ${duration}min | 总数: ${this.stats.totalCaptured} | 缺失解析: ${this.stats.noAnalysisCount}`, 'INFO');
    }
};

let completionStatus = {};
function saveStatus() { fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2)); }

async function crawlSubject(page, subject) {
    const subjectDir = path.join(OUTPUT_DIR, sanitizeFileName(subject.name));
    if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });

    log(`\n>>> 正在处理科目: ${subject.name}`, 'INFO');
    await page.goto('https://www.xs507.com/Tiku/Tikulist/index.html');
    await safeClick(page, 'a.change:has-text("切换")');
    await page.waitForSelector(`input[name="change_id"][value="${subject.productId}"]`, { timeout: 8000 });
    await page.click(`label:has(input[name="change_id"][value="${subject.productId}"])`, { force: true });
    await safeClick(page, 'button:has-text("确认"), a:has-text("确认切换")');
    await page.waitForLoadState('networkidle');

    const categories = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.list-count li')).map(li => {
            const a = li.querySelector('a');
            const name = li.querySelector('b')?.innerText.trim();
            // 修正：支持更多分类名称
            if (a && name && ['历年真题', '模拟试卷', '章节练习', '考前冲刺', '预测试卷'].some(k => name.includes(k))) {
                return { name, url: a.href };
            }
            return null;
        }).filter(Boolean);
    });

    if (categories.length === 0) {
        log(`警告: 未在科目 [${subject.name}] 中发现有效分类，尝试重新抓取分类...`, 'WARN');
        // 尝试另一种选择器
        const altCats = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .filter(a => ['历年真题', '模拟试卷', '章节练习'].some(k => a.innerText.includes(k)))
                .map(a => ({ name: a.innerText.trim(), url: a.href }));
        });
        categories.push(...altCats);
    }

    log(`在该科目下发现 ${categories.length} 个分类`, 'INFO');

    for (const cat of categories) {
        log(`进入分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(subjectDir, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url).catch(() => {});
        await randomSleep(3000, 5000);

        const chapters = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .filter(a => (a.innerText.includes('模式') || a.innerText.includes('做题')) && a.href.includes('product_id'))
                .map(a => {
                    const p = a.closest('li, tr, .item');
                    const title = p?.querySelector('.title, .name')?.innerText.trim() || a.innerText.trim();
                    const url = a.href;
                    let idMatch = url.match(/(paper_id|know_id)[\/=](\d+)/);
                    return { title, url, id: idMatch ? `${idMatch[1]}-${idMatch[2]}` : '' };
                }).filter((c, i, l) => l.findIndex(x => x.url === c.url) === i);
        });

        for (const chapter of chapters) {
            const statusKey = `${subject.productId}_${cat.name}_${buildStableChapterKey(chapter)}`;
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${buildStableChapterKey(chapter)}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            if (completionStatus[statusKey]?.isFinished) continue;

            let startFrom = getCompletedCount(outputFile);
            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });
            if (!fs.existsSync(outputFile)) fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);

            log(`    开始章节: ${chapter.title} (进度: ${startFrom})`, 'INFO');
            await openChapterAtQuestion(page, chapter.url, startFrom);

            let lastContentFp = '';
            let stuckCount = 0;
            
            while (true) {
                if (!await waitForQuestionReady(page)) {
                    log('页面响应超时，尝试刷新...', 'WARN');
                    await page.reload();
                    await openChapterAtQuestion(page, chapter.url, startFrom);
                }

                await triggerOfficialAnalysis(page, lastContentFp);
                let data = await readQuestionData(page);
                let [curr, totalNum] = data.step.split('/').map(Number);

                // 黄金刷新逻辑：如果内容未刷新或数据异常
                if (data.contentFingerprint === lastContentFp || isNaN(totalNum) || totalNum === 0) {
                    stuckCount++;
                    if (stuckCount >= 3) {
                        log('内容持续未刷新，执行强制重载...', 'WARN');
                        await page.reload();
                        await randomSleep(5000, 7000);
                        await openChapterAtQuestion(page, chapter.url, curr > 0 ? curr - 1 : startFrom);
                        stuckCount = 0;
                        continue;
                    }
                    await randomSleep(2000, 3000);
                    continue;
                }
                stuckCount = 0;

                // 写入数据
                let md = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n`;
                if (data.options) md += `${data.options}\n\n`;
                md += `> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                fs.appendFileSync(outputFile, md);

                lastContentFp = data.contentFingerprint;
                MONITOR.stats.totalCaptured++;
                if (data.analysis === '无解析') MONITOR.stats.noAnalysisCount++;
                
                completionStatus[statusKey] = { completed: curr, total: totalNum, updatedAt: new Date().toLocaleString() };
                saveStatus();
                process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                
                for (const img of data.images) { await downloadImage(img.url, path.join(chapterDir, 'images', img.name)); }

                if (curr < totalNum) {
                    const next = await page.$('.subject-next, #next_item');
                    if (next) {
                        await next.click({ force: true });
                        await page.waitForTimeout(1500);
                    } else break;
                } else {
                    completionStatus[statusKey].isFinished = true;
                    saveStatus();
                    break;
                }
            }
            log(`\n    完成章节: ${chapter.title}`, 'INFO');
        }
    }
}

async function run() {
    log('正在启动增强版抓取器 V5.0...', 'INFO');
    const browser = await chromium.launch({ 
        headless: process.env.HEADLESS === 'true'
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(LOGIN_URL);
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);
        
        // 登录后截图
        await page.screenshot({ path: path.join(DEBUG_DIR, 'after_login.png') });

        if (fs.existsSync(STATUS_FILE)) {
            try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch(e) {}
        }

        const subjects = [
            { name: '2026年中级社会工作者《中级社会工作实务》考试题库', productId: '317' },
            { name: '2026年中级社会工作者《中级社会工作法规与政策》考试题库', productId: '39' },
            { name: '2026年中级社会工作者《中级社会工作综合能力》考试题库', productId: '316' },
            { name: '2026年初级社会工作者《初级社会工作实务》考试题库', productId: '1525' },
            { name: '2026年初级社会工作者《初级社会工作综合能力》考试题库', productId: '1526' },
        ];

        for (const sub of subjects) { await crawlSubject(page, sub); }
        MONITOR.printSummary();
    } finally {
        await browser.close();
        rl.close();
    }
}

run().catch(e => { log(`运行崩溃: ${e.message}`, 'ERROR'); rl.close(); });
