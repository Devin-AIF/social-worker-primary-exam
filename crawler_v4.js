const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * 自动化抓取脚本 V17.1 (全面代码评审修复版)
 * 1. 不拦截任何网络请求（防止误拦解析页）
 * 2. handlePopup 只移除明确拦截遮罩，保留 .layui-layer（可能是解析弹窗）
 * 3. waitForQuestionChange：等待题号变化，确认切换到新题
 * 4. openChapterAtQuestion：逐一尝试多选择器激活背题模式
 * 5. 断点续抓：已抓取的题目自动跳过（基于 completion_status.json + MD文件题数双重校验）
 * 6. 修复 safeClick fallback 不支持 Playwright 专属选择器的问题
 */

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

// BASE_URL 保留备用（当前未直接引用）
// const BASE_URL = 'https://www.xs507.com';
const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';
const OUTPUT_DIR = './抓取结果_V4';
const LOG_FILE = './crawler.log';
const STATUS_FILE = path.join(OUTPUT_DIR, 'completion_status.json');
const ENABLE_DISCUSSION_FALLBACK = true;
const SINGLE_QUESTION_TEST_MODE = false;
const REQUIRE_OFFICIAL_ANALYSIS_TO_SAVE = false;
const MAX_QUESTIONS_PER_CHAPTER = Number.MAX_SAFE_INTEGER;

// --- 状态与记录 ---
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
    } catch (e) {
        return 0;
    }
}

function saveStatus() {
    try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2));
    } catch (e) {}
}

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    try { fs.appendFileSync(LOG_FILE, formattedMessage); } catch (e) {}
    console.log(formattedMessage.trim());
}

async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await sleep(ms);
}

/**
 * 等待题目内容真正切换完成。
 *
 * 背景：网站 DOM 中 #itemlist（含 #item_step、#item_id、#item_title）
 * 与 #analysis（解析区）是独立的兄弟元素，可能异步更新。
 * 仅等待 #item_step 变化不够，必须同时确认 #analysis 已刷新。
 *
 * 策略：
 *   Step 1 — 等待 #item_step 变化（题目已开始切换）
 *   Step 2 — 等待 #item_id 变化（#itemlist 整体已更新，包含新题数据）
 *   Step 3 — 若上一题有解析，等待 .analysis.pd10 内容不再等于旧解析
 *            （确认 #analysis 区域已加载新内容）
 *   Step 4 — 短暂等待渲染完成
 */
async function waitForQuestionChange(page, oldStep, oldItemId, oldAnalysis) {
    // Step 1: 等待题号变化
    await page.waitForFunction((old) => {
        const el = document.querySelector('#item_step, .item-step');
        return (el?.innerText || '').trim() !== old;
    }, oldStep, { timeout: 12000 }).catch(() => {});

    // Step 2: 等待 #item_id（题目唯一编号）变化，确认 #itemlist 已更新
    if (oldItemId) {
        await page.waitForFunction((old) => {
            const el = document.querySelector('#item_id');
            const t = (el?.innerText || '').trim();
            return t.length > 0 && t !== old;
        }, oldItemId, { timeout: 8000 }).catch(() => {});
    }

    // Step 3: 若上一题有实质解析，等待 #analysis 区也已刷新
    const hasOldAnalysis = oldAnalysis
        && oldAnalysis !== '无解析'
        && !oldAnalysis.startsWith('[讨论提取]')
        && !oldAnalysis.startsWith('[警告');
    if (hasOldAnalysis) {
        await page.waitForFunction((old) => {
            // 只看第一个 .analysis.pd10（#itemlist 内的主解析区）
            const el = document.querySelector('#answer_analysis .analysis.pd10, .answer-yes .analysis.pd10, .answer-wrong .analysis.pd10, .analysis.pd10');
            if (!el) return true;
            const t = (el.innerText || '').trim();
            return !t || t !== old;
        }, oldAnalysis, { timeout: 8000 }).catch(() => {});
    }

    // Step 4: 短暂等待渲染稳定
    await randomSleep(800, 1500);
}


async function handlePopup(page) {
    await page.evaluate(() => {
        // 只移除明确的限速拦截遮罩，保留 .layui-layer（可能是解析弹窗）
        const blockers = ['#video_analysis_ratelimit_overlay', '.layui-layer-shade', '.layerSaveSuccess'];
        blockers.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

        // 重置反爬标记
        window.is_ratelimit = false;
        if (window.video_analysis_ratelimit_timer) clearInterval(window.video_analysis_ratelimit_timer);

        // 强制显示解析区域
        document.querySelectorAll('.hide').forEach(el => el.classList.remove('hide'));
        document.querySelectorAll('#analysis, .analysis, #answer_analysis').forEach(el => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        });
    });
    return true;
}

async function detectAntiCrawler(page) {
    return page.evaluate(() => {
        const selectors = [
            '#video_analysis_ratelimit_overlay',
            '#popup_box',
            '#popup_box_bg',
            '#popup_box_iframe'
        ];
        const hasOverlay = selectors.some(selector => {
            const el = document.querySelector(selector);
            return !!el;
        });
        const text = (document.body?.innerText || '').slice(0, 2000);
        const keywords = ['访问过于频繁', '请稍后再试', '重新登录', '登录后继续', '操作过快'];
        return hasOverlay || keywords.some(keyword => text.includes(keyword));
    });
}

async function waitOutAntiCrawler(page, reason) {
    log(`检测到疑似反爬/登录拦截，开始冷却重试: ${reason}`, 'WARN');
    await handlePopup(page);
    await randomSleep(20000, 35000);
    await handlePopup(page);
}

async function safeClick(page, selector, waitAfter = 0) {
    // page.$() 支持 Playwright 专属选择器（如 :has-text()）
    const element = await page.$(selector);
    if (!element) return false;

    await handlePopup(page);
    try {
        await element.click({ force: true, timeout: 5000 });
    } catch (e) {
        // fallback：直接对已定位的元素执行 JS click，不再传 selector 字符串
        // （避免 document.querySelector 不支持 Playwright 专属语法）
        await element.evaluate(el => el.click()).catch(() => {});
    }

    if (waitAfter > 0) await page.waitForTimeout(waitAfter);
    await handlePopup(page);
    return true;
}

async function triggerOfficialAnalysis(page) {
    await page.evaluate(() => {
        const clickIfVisible = (selector) => {
            const elements = Array.from(document.querySelectorAll(selector));
            for (const el of elements) {
                const text = (el.innerText || el.textContent || '').trim();
                const visible = !!(el.offsetParent || el.getClientRects().length);
                if (visible || text.includes('解析') || text.includes('查看')) {
                    el.click();
                }
            }
        };

        document.querySelectorAll('.hide').forEach(el => el.classList.remove('hide'));
        document.querySelectorAll('#analysis, .analysis, #answer_analysis, .answer-yes, .answer-wrong').forEach(el => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        });

        clickIfVisible('.click_analysis');
        clickIfVisible('[data-type="analysis"]');
        clickIfVisible('.analysis-btn, .show-analysis, .jiexi, .answer-analysis');

        const tabs = Array.from(document.querySelectorAll('a, button, span, div'))
            .filter(el => {
                const text = (el.innerText || el.textContent || '').trim();
                return text === '查看解析' || text === '解析' || text === '参考解析';
            });
        tabs.forEach(el => el.click());
    });
}

async function readQuestionData(page) {
    return page.evaluate((enableDiscussionFallback) => {
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return !!(el.offsetParent || el.getClientRects().length) && style.display !== 'none' && style.visibility !== 'hidden';
        };

        const getAnalysis = () => {
            const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis'];
            for (const s of selectors) {
                const elements = Array.from(document.querySelectorAll(s));
                for (let i = elements.length - 1; i >= 0; i--) {
                    const el = elements[i];
                    if (!isVisible(el)) continue;

                    let t = (el.innerText || el.textContent || '').trim();
                    if (t.includes('点击查看解析')) continue;
                    
                    t = t.replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                    const noise = ['社会工作者考试', '实务》真题及答案'];
                    if (t.length > 2 && !noise.some(n => t === n)) return t;
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

        const getAns = () => {
            const extractLetters = (text) => {
                const match = (text || '').match(/正确答案[^A-F]*([A-F、,，\s]+)/);
                if (match) {
                    return match[1].replace(/[^A-F]/g, '');
                }
                return '';
            };

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
        const itemId = document.querySelector('#item_id')?.innerText.trim() || '';
        const res = {
            type: document.querySelector('#item_type, .item-type')?.innerText.trim() || '题型',
            step,
            itemId,
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

async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    await page.goto(chapterUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await handlePopup(page);

    // 第一步：点击「开始做题」（如果存在）
    await safeClick(page, 'a.enable.a2, a:has-text("开始做题"), #PaperStartTimes', 6000);
    await handlePopup(page);

    // 第二步：精准激活背题模式（防止重复点击变成练习模式）
    let activated = false;
    const foundBeiti = await page.evaluate(() => {
        // 查找文本正好为"背题模式"的可点击元素
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
            .find(el => {
                const t = (el.innerText || '').trim();
                // 必须明确显示为背题模式才点，如果是"练习模式"说明已经在背题状态了
                return t === '背题模式' && el.offsetParent !== null; 
            });
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    });

    if (foundBeiti) {
        await randomSleep(2500, 3500);
        await handlePopup(page);
        activated = true;
        log('背题模式已激活（文本精准匹配）', 'INFO');
    } else {
        log('未找到"背题模式"文本的按钮，可能已处于该模式，继续执行', 'INFO');
    }

    // 第三步：跳转到指定题号
    if (questionIndex > 0) {
        await page.waitForSelector('#tiku_sheet_card li', { timeout: 8000 }).catch(() => {});
        await page.evaluate((index) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li');
            if (cards[index]) cards[index].click();
        }, questionIndex);
        await randomSleep(3500, 5500);
        await handlePopup(page);
    }
}


function hasOfficialAnalysis(data) {
    if (!data) return false;
    const text = (data.analysis || '').trim();
    if (!text || text === '无解析') return false;
    if (text.startsWith('[讨论提取]')) return false;
    return true;
}

function hasReliableAnswer(data) {
    if (!data) return false;
    return /^[A-F]+$/.test((data.answer || '').trim());
}

function isLikelyStaleAnalysis(currentData, lastSnapshot) {
    if (!currentData || !lastSnapshot) return false;
    const currentStep = (currentData.step || '').trim();
    const lastStep = (lastSnapshot.step || '').trim();
    const currentTitle = (currentData.title || '').trim();
    const lastTitle = (lastSnapshot.title || '').trim();
    const currentAnalysis = (currentData.analysis || '').trim();
    const lastAnalysis = (lastSnapshot.analysis || '').trim();

    if (!currentAnalysis || currentAnalysis === '无解析') return false;
    if (currentAnalysis.startsWith('[讨论提取]')) return false;

    // 核心修复：比较时剥离前缀
    const cleanLastAnalysis = lastAnalysis.replace(/^\[警告：可能重复上一题解析\]\s*/, '').trim();

    const questionChanged = currentStep !== lastStep || currentTitle !== lastTitle;
    return questionChanged && currentAnalysis === cleanLastAnalysis;
}

async function downloadImage(url, dest) {
    if (!url) return;
    try {
        if (url.startsWith('data:image')) {
            await fs.promises.writeFile(dest, Buffer.from(url.split('base64,')[1], 'base64'));
            return;
        }
        const fullUrl = url.startsWith('//') ? `https:${url}` : url;
        await new Promise((res) => {
            const req = https.get(fullUrl, { timeout: 15000 }, (r) => {
                if (r.statusCode === 200) {
                    const f = fs.createWriteStream(dest);
                    r.pipe(f);
                    f.on('finish', () => { f.close(); res(); });
                    f.on('error', () => { f.close(); res(); });
                } else res();
            });
            req.on('error', () => res());
        });
    } catch (e) {}
}

async function run() {
    log('正在开启 V17.1 全面修复抓取模式...', 'INFO');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    // 不拦截任何网络请求，防止误拦解析页
    const page = await context.newPage();


    // --- 自动登录 ---
    try {
        log('尝试自动登录...', 'INFO');
        await page.goto(LOGIN_URL);
        await page.waitForTimeout(2000);
        const agree = await page.$('.login-form-agree i');
        if (agree) await agree.click();
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn, button:has-text("登录")');
        await page.waitForTimeout(6000);
    } catch (e) { log(`登录过程可能存在问题: ${e.message}`, 'WARN'); }

    const CATEGORIES = [
        { name: '章节练习', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/0.html' },
        { name: '历年真题', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/1.html' },
        { name: '模拟试卷', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/2.html' }
    ];

    for (const cat of CATEGORIES) {
        log(`\n>>> 进入分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(OUTPUT_DIR, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url).catch(() => {});
        await randomSleep(3500, 5500);

        // --- 识别章节/试卷列表 ---
        const chapters = await page.evaluate(() => {
            const container = document.querySelector('.question-conten-list, .product-box, #main-tiku-box') || document.body;
            const blackList = ['取证之路', '首页', '欣师', '网校', '咨询', 'APP', '小程序'];
            
            return Array.from(container.querySelectorAll('a'))
                .filter(a => {
                    const t = a.innerText.trim();
                    if (!t || blackList.some(b => t.includes(b))) return false;
                    const isActionButton = (t.includes('模式') || t.includes('做题') || t.includes('开始')) && a.href.includes('product_id');
                    const isTitleLink = a.closest('.title') && (a.href.includes('paper_id') || a.href.includes('product_id'));
                    return isActionButton || isTitleLink;
                })
                .map(a => {
                    let title = a.innerText.trim();
                    let url = a.href;
                    let totalCount = 0;
                    const p = a.closest('li, tr, .big');
                    if (p) {
                        const tEl = p.querySelector('.title, .name, td:first-child');
                        if (tEl) title = tEl.innerText.trim();
                        const alreadyEl = p.querySelector('.already');
                        if (alreadyEl && alreadyEl.innerText.includes('/')) {
                            const match = alreadyEl.innerText.match(/\/(\d+)/);
                            if (match) totalCount = parseInt(match[1], 10);
                        }
                        const practice = Array.from(p.querySelectorAll('a')).find(el => el.innerText.includes('练习模式'));
                        if (practice) url = practice.href;
                    }
                    return { title, url, totalCount };
                })
                .filter((chapter, index, list) => list.findIndex(item => item.title === chapter.title) === index);
        });

        for (const chapter of chapters) {
            const statusKey = `${cat.name}_${chapter.title}`;
            const safeTitle = sanitizeFileName(chapter.title);
            const chapterDir = path.join(typeDir, safeTitle);
            const imgDir = path.join(chapterDir, 'images');
            const outputFile = path.join(chapterDir, `${safeTitle}.md`);

            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

            const skipCount = Math.max(Number(completionStatus[statusKey]) || 0, getCompletedCount(outputFile));
            if (chapter.totalCount > 0 && skipCount >= chapter.totalCount) {
                log(`跳过已完成章节: ${chapter.title} (${skipCount}/${chapter.totalCount})`, 'INFO');
                completionStatus[statusKey] = skipCount;
                saveStatus();
                continue;
            }

            log(`>> 正在抓取: ${chapter.title} (起步题号: ${skipCount + 1})`, 'INFO');
            try {
                await openChapterAtQuestion(page, chapter.url, skipCount);
            } catch (e) { log(`尝试开启背题模式失败: ${e.message}`, 'DEBUG'); }

            if (!fs.existsSync(outputFile) || skipCount === 0) {
                fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);
            }

            // --- 题目循环 ---
            let retryCount = 0;
            let chapterCapturedCount = 0;
            // 哨兵值初始化：防止第 1 题跳过 stale 检测（null 时 isLikelyStaleAnalysis 直接返回 false）
            let lastSavedSnapshot = { step: '__INIT__', title: '__INIT__', analysis: '__INIT__' };
            let currentQuestionIndex = skipCount;


            while (true) {
                try {
                    if (await detectAntiCrawler(page)) {
                        await waitOutAntiCrawler(page, `章节 ${chapter.title} 进入题目页前`);
                    }

                    await page.waitForSelector('#item_title', { timeout: 15000 });
                    await handlePopup(page);

                    // 背题模式下解析应已可见；主动触发一次以防万一
                    await triggerOfficialAnalysis(page);
                    await randomSleep(1500, 2500);
                    await handlePopup(page);

                    let data = await readQuestionData(page);
                    // 若仍无解析，再多等一次
                    if (data.analysis === '无解析') {
                        await randomSleep(2000, 3000);
                        await handlePopup(page);
                        data = await readQuestionData(page);
                    }

                    const [curr, total] = data.step.split('/').map(Number);
                    retryCount = 0;
                    currentQuestionIndex = Math.max(skipCount, Math.max(curr - 1, 0));

                    // 跳过已抓取题目（断点续抓）：等待题号变化后再 continue，防止读到旧题
                    if (curr <= skipCount) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next && curr < total) {
                            const oldStep = data.step;
                            const oldItemId = data.itemId;
                            const oldAnalysis = data.analysis;
                            
                            // 根本性修复：主动清空旧解析 DOM，防止新题无解析时读到旧数据
                            await page.evaluate(() => {
                                document.querySelectorAll('.analysis.pd10, .right').forEach(el => el.innerText = '');
                            });
                            
                            await next.click({ force: true }).catch(() => page.evaluate(() => document.querySelector('.subject-next, #next_item')?.click()));
                            await waitForQuestionChange(page, oldStep, oldItemId, oldAnalysis);
                            continue;
                        }
                        break;
                    }

                    // 检测串题（解析与上一题相同）
                    const staleAnalysis = isLikelyStaleAnalysis(data, lastSavedSnapshot);
                    if (staleAnalysis) {
                        log(`检测到重复解析，标记为可能过期: ${chapter.title} 第 ${curr} 题`, 'WARN');
                        data.analysis = `[警告：可能重复上一题解析] ${data.analysis}`;
                    }
                    if (!hasOfficialAnalysis(data)) {
                        log(`第 ${curr} 题无官方解析，以"无解析"保存`, 'WARN');
                    }

                    const mdContent = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                    fs.appendFileSync(outputFile, mdContent);
                    lastSavedSnapshot = {
                        step: data.step,
                        title: data.title,
                        analysis: data.analysis
                    };
                    completionStatus[statusKey] = curr;
                    saveStatus();
                    process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                    chapterCapturedCount += 1;

                    const imgTasks = data.images.map(img => downloadImage(img.url, path.join(imgDir, img.name)));
                    await Promise.all(imgTasks);

                    if (SINGLE_QUESTION_TEST_MODE || chapterCapturedCount >= MAX_QUESTIONS_PER_CHAPTER) {
                        log(`单题测试模式结束: ${chapter.title} 停在第 ${curr} 题`, 'INFO');
                        break;
                    }

                    if (curr < total) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) {
                            await handlePopup(page);
                            const oldStep = data.step;
                            const oldItemId = data.itemId;
                            const oldAnalysis = data.analysis;
                            
                            // 根本性修复：主动清空旧解析 DOM，防止新题无解析时读到旧数据
                            await page.evaluate(() => {
                                document.querySelectorAll('.analysis.pd10, .right').forEach(el => el.innerText = '');
                            });
                            
                            await next.click({ force: true }).catch(() => page.evaluate(() => document.querySelector('.subject-next, #next_item')?.click()));
                            // 等待题号变化，确认已切换到新题
                            await waitForQuestionChange(page, oldStep, oldItemId, oldAnalysis);
                        } else break;
                    } else {
                        log(`\n>> [完成] ${chapter.title} 抓取完毕。`, 'INFO');
                        completionStatus[statusKey] = total;
                        saveStatus();
                        break;
                    }
                } catch (e) {
                    const message = e.message || String(e);
                    const isAntiCrawler = message.includes('intercepts pointer events')
                        || message.includes('popup_box')
                        || message.includes('waitForSelector');
                    if (isAntiCrawler && retryCount < 3) {
                        retryCount += 1;
                        await waitOutAntiCrawler(page, `第 ${retryCount} 次重试: ${message.split('\n')[0]}`);
                        continue;
                    }
                    log(`题目抓取异常: ${message}`, 'ERROR');
                    break;
                }
            }

            if (chapterCapturedCount === 0 && fs.existsSync(outputFile)) {
                const content = fs.readFileSync(outputFile, 'utf-8');
                if (content.trim() === `# ${chapter.title}`) {
                    fs.unlinkSync(outputFile);
                    log(`未写入有效题目，已清理空文件: ${chapter.title}`, 'INFO');
                }
            }
        }
    }
    log('所有任务全部圆满完成！', 'INFO');
    await browser.close();
}

run().catch(err => log(`致命错误: ${err.message}`, 'FATAL'));
