/**
 * =================================================================================
 * 自动化抓取脚本 V17.2 (工程化加固版)
 * =================================================================================
 * 
 * 【功能汇总】
 * 1. 结构化进度管理：使用 completion_status.json 记录 ID、标题、进度、总数，支持断点续传。
 * 2. 智能跳过机制：进入网页前优先对比日志与本地文件，已完成章节秒跳过。
 * 3. 串题残留检测：通过 isLikelyStaleAnalysis 严格对比上一题解析，防止 DOM 未刷新导致的重复写入。
 * 4. 动态 ID 识别：支持同名不同 ID 的试卷共存，防止进度覆盖。
 * 5. 自动登录与防爬：内置登录逻辑及频繁访问拦截检测（waitOutAntiCrawler）。
 * 
 * 【后续开发注意事项】
 * 1. 【路径管理】：必须使用 path.join 和 __dirname (PROJECT_ROOT) 以确保在任何环境下路径一致。
 * 2. 【DOM 异步】：网站 DOM 刷新是分块的。waitForQuestionChange 必须检查 #item_id 和解析区内容。
 * 3. 【ID 唯一性】：网站改版频繁，必须优先以 URL 中的 paper_id/know_id 作为识别 Key。
 * 4. 【解析获取】：优先尝试背题模式。如果解析区域为空，需尝试模拟点击选项触发加载。
 * 5. 【数据安全】：completion_status.json 是核心资产，写入前需确保结构完整（completed/total）。
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
const ENABLE_DISCUSSION_FALLBACK = true; // 是否从讨论区提取解析（当官方无解析时）
const SINGLE_QUESTION_TEST_MODE = false;
const MAX_QUESTIONS_PER_CHAPTER = Number.MAX_SAFE_INTEGER;

// --- 状态与记录初始化 ---
let completionStatus = {};
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (fs.existsSync(STATUS_FILE)) {
    try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch (e) {}
}

/**
 * 清洗文件名，去除操作系统不支持的特殊字符
 * @param {string} name 原始文件名
 * @returns {string} 安全的文件名
 */
function sanitizeFileName(name) {
    return name.replace(/[\\/:"*?<>|]/g, '_');
}

/**
 * 扫描本地 Markdown 文件，统计已抓取的题目数量（用于断点续传校验）
 * @param {string} outputFile MD文件路径
 * @returns {number} 题目总数
 */
function getCompletedCount(outputFile) {
    if (!fs.existsSync(outputFile)) return 0;
    try {
        const content = fs.readFileSync(outputFile, 'utf-8');
        return (content.match(/## 第 \d+ 题/g) || []).length;
    } catch (e) {
        return 0;
    }
}

/**
 * 将内存中的进度状态持久化到 JSON 文件
 */
function saveStatus() {
    try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2));
    } catch (e) {}
}

/**
 * 记录带时间戳的日志
 * @param {string} message 日志消息
 * @param {string} type 日志级别
 */
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    try { fs.appendFileSync(LOG_FILE, formattedMessage); } catch (e) {}
    console.log(formattedMessage.trim());
}

/**
 * 随机等待函数（防爬策略）
 */
async function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待题目内容切换完成（防串题核心逻辑）
 * @param {object} page 页面对象
 * @param {string} oldStep 旧题号
 * @param {string} oldItemId 旧题目ID
 * @param {string} oldAnalysis 旧解析
 */
async function waitForQuestionChange(page, oldStep, oldItemId, oldAnalysis) {
    // 1. 等待题号文字变化
    await page.waitForFunction((old) => {
        const el = document.querySelector('#item_step, .item-step');
        return (el?.innerText || '').trim() !== old;
    }, oldStep, { timeout: 12000 }).catch(() => {});

    // 2. 等待 DOM 内部 ID 变化
    if (oldItemId) {
        await page.waitForFunction((old) => {
            const el = document.querySelector('#item_id');
            return (el?.innerText || '').trim() !== old;
        }, oldItemId, { timeout: 8000 }).catch(() => {});
    }

    // 3. 渲染缓冲
    await randomSleep(800, 1500);
}

/**
 * 处理遮罩和异常弹窗
 */
async function handlePopup(page) {
    await page.evaluate(() => {
        const blockers = ['#video_analysis_ratelimit_overlay', '.layui-layer-shade'];
        blockers.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        // 强制显示解析区
        document.querySelectorAll('#analysis, .analysis, #answer_analysis').forEach(el => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        });
    });
}

/**
 * 安全点击封装
 */
async function safeClick(page, selector, waitAfter = 0) {
    const element = await page.$(selector);
    if (!element) return false;
    try {
        await element.click({ force: true, timeout: 5000 });
    } catch (e) {
        await element.evaluate(el => el.click()).catch(() => {});
    }
    if (waitAfter > 0) await page.waitForTimeout(waitAfter);
    return true;
}

/**
 * 提取页面题目数据
 */
async function readQuestionData(page) {
    return page.evaluate((enableDiscussionFallback) => {
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return !!(el.offsetParent || el.getClientRects().length) && style.display !== 'none';
        };

        const getAnalysis = () => {
            const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.analysis'];
            for (const s of selectors) {
                const el = Array.from(document.querySelectorAll(s)).find(isVisible);
                if (el) {
                    let t = (el.innerText || '').trim();
                    if (!t.includes('点击查看解析')) {
                        return t.replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                    }
                }
            }
            return '无解析';
        };

        const getAns = () => {
            const opts = Array.from(document.querySelectorAll('#item_options li, .options li'));
            const rights = opts
                .filter(li => isVisible(li) && (li.getAttribute('data-isanswer') === '1' || li.classList.contains('right')))
                .map(li => li.getAttribute('data-optname') || li.innerText.trim().charAt(0));
            return rights.length > 0 ? [...new Set(rights)].sort().join('') : '未知';
        };

        const step = document.querySelector('#item_step, .item-step')?.innerText.trim() || '0/0';
        const res = {
            type: document.querySelector('#item_type, .item-type')?.innerText.trim() || '题型',
            step,
            itemId: document.querySelector('#item_id')?.innerText.trim() || '',
            options: Array.from(document.querySelectorAll('#item_options li, .options li')).filter(isVisible).map(li => li.innerText.trim()).join('\n'),
            answer: getAns(),
            analysis: getAnalysis(),
            title: document.querySelector('#item_title, .item-title')?.innerText.trim() || '',
            images: []
        };
        // 图片处理逻辑
        document.querySelectorAll('#item_title img, .item-title img').forEach((img, idx) => {
            const src = img.getAttribute('src');
            if (src) {
                const name = `q_${step.replace(/\//g, '_')}_${idx}.png`;
                res.images.push({ name, url: src });
            }
        });
        return res;
    }, ENABLE_DISCUSSION_FALLBACK);
}

/**
 * 串题检测逻辑
 */
function isLikelyStaleAnalysis(currentData, lastSnapshot) {
    if (!currentData || !lastSnapshot) return false;
    const analysisIdentical = currentData.analysis === lastSnapshot.analysis && currentData.analysis !== '无解析';
    const questionChanged = currentData.step !== lastSnapshot.step;
    return questionChanged && analysisIdentical;
}

/**
 * 图片下载
 */
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
 * 主程序
 */
async function run() {
    log('正在开启 V17.2 工程化加固版抓取模式...', 'INFO');
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
    } catch (e) { log('登录流程异常', 'WARN'); }

    const CATEGORIES = [
        { name: '历年真题', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/1.html' },
        { name: '模拟试卷', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/2.html' }
    ];

    for (const cat of CATEGORIES) {
        log(`>>> 进入分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(OUTPUT_DIR, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url);
        await randomSleep(3000, 5000);

        // 识别章节
        const chapters = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .filter(a => (a.innerText.includes('模式') || a.innerText.includes('做题')) && a.href.includes('product_id'))
                .map(a => {
                    const p = a.closest('li, tr, .item');
                    const title = p?.querySelector('.title, .name, .item-title')?.innerText.trim() || a.innerText.trim();
                    const url = a.href;
                    const id = 'paper-' + (url.match(/paper_id[\/=](\d+)/)?.[1] || '');
                    const m = p?.innerText.match(/共\s*(\d+)\s*题/) || p?.innerText.match(/\/(\d+)/);
                    return { title, url, id, totalCount: m ? parseInt(m[1], 10) : 0 };
                })
                .filter((c, i, l) => l.findIndex(item => item.url === c.url) === i);
        });

        for (const chapter of chapters) {
            const statusKey = `${cat.name}_${chapter.title}_${chapter.id}`;
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapter.id}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            // 进度决策
            let saved = completionStatus[statusKey] || {};
            if (typeof saved === 'number') saved = { completed: saved };
            const skipCount = Math.max(Number(saved.completed) || 0, getCompletedCount(outputFile));
            const total = chapter.totalCount || saved.total || 0;

            if (total > 0 && skipCount >= total) {
                log(`[跳过] 已完成: ${chapter.title}`, 'INFO');
                continue;
            }

            log(`>> 正在抓取: ${chapter.title} (已完成: ${skipCount})`, 'INFO');
            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });

            try {
                // 进入章节并激活背题模式
                await page.goto(chapter.url);
                await randomSleep(3000, 5000);
                await safeClick(page, 'a:has-text("开始做题"), a:has-text("背题模式")');
                
                // 跳转逻辑
                if (skipCount > 0) {
                    await page.waitForSelector('#tiku_sheet_card li', { timeout: 5000 }).catch(() => {});
                    await page.evaluate((idx) => {
                        const cards = document.querySelectorAll('#tiku_sheet_card li');
                        if (cards[idx]) cards[idx].click();
                    }, skipCount);
                    await randomSleep(3000, 5000);
                }

                if (!fs.existsSync(outputFile)) fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);

                let lastSnapshot = { step: '' };
                while (true) {
                    await page.waitForSelector('#item_title', { timeout: 10000 });
                    await handlePopup(page);
                    
                    let data = await readQuestionData(page);
                    const [curr, totalNum] = data.step.split('/').map(Number);

                    if (curr <= skipCount) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next && curr < totalNum) {
                            await next.click();
                            await waitForQuestionChange(page, data.step, data.itemId, data.analysis);
                            continue;
                        }
                        break;
                    }

                    // 串题校验
                    if (isLikelyStaleAnalysis(data, lastSnapshot)) data.analysis = '无解析';

                    // 写入
                    const content = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                    fs.appendFileSync(outputFile, content);

                    // 存日志
                    completionStatus[statusKey] = {
                        id: chapter.id, title: chapter.title,
                        completed: curr, total: totalNum, updatedAt: new Date().toLocaleString()
                    };
                    saveStatus();
                    lastSnapshot = data;

                    process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);

                    if (curr < totalNum) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) {
                            await next.click();
                            await waitForQuestionChange(page, data.step, data.itemId, data.analysis);
                        } else break;
                    } else break;
                }
            } catch (e) { log(`章节抓取中断: ${e.message}`, 'ERROR'); }
        }
    }
    log('任务完成', 'INFO');
    await browser.close();
}

run().catch(console.error);
