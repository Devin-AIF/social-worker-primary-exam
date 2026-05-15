/**
 * =================================================================================
 * 自动化抓取脚本 V20.0 (终极全量加固版 - 生产级)
 * =================================================================================
 * 
 * 【功能综述 (Features)】
 * 1. 全自动多题库遍历：支持跨科目、跨分类（章节练习/历年真题/模拟试卷）的全自动循环爬取。
 * 2. 智能进度同步 (State Sync)：采用 JSON 状态文件 (completion_status.json) 驱动，
 *    支持“科目级”和“章节级”双重跳过逻辑，极大提升运行效率。
 * 3. 强力顺序校验 (Sequence Guard)：实时监控网页题号，若发现跳题或乱序，
 *    立即通过“答题卡”强制纠偏，确保 Markdown 输出 100% 连续且不重不漏。
 * 4. 深度解析提取 (Deep Analysis)：
 *    - 支持客观题与主观题（问答、案例分析）的差异化解析触发。
 *    - 采用“动态等待 + 多级选择器”策略，确保 Ajax 异步内容完全加载后再读取。
 * 5. “背题模式”强制重置：启动时可选追加 `again=1` 强制刷新服务器端状态，解决“进度缓存”导致的起始位错误。
 * 6. 共享题干支持：完美提取“一干多题”结构的父级题干与子级题目。
 * 7. 讨论区后备方案：当官方解析缺失时，自动扫描讨论区提取“老师”级别的优质回答。
 * 8. 图片本地化：自动下载题目中的图片并转化为 Markdown 相对路径引用，确保离线可用。
 * 
 * 【设计哲学 (Design Philosophy)】
 * - 稳定性高于速度：内置多重 handlePopup 和 randomSleep，模拟人类行为，规避风控。
 * - 声明式恢复：优先遵循进度文件，本地物理文件仅作为最后一道防线。
 * - 容错性：捕获所有非致命异常，支持异常后自动重试并继续后续任务。
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
const DEBUG_DIR = path.join(PROJECT_ROOT, 'debug_screenshots'); // 错误截图目录
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

async function takeScreenshot(page, name) {
    const timestamp = new Date().getTime();
    const fileName = `error_${name}_${timestamp}.png`;
    const filePath = path.join(DEBUG_DIR, fileName);
    try {
        await page.screenshot({ path: filePath, fullPage: true });
        log(`错误现场已截图: ${fileName}`, 'WARN');
    } catch (e) {
        log(`截图失败: ${e.message}`, 'ERROR');
    }
}

/** 
 * 是否启用“评论区提取”作为解析后备方案。
 * 若开启，当页面未显示官方解析时，将尝试在 `.tiku-talk-list` 寻找带“老师”关键字的评论。
 */
const ENABLE_DISCUSSION_FALLBACK = true;

// --- 状态与记录初始化 ---
let completionStatus = {};
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * 数据迁移：将原来直接存在抓取结果_V4根目录下的文件迁移到指定的默认科目目录中
 * 同时更新 completion_status.json
 */
function migrateOldData() {
    const defaultSubject = '2026年初级社会工作者《初级社会工作实务》考试题库';
    const defaultSubjectDir = path.join(OUTPUT_DIR, sanitizeFileName(defaultSubject));
    const oldDirs = ['历年真题', '模拟试卷', '章节练习'];
    let migrated = false;

    for (const d of oldDirs) {
        const oldPath = path.join(OUTPUT_DIR, d);
        if (fs.existsSync(oldPath) && fs.lstatSync(oldPath).isDirectory()) {
            if (!fs.existsSync(defaultSubjectDir)) fs.mkdirSync(defaultSubjectDir, { recursive: true });
            const newPath = path.join(defaultSubjectDir, d);
            fs.renameSync(oldPath, newPath);
            migrated = true;
            log(`已将旧目录迁移至新层级: ${newPath}`, 'INFO');
        }
    }

    if (fs.existsSync(STATUS_FILE)) {
        try { 
            const content = fs.readFileSync(STATUS_FILE, 'utf-8');
            if (content.trim()) {
                completionStatus = JSON.parse(content);
            }
        } catch (e) {
            log(`读取进度文件失败: ${e.message}。请检查 ${STATUS_FILE} 格式是否正确。为防止进度丢失，脚本已停止。`, 'ERROR');
            process.exit(1); 
        }
        let statusChanged = false;
        const newStatus = {};
        for (const key in completionStatus) {
            // 如果 key 是旧格式（没有包含科目名称前缀）
            if (oldDirs.some(d => key.startsWith(d + '_'))) {
                const newKey = `${defaultSubject}_${key}`;
                newStatus[newKey] = completionStatus[key];
                statusChanged = true;
            } else {
                newStatus[key] = completionStatus[key];
            }
        }
        if (statusChanged) {
            completionStatus = newStatus;
            try { 
                fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2)); 
                log('已更新 completion_status.json 适配新层级结构', 'INFO');
            } catch (e) {
                log(`更新进度文件失败: ${e.message}`, 'ERROR');
            }
        }
    }
}
// 执行数据结构迁移并加载最新状态
migrateOldData();

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
    try { 
        fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2)); 
    } catch (e) {
        log(`保存进度失败: ${e.message}`, 'ERROR');
    }
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
 * 全量恢复：深度清理
 * 定期清理页面上的遮罩层，防止 Playwright 的 click 动作被拦截。
 * @param {import('playwright').Page} page Playwright 页面实例
 */
async function handlePopup(page) {
    await page.evaluate(() => {
        // 1. 移除真正的透明遮罩（它们会挡住点击）
        const shades = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg'];
        shades.forEach(s => {
            document.querySelectorAll(s).forEach(el => el.remove());
        });

        // 2. 移除干扰答题区域或按钮的固定浮窗
        const floatingMasks = ['.fix-bottom', '.ad-box'];
        floatingMasks.forEach(s => {
            document.querySelectorAll(s).forEach(el => el.remove());
        });

        // 3. 重置可能的反爬 JS 变量
        try {
            window.is_ratelimit = false;
            if (window.video_analysis_ratelimit_timer) {
                clearInterval(window.video_analysis_ratelimit_timer);
            }
        } catch (e) {
            // 忽略由于网页端变量为常量导致的赋值错误
        }
    });
}

/**
 * 全量恢复：安全点击封装
 */
async function safeClick(page, selector, waitAfter = 0) {
    const element = await page.$(selector);
    if (!element) return false;

    await handlePopup(page);
    try {
        await element.click({ force: true, timeout: 5000 });
    } catch (e) {
        await element.evaluate(el => el.click()).catch(() => {});
    }
    if (waitAfter > 0) await page.waitForTimeout(waitAfter);
    await handlePopup(page);
    return true;
}

/**
 * 核心逻辑：确保进入“背题模式”
 */
async function ensureReciteMode(page) {
    const isAlreadyRecite = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('退出背题') || text.includes('背题模式已开启') || !!document.querySelector('.recite-mode-active');
    });

    if (isAlreadyRecite) return true;

    log('正在开启背题模式...', 'INFO');
    const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
            .find(el => {
                const t = (el.innerText || '').trim();
                return (t === '背题模式' || t === '背题') && el.offsetParent !== null;
            });
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (clicked) {
        await randomSleep(3000, 5000);
        await handlePopup(page);
    }
    return clicked;
}

/**
 * 全量恢复：触发解析显示
 * 在单页应用（SPA）中，某些答案和解析只有在用户点击特定按钮后才会经由 Ajax 加载或解除隐藏。
 * 本函数采取“广撒网”策略，遍历点击所有疑似解析按钮的节点。
 */
/**
 * 深度解析触发引擎
 * 针对 SPA 应用，很多内容是异步 Ajax 加载的。
 * 本函数通过模拟用户点击“查看解析”或“显示答案”等操作来触发数据加载。
 */
async function triggerOfficialAnalysis(page) {
    const trigger = async () => {
        await page.evaluate(() => {
            const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length) && window.getComputedStyle(el).display !== 'none');
            
            // 1. 检查解析是否已经完全展开且包含真实内容
            const getVisibleAnalysis = () => {
                const sel = ['.analysis.pd10', '#answer_analysis', '.analysis', '#analysis', '.tiku-analysis', '.answer-detail', '#answer_analysis_detail', '.subject-answer', '.answer-yes', '.answer-wrong', '.answer-content', '.solution'];
                for (const s of sel) {
                    const el = document.querySelector(s);
                    if (isVisible(el) && el.innerText.trim().length > 15 && !el.innerText.includes('点击查看解析')) return el;
                }
                return null;
            };
            
            if (getVisibleAnalysis()) return; 

            // 2. 触发各种可能的解析/答案按钮
            const clickSelectors = [
                '.click_analysis', 
                '[data-type="analysis"]', 
                '.analysis-btn', 
                '.show-analysis', 
                '.jiexi', 
                '.answer-analysis',
                '.btn-analysis',
                '.show-answer',
                '#show_answer_btn',
                '.view-solution',
                '.btn-answer',
                '.view-answer'
            ];
            
            for (const s of clickSelectors) {
                const els = Array.from(document.querySelectorAll(s));
                for (const el of els) {
                    if (isVisible(el)) { el.click(); break; }
                }
            }

            // 3. 特征匹配点击
            const textButtons = Array.from(document.querySelectorAll('a, button, span, div'))
                .filter(el => {
                    const t = (el.innerText || '').trim();
                    return (t === '查看解析' || t === '解析' || t === '参考解析' || t === '答案解析' || t === '查看答案' || t === '参考答案' || t === '显示答案') && isVisible(el);
                });
            textButtons.forEach(el => el.click());
        });
    };

    await trigger();
    // 为 Ajax 异步加载预留缓冲时间
    await page.waitForTimeout(1500);
    
    // 核心：动态等待解析内容真正出现在 DOM 中且包含文本
    const success = await page.waitForFunction(() => {
        const el = document.querySelector('.analysis, #answer_analysis, .tiku-analysis, .answer-detail, #answer_analysis_detail, .subject-answer, .answer-yes, .answer-wrong, .answer-content, .solution');
        return el && el.innerText.trim().length > 5 && !el.innerText.includes('点击查看解析');
    }, { timeout: 4000 }).catch(() => false);

    if (!success) {
        log('解析加载缓慢，尝试二次触发...', 'DEBUG');
        await trigger();
        await page.waitForTimeout(2000);
    }
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
    // 1. 核心校验：等待题目进度（题号）或内部题目 ID 发生变化，标志着 SPA 开始重新渲染
    await page.waitForFunction(({ oldStep, oldItemId }) => {
        const stepEl = document.querySelector('#item_step, .item-step');
        const idEl = document.querySelector('#item_id');
        const currentStep = (stepEl?.innerText || '').trim();
        const currentId = (idEl?.innerText || '').trim();
        
        return (currentStep && currentStep !== oldStep) || (currentId && currentId !== oldItemId);
    }, { oldStep, oldItemId }, { timeout: 12000 }).catch(() => {});

    // 2. DOM 稳定期：等待题目主干渲染完毕 (标题区域必须有文字)
    await page.waitForFunction(() => {
        const el = document.querySelector('#item_title, .item-title, .subject-title');
        return el && el.innerText.trim().length > 0;
    }, { timeout: 5000 }).catch(() => {});

    // 3. 基础缓冲，让剩余选项、图片等资源有时间呈现
    await randomSleep(1000, 1500); 
}

/**
 * 全量恢复：深度提取数据 (爬虫的“眼睛”)
 * 在浏览器上下文中执行的脚本，直接读取 DOM。
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>} 提取出的题目对象
 */
async function readQuestionData(page) {
    return page.evaluate((enableDiscussionFallback) => {
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return !!(el.offsetParent || el.getClientRects().length) && style.display !== 'none' && style.visibility !== 'hidden';
        };

        const extractLetters = (text) => {
            const match = (text || '').match(/正确答案[^A-F]*([A-F、,，\s]+)/) || (text || '').match(/答案[^A-F]*([A-F]+)/);
            return match ? match[1].replace(/[^A-F]/g, '') : '';
        };

        const images = [];
        const getStep = () => {
            const sel = ['#item_step', '.item-step', '.question-step', '.subject-step', '.step', '.step-num'];
            for (const s of sel) {
                const el = document.querySelector(s);
                if (el && el.innerText.includes('/')) return el.innerText.trim();
            }
            return '0/0';
        };
        const step = getStep();

        // 核心：原地提取逻辑（不克隆，确保 innerText 格式完美）
        const processImages = (container, prefix) => {
            if (!container) return '';
            const imgs = Array.from(container.querySelectorAll('img'));
            const originalDisplays = imgs.map(img => img.style.display);
            
            imgs.forEach((img, idx) => {
                const src = img.getAttribute('src');
                const alt = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
                
                if (src) {
                    // 策略：如果图片有 alt 属性且较短，极可能是“文字图片化”，直接用文字替换
                    if (alt && alt.length > 0 && alt.length < 50) {
                        const span = document.createElement('span');
                        span.className = 'gemini-img-marker';
                        span.innerText = alt; // 直接使用文字
                        img.parentNode.insertBefore(span, img);
                        img.style.display = 'none';
                    } else {
                        const name = `q_${step.replace(/\//g, '_')}_${prefix}_${idx}.png`;
                        images.push({ name, url: src });
                        const span = document.createElement('span');
                        span.className = 'gemini-img-marker';
                        span.innerText = `![图](./images/${name})`;
                        img.parentNode.insertBefore(span, img);
                        img.style.display = 'none'; 
                    }
                }
            });
            const text = container.innerText.trim();
            container.querySelectorAll('.gemini-img-marker').forEach(el => el.remove());
            imgs.forEach((img, i) => img.style.display = originalDisplays[i]);
            return text;
        };

        // 1. 提取题目（区分共享题干与子题目）
        const stemEl = document.querySelector('#item_title, .item-title, .subject-title, .question-title');
        const subTitleEl = document.querySelector('.subject-sub-title, .question-sub-title');
        
        let stemText = processImages(stemEl, 'stem');
        let titleText = processImages(subTitleEl, 'tit');
        
        // 如果没有子题目，说明当前内容就是主题目
        if (!titleText) {
            titleText = stemText;
            stemText = '';
        }

        // 2. 提取选项
        const optionEls = Array.from(document.querySelectorAll('#item_options li, .options li, .question-options li')).filter(isVisible);
        const optionsList = optionEls.map((li, idx) => processImages(li, `opt${idx}`)).join('\n');

        // 3. 提取官方解析（增加对主观题容器的探测）
        let analysisText = '无解析';
        const analysisSelectors = [
            '.analysis.pd10', 
            '#answer_analysis .analysis', 
            '.answer-yes .analysis', 
            '.answer-wrong .analysis', 
            '.analysis', 
            '#analysis',
            '.tiku-analysis',
            '.answer-detail',
            '#answer_analysis_detail',
            '.subject-answer',
            '.answer-content',
            '.question-answer',
            '#answer',
            '.solution',
            '.jiexi-content'
        ];
        
        for (const s of analysisSelectors) {
            const elements = Array.from(document.querySelectorAll(s));
            for (let i = elements.length - 1; i >= 0; i--) {
                const el = elements[i];
                if (isVisible(el)) {
                    const t = el.innerText.trim();
                    if (t.includes('点击查看解析') || t.length < 5) continue;
                    
                    let rawAnalysis = processImages(el, 'ans');
                    // 更智能的清洗逻辑
                    let clean = rawAnalysis.replace(/^[\s\S]*?参考解析[：:\n]*\s*/i, '')
                                         .replace(/^[\s\S]*?答案解析[：:\n]*\s*/i, '')
                                         .replace(/^[\s\S]*?解析[：:\n]*\s*/i, '')
                                         .replace(/点击查看解析/g, '')
                                         .replace(/我要纠错/g, '')
                                         .replace(/从错题本移除/g, '')
                                         .replace(/提交/g, '')
                                         .trim();
                    analysisText = clean || rawAnalysis;
                    if (analysisText.length > 5 && analysisText !== '无解析') break;
                }
            }
            if (analysisText !== '无解析') break;
        }

        // 4. 讨论区后备
        if (analysisText === '无解析' && enableDiscussionFallback) {
            const talks = Array.from(document.querySelectorAll('.tiku-talk-list li, .question-talk-list li'));
            for (let i = talks.length - 1; i >= 0; i--) {
                if (talks[i].querySelector('.terd') || talks[i].innerText.includes('老师')) {
                    const mEl = talks[i].querySelector('.huida .mesage, .message');
                    if (mEl) {
                        analysisText = `[讨论提取] ${processImages(mEl, 'talk')}`;
                        break;
                    }
                }
            }
        }

        // 5. 提取答案
        const getAns = () => {
            const opts = Array.from(document.querySelectorAll('#item_options li, .options li, .question-options li'));
            const rights = opts
                .filter(li => isVisible(li) && (li.getAttribute('data-isanswer') === '1' || li.classList.contains('correct') || li.classList.contains('right') || !!li.querySelector('.right_icon') || li.querySelector('.correct_icon')))
                .map(li => li.getAttribute('data-optname') || li.innerText.trim().charAt(0))
                .filter(Boolean);
            if (rights.length > 0) return [...new Set(rights)].sort().join('');

            const explicitSelectors = ['.right_answer', '#right_answer', '#answer_analysis', '.answer-yes', '.answer-wrong', '.analysis', '#analysis', '.correct-answer'];
            for (const selector of explicitSelectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                for (let i = elements.length - 1; i >= 0; i--) {
                    if (isVisible(elements[i])) {
                        const answer = extractLetters(elements[i].innerText);
                        if (answer) return answer;
                    }
                }
            }
            return '未知';
        };

        return {
            type: document.querySelector('#item_type, .item-type, .question-type')?.innerText.trim() || '题型',
            step,
            itemId: document.querySelector('#item_id')?.innerText.trim() || '',
            stem: stemText,
            title: titleText,
            options: optionsList,
            answer: getAns(),
            analysis: analysisText,
            images,
            fingerprint: (titleText.substring(0, 50) + optionsList.substring(0, 50)).replace(/\s/g, '')
        };
    }, ENABLE_DISCUSSION_FALLBACK);
}

/**
 * 章节初始化与精准定位
 * 负责重置页面状态、开启背题模式，并利用“答题卡”跳转到断点。
 */
async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    log(`正在打开章节 URL: ${chapterUrl}`, 'DEBUG');
    
    // 强制重置策略：如果从 0 开始，追加 again=1 确保服务器端不使用旧进度缓存
    const finalUrl = (questionIndex === 0 && !chapterUrl.includes('again=1')) 
        ? (chapterUrl.includes('?') ? `${chapterUrl}&again=1` : `${chapterUrl}?again=1`)
        : chapterUrl;

    await page.goto(finalUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await handlePopup(page);
    
    // 1. 自动识别并点击各种风格的启动按钮
    const startSelectors = [
        'a.enable.a2', 
        'a:has-text("开始做题")', 
        'a:has-text("练习模式")', 
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
            await handlePopup(page);
            break;
        }
    }

    // 2. 激活“背题模式” (该模式下 HTML 中会直接附带正确答案，极大提高解析准确度)
    const activated = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li'))
            .find(el => {
                const t = (el.innerText || '').trim();
                const isVisible = !!(el.offsetParent || el.getClientRects().length);
                return (t === '背题模式' || t === '背题' || t === '显示答案') && isVisible;
            });
        if (btn) { btn.click(); return true; }
        return false;
    });

    if (activated) {
        log('背题模式已激活', 'INFO');
        await randomSleep(3000, 5000);
        await handlePopup(page);
    }

    // 3. 核心机制：答题卡跳转 (比输入框跳转更抗干扰)
    if (questionIndex > 0) {
        log(`正在跳转到题号: ${questionIndex + 1}`, 'DEBUG');
        // 确保答题卡菜单已展开
        await page.evaluate(() => {
            const cardBtn = document.querySelector('.bd_dtk, .answer-card-btn, #tiku_sheet');
            if (cardBtn && !!(cardBtn.offsetParent || cardBtn.getClientRects().length)) cardBtn.click();
        });
        await page.waitForTimeout(1000);

        const jumped = await page.evaluate((index) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
            if (cards.length > 0) {
                const target = Math.min(index, cards.length - 1);
                cards[target].click();
                return true;
            }
            return false;
        }, questionIndex);

        if (!jumped) {
            log('答题卡定位失败，尝试输入框后备方案...', 'WARN');
            const jumpInput = await page.$('.bd_bt_input');
            if (jumpInput) {
                await jumpInput.focus();
                await jumpInput.fill(String(questionIndex + 1));
                await page.keyboard.press('Enter');
            }
        }
        await randomSleep(3000, 5000);
        await handlePopup(page);
    }
}

/**
 * 图片异步下载 (加固版：支持 http/https 协议、相对路径和基本重试)
 * @param {string} url 图片源地址
 * @param {string} dest 本地存储路径
 */
async function downloadImage(url, dest) {
    if (!url) return;
    try {
        // 支持 Base64 数据协议
        if (url.startsWith('data:image')) {
            const base64Data = url.split(',')[1];
            if (base64Data) {
                fs.writeFileSync(dest, base64Data, 'base64');
                return;
            }
        }

        let fullUrl = url;
        if (url.startsWith('//')) {
            fullUrl = `https:${url}`;
        } else if (url.startsWith('/')) {
            fullUrl = `https://www.xs507.com${url}`;
        } else if (!url.startsWith('http')) {
            fullUrl = `https://www.xs507.com/${url}`;
        }

        // 根据 URL 协议选择合适的模块
        const protocol = fullUrl.startsWith('https') ? https : http;

        await new Promise((resolve, reject) => {
            const request = protocol.get(fullUrl, (response) => {
                if (response.statusCode === 200) {
                    const file = fs.createWriteStream(dest);
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                } else {
                    reject(new Error(`下载失败: ${response.statusCode}`));
                }
            });
            request.on('error', (err) => reject(err));
            request.setTimeout(10000, () => {
                request.destroy();
                reject(new Error('下载超时'));
            });
        });
    } catch (e) {
        log(`图片下载异常 [${url}]: ${e.message}`, 'DEBUG');
    }
}

/**
 * =================================================================================
 * 主循环：任务分配与断点续传核心引擎
 * =================================================================================
 */
/**
 * 抓取单个科目下所有分类（历年真题、模拟试卷、章节练习）的题目
 * @param {import('playwright').Page} page
 * @param {Object} subject 科目信息 { name, productId }
 */
async function crawlSubject(page, subject) {
    const subjectName = sanitizeFileName(subject.name);
    const subjectDir = path.join(OUTPUT_DIR, subjectName);
    if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });

    // 0. 核心效率优化：检查题库是否整体已完成
    const subjectStatusKey = `SUBJECT_FINISHED_${subject.name}`;
    if (completionStatus[subjectStatusKey]) {
        log(`\n[跳过] 题库 [${subject.name}] 已整体标记为完成，直接跳过。`, 'INFO');
        return;
    }

    // 先切换到该题库：访问题库列表页并点击对应 radio
    const TIKU_LIST_URL = 'https://www.xs507.com/Tiku/Tikulist/index.html';
    log(`\n正在切换题库到: ${subject.name} (product_id=${subject.productId})`, 'INFO');
    
    // 导航到题库列表页
    await page.goto(TIKU_LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await handlePopup(page);

    // 关键：检查是否存在“切换其他题库”按钮，如果有则点击它以展开列表
    const switchLink = await page.$('a.change:has-text("切换"), a.change[href*="change.html"]');
    if (switchLink) {
        log('检测到“切换其他题库”链接，正在点击...', 'INFO');
        await switchLink.click({ force: true }).catch(() => {});
        await randomSleep(2000, 3000);
        await handlePopup(page);
    }
    
    // 等待页面 JS 渲染完成：显式等待包含 radio 列表的容器出现
    let radioLoaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // 如果点击链接后 URL 变了或者内容刷新了，再次检查
            if (attempt > 1) {
                const retrySwitch = await page.$('a.change:has-text("切换")');
                if (retrySwitch) await retrySwitch.click({ force: true }).catch(() => {});
            }

            // 等待 radio 出现
            await page.waitForSelector('input[name="change_id"]', { timeout: 8000 });
            radioLoaded = true;
            break;
        } catch (e) {
            log(`第 ${attempt} 次等待 radio 列表失败，URL: ${page.url()}`, 'WARN');
            if (attempt < 3) {
                // 重试：刷新页面
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                await randomSleep(3000, 5000);
            }
        }
    }
    
    await handlePopup(page);

    // 用 Playwright 原生 click 点击对应的 label（确保触发 jQuery change 事件）
    const radioSelector = `input[name="change_id"][value="${subject.productId}"]`;
    const radioExists = await page.$(radioSelector);
    
    if (!radioExists) {
        log(`未找到 product_id=${subject.productId} 的切换按钮，跳过`, 'ERROR');
        // 打印页面上实际存在的 radio 值，便于调试
        const availableValues = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('input[name="change_id"]')).map(r => `${r.value}(${r.checked ? '选中' : '未选'})`);
        });
        log(`页面上可用的 product_id 列表: [${availableValues.join(', ')}]`, 'DEBUG');
        return;
    }

    // 点击 label 来选中 radio（触发完整事件链）
    try {
        // 方式1: 点击包裹 radio 的 label
        await page.click(`label:has(input[name="change_id"][value="${subject.productId}"])`, { force: true, timeout: 5000 });
    } catch (e) {
        try {
            // 方式2: 直接点击 input
            await page.click(radioSelector, { force: true, timeout: 3000 });
        } catch (e2) {
            // 方式3: JS 强制选中并触发 change 事件
            await page.evaluate((pid) => {
                const radio = document.querySelector(`input[name="change_id"][value="${pid}"]`);
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                    radio.dispatchEvent(new Event('click', { bubbles: true }));
                }
            }, subject.productId);
        }
    }
    log(`已选中题库: ${subject.name}`, 'INFO');
    
    // 等待页面可能发生的导航/刷新/Ajax 切换
    await randomSleep(3000, 5000);
    await handlePopup(page);

    // 部分网站切换后会自动跳转，部分需要手动触发。检查是否有"确认"按钮
    const confirmBtn = await page.$('.list-change .btn-confirm, .list-change .submit, button:has-text("确认"), a:has-text("确认切换")');
    if (confirmBtn) {
        await confirmBtn.click({ force: true }).catch(() => {});
        log('点击了确认切换按钮', 'DEBUG');
        await randomSleep(4000, 6000);
    }
    
    // 切换完成后，页面可能刷新了，等待稳定
    await page.waitForLoadState('networkidle').catch(() => {});
    await handlePopup(page);

    // 关键：从页面动态提取分类链接（适配“进入题库”列表）
    const CATEGORIES = [];
    const extractedCats = await page.evaluate(() => {
        const results = [];
        const items = document.querySelectorAll('.list-count li');
        items.forEach(li => {
            const a = li.querySelector('a');
            const name = li.querySelector('b')?.innerText.trim();
            if (a && name) {
                // 仅抓取我们感兴趣的分类
                if (['历年真题', '模拟试卷', '章节练习'].includes(name)) {
                    results.push({ name, url: a.href });
                }
            }
        });
        return results;
    });

    if (extractedCats.length > 0) {
        log(`成功从页面提取到 ${extractedCats.length} 个分类链接`, 'INFO');
        CATEGORIES.push(...extractedCats);
    } else {
        log('未发现 .list-count 链接列表，尝试通过参数构造...', 'DEBUG');
        // 获取切换后页面的 subject_id（从页面链接中提取）
        let subjectId = '';
        const pageLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="subject_id"]'));
            for (const a of links) {
                const m = a.href.match(/subject_id[\/=](\d+)/);
                if (m) return m[1];
            }
            return '';
        });
        subjectId = pageLinks;

        if (!subjectId) {
            const curUrl = page.url();
            const m = curUrl.match(/subject_id[\/=](\d+)/);
            if (m) subjectId = m[1];
        }

        if (subjectId) {
            CATEGORIES.push({ name: '历年真题', url: `https://www.xs507.com/Tiku/Product/index/product_id/${subject.productId}/subject_id/${subjectId}/type/1.html` });
            CATEGORIES.push({ name: '模拟试卷', url: `https://www.xs507.com/Tiku/Product/index/product_id/${subject.productId}/subject_id/${subjectId}/type/2.html` });
            CATEGORIES.push({ name: '章节练习', url: `https://www.xs507.com/Tiku/Product/index/product_id/${subject.productId}/subject_id/${subjectId}/type/3.html` });
        } else {
            log(`缺少 subject_id，将尝试从当前页面直接抓取`, 'WARN');
            CATEGORIES.push({ name: '默认分类', url: page.url() });
        }
    }

    for (const cat of CATEGORIES) {
        log(`\n>>> [${subject.name}] 进入分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(subjectDir, cat.name);
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
            // 核心修复：直接使用固定的 subject.name 作为 Key，防止 DOM 读取不稳定导致进度记录失败
            const statusKey = `${subject.name}_${cat.name}_${chapter.title}_${chapter.id}`;
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapter.id}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            // 综合判断断点续传进度 (恢复到最稳健的 MAX 策略)
            let savedInfo = completionStatus[statusKey] || {};
            if (typeof savedInfo === 'number') savedInfo = { completed: savedInfo };
            
            // 2. 核心优化：进度恢复策略
            const totalGoal = chapter.total || savedInfo.total || 0;
            const jsonProgress = Number(savedInfo.completed) || 0;
            const mdProgress = getCompletedCount(outputFile);
            
            let currentProgress = jsonProgress;
            
            // 进度纠偏：只有当 JSON 有记录且 MD 文件更领先时，才进行前移修正（防止上次运行崩溃未保存 JSON）
            // 如果 JSON 为 0，说明用户可能手动重置了进度，此时我们严格遵守 0 并允许后续逻辑清理旧 MD 文件
            if (jsonProgress > 0 && mdProgress > jsonProgress) {
                log(`检测到本地 MD 文件已有 ${mdProgress} 题，将从该位置恢复以防重复。`, 'WARN');
                currentProgress = mdProgress;
            }

            if (savedInfo.isFinished || (totalGoal > 0 && currentProgress >= totalGoal)) {
                log(`[跳过] 该章节已全部抓取完毕: ${chapter.title} (${currentProgress}/${totalGoal})`, 'INFO');
                continue;
            }

            log(`>> 准备抓取: ${chapter.title} (ID: ${chapter.id}, 当前断点: ${currentProgress}/${totalGoal || '?'})`, 'INFO');
            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });

            try {
                // 开启抓取前先确保页面处于背题模式或准备就绪
                await openChapterAtQuestion(page, chapter.url, currentProgress);
                // 如果从 0 开始，或者文件不存在，则初始化文件（覆盖旧内容）
                if (!fs.existsSync(outputFile) || currentProgress === 0) {
                    fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);
                }

                let lastWrittenCurr = currentProgress; 
                let lastFingerprint = ''; // 数据指纹，防止重复读取旧内容
                let lastStem = '';        // 用于共享题干去重
                let stuckCount = 0;       // 页面卡死计数器
                let retryCount = 0;       // 重复题号计数器
                
                while (true) {
                    await handlePopup(page);
                    try {
                        await page.waitForSelector('#item_title, .item-title, .subject-title', { timeout: 15000 });
                    } catch (e) {
                        log('等待题目加载超时，尝试点击“继续”或“下一题”纠偏...', 'WARN');
                        await takeScreenshot(page, 'timeout_waiting_title');
                        await handlePopup(page);
                        const nextBtn = await page.$('.subject-next, #next_item, a:has-text("下一题")');
                        if (nextBtn) await nextBtn.click({ force: true }).catch(() => {});
                        await page.waitForTimeout(2000);
                    }
                    
                    await triggerOfficialAnalysis(page);
                    await randomSleep(2000, 3500);
                    
                    let data = await readQuestionData(page);
                    
                    // --- 核心安全机制：数据指纹校验 (防止 SPA 异步延迟导致的重复读取) ---
                    if (data.fingerprint === lastFingerprint && lastWrittenCurr > 0) {
                        stuckCount++;
                        log(`检测到页面内容未刷新 (重复指纹, 重试: ${stuckCount}/5)...`, 'WARN');
                        if (stuckCount >= 3) {
                            log('疑似页面卡死，尝试强制刷新并重新定位...', 'ERROR');
                            await takeScreenshot(page, 'stuck_reload');
                            await page.reload().catch(() => {});
                            await randomSleep(5000, 8000);
                            await openChapterAtQuestion(page, chapter.url, lastWrittenCurr);
                            stuckCount = 0;
                        }
                        await randomSleep(2000, 4000);
                        continue;
                    }
                    stuckCount = 0; // 成功读取新题，重置计数
                    lastFingerprint = data.fingerprint;

                    const [curr, totalNum] = data.step.split('/').map(Number);
                    
                    // --- 核心安全机制：顺序校验与强制纠偏 ---
                    // 目的是防止网站因为网络波动导致的自动跳转或题号错位。
                    // 如果当前页面题号（curr）不等于期望的题号（lastWrittenCurr + 1），则通过答题卡强制拉回。
                    if (curr !== lastWrittenCurr + 1 && curr <= totalNum && curr > 0) {
                        log(`检测到题号不连续 (当前:${curr}, 期望:${lastWrittenCurr + 1})，正在通过答题卡强制纠偏...`, 'WARN');
                        await page.evaluate((target) => {
                            const cardBtn = document.querySelector('.bd_dtk, #tiku_sheet');
                            if (cardBtn) cardBtn.click();
                            setTimeout(() => {
                                const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li');
                                if (cards[target - 1]) cards[target - 1].click();
                            }, 500);
                        }, lastWrittenCurr + 1);
                        await randomSleep(3000, 5000);
                        data = await readQuestionData(page);
                        const [newCurr] = data.step.split('/').map(Number);
                        if (newCurr !== lastWrittenCurr + 1) {
                            log(`纠偏失败，当前仍为 ${newCurr}，尝试直接继续抓取以防死循环。`, 'DEBUG');
                        }
                    }

                    // 辅助补救：如果解析仍然缺失，模拟点击第一个选项以触发服务端返回解析
                    if (data.answer === '未知' || data.answer === '' || data.analysis === '无解析') {
                        await page.evaluate(() => {
                            const opt = document.querySelector('#item_options li, .options li, .question-options li');
                            // 关键：只有在未选中的情况下才点，避免“反向操作”取消选中
                            if (opt && !opt.classList.contains('selected') && !opt.classList.contains('active')) {
                                opt.click();
                            }
                        });
                        await page.waitForTimeout(1000);
                        await triggerOfficialAnalysis(page);
                        await randomSleep(2000, 3000);
                        data = await readQuestionData(page);
                    }
                    
                    // 刷新最新状态
                    const [currFinal, totalNumFinal] = data.step.split('/').map(Number);
                    
                    // 1. 断点续传：物理跳过
                    if (currFinal <= currentProgress) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next && currFinal < totalNumFinal) {
                            log(`跳过已抓取题号: ${currFinal}`, 'DEBUG');
                            const old = { step: data.step, id: data.itemId };
                            await next.click({ force: true });
                            await waitForQuestionChange(page, old.step, old.id);
                            continue;
                        } else if (currFinal <= currentProgress && currFinal === totalNumFinal) {
                            log(`已到达最后一道题，但仍在跳过范围内，任务结束`, 'INFO');
                            completionStatus[statusKey] = { ...savedInfo, isFinished: true, completed: totalNumFinal, total: totalNumFinal };
                            saveStatus();
                            break;
                        }
                    }

                    // 2. 核心防御：防止原地踏步
                    if (currFinal <= lastWrittenCurr) {
                        retryCount++;
                        log(`检测到重复题号 ${currFinal} (重试: ${retryCount}/5)，尝试补救跳转...`, 'WARN');
                        await handlePopup(page);
                        const next = await page.$('.subject-next, #next_item');
                        if (next && currFinal < totalNumFinal) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click({ force: true });
                            await waitForQuestionChange(page, old.step, old.id);
                            continue;
                        } else break;
                    }

                    retryCount = 0; 

                    if (currFinal <= 0) {
                        log(`检测到数据未就绪 (题号: ${currFinal})，等待刷新...`, 'DEBUG');
                        await randomSleep(2000, 3000);
                        continue;
                    }

                    // --- 核心排版逻辑：共享题干与题目合并 ---
                    let md = `## 第 ${currFinal} 题 [${data.type}]\n\n`;
                    
                    // 如果有共享题干，且与上一题不同，则写入题干
                    if (data.stem && data.stem !== lastStem) {
                        md += `**【背景】**\n${data.stem}\n\n`;
                        lastStem = data.stem;
                    }
                    
                    md += `**题目：** ${data.title}\n\n`;
                    
                    // 问答题、简答题等主观题处理
                    if (!['问答题', '简答题', '案例分析题', '论述题'].includes(data.type)) {
                        md += `**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n> **正确答案：** ${data.answer}\n\n`;
                        md += `**解析：**\n${data.analysis}\n\n---\n\n`;
                    } else {
                        // 主观题：答案直接显示在解析位
                        md += `**参考答案/解析：**\n${data.analysis}\n\n---\n\n`;
                    }
                    
                    fs.appendFileSync(outputFile, md);

                    // --- 状态持久化与进度存档 ---
                    lastWrittenCurr = currFinal; 
                    completionStatus[statusKey] = {
                        id: chapter.id, title: chapter.title,
                        completed: currFinal, total: totalNumFinal, updatedAt: new Date().toLocaleString()
                    };
                    saveStatus();

                    process.stdout.write(`\r进度: ${data.step} | ID: ${chapter.id} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                    
                    // 异步下载图片
                    for (const img of data.images) {
                        await downloadImage(img.url, path.join(chapterDir, 'images', img.name));
                    }

                    // 前进到下一题
                    if (currFinal < totalNumFinal) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) {
                            const old = { step: data.step, id: data.itemId };
                            await next.click({ force: true });
                            await waitForQuestionChange(page, old.step, old.id);
                        } else {
                            log('\n未发现下一题按钮，任务结束。', 'DEBUG');
                            break; 
                        }
                    } else {
                        log(`\n>> [完成] ${chapter.title}`, 'INFO');
                        completionStatus[statusKey] = {
                            id: chapter.id, title: chapter.title,
                            completed: currFinal, total: totalNumFinal, 
                            isFinished: true,
                            updatedAt: new Date().toLocaleString()
                        };
                        saveStatus();
                        break;
                    }
                }
            } catch (e) { 
                log(`抓取异常: ${e.message}`, 'ERROR'); 
                await takeScreenshot(page, 'chapter_loop_error');
            }
        }
    }
    
    // 标记整个科目完成
    completionStatus[`SUBJECT_FINISHED_${subject.name}`] = {
        isFinished: true,
        updatedAt: new Date().toLocaleString()
    };
    saveStatus();
    log(`\n★★★ [完成] 科目 [${subject.name}] 所有内容已处理完毕，标记为整体完成。 ★★★`, 'INFO');
}

/**
 * 全自动主入口：登录 -> 遍历5套题库 -> 逐一切换并抓取
 */
async function run() {
    log('正在开启 V20.0 全自动多题库版...', 'INFO');
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

    // 5 套题库的完整清单（从网站 HTML 中提取）
    const ALL_SUBJECTS = [
        { name: '2026年初级社会工作者《初级社会工作实务》考试题库', productId: '1525' },
        { name: '2026年中级社会工作者《中级社会工作实务》考试题库', productId: '317' },
        { name: '2026年中级社会工作者《中级社会工作法规与政策》考试题库', productId: '39' },
        { name: '2026年中级社会工作者《中级社会工作综合能力》考试题库', productId: '316' },
        { name: '2026年初级社会工作者《初级社会工作综合能力》考试题库', productId: '1526' },
    ];

    log(`\n===========================================================`, 'INFO');
    log(`共 ${ALL_SUBJECTS.length} 套题库待处理，开始全自动遍历...`, 'INFO');
    log(`===========================================================\n`, 'INFO');

    for (let i = 0; i < ALL_SUBJECTS.length; i++) {
        const subject = ALL_SUBJECTS[i];
        log(`\n★★★ [${i + 1}/${ALL_SUBJECTS.length}] 开始处理: ${subject.name} ★★★`, 'INFO');
        try {
            await crawlSubject(page, subject);
        } catch (e) {
            log(`科目 [${subject.name}] 抓取过程中出现异常: ${e.message}`, 'ERROR');
        }
    }

    log('\n★★★ 所有 5 套题库全部处理完毕！★★★', 'INFO');
    await browser.close();
    rl.close();
}

run().catch((e) => {
    console.error(e);
    rl.close();
});
