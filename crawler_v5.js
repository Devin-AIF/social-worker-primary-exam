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
function buildStableChapterKey(chapter) {
    if (chapter.id) return chapter.id;
    const encoded = Buffer.from(chapter.url || chapter.title || '').toString('base64');
    return `url-${encoded.replace(/[+/=]/g, '').slice(0, 24)}`;
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

// --- 辅助函数 ---
function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    process.stdout.write(formattedMessage);
    fs.appendFileSync(LOG_FILE, formattedMessage);
}
function logError(scope, error) {
    const message = error?.message || String(error);
    log(`${scope} 失败: ${message}`, 'ERROR');
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

// --- 核心引擎 ---

async function handlePopup(page) {
    await page.evaluate(() => {
        const shades = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg', '.mask', '.loading-mask', '.analysis-lock', '.layerFeedback', '.layui-layer'];
        shades.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });
}

async function installDomGuard(page) {
    return await page.evaluate(() => {
        if (window.__crawlerDomGuardInstalled) return;
        window.__crawlerDomGuardInstalled = true;
        const cleanup = () => {
            const popups = ['.layerSaveSuccess', '.layui-layer-shade', '.layui-layer', '#video_analysis_ratelimit_overlay', '.layerFeedback', '#popup_box_bg', '.mask', '.loading-mask'];
            popups.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        };
        cleanup();
        const observer = new MutationObserver(cleanup);
        observer.observe(document.body, { childList: true, subtree: true });
    }).then(() => true).catch((e) => {
        logError('installDomGuard', e);
        return false;
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

/**
 * 触发官方解析 (增强版：带去重校验)
 */
async function triggerOfficialAnalysis(page, lastContentFp = '') {
    // 1. 物理清理所有解析容器，确保旧数据不干扰
    await page.evaluate(() => {
        const anaSelectors = ['.analysis', '#answer_analysis', '#analysis', '.answer-content', '.analysis-box', '.answer-analysis', '.jiexi-content', '.answer-yes', '.right-answer'];
        anaSelectors.forEach(s => document.querySelectorAll(s).forEach(el => {
            el.innerHTML = '';
            el.style.display = 'none';
        }));
    }).catch(() => {});

    await page.evaluate(() => {
        // 2. 尝试点击所有可能的“显示”按钮
        const clickSelectors = ['.click_analysis', '[data-type="analysis"]', '.analysis-btn', '.show-analysis', '.jiexi', '.show-answer', '#show_answer_btn', '.view-answer', '.subject-submit'];
        clickSelectors.forEach(s => {
            document.querySelectorAll(s).forEach(btn => {
                const text = (btn.innerText || '').trim();
                if (text.includes('收起')) return;
                if (btn.offsetParent !== null || /解析|答案|显示|查看|提交/.test(text) || btn.classList.contains('click_analysis')) {
                    btn.click();
                }
            });
        });

        // 3. 特殊处理：问答题
        if (document.querySelector('#item_type')?.innerText.includes('问答')) {
            const submitBtn = document.querySelector('.subject-submit');
            if (submitBtn) submitBtn.click();
        }
    });

    // 4. 循环等待新内容加载，且必须与旧内容指纹不同
    for (let i = 0; i < 10; i++) {
        const currentData = await page.evaluate(() => {
            const anaSelectors = ['.analysis', '#answer_analysis', '#analysis', '.jiexi-content', '.answer-yes', '.right-answer'];
            let bestText = '';
            for (const s of anaSelectors) {
                const el = document.querySelector(s);
                if (el && el.innerText.trim().length > 15 && el.offsetParent !== null) {
                    bestText = el.innerText.trim();
                    break;
                }
            }
            return bestText;
        });

        const currentFp = currentData.replace(/\s/g, '').substring(0, 100);
        if (currentFp && currentFp !== lastContentFp) {
            break; // 成功拿到新解析
        }
        await page.waitForTimeout(1000);
    }
}

async function readQuestionData(page) {
    const data = await page.evaluate(() => {
        const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

        const step = (document.querySelector('#item_step, .item-step')?.innerText || '0/0').trim();
        const itemId = (document.querySelector('#item_id')?.innerText || '').replace(/编号：/g, '').trim();
        const images = [];

        const processContent = (el, prefix) => {
            if (!el) return '';
            const clone = el.cloneNode(true);
            const junkSelectors = ['.err_correct', '.remove_wrong', '.video_analysis', '.subject-action', '.analysis-action', '.report-error', '.show_child', '.fr', '.tips'];
            junkSelectors.forEach(s => clone.querySelectorAll(s).forEach(sub => sub.remove()));
            
            clone.querySelectorAll('img').forEach((img, idx) => {
                let src = img.getAttribute('src') || img.getAttribute('data-src') || img.src;
                if (!src) return;
                if (src.startsWith('//')) src = 'https:' + src;
                const name = `q_${step.replace(/\//g, '_')}_${prefix}_${idx}.png`;
                images.push({ name, url: src });
                img.replaceWith(` ![图](./images/${name}) `);
            });

            // 使用 innerHTML 转换为带换行的文本，避免 innerText 在某些隐藏元素中获取为空的问题
            let html = clone.innerHTML;
            html = html.replace(/<br\s*[\/]?>/gi, '\n');
            html = html.replace(/<\/p>/gi, '\n');
            html = html.replace(/<[^>]+>/g, ''); // 移除其他 HTML 标签

            let text = html.trim();
            const junkPatterns = [/点击查看解析/g, /收起解析/g, /视频解析/g, /我要纠错/g, /从错题本移除/g, /提交/g, /\[视频解析\]/g, /\[查看解析\]/g, /查看视频/g, /听课/g, /展开解析/g, /答案及解析/g];
            junkPatterns.forEach(p => text = text.replace(p, ''));
            
            // 修复可能产生的多余空行
            return text.replace(/\n\s*\n/g, '\n').trim();
        };

        const titleEl = document.querySelector('#item_title');
        
        const fetchOptions = () => {
            const selectors = ['#item_options li', '.options li', '.question-options li', '.subject-option li', '.option-list li'];
            for (const s of selectors) {
                const items = document.querySelectorAll(s);
                if (items.length > 0) return Array.from(items).map((li, idx) => processContent(li, `opt${idx}`)).join('\n');
            }
            return '';
        };

        const titleText = processContent(titleEl, 'tit');
        const itemType = document.querySelector('#item_type')?.innerText.trim() || '题型';

        let finalAnswer = '未知';
        let finalAnalysis = '无解析';

        // 0. 优先检测专用答案区域 (适配 2026/2024 最新 UI)
        const dedicatedAnsBox = Array.from(document.querySelectorAll('div, span, p, b, strong, .answer-yes, .right-answer')).find(el => {
            const t = el.innerText.trim();
            return t.startsWith('正确答案：') || t.startsWith('正确答案:');
        });
        if (dedicatedAnsBox) {
            finalAnswer = dedicatedAnsBox.innerText.replace(/正确答案[：:\s]*/, '').replace(/^\s*为\s*/, '').replace(/[\s,，、]/g, '').trim();
        }

        // 1. 提取解析全文 (根据裸跑结果，锁定最精准的路径)
        const anaSelectors = [
            '.answer-qa .analysis > div:first-child', // 2023真题核心：参考答案和要点都在第一个div
            '#answer_analysis .analysis > div:first-child',
            '#analysis .analysis > div:first-child',
            '#answer_analysis .analysis',
            '#analysis .analysis',
            '.answer-qa .analysis',
            '.analysis',
            '.answer-content',
            '.analysis-box',
            '.answer-analysis',
            '.jiexi-content'
        ];
        
        let fullAnaText = '';
        for (const s of anaSelectors) {
            const el = document.querySelector(s);
            // 物理隔离检测：必须可见 (offsetParent !== null)，且长度足够，且不是题目内容
            if (el && el.offsetParent !== null && isVisible(el)) {
                const candidate = processContent(el, 'ans');
                if (candidate && candidate.length > 10 && !titleText.includes(candidate.substring(0, 50))) {
                    fullAnaText = candidate;
                    break;
                }
            }
        }

        // 2. 字段分配逻辑 (全方位容错版)
        if (fullAnaText) {
            // 预处理：替换 &nbsp; 为标准空格，统一空白符
            let cleanFullText = fullAnaText.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

            const ansRegex = /(?:参\s*考\s*答\s*案|正\s*确\s*答\s*案|【\s*答\s*案\s*】|答\s*案)[：:\s]*为?/i;
            const anaRegex = /(?:题\s*目\s*解\s*析|答\s*案\s*解\s*析|解\s*析|【\s*解\s*析\s*】|答\s*题\s*要\s*点|要\s*点)[：:\s]*/i;

            // 寻找关键词位置
            const anaMatch = cleanFullText.match(new RegExp(anaRegex.source, 'gi'));
            const anaIndex = anaMatch ? cleanFullText.indexOf(anaMatch[0]) : -1;

            let ansPart = '';
            let anaPart = '';

            if (anaIndex !== -1) {
                ansPart = cleanFullText.substring(0, anaIndex).trim();
                anaPart = cleanFullText.substring(anaIndex).trim();
            } else {
                ansPart = cleanFullText;
                anaPart = '';
            }

            // 提取答案
            if (ansPart.match(ansRegex)) {
                finalAnswer = ansPart.replace(new RegExp('^.*?' + ansRegex.source, 'i'), '').replace(/^\s*为\s*/, '').trim();
            } else if (anaPart.match(ansRegex)) {
                // 如果答案在解析块里
                const m = anaPart.match(ansRegex);
                const afterAns = anaPart.substring(anaPart.indexOf(m[0]) + m[0].length).trim();
                // 优化：优先匹配开头的连续大写字母（支持多选 ADE）
                const multiMatch = afterAns.match(/^\s*([A-G\s,，、]+)/i);
                if (multiMatch) {
                    finalAnswer = multiMatch[1].replace(/[\s,，、]/g, '').trim();
                } else {
                    finalAnswer = afterAns.split(/[\s解]/)[0].replace(/^\s*为\s*/, '').trim();
                }
            }

            // 如果是选择题且没抓到有效答案，尝试暴力搜寻连续的大写字母
            if (!finalAnswer || finalAnswer.length > 10 || finalAnswer === '参考' || finalAnswer === '为') {
                const letterMatch = cleanFullText.match(/(?:答案|参考答案|正确答案)[：:\s]*为?\s*([A-G\s,，、]+)/i);
                if (letterMatch) {
                    finalAnswer = letterMatch[1].replace(/[\s,，、]/g, '').trim();
                } else if (!itemType.includes('问答')) {
                    // 最后的倔强：搜寻第一个出现的孤立大写字母序列
                    const soloLetter = cleanFullText.match(/\b([A-G]{1,7})\b/);
                    if (soloLetter) finalAnswer = soloLetter[1];
                }
            }

            // 提取解析
            if (anaPart) {
                finalAnalysis = anaPart.replace(new RegExp('^.*?' + anaRegex.source, 'i'), '').trim();
            } else if (ansPart && !finalAnswer) {
                // 可能是纯解析
                finalAnalysis = ansPart;
            }

            // 最终清洗解析：循环去除叠词前缀
            const cleanup = /^(?:题目解析|答案解析|解析|【解析】|答题要点|要点|参考答案|正确答案|答案)[：:\s]*/i;
            for(let i=0; i<3; i++) finalAnalysis = finalAnalysis.replace(cleanup, '').trim();
            if (!finalAnalysis || finalAnalysis === '无') finalAnalysis = (anaPart || cleanFullText).replace(cleanup, '').trim();
            if (!finalAnalysis) finalAnalysis = '无';
        }

        // 3. 容错校验：如果网页上直接写了 "暂无解析"，如实记录
        const noAnalysisEl = document.evaluate("//div[contains(text(), '暂无解析')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (noAnalysisEl && finalAnalysis === '无解析') finalAnalysis = '暂无解析';

        return {
            type: itemType, step, itemId, title: titleText, 
            options: fetchOptions(), answer: finalAnswer, analysis: finalAnalysis, 
            images,
            fingerprint: (itemId + step).replace(/\s/g, ''),
            contentFingerprint: (finalAnalysis).replace(/\s/g, '').substring(0, 100) || (finalAnswer + step).replace(/\s/g, ''),
            rawHtml: (finalAnalysis === '无解析') ? document.body.innerHTML : null
        };
    });
    
    if (data.analysis === '无解析' && data.rawHtml) {
        const debugPath = path.join(DEBUG_DIR, `missing_analysis_${data.itemId}_${data.step.replace('/', '_')}.html`);
        fs.writeFileSync(debugPath, data.rawHtml);
    }
    return data;
}

// --- 导航控制 ---

async function waitForQuestionReady(page) {
    const ready = await page.waitForFunction(() => {
        const title = document.querySelector('#item_title, .item-title, .subject-title');
        const step = document.querySelector('#item_step, .item-step');
        return title && title.innerText.trim().length > 0 && step && step.innerText.includes('/');
    }, { timeout: 15000 }).then(() => true).catch((e) => {
        logError('waitForQuestionReady', e);
        return false;
    });
    if (!ready) return false;
    await installDomGuard(page);
    return true;
}

async function waitForQuestionChange(page, oldId, oldStep, oldContentFp, oldTitle) {
    // 1. “核弹级”清理：清空所有可能残留数据的区域
    await page.evaluate(() => {
        const selectors = [
            '#item_title', '.item-title', '#item_options', '.options', 
            '.analysis', '#answer_analysis', '#analysis', '.answer-yes', 
            '.right-answer', '.jiexi-content', '.answer-content'
        ];
        selectors.forEach(s => {
            document.querySelectorAll(s).forEach(el => { el.innerHTML = ''; if(el.value) el.value=''; });
        });
        // 隐藏这些区域，确保只有新触发的才会显示
        document.querySelectorAll('.analysis, #analysis, #answer_analysis').forEach(el => el.style.display = 'none');
    }).catch(() => {});

    const changed = await page.waitForFunction(({ oldId, oldStep, oldTitle }) => {
        const curId = (document.querySelector('#item_id')?.innerText || '').replace(/编号：/g, '').trim();
        const curStep = (document.querySelector('#item_step, .item-step')?.innerText || '').trim();
        const curTitle = (document.querySelector('#item_title, .item-title')?.innerText || '').trim();
        
        const idChanged = curId && curId !== oldId;
        const stepChanged = curStep && curStep !== oldStep;
        const titleReady = curTitle && curTitle.length > 5 && curTitle !== oldTitle;

        return (idChanged || stepChanged) && titleReady;
    }, { oldId, oldStep, oldTitle }, { timeout: 15000 }).then(() => true).catch((e) => {
        logError(`waitForQuestionChange`, e);
        return false;
    });

    if (changed) await randomSleep(2500, 4000); // 预留充足时间给 AJAX
    return changed;
}

async function openChapterAtQuestion(page, chapterUrl, questionIndex = 0) {
    const finalUrl = (questionIndex === 0 && !chapterUrl.includes('again=1')) ? (chapterUrl.includes('?') ? `${chapterUrl}&again=1` : `${chapterUrl}?again=1`) : chapterUrl;
    await page.goto(finalUrl).catch(() => {});
    await randomSleep(4000, 6000);
    await installDomGuard(page);
    
    // 点击开始
    const startSelectors = ['a.enable.a2', 'a:has-text("开始做题")', 'a:has-text("练习模式")'];
    for (const s of startSelectors) { if (await safeClick(page, s, 3000)) break; }
    
    // 切换背题模式
    log(`尝试切换背题模式...`, 'DEBUG');
    const modeSwitched = await page.evaluate(() => {
        const btnSelectors = [
            '.recite-mode', '#recite_mode', '.beiti', '[data-mode="recite"]', 
            '.subject-action a', '.analysis-action a', '.tool-bar a'
        ];
        
        // 1. 按文字查找按钮
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); 
            return (t === '背题模式' || t === '背题' || t === '显示答案' || t === '解析模式');
        });
        
        if (btn) {
            btn.click();
            return `TextMatch: ${btn.innerText.trim()}`;
        }

        // 2. 按选择器查找
        for (const s of btnSelectors) {
            const el = document.querySelector(s);
            if (el && (el.innerText || '').includes('背')) {
                el.click();
                return `SelectorMatch: ${s}`;
            }
        }

        // 3. 暴力模拟切换 (xs507 常用逻辑)
        if (typeof switchMode === 'function') {
            switchMode('recite'); 
            return 'FunctionCall: switchMode';
        }

        return 'NotFound';
    });
    log(`背题模式切换结果: ${modeSwitched}`, 'DEBUG');
    
    await randomSleep(5000, 7000);
    const ready = await waitForQuestionReady(page);
    if (!ready) throw new Error('章节打开后题目未就绪');

    if (questionIndex > 0) {
        log(`正在跳转到题号: ${questionIndex + 1}`, 'DEBUG');
        await page.evaluate(() => { const cardBtn = document.querySelector('.bd_dtk, #tiku_sheet, .answer-card-btn'); if (cardBtn) cardBtn.click(); });
        await page.waitForTimeout(1000);
        await page.evaluate((index) => {
            const cards = document.querySelectorAll('#tiku_sheet_card li, .answer-card li, .dtk_list li');
            if (cards[index]) cards[index].click();
        }, questionIndex);
        await randomSleep(3000, 5000);
        const moved = await waitForQuestionReady(page);
        if (!moved) throw new Error(`跳题失败，目标题号: ${questionIndex + 1}`);
    }
}

async function downloadImage(url, dest) {
    if (!url) return;
    if (url.startsWith('data:')) {
        try {
            const parts = url.split(',');
            if (parts.length < 2) return;
            const buffer = Buffer.from(parts[1], 'base64');
            fs.writeFileSync(dest, buffer);
        } catch (e) {
            log(`Base64图片保存失败: ${e.message}`, 'WARN');
        }
        return;
    }
    const tempDest = `${dest}.tmp`;
    const fetchWithRedirect = (fullUrl, redirectsLeft = 3) => {
        return new Promise((resolve, reject) => {
            const protocol = fullUrl.startsWith('https') ? https : http;
            const request = protocol.get(fullUrl, (response) => {
                const statusCode = response.statusCode || 0;
                if ([301, 302, 303, 307, 308].includes(statusCode)) {
                    const location = response.headers.location;
                    response.resume();
                    if (!location || redirectsLeft <= 0) {
                        reject(new Error(`重定向失败: ${statusCode}`));
                        return;
                    }
                    const nextUrl = new URL(location, fullUrl).toString();
                    resolve(fetchWithRedirect(nextUrl, redirectsLeft - 1));
                    return;
                }

                if (statusCode !== 200) {
                    response.resume();
                    reject(new Error(`HTTP ${statusCode}`));
                    return;
                }

                const file = fs.createWriteStream(tempDest);
                response.pipe(file);
                file.on('finish', () => {
                    file.close((closeErr) => {
                        if (closeErr) {
                            reject(closeErr);
                            return;
                        }
                        fs.rename(tempDest, dest, (renameErr) => {
                            if (renameErr) {
                                reject(renameErr);
                                return;
                            }
                            resolve();
                        });
                    });
                });
                file.on('error', (err) => {
                    fs.unlink(tempDest, () => {});
                    reject(err);
                });
            });
            request.setTimeout(10000, () => request.destroy(new Error('下载超时')));
            request.on('error', (e) => reject(e));
        });
    };
    try {
        let fullUrl = url.startsWith('//') ? `https:${url}` : (url.startsWith('http') ? url : `https://www.xs507.com/${url}`);
        await fetchWithRedirect(fullUrl);
    } catch (e) {
        fs.unlink(tempDest, () => {});
        log(`图片下载失败: ${url} -> ${dest} (${e?.message || e})`, 'WARN');
    }
}

const MONITOR = {
    stats: { totalCaptured: 0, noAnalysisCount: 0, startTime: new Date() },
    printSummary() {
        const duration = ((new Date() - this.stats.startTime) / 1000 / 60).toFixed(1);
        log(`- 耗时: ${duration}min | 成功: ${this.stats.totalCaptured} | 缺失解析: ${this.stats.noAnalysisCount}`);
    }
};

let completionStatus = {};
function saveStatus() { fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2)); }

async function crawlSubject(page, subject) {
    const subjectDir = path.join(OUTPUT_DIR, sanitizeFileName(subject.name));
    if (!fs.existsSync(subjectDir)) fs.mkdirSync(subjectDir, { recursive: true });

    log(`\n正在切换题库: ${subject.name}`, 'INFO');
    await page.goto('https://www.xs507.com/Tiku/Tikulist/index.html');
    await safeClick(page, 'a.change:has-text("切换")');
    await page.waitForSelector(`input[name="change_id"][value="${subject.productId}"]`, { timeout: 8000 });
    await page.click(`label:has(input[name="change_id"][value="${subject.productId}"])`, { force: true });
    await randomSleep(2000, 3000);
    await safeClick(page, 'button:has-text("确认"), a:has-text("确认切换")');
    await page.waitForLoadState('networkidle');

    const CATEGORIES = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.list-count li')).map(li => {
            const a = li.querySelector('a');
            const name = li.querySelector('b')?.innerText.trim();
            return (a && name && ['历年真题', '模拟试卷', '章节练习'].includes(name)) ? { name, url: a.href } : null;
        }).filter(Boolean);
    });

    for (const cat of CATEGORIES) {
        log(`>>> [${subject.name}] 分类: ${cat.name}`, 'INFO');
        const typeDir = path.join(subjectDir, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url).catch(() => {});
        await randomSleep(3000, 5000);

        const chapters = await page.evaluate(() => {
            const raw = Array.from(document.querySelectorAll('a'))
                .filter(a => (a.innerText.includes('模式') || a.innerText.includes('做题')) && a.href.includes('product_id'))
                .map(a => {
                    const p = a.closest('li, tr, .item, .big');
                    const title = p?.querySelector('.title, .name, .item-title')?.innerText.trim() || a.innerText.trim();
                    const url = a.href;
                    let idMatch = url.match(/(paper_id|know_id)[\/=](\d+)/);
                    let id = idMatch ? `${idMatch[1].split('_')[0]}-${idMatch[2]}` : '';
                    return { title, url, id };
                });
            const seen = new Set();
            return raw.filter(ch => {
                const dedupeKey = ch.id || ch.url;
                if (!dedupeKey || seen.has(dedupeKey)) return false;
                seen.add(dedupeKey);
                return true;
            });
        });

        for (const chapter of chapters) {
            const chapterKey = buildStableChapterKey(chapter);
            const statusKey = `${subject.productId}_${cat.name}_${chapterKey}`;
            
            const chapterDir = path.join(typeDir, `${sanitizeFileName(chapter.title)}_${chapterKey}`);
            const outputFile = path.join(chapterDir, `${sanitizeFileName(chapter.title)}.md`);
            
            if (completionStatus[statusKey]?.isFinished) { 
                log(`    [跳过] ${chapter.title} (已完成)`, 'INFO'); 
                continue; 
            }

            let startFrom = getCompletedCount(outputFile);
            startFrom = Math.max(startFrom, completionStatus[statusKey]?.completed || 0);
            // 如果文件已存在且题目数量已达到 total，也视为完成
            if (completionStatus[statusKey] && startFrom >= completionStatus[statusKey].total) {
                log(`    [跳过] ${chapter.title} (文件已完整)`, 'INFO');
                completionStatus[statusKey].isFinished = true;
                saveStatus();
                continue;
            }

            if (!fs.existsSync(chapterDir)) fs.mkdirSync(chapterDir, { recursive: true });
            if (!fs.existsSync(path.join(chapterDir, 'images'))) fs.mkdirSync(path.join(chapterDir, 'images'), { recursive: true });
            if (!fs.existsSync(outputFile)) fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);

            log(`    [开始] ${chapter.title} (进度: ${startFrom})`, 'INFO');
            try {
                await openChapterAtQuestion(page, chapter.url, startFrom);
            } catch (e) {
                log(`    [失败] ${chapter.title} 打开章节失败: ${e?.message || e}`, 'ERROR');
                continue;
            }

            let lastContentFp = '';
            while (true) {
                const ready = await waitForQuestionReady(page);
                if (!ready) {
                    log(`题目加载超时，章节终止: ${chapter.title}`, 'ERROR');
                    break;
                }
                await triggerOfficialAnalysis(page, lastContentFp);

                let data = await readQuestionData(page);
                const [curr, totalNum] = data.step.split('/').map(Number);
                if (!curr || !totalNum) break;
                
                // 刷新检测：如果内容没变，原地等待
                if (data.contentFingerprint === lastContentFp && data.contentFingerprint.length > 10) {
                    log(`等待内容刷新 (题号: ${data.step})...`, 'DEBUG');
                    let success = false;
                    for(let i=0; i<3; i++) {
                        await page.waitForTimeout(2500);
                        await triggerOfficialAnalysis(page, lastContentFp);
                        data = await readQuestionData(page);
                        if (data.contentFingerprint !== lastContentFp) { success = true; break; }
                    }
                    
                    // 如果还是没刷新，尝试强制重载页面（终极手段解决缓存/解析重复）
                    if (!success) {
                        log(`内容刷新卡死，尝试强制重载页面...`, 'WARN');
                        await page.reload();
                        await randomSleep(5000, 7000);
                        await openChapterAtQuestion(page, chapter.url, curr - 1); // 重新定位到当前题
                        await triggerOfficialAnalysis(page, lastContentFp);
                        data = await readQuestionData(page);
                    }
                }

                // 写入数据
                let md = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n`;
                if (data.options) md += `**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n`;
                md += `> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                fs.appendFileSync(outputFile, md);

                lastContentFp = data.contentFingerprint;
                MONITOR.stats.totalCaptured++;
                if (data.analysis === '无解析') MONITOR.stats.noAnalysisCount++;
                
                completionStatus[statusKey] = { 
                    id: chapter.id,
                    title: chapter.title,
                    completed: curr, 
                    total: totalNum,
                    updatedAt: new Date().toLocaleString()
                };
                saveStatus();
                process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);
                for (const img of data.images) { await downloadImage(img.url, path.join(chapterDir, 'images', img.name)); }

                if (curr < totalNum) {
                    const next = await page.$('.subject-next, #next_item');
                    if (next) {
                        const old = { step: data.step, id: data.itemId, title: data.title };
                        await next.click({ force: true });
                        const changed = await waitForQuestionChange(page, old.id, old.step, lastContentFp, old.title);
                        
                        if (!changed) {
                            log(`翻页似乎卡死，尝试强制刷新页面 (题号: ${data.step})...`, 'WARN');
                            await page.reload();
                            await randomSleep(5000, 7000);
                            await openChapterAtQuestion(page, chapter.url, curr); // 重新定位到下一题
                            await triggerOfficialAnalysis(page, lastContentFp);
                        }
                    } else { break; }
                } else {
                    completionStatus[statusKey].isFinished = true;
                    completionStatus[statusKey].updatedAt = new Date().toLocaleString();
                    saveStatus();
                    break;
                }
            }
            log(`\n    [完成] ${chapter.title}`, 'INFO');
        }
    }
}

async function run() {
    log('开启归简版抓取器...', 'INFO');
    let browser;
    let page;
    try {
        if (!AUTH.user || !AUTH.pass) {
            throw new Error('缺少环境变量 XS507_USER 或 XS507_PASS，请先设置后再运行');
        }

        browser = await chromium.launch({ headless: process.env.HEADLESS === 'true' ? true : false });
        page = await (await browser.newContext()).newPage();

        try {
            await page.goto(LOGIN_URL);
            await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
            await page.fill('input[placeholder*=\"手机号\"]', AUTH.user);
            await page.fill('input[placeholder*=\"密码\"]', AUTH.pass);
            await page.click('.login-form-btn');
            await page.waitForTimeout(6000);
        } catch (e) {
            logError('登录流程', e);
            throw e;
        }

        try {
            if (fs.existsSync(STATUS_FILE)) {
                let raw = fs.readFileSync(STATUS_FILE, 'utf-8').trim();
                // 防御性处理：移除 JSON 结构外可能的残余字符
                raw = raw.replace(/^[\s\ufeff\xa0]+|[\s\ufeff\xa0]+$/g, '');
                if (raw.startsWith('{') && raw.endsWith('}')) {
                    completionStatus = JSON.parse(raw);
                } else {
                    throw new Error('JSON 格式不完整');
                }
            }
        } catch (e) {
            log(`状态文件解析失败，将从空状态开始: ${e?.message || e}`, 'WARN');
        }

        const ALL_SUBJECTS = [
            { name: '2026年中级社会工作者《中级社会工作实务》考试题库', productId: '317' },
            { name: '2026年中级社会工作者《中级社会工作法规与政策》考试题库', productId: '39' },
            { name: '2026年中级社会工作者《中级社会工作综合能力》考试题库', productId: '316' },
            { name: '2026年初级社会工作者《初级社会工作实务》考试题库', productId: '1525' },
            { name: '2026年初级社会工作者《初级社会工作综合能力》考试题库', productId: '1526' },
        ];

        for (const subject of ALL_SUBJECTS) { 
            const finishKey = `SUBJECT_FINISHED_${subject.productId}`;
            if (completionStatus[finishKey] && completionStatus[finishKey].isFinished) {
                log(`科目 [${subject.name}] 已标记为整体完成，跳过。`, 'INFO');
                continue;
            }
            await crawlSubject(page, subject); 
        }
        MONITOR.printSummary();
    } finally {
        if (browser) await browser.close().catch((e) => log(`关闭浏览器失败: ${e?.message || e}`, 'WARN'));
        if (!rl.closed) rl.close();
    }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
