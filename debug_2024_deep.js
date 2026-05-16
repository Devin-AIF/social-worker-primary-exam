
const { chromium } = require('playwright');
const fs = require('fs');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

async function run() {
    console.log('启动浏览器...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.waitForTimeout(2000);
    await page.click('.login-form-agree i', { timeout: 2000 }).catch(() => {});
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(6000);

    console.log('访问 2024 真题...');
    await page.goto('https://www.xs507.com/Tiku/Papers/exam/product_id/317/paper_id/14658/subject_id/107/records_type/2/is_again/1.html');
    await page.waitForTimeout(5000);

    // 选背题模式
    console.log('切换背题模式...');
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
            const t = (el.innerText || '').trim(); 
            return (t === '背题模式' || t === '背题' || t === '显示答案');
        });
        if (btn) btn.click();
    });
    await page.waitForTimeout(3000);

    console.log('\n--- 分析当前题 (2024 真题) ---');
    
    // 找出所有包含“解析”或“答案”文字的元素
    const elements = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        return all
            .filter(el => {
                const t = el.innerText || '';
                return (t.includes('解析') || t.includes('答案')) && t.length < 50 && el.children.length < 3;
            })
            .map(el => ({
                tag: el.tagName,
                text: el.innerText.trim(),
                className: el.className,
                id: el.id,
                visible: el.offsetParent !== null,
                rect: el.getBoundingClientRect()
            }));
    });

    console.log(`找到 ${elements.length} 个可能的触发元素:`);
    elements.forEach(e => {
        console.log(`- [${e.visible ? 'VISIBLE' : 'HIDDEN'}] <${e.tag}> id="${e.id}" class="${e.className}" text="${e.text}"`);
    });

    // 强行展开解析并点击所有可能的按钮
    console.log('尝试强行触发解析...');
    await page.evaluate(() => {
        // 1. 强行显示
        const analysisSelectors = ['#analysis', '.analysis', '#answer_analysis', '.item_analysis', '#item_analysis', '#item_answer', '.answer-content'];
        analysisSelectors.forEach(s => {
            document.querySelectorAll(s).forEach(el => {
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
                el.classList.remove('hide', 'hidden');
            });
        });

        // 2. 点击所有按钮
        const btns = Array.from(document.querySelectorAll('a, button, span, div')).filter(el => {
            const t = el.innerText || '';
            return (t.includes('点击查看解析') || t.includes('显示答案') || t.includes('查看解析') || el.classList.contains('click_analysis'));
        });
        btns.forEach(b => {
            console.log('正在点击:', b.innerText || b.className);
            b.click();
        });
    });
    
    await page.waitForTimeout(5000);

    const result = await page.evaluate(() => {
        const ana = document.querySelector('#analysis, #answer_analysis, .analysis');
        return {
            text: ana?.innerText.trim() || 'NOT FOUND',
            html: ana?.innerHTML.substring(0, 500) || 'NOT FOUND'
        };
    });

    console.log('\n抓取结果:');
    console.log('Text:', result.text.substring(0, 200) + '...');
    // console.log('HTML:', result.html);

    await browser.close();
}

run().catch(console.error);
