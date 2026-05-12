const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * 自动化抓取脚本 V15.0 (终极全能版)
 * 1. 自动登录与分类扫描
 * 2. 兼容 章节练习/历年真题/模拟试卷
 * 3. 深度反爬绕过 (脚本拦截 + 遮罩物理移除)
 * 4. 鲁棒性提取 (解决重复ID、解析噪音、老师讨论自动提取)
 * 5. 极速状态管理 (JSON Log 秒级跳过)
 */

const AUTH = {
    user: '13510922043',
    pass: '265567'
};

const BASE_URL = 'https://www.xs507.com';
const LOGIN_URL = 'https://www.xs507.com/Home/login/account.html?hide-tip=1';
const OUTPUT_DIR = './抓取结果_V3';
const LOG_FILE = './crawler.log';
const STATUS_FILE = path.join(OUTPUT_DIR, 'completion_status.json');

// --- 状态与记录 ---
let completionStatus = {};
if (fs.existsSync(STATUS_FILE)) {
    try { completionStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch (e) {}
}

function saveStatus() {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(STATUS_FILE, JSON.stringify(completionStatus, null, 2));
    } catch (e) {}
}

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${type}] ${message}\n`;
    try { fs.appendFileSync(LOG_FILE, formattedMessage); } catch (e) {}
    console.log(formattedMessage.trim());
}

// --- 核心反爬与弹窗处理 ---
async function handlePopup(page) {
    await page.evaluate(() => {
        // 1. 物理移除拦截遮罩
        const items = ['#video_analysis_ratelimit_overlay', '.layui-layer-shade', '.layui-layer', '.layerSaveSuccess'];
        items.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
        
        // 2. 重置反爬标记
        window.is_ratelimit = false;
        if (window.video_analysis_ratelimit_timer) clearInterval(window.video_analysis_ratelimit_timer);
        
        // 3. 强制显示解析区域
        const boxes = document.querySelectorAll('#analysis, .analysis, #answer_analysis');
        boxes.forEach(box => {
            box.style.display = 'block';
            box.classList.remove('hide');
        });
    });
    return true;
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
    log('正在开启终极抓取模式...', 'INFO');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    
    // 拦截源头反爬脚本
    await context.route('**/*video_analysis.js*', route => route.abort());
    const page = await context.newPage();

    // --- 自动登录 ---
    try {
        await page.goto(LOGIN_URL);
        await page.waitForTimeout(2000);
        const agree = await page.$('.login-form-agree i');
        if (agree) await agree.click();
        await page.fill('input[placeholder*="手机号"]', AUTH.user);
        await page.fill('input[placeholder*="密码"]', AUTH.pass);
        await page.click('.login-form-btn, button:has-text("登录")');
        await page.waitForTimeout(6000);
    } catch (e) { log(`登录失败: ${e.message}`, 'ERROR'); }

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
        await page.waitForTimeout(4000);

        // --- 深度识别章节/试卷列表 ---
        const chapters = await page.evaluate(() => {
            // 必须使用最精确的容器，防止选到页头的 .main-width
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
                            const m = alreadyEl.innerText.match(/\/(\d+)/);
                            if (m) totalCount = parseInt(m[1]);
                        }
                        // 优先练习模式
                        const practice = Array.from(p.querySelectorAll('a')).find(el => el.innerText.includes('练习模式'));
                        if (practice) url = practice.href;
                    }
                    return { title, url, totalCount };
                })
                .filter((v, i, a) => a.findIndex(t => t.title === v.title) === i); // 去重
        });

        for (const chapter of chapters) {
            const statusKey = `${cat.name}/${chapter.title}`;
            const chapterDir = path.join(typeDir, chapter.title.replace(/[\\/:"*?<>|]/g, '_'));
            const outputFile = path.join(chapterDir, '题目.md');
            const imgDir = path.join(chapterDir, 'images');

            // --- 核心修复：更灵活的跳过逻辑 ---
            // 1. 如果 Log 记录中有这个章节，直接跳过 (不再强制要求 totalCount > 0)
            if (completionStatus[statusKey]) {
                log(`>> [Log跳过] ${chapter.title} (记录显示已抓取 ${completionStatus[statusKey]} 题)`, 'INFO');
                continue;
            }

            let skipCount = 0;
            if (fs.existsSync(outputFile)) {
                const c = fs.readFileSync(outputFile, 'utf-8');
                skipCount = (c.match(/## 第 \d+ 题/g) || []).length;
            }

            // 2. 如果 MD 里的题数已经达到列表显示的总数（如果有），也跳过
            if (chapter.totalCount > 0 && skipCount >= chapter.totalCount) {
                log(`>> [满额跳过] ${chapter.title} (本地 ${skipCount} / 总数 ${chapter.totalCount})`, 'INFO');
                completionStatus[statusKey] = skipCount;
                saveStatus();
                continue;
            }

            fs.mkdirSync(imgDir, { recursive: true });
            log(`>> 正在抓取: ${chapter.title} (起步题号: ${skipCount + 1})`, 'INFO');

            try {
                await page.goto(chapter.url);
                await page.waitForTimeout(5000);
                // 处理“开始做题”按钮
                const start = await page.$('a.enable.a2, a:has-text("开始做题"), #PaperStartTimes');
                if (start) { await start.click(); await page.waitForTimeout(6000); }
                
                // 开启背题模式
                const beiti = await page.$('.bd_bt, a:has-text("背题模式"), .sheet-tool a:first-child');
                if (beiti) { await beiti.click(); await page.waitForTimeout(4000); }

                // 跳转题号
                if (skipCount > 0) {
                    await page.evaluate((sc) => {
                        const list = document.querySelectorAll('#tiku_sheet_card li');
                        if (list[sc]) list[sc].click();
                    }, skipCount);
                    await page.waitForTimeout(5000);
                }
            } catch (e) { log(`进入章节失败: ${e.message}`, 'ERROR'); continue; }

            if (skipCount === 0) fs.writeFileSync(outputFile, `# ${chapter.title}\n\n`);

            // --- 题目循环 ---
            while (true) {
                try {
                    await page.waitForSelector('#item_title', { timeout: 15000 });
                    await handlePopup(page);
                    await page.waitForTimeout(2000);

                    const data = await page.evaluate(() => {
                        const getAnalysis = () => {
                            const noise = ['社会工作者考试', '实务》真题及答案', '企业社会工作服务的主要方法', '章节练习', '历年真题', '模拟试卷'];
                            const all = Array.from(document.querySelectorAll('.analysis'));
                            for (let i = all.length - 1; i >= 0; i--) {
                                const el = all[i];
                                if (el.offsetParent === null) continue;
                                let t = (el.innerText || el.textContent || '').trim();
                                t = t.replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                                if (t.length > 5 && !noise.some(n => t.includes(n))) return t;
                            }
                            // 老师讨论兜底
                            const talks = Array.from(document.querySelectorAll('.tiku-talk-list li'));
                            for (let i = talks.length - 1; i >= 0; i--) {
                                if (talks[i].querySelector('.terd') || talks[i].innerText.includes('老师')) {
                                    const m = talks[i].querySelector('.huida .mesage')?.innerText.trim();
                                    if (m && m.length > 5) return `[讨论提取] ${m}`;
                                }
                            }
                            return '无解析';
                        };

                        const getAns = () => {
                            const opts = Array.from(document.querySelectorAll('#item_options li'));
                            const rights = opts.filter(li => li.classList.contains('right') || li.classList.contains('correct') || li.querySelector('.right_icon') || li.getAttribute('data-isanswer') === '1')
                                               .map(li => li.getAttribute('data-optname') || li.innerText.trim().charAt(0));
                            if (rights.length > 0) return [...new Set(rights)].sort().join('');
                            const rText = document.querySelector('.right, .right_answer')?.innerText || '';
                            return rText.includes('正确答案') ? rText.replace(/正确答案[：:]\s*/, '').trim() : '未知';
                        };

                        const step = document.querySelector('#item_step')?.innerText.trim() || '0/0';
                        const res = {
                            type: document.querySelector('#item_type')?.innerText.trim() || '题型',
                            step,
                            options: Array.from(document.querySelectorAll('#item_options li')).map(li => li.innerText.trim()).join('\n'),
                            answer: getAns(),
                            analysis: getAnalysis(),
                            title: '',
                            images: []
                        };
                        const titEl = document.querySelector('#item_title');
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
                    });

                    const [curr, total] = data.step.split('/').map(Number);
                    if (curr <= skipCount) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next && curr < total) { await next.click({ force: true }); await page.waitForTimeout(3000); continue; }
                        else break;
                    }

                    const mdContent = `## 第 ${curr} 题 [${data.type}]\n\n**题目：** ${data.title}\n\n**选项：**\n\`\`\`\n${data.options}\n\`\`\`\n\n> **正确答案：** ${data.answer}\n\n**解析：**\n${data.analysis}\n\n---\n\n`;
                    fs.appendFileSync(outputFile, mdContent);
                    process.stdout.write(`\r进度: ${data.step} | 解析: ${data.analysis !== '无解析' ? '✔' : '✘'}`);

                    const imgTasks = data.images.map(img => downloadImage(img.url, path.join(imgDir, img.name)));
                    await Promise.all(imgTasks);

                    if (curr < total) {
                        const next = await page.$('.subject-next, #next_item');
                        if (next) { 
                            await handlePopup(page);
                            await next.click({ force: true }).catch(() => page.evaluate(() => document.querySelector('.subject-next, #next_item')?.click()));
                            await page.waitForTimeout(Math.floor(Math.random() * 2000) + 3500); 
                        } else break;
                    } else {
                        log(`\n>> [完成] ${chapter.title} 抓取完毕。`, 'INFO');
                        completionStatus[statusKey] = total;
                        saveStatus();
                        break;
                    }
                } catch (e) { log(`题目抓取异常: ${e.message}`, 'ERROR'); break; }
            }
        }
    }
    log('所有任务全部圆满完成！', 'INFO');
    await browser.close();
}

run().catch(err => log(`致命错误: ${err.message}`, 'FATAL'));
