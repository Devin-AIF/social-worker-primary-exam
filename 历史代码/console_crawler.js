/**
 * Chrome 控制台极速抓取脚本
 * 使用方法：
 * 1. 正常登录网页，进入某一个章节的“开始做题”页面。
 * 2. 按 F12 打开开发者工具，切换到 Console (控制台) 标签页。
 * 3. 复制以下全部代码，粘贴到控制台，按下回车键。
 * 4. 脚本会自动翻页抓取，完成后会自动下载一个 .md 格式的 Markdown 文件。
 */

async function startCrawling() {
    console.log('>>> 开始执行抓取任务...');
    let questions = [];
    
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // 1. 建立全局弹窗屏蔽器 (MutationObserver 实时监控，一出现就干掉)
    const observer = new MutationObserver(() => {
        const popups = ['.layerSaveSuccess', '.layui-layer-shade', '.layui-layer', '#video_analysis_ratelimit_overlay', '.layerFeedback'];
        popups.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 移除各类遮罩层，强行显示被隐藏的元素
    const removeOverlays = () => {
        try { localStorage.clear(); sessionStorage.clear(); } catch(e){} // 顺手清理限流缓存
        document.querySelectorAll('.hide').forEach(el => el.classList.remove('hide'));
        document.querySelectorAll('[style*="display: none"]').forEach(el => {
            if (el.id !== 'item_star' && el.className !== 'show_child fr') {
                el.style.display = 'block';
            }
        });
        
        const analysisBox = document.querySelector('#analysis, .analysis, #answer_analysis');
        if (analysisBox) analysisBox.style.display = 'block';
    };

    // 彻底放弃背题模式，使用正常的“做题模式”

    let lastStep = '';
    let consecutiveSameStep = 0; // 防卡死计数器
    
    while(true) {
        removeOverlays();

        const titleEl = document.querySelector('#item_title');
        const step = document.querySelector('#item_step')?.innerText.trim() || '';
        
        if (step === lastStep && step !== '') {
            consecutiveSameStep++;
            if (consecutiveSameStep > 3) {
                console.log('检测到连续 3 次题号未变，可能是被限制或网络卡顿，停止抓取并导出当前数据。');
                break;
            }
        } else {
            consecutiveSameStep = 0; // 重置
        }
        lastStep = step;

        const fetchAnalysis = () => {
            const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis'];
            for (const s of selectors) {
                const elements = document.querySelectorAll(s);
                // 倒序遍历，防止单页应用追加元素导致抓到前面废弃的空壳
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

        // 1. 模拟正常做题：直接点击第一个选项，触发判题逻辑和解析渲染
        try {
            const firstOpt = document.querySelector('.subject-option li');
            if (firstOpt) { 
                firstOpt.click(); 
                await sleep(800); // 给网页判断对错并渲染解析的时间
            }
        } catch(e) {}

        removeOverlays(); // 清理点击选项后可能弹出的窗口

        // 2. 如果有些题库做完题后，还需要手动点击“查看解析”才展示，这里自动帮点
        try {
            const viewAnalysisBtn = document.querySelector('.click_analysis');
            if (viewAnalysisBtn && viewAnalysisBtn.style.display !== 'none') {
                viewAnalysisBtn.click();
                await sleep(400);
            }
        } catch(e) {}

        let analysisResult = fetchAnalysis();

        const res = {
            type: document.querySelector('#item_type')?.innerText.trim() || '题型',
            step,
            options: Array.from(document.querySelectorAll('#item_options li')).map(li => li.innerText.trim()).join('\n'),
            answer: (document.querySelector('.right')?.innerText || '').replace('正确答案：', '').trim() || '未知',
            analysis: analysisResult,
            images: [],
            title: ''
        };

        if (titleEl) {
            const clone = titleEl.cloneNode(true);
            clone.querySelectorAll('img').forEach((img, idx) => {
                let src = img.getAttribute('src');
                if (src) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    // 在控制台脚本中，直接将图片原地址或base64写入 Markdown 中
                    img.replaceWith(` ![图](${src}) `);
                }
            });
            res.title = clone.innerText.trim();
        }

        questions.push(res);
        console.log(`进度: ${res.step} | 解析状态: ${res.analysis !== '无解析' ? '成功' : '失败'}`);

        // 翻页逻辑
        const [currStr, totalStr] = res.step.split('/');
        const curr = parseInt(currStr) || 0;
        const total = parseInt(totalStr) || 0;
        
        if (curr > 0 && curr < total) {
            const nextBtn = document.querySelector('.subject-next, #next_item');
            if (nextBtn) {
                nextBtn.click();
                // 随机延迟防封停 (1.5 ~ 3.5秒)
                const delay = Math.floor(Math.random() * 2000) + 1500;
                await sleep(delay); 
            } else {
                break;
            }
        } else {
            console.log('已到达最后一题。');
            break;
        }
    }

    // 拼接成 Markdown 文本
    const titleName = document.title ? document.title.split('-')[0] : '抓取结果';
    const md = `# ${titleName}\n\n` + questions.map((q, i) => 
        `## 第 ${i + 1} 题 [${q.type}]\n\n**题目：** ${q.title}\n\n**选项：**\n\`\`\`\n${q.options}\n\`\`\`\n\n> **正确答案：** ${q.answer}\n\n**解析：**\n${q.analysis}\n\n---\n`
    ).join('\n');

    // 触发浏览器下载
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${titleName}_抓取.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('✅ 全部抓取完成！Markdown 文件已触发下载。');
}

// 启动执行
startCrawling();
