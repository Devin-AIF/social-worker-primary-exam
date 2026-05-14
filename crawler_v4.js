/**
 * =================================================================================
 * 自动化抓取脚本 V17.4 (最终全量加固版)
 * =================================================================================
 * 
 * 【核心设计原则】
 * 1. 稳定性第一：不追求极速，追求每一题都有答案、有解析。
 * 2. 全量恢复：严禁删减任何曾证明有效的 DOM 选择器和激活逻辑。
 * 3. 结构化日志：精准记录 ID、进度、总数，支持同名试卷共存。
 * 4. 深度防御：处理各类遮罩、异步加载、串题残留。
 * =================================================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- 配置与常量 ---
/** 
 * 登录凭证配置 
 * 优先从环境变量获取，若未设置则使用默认测试账号 
 */
const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';

// 目录路径常量
const PROJECT_ROOT = __dirname;
const OUTPUT_DIR = path.join(PROJECT_ROOT, '抓取结果_V4'); // Markdown 文件的全局根输出目录
const LOG_FILE = path.join(PROJECT_ROOT, 'crawler.log'); // 运行日志保存路径
const STATUS_FILE = path.join(OUTPUT_DIR, 'completion_status.json'); // 断点续传的核心状态文件

/** 
 * 是否启用“评论区提取”作为解析后备方案。
 * 若开启，当页面未显示官方解析时，将尝试在 `.tiku-talk-list` 寻找带“老师”关键字的评论。
 */
const ENABLE_DISCUSSION_FALLBACK = true;

// --- 状态与记录初始化 ---
let completionStatus = {};
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (fs.existsSync(STATUS_FILE)) {
    try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch (e) {}
}

/**
 * 辅助函数：清洗文件名
 * 移除 Windows/Mac 系统中不允许作为文件名的特殊字符
 * @param {string} name 原始章节标题
 * @returns {string} 可安全用作文件或文件夹名称的字符串
 */
function sanitizeFileName(name) {
    return name.replace(/[\\/:"*?<>|]/g, '_');
}

/**
 * 辅助函数：读取本地 MD 已抓取数量
 * 用于验证本地生成的 Markdown 文件中实际保存了多少道题，辅助断点续传逻辑，防止空洞。
 * @param {string} outputFile Markdown 文件路径
 * @returns {number} 文件内已生成的题目数量
 */
function getCompletedCount(outputFile) {
    if (!fs.existsSync(outputFile)) return 0;
    try {
        const content = fs.readFileSync(outputFile, 'utf-8');
        // 根据 Markdown 的二级标题标记统计题目数
        return (content.match(/## 第 \d+ 题/g) || []).length;
    } catch (e) { return 0; }
}

/**
 * 持久化进度
 * 将内存中的 completionStatus 字典写入 JSON 文件，供下次启动时恢复
 */
function saveStatus() {
    try { fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2)); } catch (e) {}
}

/**
 * 记录日志
 * 在终端输出的同时，追加写入到 crawler.log 中，附带 ISO 格式时间戳
 * @param {string} message 日志内容
 * @param {string} type 日志级别 (INFO, WARN, ERROR, DEBUG)
 */
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    try { fs.appendFileSync(LOG_FILE, formattedMessage); } catch (e) {}
    console.log(formattedMessage.trim());
}

/**
 * 辅助函数：基础异步等待
 * @param {number} ms 毫秒数
 */
async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 辅助函数：范围随机异步等待
 * 用于模拟人类不规律的点击间隔，降低被风控（Rate Limit）的概率
 * @param {number} min 最小等待时间（毫秒）
 * @param {number} max 最大等待时间（毫秒）
 */
async function randomSleep(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await sleep(ms);
}

/**
 * 全量恢复：处理遮罩和弹窗拦截 (核心反风控逻辑)
 * 定期清理页面上的遮罩层，防止 Playwright 的 click 动作被拦截。
 * @param {import('playwright').Page} page Playwright 页面实例
 */
async function handlePopup(page) {
    await page.evaluate(() => {
        // 1. 移除所有已知遮罩层，防止指针事件被吞
        const blockers = [
            '#video_analysis_ratelimit_overlay', // 视频解析频率限制遮罩
            '.layui-layer-shade',                // 常见的 LayUI 遮罩层
            '.layerSaveSuccess',                 // 保存成功的提示框
            '#popup_box',
            '#popup_box_bg'
        ];
        blockers.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

        // 2. 重置可能的反爬 JS 变量，破除前端限流
        window.is_ratelimit = false;
        if (window.video_analysis_ratelimit_timer) clearInterval(window.video_analysis_ratelimit_timer);

        // 3. 强行显示被隐藏的解析区域 (针对某些题目只通过 CSS 隐藏解析的情况)
        document.querySelectorAll('.hide, .hidden, [style*="display: none"]').forEach(el => {
            if (el.id?.includes('analysis') || el.className?.includes('analysis') || el.className?.includes('answer')) {
                el.classList.remove('hide', 'hidden');
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
            }
        });
    });
}

/**
 * 全量恢复：安全点击封装
 * 带容错的点击机制，如果 Playwright 标准的行动力测试（Actionability checks）失败，
 * 则降级为纯 JS 的原生点击，绕过 pointer-events 阻拦。
 * @param {import('playwright').Page} page
 * @param {string} selector CSS选择器
 * @param {number} waitAfter 点击后强制等待的毫秒数
 * @returns {boolean} 是否成功找到并点击了元素
 */
async function safeClick(page, selector, waitAfter = 0) {
    const element = await page.$(selector);
    if (!element) return false;

    await handlePopup(page);
    try {
        await element.click({ force: true, timeout: 5000 });
    } catch (e) {
        // 后备方案：跳过 Playwright 鼠标模拟，直接执行 JS DOM click
        await element.evaluate(el => el.click()).catch(() => {});
    }
    if (waitAfter > 0) await page.waitForTimeout(waitAfter);
    await handlePopup(page);
    return true;
}

/**
 * 全量恢复：触发解析显示
 * 在单页应用（SPA）中，某些答案和解析只有在用户点击特定按钮后才会经由 Ajax 加载或解除隐藏。
 * 本函数采取“广撒网”策略，遍历点击所有疑似解析按钮的节点。
 */
async function triggerOfficialAnalysis(page) {
    await page.evaluate(() => {
        const clickIfVisible = (selector) => {
            const elements = Array.from(document.querySelectorAll(selector));
            for (const el of elements) {
                const visible = !!(el.offsetParent || el.getClientRects().length);
                if (visible) el.click();
            }
        };

        // 1. 通过已知 class 和属性定位点击所有可能的解析按钮
        clickIfVisible('.click_analysis');
        clickIfVisible('[data-type="analysis"]');
        clickIfVisible('.analysis-btn, .show-analysis, .jiexi, .answer-analysis');

        // 2. 后备方案：通过文本特征盲点
        const tabs = Array.from(document.querySelectorAll('a, button, span, div'))
            .filter(el => {
                const t = (el.innerText || '').trim();
                return (t === '查看解析' || t === '解析' || t === '参考解析') && !!(el.offsetParent || el.getClientRects().length);
            });
        tabs.forEach(el => el.click());
    });
}

/**
 * 全量恢复：等待题目刷新 (解决 SPA 串题问题的核心)
 * 当点击“下一题”时，由于是单页应用，DOM 不会重新加载，只会替换内部文本。
 * 为了防止爬虫过快读取到上一题的残留数据，必须采取“双重校验”策略。
 * @param {import('playwright').Page} page
 * @param {string} oldStep 上一题的进度标签 (例如 "1/100")
 * @param {string} oldItemId 上一题的题目内部 ID
 */
async function waitForQuestionChange(page, oldStep, oldItemId) {
    // 1. 双重校验之一：等待进度标识（题号）发生本质变化
    await page.waitForFunction((old) => {
        const el = document.querySelector('#item_step, .item-step');
        return (el?.innerText || '').trim() !== old;
    }, oldStep, { timeout: 12000 }).catch(() => {});

    // 2. 双重校验之二：等待 DOM ID 发生变化 (防止题号变了但数据还没渲染完)
    if (oldItemId) {
        await page.waitForFunction((old) => {
            const el = document.querySelector('#item_id');
            const t = (el?.innerText || '').trim();
            return t.length > 0 && t !== old;
        }, oldItemId, { timeout: 8000 }).catch(() => {});
    }
    // 3. 强制网络请求缓冲期：给 Ajax 渲染图片和解析留出绝对时间
    await randomSleep(1500, 2500); 
}

/**
 * 全量恢复：深度提取数据 (爬虫的“眼睛”)
 * 在浏览器上下文中执行的脚本，直接读取 DOM。
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>} 提取出的题目对象
 */
async function readQuestionData(page) {
    return page.evaluate((enableDiscussionFallback) => {
        // 辅助方法：判断元素是否在页面上真实可见
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return !!(el.offsetParent || el.getClientRects().length) && style.display !== 'none' && style.visibility !== 'hidden';
        };

        // 辅助方法：从类似 "正确答案是：A、B" 的中文字符串中提取纯字母 "AB"
        const extractLetters = (text) => {
            const match = (text || '').match(/正确答案[^A-F]*([A-F、,，\s]+)/);
            return match ? match[1].replace(/[^A-F]/g, '') : '';
        };

        // 提取官方解析
        const getAnalysis = () => {
            // 候选选择器列表，按优先级排序
            const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis'];
            for (const s of selectors) {
                const elements = Array.from(document.querySelectorAll(s));
                // 倒序遍历，通常最后出现的结构是当前弹出的真实解析
                for (let i = elements.length - 1; i >= 0; i--) {
                    const el = elements[i];
                    if (!isVisible(el)) continue;
                    let t = (el.innerText || el.textContent || '').trim();
                    if (t.includes('点击查看解析')) continue; // 过滤掉伪解析占位符
                    
                    // 清理前缀词，如 "参考解析："
                    t = t.replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                    if (t.length > 2) return t;
                }
            }
            
            // 兜底方案：如果找不到官方解析且开启了评论区提取，则尝试找带有“老师”的评论
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

        // 提取正确答案
        const getAns = () => {
            // 策略 1: 隐式答案。嗅探列表项的 DOM 状态（被赋予了正确类名或高亮图标）
            const opts = Array.from(document.querySelectorAll('#item_options li, .options li'));
            const rights = opts
                .filter(li => isVisible(li) && (li.getAttribute('data-isanswer') === '1' || li.classList.contains('correct') || li.classList.contains('right') || !!li.querySelector('.right_icon')))
                .map(li => li.getAttribute('data-optname') || li.innerText.trim().charAt(0))
                .filter(Boolean);
            if (rights.length > 0) return [...new Set(rights)].sort().join('');

            // 策略 2: 显式答案。寻找页面上明确标注“正确答案是 X”的文本区域
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
            // 将选项直接拼接为 Markdown 友好的多行文本
            options: Array.from(document.querySelectorAll('#item_options li, .options li')).filter(isVisible).map(li => li.innerText.trim()).join('\n'),
            answer: getAns(),
            analysis: getAnalysis(),
            title: '',
            images: []
        };

        // 提取题目文本并处理内嵌图片
        const titEl = document.querySelector('#item_title, .item-title, .subject-title');
        if (titEl) {
            // 使用 cloneNode(true) 进行深拷贝，防止原地修改破坏原网页的 DOM
            const clone = titEl.cloneNode(true);
            clone.querySelectorAll('img').forEach((img, idx) => {
                const src = img.getAttribute('src');
                if (src) {
                    const name = `q_${step.replace(/\//g, '_')}_${idx}.png`; // 基于题号生成唯一图片名
                    res.images.push({ name, url: src });
                    // 原地将 img 标签替换为 Markdown 图片语法
                    img.replaceWith(` ![图](./images/${name}) `);
                }
            });
            res.title = clone.innerText.trim();
        }
        return res;
    }, ENABLE_DISCUSSION_FALLBACK);
}

/**
 * 全量恢复：进入章节并初始化刷题状态
 * 负责点击进入指定章节，开启“背题模式”，并跳转到断点所在的题号。
 * @param {import('playwright').Page} page
 * @param {string} chapterUrl 章节的初始 URL
 * @param {number} questionIndex 断点索引（已抓取数量），用于跳过已抓取的题目
 */
async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    log(`正在打开章节 URL: ${chapterUrl}`, 'DEBUG');
    await page.goto(chapterUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await handlePopup(page);
    
    // 1. 点击进入做题界面 (增加了更多可能的按钮文本，适配详情页和直接跳转页)
    const startSelectors = [
        'a.enable.a2', 
        'a:has-text("开始做题")', 
        'a:has-text("练习模式")', 
        'a:has-text("考试模式")', 
        'a:has-text("继续做题")', 
        'a:has-text("重新做题")',
        '#PaperStartTimes',
        '.btns a.enable'
    ];
    
    let clicked = false;
    for (const selector of startSelectors) {
        if (await safeClick(page, selector, 5000)) {
            log(`激活了启动按钮: ${selector}`, 'DEBUG');
            clicked = true;
            // 如果是“重新做题”，可能还有个确认弹窗，再清理一次
            await handlePopup(page);
            break;
        }
    }

    if (!clicked) {
        log('未发现显式的启动按钮，可能已直接进入答题页或按钮不匹配', 'DEBUG');
    }

    // 2. 尝试激活“背题模式” (该模式下通常会直接显示正确答案，极大降低抓取难度)
    const activated = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
            .find(el => (el.innerText || '').trim() === '背题模式' && el.offsetParent !== null);
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (activated) {
        log('背题模式已激活', 'INFO');
        await randomSleep(3000, 5000);
        await handlePopup(page);
    }

    // 3. 断点续传跳转：点击答题卡上的特定索引直接跳到未抓取的题目
    if (questionIndex > 0) {
        log(`正在跳转到题号: ${questionIndex + 1}`, 'DEBUG');
        await page.waitForSelector('#tiku_sheet_card li', { timeout: 8000 }).catch(() => {});
        await page.evaluate((index) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li');
            const target = Math.min(index, cards.length - 1); // 防止索引越界
            if (target >= 0 && cards[target]) cards[target].click();
        }, questionIndex);
        await randomSleep(4000, 6000);
        await handlePopup(page);
    }
}

/**
 * 串题检测 (防御性编程)
 * 判断抓取到的解析是不是上一题残留的。
 * @param {Object} currentData 当前提取到的数据
 * @param {Object} lastSnapshot 上一题的数据快照
 * @returns {boolean} 是否疑似串题
 */
function isLikelyStaleAnalysis(currentData, lastSnapshot) {
    if (!currentData || !lastSnapshot) return false;
    if (currentData.analysis === '无解析' || currentData.analysis === '未知') return false;
    return currentData.step !== lastSnapshot.step && currentData.analysis === lastSnapshot.analysis;
}

/**
 * 图片异步下载
 * @param {string} url 图片源地址
 * @param {string} dest 本地存储路径
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
 * =================================================================================
 * 主循环：任务分配与断点续传核心引擎
 * =================================================================================
 */
async function run() {
    log('正在开启 V17.5 导航加固版...', 'INFO');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 自动登录
    try {
        log('尝试自动登录...', 'INFO');
        await page.goto(LOGIN_URL);
        await page.waitForTimeout(2000);
        await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn');
        await page.waitForTimeout(6000);
    } catch (e) { log('登录流程可能存在问题', 'WARN'); }

    const CATEGORIES = [
        { name: '历年真题', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/1.html' },
        { name: '模拟试卷', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/2.html' }
    ];

    for (const cat of CATEGORIES) {
        log(`\n>>> 进入分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(OUTPUT_DIR, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url).catch(() => {});
        await randomSleep(3500, 5500);

        // 核心：精准识别列表并提取各章节元数据
        const chapters = await page.evaluate(() => {
            const container = document.querySelector('.question-conten-list, .product-box, #main-tiku-box') || document.body;
            return Array.from(container.querySelectorAll('a'))
                .filter(a => {
                    const t = a.innerText.trim();
                    // 过滤出真正代表“进入考试/练习”的有效链接
                    const isAction = (t.includes('模式') || t.includes('做题') || t.includes('开始')) && a.href.includes('product_id');
                    const isLink = a.closest('.title') && (a.href.includes('paper_id') || a.href.includes('product_id'));
                    return isAction || isLink;
                })
                .map(a => {
                    const p = a.closest('li, tr, .item, .big');
                    let title = p?.querySelector('.title, .name, .item-title')?.innerText.trim() || a.innerText.trim();
                    
                    // 核心优化：优先提取直达做题页面的链接（练习模式 > 考试模式 > 详情页）
                    let url = a.href;
                    if (p) {
                        const practiceBtn = p.querySelector('a[href*="/exam/"][href*="records_type/1"]');
                        const examBtn = p.querySelector('a[href*="/exam/"]');
                        const detailBtn = p.querySelector('a[href*="/detail/"]');
                        if (practiceBtn) url = practiceBtn.href;
                        else if (examBtn) url = examBtn.href;
                        else if (detailBtn) url = detailBtn.href;
                    }
                    
                    let id = '';
                    // 使用正则提取唯一 ID 供断点续传使用，按优先级探测
                    const mPaper = url.match(/paper_id[\/=](\d+)/);
                    const mKnow = url.match(/know_id[\/=](\d+)/);
                    const mProd = url.match(/product_id[\/=](\d+)/);
                    if (mPaper) id = 'paper-' + mPaper[1];
                    else if (mKnow) id = 'know-' + mKnow[1];
                    else if (mProd) id = 'prod-' + mProd[1];
                    else id = 'unknown-' + Math.random().toString(36).slice(2, 7);

                    // 提取该试卷包含的总题数 (如 "共 100 题")
                    const mCount = p?.innerText.match(/共\s*(\d+)\s*题/) || p?.innerText.match(/\/(\d+)/);
                    return { title, url, id, total: mCount ? parseInt(mCount[1], 10) : 0 };
                })
                .filter((c, i, l) => l.findIndex(item => item.id === c.id) === i); // 依据 ID 去重
        });

        log(`识别到 ${chapters.length} 个章节`, 'INFO');

        for (const chapter of chapters) {
            const statusKey = `${cat.name}_${chapter.title}_${chapter.id}`;
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapter.id}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            // 综合判断断点续传进度（取 JSON 记录和本地 MD 文件已存题数的最大值）
            let savedInfo = completionStatus[statusKey] || {};
            if (typeof savedInfo === 'number') savedInfo = { completed: savedInfo };
            const skipCount = Math.max(Number(savedInfo.completed) || 0, getCompletedCount(outputFile));
            const totalGoal = chapter.total || savedInfo.total || 0;

            if (totalGoal > 0 && skipCount >= totalGoal) {
                log(`[跳过] 已完成: ${chapter.title} (${skipCount}/${totalGoal})`, 'INFO');
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
                    await handlePopup(page);
                    try {
                        await page.waitForSelector('#item_title', { timeout: 20000 });
                    } catch (e) {
                        log('等待题目超时，清理遮罩并尝试强制刷新页面...', 'WARN');
                        await handlePopup(page);
                        // 如果还是不行，可能是跳转没成功，尝试再点击一次“开始”
                        const retryBtn = await page.$('a.enable.a2, a:has-text("继续"), a:has-text("做题")');
                        if (retryBtn) await retryBtn.click().catch(() => {});
                        
                        await page.waitForSelector('#item_title', { timeout: 15000 }).catch(err => { throw new Error('无法进入题目页'); });
                    }
                    
                    await triggerOfficialAnalysis(page);
                    await randomSleep(2000, 3500);
                    
                    let data = await readQuestionData(page);
                    
                    // 防护：如果没抓到答案，这可能是部分多选题的机制限制，尝试点击任意一个选项触发 Ajax 返回答案
                    if (data.answer === '未知' || data.answer === '' || data.analysis === '无解析') {
                        await page.evaluate(() => {
                            const opt = document.querySelector('#item_options li, .options li');
                            if (opt) opt.click();
                        });
                        await randomSleep(2000, 3000);
                        await triggerOfficialAnalysis(page);
                        data = await readQuestionData(page);
                    }

                    const [curr, totalNum] = data.step.split('/').map(Number);
                    
                    // 断点续传：跳过已抓取
                    if (curr <= skipCount) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next && curr < totalNum) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click({ force: true });
                            await waitForQuestionChange(page, old.step, old.id);
                            continue;
                        }
                        break;
                    }

                    if (isLikelyStaleAnalysis(data, lastSnapshot)) data.analysis = '无解析';

                    // 写入
                    const md = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                    fs.appendFileSync(outputFile, md);

                    // 存进度
                    completionStatus[statusKey] = {
                        id: chapter.id, title: chapter.title,
                        completed: curr, total: totalNum, updatedAt: new Date().toLocaleString()
                    };
                    saveStatus();
                    lastSnapshot = data;

                    process.stdout.write(`\r进度: ${data.step} | ID: ${chapter.id} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                    await Promise.all(data.images.map(img => downloadImage(img.url, path.join(chapterDir, 'images', img.name))));

                    if (curr < totalNum) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click({ force: true });
                            await waitForQuestionChange(page, old.step, old.id);
                        } else break;
                    } else {
                        log(`\n>> [完成] ${chapter.title}`, 'INFO');
                        break;
                    }
                }
            } catch (e) { log(`抓取异常: ${e.message}`, 'ERROR'); }
        }
    }
    log('所有任务圆满完成！', 'INFO');
    await browser.close();
}

run().catch(console.error);
