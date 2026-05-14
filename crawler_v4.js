/**
 * =================================================================================
 * 自动化抓取脚本 V17.3 (回归加固版)
 * =================================================================================
 * 
 * 【修复说明】
 * 1. 恢复了更强大的数据提取引擎：支持 7 种以上答案识别路径和 5 种以上解析识别路径。
 * 2. 强化背题模式激活：采用精准文本匹配，防止模式切换失败导致的解析缺失。
 * 3. 增强异步稳定性：在点击“下一题”后增加多重 DOM 状态校验，确保数据刷新后再读取。
 * 4. 优化写入策略：对于“未知”答案或缺失解析的题目增加强制重试机制，宁愿慢也要准。
 * =================================================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- 配置与常量 ---
const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';
const PROJECT_ROOT = __dirname;
const OUTPUT_DIR = path.join(PROJECT_ROOT, '抓取结果_V4');
const LOG_FILE = path.join(PROJECT_ROOT, 'crawler.log');
const STATUS_FILE = path.join(OUTPUT_DIR, 'completion_status.json');
const ENABLE_DISCUSSION_FALLBACK = true;

// --- 状态与记录初始化 ---
let completionStatus = {};
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (fs.existsSync(STATUS_FILE)) {
    try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch (e) {}
}

function sanitizeFileName(name) {
    return name.replace(/[\\/:"*?<>|]/g, '_');
}

function getCompletedCount(outputFile) {
    if (!fs.existsSync(outputFile)) return 0;
    try {
        const content = fs.readFileSync(outputFile, 'utf-8');
        return (content.match(/## 第 \d+ 题/g) || []).length;
    } catch (e) { return 0; }
}

function saveStatus() {
    try { fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2)); } catch (e) {}
}

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    try { fs.appendFileSync(LOG_FILE, formattedMessage); } catch (e) {}
    console.log(formattedMessage.trim());
}

async function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 核心：等待题目彻底刷新
 */
async function waitForQuestionChange(page, oldStep, oldItemId, oldAnalysis) {
    await page.waitForFunction((old) => {
        const el = document.querySelector('#item_step, .item-step');
        return (el?.innerText || '').trim() !== old;
    }, oldStep, { timeout: 12000 }).catch(() => {});

    if (oldItemId) {
        await page.waitForFunction((old) => {
            const el = document.querySelector('#item_id');
            const t = (el?.innerText || '').trim();
            return t.length > 0 && t !== old;
        }, oldItemId, { timeout: 8000 }).catch(() => {});
    }
    await randomSleep(1200, 2000); // 增加缓冲，确保解析区也刷新
}

/**
 * 核心：触发解析显示（多重策略）
 */
async function triggerOfficialAnalysis(page) {
    await page.evaluate(() => {
        // 1. 强制显示所有隐藏的解析相关 DOM
        const hideEls = document.querySelectorAll('.hide, [style*="display: none"]');
        hideEls.forEach(el => {
            if (el.id?.includes('analysis') || el.className?.includes('analysis') || el.className?.includes('answer')) {
                el.classList.remove('hide');
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
            }
        });

        // 2. 模拟点击所有可能的解析按钮
        const selectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.answer-analysis'];
        selectors.forEach(s => {
            document.querySelectorAll(s).forEach(el => {
                const visible = !!(el.offsetParent || el.getClientRects().length);
                if (visible) el.click();
            });
        });

        // 3. 针对文本内容点击
        Array.from(document.querySelectorAll('a, button, span, div'))
            .filter(el => {
                const t = (el.innerText || '').trim();
                return (t === '查看解析' || t === '解析' || t === '参考解析') && !!(el.offsetParent || el.getClientRects().length);
            })
            .forEach(el => el.click());
    });
}

/**
 * 核心：深度读取题目数据
 */
async function readQuestionData(page) {
    return page.evaluate((enableDiscussionFallback) => {
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return !!(el.offsetParent || el.getClientRects().length) && style.display !== 'none' && style.visibility !== 'hidden';
        };

        // 提取正确答案字母（从文本中提取）
        const extractLetters = (text) => {
            const match = (text || '').match(/正确答案[^A-F]*([A-F、,，\s]+)/);
            return match ? match[1].replace(/[^A-F]/g, '') : '';
        };

        // 获取解析内容
        const getAnalysis = () => {
            const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis'];
            for (const s of selectors) {
                const elements = Array.from(document.querySelectorAll(s));
                for (let i = elements.length - 1; i >= 0; i--) {
                    const el = elements[i];
                    if (!isVisible(el)) continue;
                    let t = (el.innerText || el.textContent || '').trim();
                    if (t.includes('点击查看解析')) continue;
                    t = t.replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                    if (t.length > 2) return t;
                }
            }
            if (enableDiscussionFallback) {
                const talks = Array.from(document.querySelectorAll('.tiku-talk-list li'));
                for (let i = talks.length - 1; i >= 0; i--) {
                    if (talks[i].querySelector('.terd') || talks[i].innerText.includes('老师')) {
                        const m = talks[i].querySelector('.huida .mesage')?.innerText.trim();
                        if (m && m.length > 2) return `[讨论提取] ${m}`;
                    }
                }
            }
            return '无解析';
        };

        // 获取答案
        const getAns = () => {
            const opts = Array.from(document.querySelectorAll('#item_options li, .options li'));
            const rights = opts
                .filter(li => isVisible(li) && (li.getAttribute('data-isanswer') === '1' || li.classList.contains('correct') || li.classList.contains('right') || !!li.querySelector('.right_icon')))
                .map(li => li.getAttribute('data-optname') || li.innerText.trim().charAt(0))
                .filter(Boolean);
            if (rights.length > 0) return [...new Set(rights)].sort().join('');

            const explicitSelectors = ['.right_answer', '#right_answer', '#answer_analysis', '.answer-yes', '.answer-wrong', '.analysis', '#analysis'];
            for (const selector of explicitSelectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                for (let i = elements.length - 1; i >= 0; i--) {
                    if (!isVisible(elements[i])) continue;
                    const answer = extractLetters(elements[i].innerText || elements[i].textContent || '');
                    if (answer) return answer;
                }
            }
            return '未知';
        };

        const step = document.querySelector('#item_step, .item-step')?.innerText.trim() || '0/0';
        const res = {
            type: document.querySelector('#item_type, .item-type')?.innerText.trim() || '题型',
            step,
            itemId: document.querySelector('#item_id')?.innerText.trim() || '',
            options: Array.from(document.querySelectorAll('#item_options li, .options li')).filter(isVisible).map(li => li.innerText.trim()).join('\n'),
            answer: getAns(),
            analysis: getAnalysis(),
            title: '',
            images: []
        };

        const titEl = document.querySelector('#item_title, .item-title, .subject-title');
        if (titEl) {
            const clone = titEl.cloneNode(true);
            clone.querySelectorAll('img').forEach((img, idx) => {
                const src = img.getAttribute('src');
                if (src) {
                    const name = `q_${step.replace(/\//g, '_')}_${idx}.png`;
                    res.images.push({ name, url: src });
                    img.replaceWith(` ![图](./images/${name}) `);
                }
            });
            res.title = clone.innerText.trim();
        }
        return res;
    }, ENABLE_DISCUSSION_FALLBACK);
}

/**
 * 核心：进入章节并激活背题模式
 */
async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    await page.goto(chapterUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await handlePopup(page);
    
    // 点击开始做题
    await safeClick(page, 'a.enable.a2, a:has-text("开始做题"), #PaperStartTimes', 6000);
    await handlePopup(page);

    // 激活背题模式
    const activated = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
            .find(el => (el.innerText || '').trim() === '背题模式' && el.offsetParent !== null);
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (activated) {
        await randomSleep(3000, 5000);
        await handlePopup(page);
    }

    // 跳转
    if (questionIndex > 0) {
        log(`正在跳转到题号: ${questionIndex + 1}`, 'DEBUG');
        await page.waitForSelector('#tiku_sheet_card li', { timeout: 8000 }).catch(() => {});
        await page.evaluate((index) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li');
            const target = Math.min(index, cards.length - 1);
            if (target >= 0 && cards[target]) cards[target].click();
        }, questionIndex);
        await randomSleep(4000, 6000);
        await handlePopup(page);
    }
}

function isLikelyStaleAnalysis(currentData, lastSnapshot) {
    if (!currentData || !lastSnapshot) return false;
    if (currentData.analysis === '无解析' || currentData.analysis === '未知') return false;
    return currentData.step !== lastSnapshot.step && currentData.analysis === lastSnapshot.analysis;
}

async function downloadImage(url, dest) {
    if (!url) return;
    try {
        const fullUrl = url.startsWith('//') ? `https:${url}` : url;
        await new Promise((res) => {
            https.get(fullUrl, (r) => {
                if (r.statusCode === 200) {
                    const f = fs.createWriteStream(dest);
                    r.pipe(f);
                    f.on('finish', () => { f.close(); res(); });
                } else res();
            }).on('error', () => res());
        });
    } catch (e) {}
}

/**
 * =================================================================================
 * 主循环
 * =================================================================================
 */
async function run() {
    log('正在开启 V17.3 回归加固版...', 'INFO');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 自动登录
    try {
        await page.goto(LOGIN_URL);
        await page.waitForTimeout(2000);
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);
    } catch (e) { log('登录失败', 'WARN'); }

    const CATEGORIES = [
        { name: '历年真题', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/1.html' },
        { name: '模拟试卷', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/2.html' }
    ];

    for (const cat of CATEGORIES) {
        log(`>>> 分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(OUTPUT_DIR, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url);
        await randomSleep(3000, 5000);

        const chapters = await page.evaluate(() => {
            const container = document.querySelector('.question-conten-list, .product-box, #main-tiku-box') || document.body;
            return Array.from(container.querySelectorAll('a'))
                .filter(a => {
                    const t = a.innerText.trim();
                    const isAction = (t.includes('模式') || t.includes('做题') || t.includes('开始')) && a.href.includes('product_id');
                    const isLink = a.closest('.title') && (a.href.includes('paper_id') || a.href.includes('product_id'));
                    return isAction || isLink;
                })
                .map(a => {
                    const p = a.closest('li, tr, .item, .big');
                    let title = p?.querySelector('.title, .name, .item-title')?.innerText.trim() || a.innerText.trim();
                    const url = a.href;

                    // 提取唯一 ID (优先 paper_id, 其次 know_id, 最后 product_id)
                    let id = '';
                    const mPaper = url.match(/paper_id[\/=](\d+)/);
                    const mKnow = url.match(/know_id[\/=](\d+)/);
                    const mProd = url.match(/product_id[\/=](\d+)/);

                    if (mPaper) id = 'paper-' + mPaper[1];
                    else if (mKnow) id = 'know-' + mKnow[1];
                    else if (mProd) id = 'prod-' + mProd[1];
                    else id = 'unknown-' + Math.random().toString(36).slice(2, 7);

                    const mCount = p?.innerText.match(/共\s*(\d+)\s*题/) || p?.innerText.match(/\/(\d+)/);
                    return { title, url, id, total: mCount ? parseInt(mCount[1], 10) : 0 };
                })
                // 根据 ID 去重，确保每个卷子只抓一次
                .filter((c, i, l) => l.findIndex(item => item.id === c.id) === i);
        });

        for (const chapter of chapters) {
            const statusKey = `${cat.name}_${chapter.title}_${chapter.id}`;
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapter.id}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            let saved = completionStatus[statusKey] || {};
            if (typeof saved === 'number') saved = { completed: saved };
            const skipCount = Math.max(Number(saved.completed) || 0, getCompletedCount(outputFile));
            const total = chapter.total || saved.total || 0;

            if (total > 0 && skipCount >= total) {
                log(`[跳过] ${chapter.title}`, 'INFO');
                continue;
            }

            log(`>> 准备抓取: ${chapter.title} (ID: ${chapter.id}, 进度: ${skipCount})`, 'INFO');
            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });

            try {
                await openChapterAtQuestion(page, chapter.url, skipCount);
                if (!fs.existsSync(outputFile)) fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);

                let lastSnapshot = { step: '__INIT__' };
                while (true) {
                    await page.waitForSelector('#item_title', { timeout: 15000 });
                    await triggerOfficialAnalysis(page);
                    await randomSleep(2000, 3000);
                    
                    let data = await readQuestionData(page);
                    
                    // 强制纠偏：如果没抓到答案，尝试点击第一个选项激活
                    if (data.answer === '未知' || data.analysis === '无解析') {
                        await page.evaluate(() => document.querySelector('#item_options li, .options li')?.click());
                        await randomSleep(2000, 3000);
                        await triggerOfficialAnalysis(page);
                        data = await readQuestionData(page);
                    }

                    const [curr, totalNum] = data.step.split('/').map(Number);
                    if (curr <= skipCount) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next && curr < totalNum) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click();
                            await waitForQuestionChange(page, old.step, old.id);
                            continue;
                        }
                        break;
                    }

                    if (isLikelyStaleAnalysis(data, lastSnapshot)) data.analysis = '无解析';

                    // 写入 Markdown
                    const md = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                    fs.appendFileSync(outputFile, md);

                    // 存进度
                    completionStatus[statusKey] = {
                        id: chapter.id, title: chapter.title,
                        completed: curr, total: totalNum, updatedAt: new Date().toLocaleString()
                    };
                    saveStatus();
                    lastSnapshot = data;

                    process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                    await Promise.all(data.images.map(img => downloadImage(img.url, path.join(chapterDir, 'images', img.name))));

                    if (curr < totalNum) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click();
                            await waitForQuestionChange(page, old.step, old.id);
                        } else break;
                    } else break;
                }
            } catch (e) { log(`抓取异常: ${e.message}`, 'ERROR'); }
        }
    }
    log('全部完成！', 'INFO');
    await browser.close();
}

run().catch(console.error);
