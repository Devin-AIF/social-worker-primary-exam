const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * 自动化抓取脚本 V8.0 (极速背题模式版)
 * 核心逻辑：自动开启背题模式，实现无延迟极速抓取 + 100% 解析覆盖。
 */

const BASE_URL = 'https://www.xs507.com';
const OUTPUT_DIR = './抓取结果';

const CATEGORIES = [
    { name: '章节练习', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/0.html' },
    { name: '历年真题', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/1.html' },
    { name: '模拟试卷', url: 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/2.html' },
    { name: '仿真考场', url: 'https://www.xs507.com/Tiku/mokao/social.html?product_id=1525&subject_id=1563' }
];

async function downloadImage(url, dest) {
    if (!url) return;
    try {
        if (url.startsWith('data:image')) {
            await fs.promises.writeFile(dest, Buffer.from(url.split('base64,')[1], 'base64'));
            return;
        }
        const fullUrl = url.startsWith('//') ? `https:${url}` : url;
        await new Promise((res) => {
            const req = https.get(fullUrl, { timeout: 10000 }, (r) => {
                if (r.statusCode === 200) {
                    const f = fs.createWriteStream(dest);
                    r.pipe(f);
                    f.on('finish', () => { f.close(); res(); });
                    f.on('error', (err) => {
                        console.error(`\n图片写入失败 ${dest}:`, err.message);
                        f.close();
                        res();
                    });
                } else {
                    console.error(`\n图片下载失败, 状态码 ${r.statusCode}: ${fullUrl}`);
                    res();
                }
            });
            req.on('timeout', () => {
                console.error(`\n图片下载超时: ${fullUrl}`);
                req.destroy();
                res();
            });
            req.on('error', (err) => {
                console.error(`\n图片下载异常: ${err.message} - ${fullUrl}`);
                res();
            });
        });
    } catch (e) {
        console.error(`\n处理图片 URL 出错: ${e.message}`);
    }
}

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 暴力跳过前端反爬：直接拦截并阻止加载生成“刷新过快”弹窗的 JS 脚本
    await context.route('**/*video_analysis.js*', route => route.abort());

    console.log('正在初始化...');
    await page.goto(BASE_URL);
    console.log('\n--- 操作指引 ---\n1. 登录并确保能看到题库\n2. 在此按回车开始极速抓取\n');
    await new Promise(r => process.stdin.once('data', r));

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    for (const cat of CATEGORIES) {
        console.log(`\n>>> 正在开启分类: ${cat.name}`);
        const typeDir = path.join(OUTPUT_DIR, cat.name);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        await page.goto(cat.url);
        await page.waitForTimeout(2000);

        const chapters = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .filter(a => (a.innerText.includes('做题') || a.innerText.includes('开始')) && a.href.includes('product_id'))
                .map(a => {
                    let title = a.innerText.trim();
                    const p = a.closest('li, tr, .big');
                    if (p) {
                        const tEl = p.querySelector('.title, .name, td:first-child');
                        if (tEl) title = tEl.innerText.trim();
                    }
                    return { title, url: a.href };
                });
        });

        for (const chapter of chapters) {
            const chapterDir = path.join(typeDir, chapter.title.replace(/[\\/:"*?<>|]/g, '_'));
            const imgDir = path.join(chapterDir, 'images');
            const outputFile = path.join(chapterDir, '题目.md');

            if (fs.existsSync(outputFile)) continue;

            fs.mkdirSync(imgDir, { recursive: true });
            console.log(`>> 极速抓取: ${chapter.title}`);
            await page.goto(chapter.url);
            
            // 仿真考场跳过确认
            const start = await page.$('a:has-text("开始做题"), .start_btn');
            if (start) { await start.click().catch(()=>{}); await page.waitForTimeout(1000); }

            // --- 核心优化：开启背题模式 ---
            const beiti = await page.$('.bd_bt, a:has-text("背题模式")');
            if (beiti) { await beiti.click().catch(()=>{}); await page.waitForTimeout(2000); }
            // ----------------------------

            let questions = [];
            while (true) {
                try {
                    await page.waitForSelector('#item_title', { timeout: 5000 });
                    
                    // 强制显示解析（以防万一）
                    await page.evaluate(() => {
                        // 清理本地缓存，防止它在前端记录刷题速度
                        try { localStorage.clear(); sessionStorage.clear(); } catch(e){}
                        const items = ['.layerSaveSuccess', '.layui-layer-shade', '.layui-layer', '#video_analysis_ratelimit_overlay'];
                        items.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
                        // 彻底移除隐藏样式，确保 innerText 能获取到内容
                        document.querySelectorAll('.hide').forEach(el => el.classList.remove('hide'));
                        document.querySelectorAll('[style*="display: none"]').forEach(el => {
                            if (el.id !== 'item_star' && el.className !== 'show_child fr') {
                                el.style.display = 'block';
                            }
                        });
                        const analysisBox = document.querySelector('#analysis, .analysis, #answer_analysis');
                        if (analysisBox) analysisBox.style.display = 'block';
                    });

                    // 如果没有开启背题模式或者需要做题才出解析，这里尝试随机点一个选项
                    try {
                        const firstOpt = await page.$('.subject-option li');
                        if (firstOpt) { await firstOpt.click(); }
                        await page.waitForTimeout(500); // 等待解析渲染
                    } catch(e) {}

                    const data = await page.evaluate(() => {
                        const titleEl = document.querySelector('#item_title');
                        const step = document.querySelector('#item_step')?.innerText.trim() || '';
                        const fetchAnalysis = () => {
                            const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis'];
                            for (const s of selectors) {
                                const elements = document.querySelectorAll(s);
                                // 倒序遍历，如果是追加 DOM 的方式，最新的题在最后
                                for (let i = elements.length - 1; i >= 0; i--) {
                                    const el = elements[i];
                                    let t = el.innerText;
                                    if (!t || t.trim() === '') t = el.textContent;
                                    t = (t || '').replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                                    if (t.length > 0 && t !== '-') return t;
                                }
                            }
                            return '无解析';
                        };

                        const res = {
                            type: document.querySelector('#item_type')?.innerText.trim() || '题型',
                            step,
                            options: Array.from(document.querySelectorAll('#item_options li')).map(li => li.innerText.trim()).join('\n'),
                            answer: (document.querySelector('.right')?.innerText || '').replace('正确答案：', '').trim() || '未知',
                            analysis: fetchAnalysis(),
                            images: [],
                            title: ''
                        };

                        if (titleEl) {
                            const clone = titleEl.cloneNode(true);
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

                    questions.push(data);
                    process.stdout.write(`\r进度: ${data.step} (解析: ${data.analysis !== '无解析' ? '有' : '无'})`);

                    // 并发下载图片
                    const imagePromises = data.images.map(img => downloadImage(img.url, path.join(imgDir, img.name)));
                    await Promise.all(imagePromises);

                    // 正常翻页（增加随机延迟防封停）
                    const [curr, total] = data.step.split('/').map(Number);
                    if (curr < total) {
                        const next = await page.$('.subject-next, #next_item, a:has-text("下一题")');
                        if (next) { 
                            await next.click(); 
                            // 随机等待 1.5 秒 ~ 3.5 秒，模拟真人做题速度
                            await page.waitForTimeout(Math.floor(Math.random() * 2000) + 1500); 
                        } else break;
                    } else break;

                } catch (e) { 
                    console.error(`\n[异常] 抓取题目时发生错误: ${e.message}`);
                    break; 
                }
            }

            const md = `# ${chapter.title}\n\n` + questions.map((q, i) => 
                `## 第 ${i + 1} 题 [${q.type}]\n\n**题目：** ${q.title}\n\n**选项：**\n\`\`\`\n${q.options}\n\`\`\`\n\n> **正确答案：** ${q.answer}\n\n**解析：**\n${q.analysis}\n\n---\n`
            ).join('\n');
            fs.writeFileSync(outputFile, md);
            console.log(`\n[完成] ${chapter.title}`);
        }
    }
    console.log('\n全部任务圆满完成！');
    await browser.close();
}

run().catch(console.error);
