
const { chromium } = require('playwright');

async function verify() {
    console.log("=== 开始真实网页验证 ===");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. 验证分类页面结构
        const targetUrl = 'https://www.xs507.com/Tiku/Product/index/product_id/1525/subject_id/1563/type/0.html';
        console.log(`正在访问分类页: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        // 检查页面是否加载成功
        const title = await page.title();
        console.log(`页面标题: ${title}`);

        // 2. 验证“仿真考场”链接是否存在（用于确认过滤逻辑的必要性）
        const hasMokao = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a')).some(a => a.href.includes('mokao') || a.innerText.includes('仿真考场'));
        });
        console.log(`页面中是否存在“仿真考场”相关链接: ${hasMokao ? '是' : '否'}`);

        // 3. 验证做题页面的关键选择器（尝试进入第一道题，不登录可能受限，但可以检查 DOM）
        const firstExercise = await page.evaluate(() => {
            const a = Array.from(document.querySelectorAll('a')).find(a => a.innerText.includes('做题'));
            return a ? a.href : null;
        });

        if (firstExercise) {
            console.log(`尝试访问做题页: ${firstExercise}`);
            await page.goto(firstExercise, { waitUntil: 'networkidle', timeout: 30000 });
            
            // 验证解析和弹窗选择器是否存在于脚本/样式中
            const pageSource = await page.content();
            
            const hasPopupInSource = pageSource.includes('video_analysis_ratelimit_overlay');
            const hasClickAnalysisInSource = pageSource.includes('click_analysis');
            
            console.log(`DOM/源码中是否存在反爬弹窗选择器 (#video_analysis_ratelimit_overlay): ${hasPopupInSource ? '是' : '否'}`);
            console.log(`DOM/源码中是否存在查看解析选择器 (.click_analysis): ${hasClickAnalysisInSource ? '是' : '否'}`);
            
            if (hasPopupInSource) {
                console.log("[SUCCESS] 反爬弹窗选择器匹配成功。");
            } else {
                console.log("[WARN] 未在当前页面源码找到弹窗选择器，可能是动态注入或环境不同。");
            }
        } else {
            console.log("[WARN] 未找到进入做题页的链接，可能需要登录。");
        }

    } catch (e) {
        console.error(`[ERROR] 验证过程中出错: ${e.message}`);
    } finally {
        await browser.close();
        console.log("=== 验证结束 ===");
    }
}

verify();
