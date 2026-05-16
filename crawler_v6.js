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
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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

// --- 核心引擎 (V5 级抓取逻辑) ---

async function handlePopup(page) {
    await page.evaluate(() => {
        // 只清理遮罩，不删除被隐藏的业务节点
        const shades = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg', '.mask', '.loading-mask', '.analysis-lock', '.layerFeedback', '.layui-layer'];
        shades.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        try {
            document.querySelectorAll('.hide, .hidden').forEach(el => el.classList.remove('hide', 'hidden'));
            const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer', '.answer-content'];
            analysisSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    el.style.display = 'block'; el.style.visibility = 'visible'; el.style.opacity = '1';
                });
            });
            document.querySelectorAll('[style*="display: none"]').forEach(el => {
                if (el.id !== 'item_star') el.style.display = 'block';
            });
        } catch(e) {}
    });
}

async function installDomGuard(page) {
    await page.evaluate(() => {
        if (window.__crawlerDomGuardInstalled) return;
        window.__crawlerDomGuardInstalled = true;

        const cleanup = () => {
            const popups = ['.layerSaveSuccess', '.layui-layer-shade', '.layui-layer', '#video_analysis_ratelimit_overlay', '.layerFeedback', '#popup_box_bg', '.mask', '.loading-mask'];
            popups.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            // 强制显示解析区域
            const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer', '.answer-content'];
            analysisSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    el.style.display = 'block';
                    el.style.visibility = 'visible';
                    el.style.opacity = '1';
                });
            });

            document.querySelectorAll('[style*="display: none"]').forEach(el => {
                if (el.id !== 'item_star' && !String(el.className || '').includes('show_child fr')) {
                    el.style.display = 'block';
                }
            });
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

async function triggerOfficialAnalysis(page, oldAnalysisFingerprint = '') {
    const trigger = async () => {
        await page.evaluate(() => {
            // 移除干扰弹窗
            document.querySelectorAll('.layui-layer-shade, .layui-layer, .layerSaveSuccess, .layui-layer-close').forEach(el => el.remove());
            
            // 强制显示解析区域
            const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer', '.answer-content'];
            analysisSelectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    el.style.display = 'block'; el.style.visibility = 'visible'; el.style.opacity = '1';
                });
            });

            // 点击查看解析按钮 (参考 console_crawler.js)
            const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn'];
            clickSelectors.forEach(s => {
                const btns = document.querySelectorAll(s);
                btns.forEach(btn => {
                    if (btn.offsetParent !== null || btn.innerText.includes('解析') || btn.innerText.includes('答案')) {
                        btn.click();
                    }
                });
            });
        });
    };
    await handlePopup(page);
    await trigger();
    await page.waitForTimeout(1000); // 控制台脚本用的是 500ms，这里稍微多给点时间
    return true; 
}

async function readQuestionData(page, staleState = {}) {
    return page.evaluate(({ ENABLE_DISCUSSION_FALLBACK, staleState }) => {
        const {
            oldAnalysisFingerprint = '',
            staleFingerprints = [],
            oldTitleFingerprint = ''
        } = staleState || {};

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

            let text = (clone.innerText || clone.textContent || '').trim();
            const junkPatterns = [/点击查看解析/g, /收起解析/g, /视频解析/g, /我要纠错/g, /从错题本移除/g, /提交/g, /\[视频解析\]/g, /\[查看解析\]/g, /查看视频/g, /听课/g, /展开解析/g];
            junkPatterns.forEach(p => text = text.replace(p, ''));
            return text.trim();
        };

        const titleEl = document.querySelector('#item_title, .item-title, .subject-title');
        const titleText = processContent(titleEl, 'tit');
        const itemType = document.querySelector('#item_type, .item-type')?.innerText.trim() || '题型';

        const fetchOptions = () => {
            const selectors = ['#item_options li', '.subject-option li', '.option-list li', '.options li'];
            for (const s of selectors) {
                const items = document.querySelectorAll(s);
                if (items.length > 0) return Array.from(items).map((li, idx) => processContent(li, `opt${idx}`)).join('\n');
            }
            return '';
        };

        let finalAnswer = '未知';
        let finalAnalysis = '无解析';

        // 1. 提取答案 (参考 console_crawler.js 逻辑)
        const ansSelectors = ['.right', '.answer-yes', '#answer_right', '.correct-answer', '.subject-answer', '.right_answer'];
        for (const s of ansSelectors) {
            const el = document.querySelector(s);
            if (el) {
                let t = el.innerText.replace('正确答案：', '').replace('答案：', '').replace('参考答案：', '').trim();
                if (t && t.length > 0 && t.length < 500) {
                    finalAnswer = t;
                    break;
                }
            }
        }

        // 2. 提取解析区域全文 (参考 console_crawler.js 逻辑)
        const anaSelectors = [
            '.analysis.pd10', '#answer_analysis .analysis', '#analysis', 
            '.analysis', '.answer-yes .analysis', '.answer-wrong .analysis',
            '.item_analysis', '#item_analysis', '.jiexi-content', '.solution'
        ];
        
        let fullAnaText = '';
        for (const s of anaSelectors) {
            const el = document.querySelector(s);
            if (el) {
                const candidate = processContent(el, 'ans');
                if (candidate && candidate.length > 5 && !candidate.includes('点击查看解析')) {
                    fullAnaText = candidate;
                    break;
                }
            }
        }

        // 3. 解析拆分逻辑 (核心搬运自 console_crawler.js)
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
                finalAnalysis = fullAnaText.replace(/^[\s\S]*?(参考解析|题目解析|答案解析|解析)[：:\n\s]*/i, '').trim();
                if (finalAnalysis === '') finalAnalysis = fullAnaText;
            }
        }

        // 兜底清理
        if (finalAnswer.includes('正确答案：')) finalAnswer = finalAnswer.replace('正确答案：', '').trim();
        
        const titleFingerprint = titleText.replace(/\s/g, '');
        const resolvedFingerprint = `${finalAnswer}|${finalAnalysis}`.replace(/\s/g, '').substring(0, 160);

        return {
            type: itemType,
            step, itemId: document.querySelector('#item_id')?.innerText.trim() || '',
            title: titleText, 
            options: fetchOptions(),
            answer: finalAnswer, 
            analysis: finalAnalysis, 
            images,
            fingerprint: (step + titleText.substring(0, 30)).replace(/\s/g, ''),
            analysisFingerprint: fullAnaText.replace(/\s/g, '').substring(0, 100),
            titleFingerprint,
            resolvedFingerprint
        };
    }, { ENABLE_DISCUSSION_FALLBACK, staleState });
}

// --- 导航与流控 (恢复 V4 稳健架构) ---

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

async function waitForQuestionReady(page) {
    await page.waitForFunction(() => {
        const title = document.querySelector('#item_title, .item-title, .subject-title');
        const step = document.querySelector('#item_step, .item-step');
        return title && (title.innerText || title.textContent || '').trim().length > 0 && step && step.innerText.includes('/');
    }, { timeout: 15000 }).catch(() => {});
    await installDomGuard(page);
    await handlePopup(page);
}

async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    const finalUrl = (questionIndex === 0 && !chapterUrl.includes('again=1')) ? (chapterUrl.includes('?') ? `${chapterUrl}&again=1` : `${chapterUrl}?again=1`) : chapterUrl;
    await page.goto(finalUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await installDomGuard(page);
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
    await waitForQuestionReady(page);

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
        await randomSleep(3000, 5000);
        await waitForQuestionReady(page);
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
    },
    checkHealth() { return 'OK'; }
};

let completionStatus = {};

function saveStatus() {
    try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2));
    } catch (e) {
        log(`保存进度失败: ${e.message}`, 'ERROR');
    }
}

async function crawlSubject(page, subject) {
    const subjectName = sanitizeFileName(subject.name);
    const subjectDir = path.join(OUTPUT_DIR, subjectName);
    if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });

    const TIKU_LIST_URL = 'https://www.xs507.com/Tiku/Tikulist/index.html';
    log(`\n正在切换题库到: ${subject.name} (product_id=${subject.productId})`, 'INFO');
    
    await page.goto(TIKU_LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await handlePopup(page);

    const switchLink = await page.$('a.change:has-text("切换"), a.change[href*="change.html"]');
    if (switchLink) {
        await switchLink.click({ force: true }).catch(() => {});
        await randomSleep(2000, 3000);
        await handlePopup(page);
    }
    
    let radioLoaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            if (attempt > 1) {
                const retrySwitch = await page.$('a.change:has-text("切换")');
                if (retrySwitch) await retrySwitch.click({ force: true }).catch(() => {});
            }
            await page.waitForSelector('input[name="change_id"]', { timeout: 8000 });
            radioLoaded = true;
            break;
        } catch (e) {
            log(`第 ${attempt} 次等待题库切换列表失败，URL: ${page.url()}`, 'WARN');
            if (attempt < 3) {
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                await randomSleep(3000, 5000);
            }
        }
    }
    if (!radioLoaded) {
        log(`题库切换列表加载失败，跳过科目: ${subject.name}`, 'ERROR');
        return;
    }

    const radioSelector = `input[name="change_id"][value="${subject.productId}"]`;
    const radioExists = await page.$(radioSelector);
    if (!radioExists) {
        const availableValues = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="change_id"]')).map(r => r.value));
        log(`未找到 product_id=${subject.productId} 的切换项，可用值: [${availableValues.join(', ')}]`, 'ERROR');
        return;
    }

    try {
        await page.click(`label:has(input[name="change_id"][value="${subject.productId}"])`, { force: true, timeout: 5000 });
    } catch (e) {
        try {
            await page.click(radioSelector, { force: true, timeout: 3000 });
        } catch (e2) {
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

    await randomSleep(3000, 5000);
    await handlePopup(page);

    const confirmBtn = await page.$('.list-change .btn-confirm, .list-change .submit, button:has-text("确认"), a:has-text("确认切换"), .change-subject-btn');
    if (confirmBtn) {
        await confirmBtn.click({ force: true }).catch(() => {});
        log('已点击确认切换按钮', 'DEBUG');
        await randomSleep(4000, 6000);
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    await handlePopup(page);

    const CATEGORIES = [];
    const extractedCats = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.list-count li')).map(li => {
            const a = li.querySelector('a');
            const name = li.querySelector('b')?.innerText.trim();
            return (a && name && ['历年真题', '模拟试卷', '章节练习'].includes(name)) ? { name, url: a.href } : null;
        }).filter(Boolean);
    });

    if (extractedCats.length > 0) CATEGORIES.push(...extractedCats);
    else {
        log('未发现页面分类链接，尝试通过 subject_id 构造分类页', 'WARN');
        const subjectId = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="subject_id"]'));
            for (const a of links) {
                const m = a.href.match(/subject_id[\/=](\d+)/);
                if (m) return m[1];
            }
            const htmlMatch = document.body.innerHTML.match(/subject_id[\/=](\d+)/);
            return htmlMatch ? htmlMatch[1] : '';
        });
        if (subjectId) {
            CATEGORIES.push({ name: '历年真题', url: `https://www.xs507.com/Tiku/Product/index/product_id/${subject.productId}/subject_id/${subjectId}/type/1.html` });
            CATEGORIES.push({ name: '模拟试卷', url: `https://www.xs507.com/Tiku/Product/index/product_id/${subject.productId}/subject_id/${subjectId}/type/2.html` });
            CATEGORIES.push({ name: '章节练习', url: `https://www.xs507.com/Tiku/Product/index/product_id/${subject.productId}/subject_id/${subjectId}/type/3.html` });
        } else {
            log(`未能解析 subject_id，当前 URL: ${page.url()}`, 'ERROR');
            return;
        }
    }

    log(`识别到 ${CATEGORIES.length} 个分类`, 'INFO');

    for (const cat of CATEGORIES) {
        log(`\n>>> [${subject.name}] 进入分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(subjectDir, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url).catch(() => {});
        await randomSleep(3500, 5500);
        await installDomGuard(page);
        await handlePopup(page);

        const chapters = await page.evaluate(() => {
            const container = document.querySelector('.question-conten-list, .product-box, #main-tiku-box') || document.body;
            return Array.from(container.querySelectorAll('a'))
                .filter(a => {
                    const t = a.innerText.trim();
                    const isAction = (t.includes('模式') || t.includes('做题') || t.includes('开始')) && a.href.includes('product_id');
                    const isLink = !!a.closest('.title') && (a.href.includes('paper_id') || a.href.includes('product_id'));
                    return isAction || isLink;
                })
                .map(a => {
                    const p = a.closest('li, tr, .item, .big');
                    let title = p?.querySelector('.title, .name, .item-title')?.innerText.trim() || a.innerText.trim();
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
                    const mPaper = url.match(/paper_id[\/=](\d+)/);
                    const mKnow = url.match(/know_id[\/=](\d+)/);
                    const mProd = url.match(/product_id[\/=](\d+)/);
                    if (mPaper) id = `paper-${mPaper[1]}`;
                    else if (mKnow) id = `know-${mKnow[1]}`;
                    else if (mProd) id = `prod-${mProd[1]}`;
                    else id = `unknown-${Math.random().toString(36).slice(2, 7)}`;
                    const mCount = p?.innerText.match(/共\s*(\d+)\s*题/) || p?.innerText.match(/\/(\d+)/);
                    return { title, url, id, total: mCount ? parseInt(mCount[1], 10) : 0 };
                }).filter((c, i, l) => l.findIndex(item => item.id === c.id) === i);
        });

        log(`识别到 ${chapters.length} 个章节`, 'INFO');
        if (chapters.length === 0) {
            log(`分类 ${cat.name} 未识别到章节，当前 URL: ${page.url()}`, 'WARN');
            continue;
        }

        for (const chapter of chapters) {
            const statusKey = `${subject.name}_${cat.name}_${chapter.title}_${chapter.id}`;
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapter.id}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            let savedInfo = completionStatus[statusKey] || {};
            if (typeof savedInfo === 'number') savedInfo = { completed: savedInfo };
            const totalGoal = chapter.total || savedInfo.total || 0;
            const jsonProgress = Number(savedInfo.completed) || 0;
            const mdProgress = getCompletedCount(outputFile);
            let startFrom = Math.max(jsonProgress, mdProgress);
            
            if (jsonProgress > 0 && mdProgress > jsonProgress) {
                log(`检测到本地 Markdown 已抓到 ${mdProgress} 题，将从该位置恢复: ${chapter.title}`, 'WARN');
            }

            if (savedInfo.isFinished || (totalGoal > 0 && startFrom >= totalGoal)) {
                log(`    [跳过] ${chapter.title} (已完成)`, 'INFO');
                continue;
            }

            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });
            
            // 仅在文件不存在时写入标题，防止覆盖
            if (!fs.existsSync(outputFile)) {
                fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);
            }

            log(`    [开始] ${chapter.title} (断点: ${startFrom}/${totalGoal || '?'})`, 'INFO');
            await openChapterAtQuestion(page, chapter.url, startFrom);

            let lastAnalysisFingerprint = '';
            let lastStem = '';
            let lastFingerprint = '';
            // 历史成功指纹池，用于识别多题之前的旧内容残留。
            let staleFingerprints = [];
            // 上一题题干指纹。用于辅助识别“当前候选内容其实还在引用上一题题干”的情况。
            let lastTitleFingerprint = '';
            let stuckCount = 0;
            let lastWrittenCurr = startFrom;
            while (true) {
                await waitForQuestionReady(page);
                await triggerOfficialAnalysis(page, lastAnalysisFingerprint);

                // 每次读取时都带着上一题的状态进入浏览器上下文，让页面内提取逻辑有能力识别“旧内容残留”。
                let data = await readQuestionData(page, {
                    oldAnalysisFingerprint: lastAnalysisFingerprint,
                    staleFingerprints: staleFingerprints,
                    oldTitleFingerprint: lastTitleFingerprint
                });

                // 第一层补救：
                // 如果当前题读到的是“无解析”或被判定为冲突拦截，先在当前题原地重触发一次解析。
                if (data.analysis === '无解析' || data.analysis === '无解析 (抓取冲突已拦截)') {
                    await handlePopup(page);
                    await triggerOfficialAnalysis(page, lastAnalysisFingerprint);
                    await randomSleep(1200, 2200);
                    const retried = await readQuestionData(page, {
                        oldAnalysisFingerprint: lastAnalysisFingerprint,
                        staleFingerprints: staleFingerprints,
                        oldTitleFingerprint: lastTitleFingerprint
                    });
                    if (retried.analysis !== '无解析' && retried.analysis !== '无解析 (抓取冲突已拦截)') {
                        data = retried;
                    }
                }
                const [curr, totalNum] = data.step.split('/').map(Number);
                if (!data.title || !curr || !totalNum) {
                    log(`题目页数据异常，step=${data.step} title=${data.title ? 'OK' : 'EMPTY'}`, 'WARN');
                    break;
                }

                if (data.fingerprint === lastFingerprint) {
                    stuckCount++;
                    if (stuckCount >= 3) {
                        log(`连续 ${stuckCount} 次读取到同一题目，停止当前章节以避免死循环: ${chapter.title}`, 'WARN');
                        break;
                    }
                } else {
                    stuckCount = 0;
                    lastFingerprint = data.fingerprint;
                }

                // 第二层补救：
                // 题干已经变了，但“答案+解析”整块内容雷同于历史记录，基本可以断定发生了串题。
                // 这时不直接落盘，而是原地再触发一次重新读。
                const isRepeatedInHistory = data.resolvedFingerprint.length > 30 && staleFingerprints.includes(data.resolvedFingerprint);
                if (isRepeatedInHistory && data.titleFingerprint !== lastTitleFingerprint) {
                    log(`检测到跨题复用了历史答案/解析，正在重试当前题: ${data.step}`, 'WARN');
                    await handlePopup(page);
                    await triggerOfficialAnalysis(page, lastAnalysisFingerprint);
                    await randomSleep(1500, 2500);
                    const retried = await readQuestionData(page, {
                        oldAnalysisFingerprint: lastAnalysisFingerprint,
                        staleFingerprints: staleFingerprints,
                        oldTitleFingerprint: lastTitleFingerprint
                    });
                    if (!staleFingerprints.includes(retried.resolvedFingerprint)) {
                        data = retried;
                    }
                }

                if (curr <= startFrom) {
                    const next = await page.$('.subject-next, #next_item');
                    if (next && curr < totalNum) {
                        log(`跳过已抓取题号: ${curr}`, 'DEBUG');
                        const old = { step: data.step, id: data.itemId };
                        await next.click({ force: true });
                        await waitForQuestionChange(page, old.step, old.id);
                        await waitForQuestionReady(page);
                        continue;
                    }
                    if (curr === totalNum && curr <= startFrom) {
                        completionStatus[statusKey] = { ...savedInfo, id: chapter.id, title: chapter.title, completed: totalNum, total: totalNum, isFinished: true, updatedAt: new Date().toLocaleString() };
                        saveStatus();
                        break;
                    }
                }

                if (curr <= lastWrittenCurr) {
                    const next = await page.$('.subject-next, #next_item');
                    if (next && curr < totalNum) {
                        log(`检测到重复题号 ${curr}，尝试前进到下一题`, 'WARN');
                        const old = { step: data.step, id: data.itemId };
                        await next.click({ force: true });
                        await waitForQuestionChange(page, old.step, old.id);
                        await waitForQuestionReady(page);
                        continue;
                    }
                }

                let md = `## 第 ${curr} 题 [${data.type}]\n\n`;
                md += `**题目：** ${data.title}\n\n`;
                if (data.options) md += `**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n`;
                md += `> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                fs.appendFileSync(outputFile, md);

                lastAnalysisFingerprint = data.analysisFingerprint;
                // 更新历史指纹池：仅记录有意义的长指纹，且维持最近3个。
                if (data.resolvedFingerprint && data.resolvedFingerprint.length > 30) {
                    if (!staleFingerprints.includes(data.resolvedFingerprint)) {
                        staleFingerprints.push(data.resolvedFingerprint);
                        if (staleFingerprints.length > 3) staleFingerprints.shift();
                    }
                }
                lastTitleFingerprint = data.titleFingerprint;
                lastWrittenCurr = curr;
                MONITOR.stats.totalCaptured++;
                if (data.analysis === '无解析') MONITOR.stats.noAnalysisCount++;
                
                completionStatus[statusKey] = { id: chapter.id, title: chapter.title, completed: curr, total: totalNum, updatedAt: new Date().toLocaleString() };
                saveStatus();

                process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                for (const img of data.images) { await downloadImage(img.url, path.join(chapterDir, 'images', img.name)); }

                if (curr < totalNum) {
                    const next = await page.$('.subject-next, #next_item');
                    if (next) {
                        const old = { step: data.step, id: data.itemId };
                        await next.click({ force: true });
                        await waitForQuestionChange(page, old.step, old.id);
                        await waitForQuestionReady(page);
                    } else { break; }
                } else {
                    completionStatus[statusKey] = { id: chapter.id, title: chapter.title, completed: curr, total: totalNum, isFinished: true, updatedAt: new Date().toLocaleString() };
                    saveStatus();
                    break;
                }
            }
            log(`\n    [完成] ${chapter.title}`, 'INFO');
        }
    }
}

async function run() {
    log('正在开启 V5.0 全自动增强版...', 'INFO');
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
    } catch (e) { log('登录失败，请检查账号或网络', 'ERROR'); }

    if (fs.existsSync(STATUS_FILE)) { try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch(e) {} }

    const ALL_SUBJECTS = [
        { name: '2026年初级社会工作者《初级社会工作实务》考试题库', productId: '1525' },
        { name: '2026年中级社会工作者《中级社会工作实务》考试题库', productId: '317' },
        { name: '2026年中级社会工作者《中级社会工作法规与政策》考试题库', productId: '39' },
        { name: '2026年中级社会工作者《中级社会工作综合能力》考试题库', productId: '316' },
        { name: '2026年初级社会工作者《初级社会工作综合能力》考试题库', productId: '1526' },
    ];

    for (const subject of ALL_SUBJECTS) {
        try {
            await crawlSubject(page, subject);
        } catch (e) {
            log(`科目 [${subject.name}] 抓取异常: ${e.message}`, 'ERROR');
        }
    }

    MONITOR.printSummary();
    await browser.close();
    rl.close();
}

run().catch(e => { console.error(e); rl.close(); });
