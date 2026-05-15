let isMonitoring = false;
let capturedEvents = [];
const MAX_EVENTS = 200;
let observer = null;

// --- 日志与事件记录 ---
function addEvent(type, detail) {
    if (!isMonitoring) return;
    const timestamp = new Date().toLocaleTimeString();
    capturedEvents.push({ timestamp, type, detail });
    if (capturedEvents.length > MAX_EVENTS) capturedEvents.shift();
    chrome.storage.local.set({ capturedEvents });
}

// --- 核心：反爬与弹窗检测逻辑 ---
const ANTI_CRAWL_SELECTORS = {
    masks: ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg', '.mask', '.loading-mask'],
    popups: ['.layui-layer', '.popup-box', '.modal-content', '.alert-box'],
    antiText: ['验证码', '频率过快', '异常访问', '人机验证', '滑块', '休息一下', '封禁']
};

function checkAntiCrawl() {
    // 1. 检查物理遮罩
    for (const selector of ANTI_CRAWL_SELECTORS.masks) {
        const el = document.querySelector(selector);
        if (el && !!(el.offsetParent || el.getClientRects().length)) {
            addEvent('ANTI_CRAWL_HIT', `检测到活跃遮罩层: ${selector}`);
        }
    }

    // 2. 检查可疑文本
    const bodyText = document.body.innerText;
    for (const text of ANTI_CRAWL_SELECTORS.antiText) {
        if (bodyText.includes(text)) {
            addEvent('ANTI_CRAWL_TEXT', `页面出现反爬关键字: ${text}`);
        }
    }
}

// --- 核心：解析提取分析逻辑 ---
function analyzeAnalysisExtraction() {
    const analysisSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.tiku-analysis', '.jiexi-content'];
    let found = false;
    for (const s of analysisSelectors) {
        const el = document.querySelector(s);
        if (el) {
            const visible = !!(el.offsetParent || el.getClientRects().length);
            const content = el.innerText.trim();
            if (visible && content.length > 5) {
                addEvent('ANALYSIS_DETECTION', `解析已加载 [${s}]: ${content.substring(0, 30)}...`);
                found = true;
            } else if (!visible) {
                addEvent('ANALYSIS_WARN', `解析元素存在但不可见 [${s}]`);
            }
        }
    }
}

// --- 动态监控：MutationObserver ---
function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
        let shouldCheck = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldCheck = true;
                break;
            }
        }
        if (shouldCheck) {
            checkAntiCrawl();
            analyzeAnalysisExtraction();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    addEvent('SYSTEM', '动态监控已启动');
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    addEvent('SYSTEM', '动态监控已停止');
}

// --- 消息监听 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startMonitoring") {
        isMonitoring = true;
        capturedEvents = []; // 重置
        startObserver();
        sendResponse({ status: "started" });
    } else if (request.action === "stopMonitoring") {
        isMonitoring = false;
        stopObserver();
        sendResponse({ status: "stopped" });
    } else if (request.action === "captureData") {
        const pageData = capturePageState();
        sendResponse({ pageData, events: capturedEvents });
    }
});

function capturePageState() {
    return {
        url: window.location.href,
        timestamp: new Date().toISOString(),
        htmlSample: document.body.innerHTML.substring(0, 10000), // 获取较大范围的 HTML 结构进行深度分析
        isMonitoring
    };
}

// 拦截 console（保持原有功能）
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => { addEvent('LOG', args.join(' ')); originalLog.apply(console, args); };
console.error = (...args) => { addEvent('ERROR', args.join(' ')); originalError.apply(console, args); };

console.log('Scraper Debugger Monitor Script Loaded');
