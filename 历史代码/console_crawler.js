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

    // 彻底适配背题模式：不再模拟点击选项，直接读取页面已有的答案和解析
    
    const processContent = (el) => {
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('img').forEach(img => {
            let src = img.getAttribute('src');
            if (src) {
                if (src.startsWith('//')) src = 'https:' + src;
                img.replaceWith(` ![图](${src}) `);
            }
        });
        return clone.innerText.trim();
    };

    const fetchAnalysis = () => {
        const selectors = ['.analysis.pd10', '#answer_analysis .analysis', '.answer-yes .analysis', '.answer-wrong .analysis', '.analysis', '#analysis'];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && el.innerText.trim().length > 0) {
                let t = processContent(el);
                t = t.replace(/^[\s\S]*?参考解析[：:\n]*\s*/, '').trim();
                if (t && t !== '-') return t;
            }
        }
        return '无解析';
    };

    const fetchAnswer = () => {
        const selectors = ['.right', '.answer-yes', '#answer_right', '.correct-answer', '.subject-answer'];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) {
                let t = el.innerText.replace('正确答案：', '').replace('答案：', '').trim();
                if (t) return t;
            }
        }
        return '未知';
    };

    let lastStep = '';
    let consecutiveSameStep = 0; // 防卡死计数器
    
    while(true) {
        removeOverlays();
        await sleep(600); // 等待渲染

        const titleEl = document.querySelector('#item_title');
        const step = document.querySelector('#item_step')?.innerText.trim() || '';
        
        if (step === lastStep && step !== '') {
            consecutiveSameStep++;
            if (consecutiveSameStep > 3) {
                console.log('检测到连续 3 次题号未变，停止抓取。');
                break;
            }
        } else {
            consecutiveSameStep = 0; 
        }
        lastStep = step;

        // 背题模式下，点击查看解析按钮（如果存在且没点开）
        try {
            const viewAnalysisBtn = document.querySelector('.click_analysis');
            if (viewAnalysisBtn && viewAnalysisBtn.style.display !== 'none') {
                viewAnalysisBtn.click();
                await sleep(500);
            }
        } catch(e) {}

        const fetchOptions = () => {
            // 尝试多种常见的选项容器选择器，包括共享题干题的嵌套结构
            const selectors = ['#item_options li', '.subject-option li', '.option-list li', '.options li'];
            for (const s of selectors) {
                const items = document.querySelectorAll(s);
                if (items.length > 0) {
                    return Array.from(items).map(li => processContent(li)).join('\n');
                }
            }
            return '';
        };

        const res = {
            type: document.querySelector('#item_type')?.innerText.trim() || '题型',
            step,
            options: fetchOptions(),
            answer: fetchAnswer(),
            analysis: fetchAnalysis(),
            title: processContent(titleEl)
        };

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
    const md = `# ${titleName}\n\n` + questions.map((q, i) => {
        // 1. 根据题型初步判断
        const isSubjective = ['简答题', '案例分析题', '案例题', '计算题', '论述题', '填空题', '主观题'].some(t => q.type.includes(t));
        // 2. 结合实际内容判断：如果是客观题但没抓到选项，也不显示选项块
        const shouldShowOptions = !isSubjective && q.options && q.options.trim().length > 0;
        
        const optionsSection = shouldShowOptions ? `**选项：**\n\`\`\`\n${q.options}\n\`\`\`\n\n` : '';
        
        return `## 第 ${i + 1} 题 [${q.type}]\n\n**题目：** ${q.title}\n\n${optionsSection}> **正确答案：** ${q.answer}\n\n**解析：**\n${q.analysis}\n\n---\n`;
    }).join('\n');

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
