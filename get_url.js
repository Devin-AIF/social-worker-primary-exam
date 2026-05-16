const { chromium } = require('playwright');

const AUTH = {
    user: process.env.XS507_USER || '13510922043',
    pass: process.env.XS507_PASS || '265567'
};

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('登录...');
    await page.goto('https://www.xs507.com/Home/login/account.html?hide-tip=1');
    await page.fill('input[placeholder*="手机号"]', AUTH.user);
    await page.fill('input[placeholder*="密码"]', AUTH.pass);
    await page.click('.login-form-btn');
    await page.waitForTimeout(3000);

    console.log('访问历年真题...');
    // product_id=317 (中级社会工作实务)
    // subject_id=?
    await page.goto('https://www.xs507.com/Tiku/Tikulist/index.html');
    await page.waitForTimeout(2000);
    const radioExists = await page.$(`input[name="change_id"][value="317"]`);
    if(radioExists) {
        await page.click(`label:has(input[name="change_id"][value="317"])`, { force: true });
        await page.waitForTimeout(1000);
        await page.click('.list-change .btn-confirm, .list-change .submit, a:has-text("确认切换")');
        await page.waitForTimeout(3000);
    }
    
    const subjectId = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="subject_id"]'));
        for (const a of links) {
            const m = a.href.match(/subject_id[\/=](\d+)/);
            if (m) return m[1];
        }
    });
    console.log('subject_id:', subjectId);

    if (subjectId) {
        const url = `https://www.xs507.com/Tiku/Product/index/product_id/317/subject_id/${subjectId}/type/1.html`;
        console.log('Going to URL:', url);
        await page.goto(url);
        await page.waitForTimeout(3000);
        
        const chapters = await page.evaluate(() => {
            const container = document.querySelector('.question-conten-list, .product-box, #main-tiku-box') || document.body;
            return Array.from(container.querySelectorAll('a'))
                .filter(a => a.href.includes('paper_id'))
                .map(a => {
                    const title = a.closest('li, tr, .item')?.querySelector('.title, .name')?.innerText.trim() || a.innerText.trim();
                    return { title, url: a.href };
                });
        });
        console.log('Chapters found:', chapters);
    }

    await browser.close();
}

run().catch(console.error);