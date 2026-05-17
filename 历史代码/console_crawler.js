/**
 * Chrome 控制台极速抓取脚本 (增强版)
 * 功能：
 * 1. 自动抓取题目、选项、答案、解析。
 * 2. 自动下载图片并打包至 ZIP，Markdown 使用相对路径，解压即看。
 * 3. 额外导出 data.json 原始结构化数据。
 * 
 * 使用方法：
 * 1. 正常登录网页，进入做题页面。
 * 2. F12 打开控制台，粘贴代码并回车。
 */

async function startCrawling() {
    console.log('>>> 正在加载 JSZip 库...');
    await (new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    }));
    console.log('>>> JSZip 加载成功，开始执行抓取任务...');

    let questions = [];
    const zip = new JSZip();
    const imgFolder = zip.folder("images");

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // 弹窗屏蔽
    const observer = new MutationObserver(() => {
        const popups = ['.layerSaveSuccess', '.layui-layer-shade', '.layui-layer', '#video_analysis_ratelimit_overlay', '.layerFeedback'];
        popups.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const removeOverlays = () => {
        try { localStorage.clear(); sessionStorage.clear(); } catch(e){} 
        document.querySelectorAll('.hide').forEach(el => el.classList.remove('hide'));
        const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer'];
        analysisSelectors.forEach(s => {
            document.querySelectorAll(s).forEach(el => {
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
            });
        });
        document.querySelectorAll('[style*="display: none"]').forEach(el => {
            if (el.id !== 'item_star' && el.className !== 'show_child fr') el.style.display = 'block';
        });
    };

    const downloadImageAsBlob = async (url) => {
        try {
            const response = await fetch(url);
            return await response.blob();
        } catch (e) {
            console.warn(`图片下载失败: ${url}`, e);
            return null;
        }
    };

    const processContent = async (el, step, prefix) => {
        if (!el) return '';
        const clone = el.cloneNode(true);
        const junkSelectors = ['.click_analysis', '.video_analysis', '.err_correct', '.remove_wrong', '.subject-action', '.analysis-action', 'button', 'a', '.show_child', '.fr', '.report-error'];
        junkSelectors.forEach(s => clone.querySelectorAll(s).forEach(item => item.remove()));

        const imgs = clone.querySelectorAll('img');
        for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            let src = img.getAttribute('src') || img.getAttribute('data-src') || img.src;
            if (src) {
                if (src.startsWith('//')) src = 'https:' + src;
                const fileName = `q_${step.replace(/\//g, '_')}_${prefix}_${i}.png`;
                const blob = await downloadImageAsBlob(src);
                if (blob) {
                    imgFolder.file(fileName, blob);
                    img.replaceWith(` ![图](./images/${fileName}) `);
                }
            }
        }
        return clone.innerText.trim();
    };

    const fetchAnswerAndAnalysis = async (step) => {
        let finalAnswer = '未知', finalAnalysis = '无解析';
        const ansSelectors = ['.right', '.answer-yes', '#answer_right', '.correct-answer', '.subject-answer'];
        for (const s of ansSelectors) {
            const el = document.querySelector(s);
            if (el) {
                let t = el.innerText.replace('正确答案：', '').replace('答案：', '').trim();
                if (t) { finalAnswer = t; break; }
            }
        }
        const anaSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '#analysis', '.analysis', '.answer-yes .analysis', '.item_analysis'];
        let fullText = '';
        for (const s of anaSelectors) {
            const el = document.querySelector(s);
            if (el) {
                fullText = await processContent(el, step, 'ans');
                if (fullText.length > 5) break;
            }
        }
        if (fullText) {
            const anaMatch = fullText.match(/(参考解析|题目解析|答案解析|解析)[：:\n]/);
            if (anaMatch) {
                const parts = fullText.split(anaMatch[0]);
                if (finalAnswer === '未知') finalAnswer = parts[0].replace(/^[\s\S]*?(参考答案|正确答案)[：:\n\s]*/, '').trim();
                finalAnalysis = parts.slice(1).join(anaMatch[0]).trim();
            } else {
                finalAnalysis = fullText;
            }
        }
        return { answer: finalAnswer, analysis: finalAnalysis };
    };

    let lastStep = '', consecutiveSameStep = 0; 
    while(true) {
        removeOverlays();
        await sleep(800); 
        const step = document.querySelector('#item_step')?.innerText.trim() || '';
        if (step === lastStep && step !== '') {
            if (++consecutiveSameStep > 3) break;
        } else { consecutiveSameStep = 0; }
        lastStep = step;

        try { document.querySelector('.click_analysis')?.click(); await sleep(600); } catch(e) {}

        const { answer, analysis } = await fetchAnswerAndAnalysis(step);
        const res = {
            type: document.querySelector('#item_type')?.innerText.trim() || '题型',
            step,
            options: await (async () => {
                const items = document.querySelectorAll('#item_options li, .subject-option li, .options li');
                if (items.length === 0) return '';
                let opts = [];
                for(let i=0; i<items.length; i++) opts.push(await processContent(items[i], step, `opt${i}`));
                return opts.join('\n');
            })(),
            answer,
            analysis,
            title: await processContent(document.querySelector('#item_title'), step, 'tit')
        };
        questions.push(res);
        console.log(`进度: ${res.step} | 解析: ${res.analysis.length > 5 ? '✔' : '✘'}`);

        const [curr, total] = res.step.split('/').map(Number);
        if (curr > 0 && curr < total) {
            document.querySelector('.subject-next, #next_item')?.click();
            await sleep(Math.floor(Math.random() * 2000) + 2000); 
        } else break;
    }

    const rawTitle = document.title.split('-')[0].trim();
    const paperId = (window.location.href.match(/paper_id[\/=](\d+)/) || [])[1];
    const titleName = paperId ? `${rawTitle}_paper-${paperId}` : rawTitle;

    const md = `# ${rawTitle}\n\n` + questions.map((q, i) => {
        const isSubjective = ['简答题', '案例分析', '论述', '填空', '主观'].some(t => q.type.includes(t));
        const optionsSection = (!isSubjective && q.options) ? `**选项：**\n\`\`\`\n${q.options}\n\`\`\`\n\n` : '';
        return `## 第 ${i + 1} 题 [${q.type}]\n\n**题目：** ${q.title}\n\n${optionsSection}> **正确答案：** ${q.answer}\n\n**解析：**\n${q.analysis}\n\n---\n`;
    }).join('\n');

    zip.file(`${titleName}.md`, md);
    zip.file(`data.json`, JSON.stringify(questions, null, 2));
    console.log('>>> 正在生成 ZIP 文件...');
    const content = await zip.generateAsync({type:"blob"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `${titleName}_抓取结果.zip`;
    a.click();
    console.log('✅ 全部抓取完成！');
}

startCrawling();
