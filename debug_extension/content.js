// 记录日志和错误
let logs = [];
const MAX_LOGS = 100;

function addLog(type, msg) {
    const timestamp = new Date().toLocaleTimeString();
    logs.push({ timestamp, type, msg: String(msg) });
    if (logs.length > MAX_LOGS) logs.shift();
    // 存入本地存储，方便 popup 读取
    chrome.storage.local.set({ lastLogs: logs });
}

// 拦截 console
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
    addLog('LOG', args.join(' '));
    originalLog.apply(console, args);
};

console.error = function(...args) {
    addLog('ERROR', args.join(' '));
    originalError.apply(console, args);
};

// 捕获未处理的错误
window.onerror = function(message, source, lineno, colno, error) {
    addLog('JS_ERROR', `${message} at ${source}:${lineno}:${colno}`);
};

// 监听来自 popup 的请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "captureData") {
        const data = capturePageState();
        sendResponse({ data, logs });
    }
});

function capturePageState() {
    const selectors = {
        title: '#item_title, .item-title, .subject-title',
        subTitle: '.subject-sub-title, .question-sub-title',
        options: '#item_options li, .options li, .question-options li',
        analysis: '.analysis.pd10, #answer_analysis .analysis, .analysis, .tiku-analysis',
        step: '#item_step, .item-step, .step',
        type: '#item_type, .item-type, .question-type'
    };

    const result = {
        url: window.location.href,
        timestamp: new Date().toISOString(),
        elements: {}
    };

    for (const [key, selector] of Object.entries(selectors)) {
        const els = Array.from(document.querySelectorAll(selector));
        result.elements[key] = els.map(el => ({
            text: el.innerText.trim(),
            visible: !!(el.offsetParent || el.getClientRects().length),
            html: el.outerHTML.substring(0, 500) // 采样部分 HTML
        }));
    }

    // 检查是否有遮罩层
    const masks = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess'];
    result.masks = masks.map(s => ({
        selector: s,
        exists: !!document.querySelector(s)
    }));

    return result;
}

console.log('Scraper Debugger Helper Content Script Loaded');
addLog('SYSTEM', 'Debugger content script loaded');
