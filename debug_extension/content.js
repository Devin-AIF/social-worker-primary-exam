let isMonitoring = false;
let observer = null;

// --- 向后台发送事件 ---
function logToBackground(type, detail) {
    if (!isMonitoring) return;
    const timestamp = new Date().toLocaleTimeString();
    chrome.runtime.sendMessage({
        action: "logEvent",
        event: { timestamp, type, detail }
    });
}

// --- 监控核心逻辑 (复用之前的逻辑) ---
const ANTI_CRAWL_SELECTORS = {
    masks: ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg', '.mask', '.loading-mask'],
    popups: ['.layui-layer', '.popup-box', '.modal-content', '.alert-box'],
    antiText: ['验证码', '频率过快', '异常访问', '人机验证', '滑块', '休息一下', '封禁']
};

function checkAntiCrawl() {
    for (const selector of ANTI_CRAWL_SELECTORS.masks) {
        const el = document.querySelector(selector);
        if (el && !!(el.offsetParent || el.getClientRects().length)) {
            logToBackground('ANTI_CRAWL_HIT', `遮罩激活: ${selector}`);
        }
    }
    const bodyText = document.body.innerText;
    for (const text of ANTI_CRAWL_SELECTORS.antiText) {
        if (bodyText.includes(text)) {
            logToBackground('ANTI_CRAWL_TEXT', `反爬文字: ${text}`);
        }
    }
}

function analyzeAnalysisExtraction() {
    const analysisSelectors = ['.analysis.pd10', '#answer_analysis .analysis', '.tiku-analysis', '.jiexi-content'];
    for (const s of analysisSelectors) {
        const el = document.querySelector(s);
        if (el) {
            const visible = !!(el.offsetParent || el.getClientRects().length);
            if (visible && el.innerText.trim().length > 5) {
                logToBackground('ANALYSIS_DETECTION', `解析加载成功 [${s}]`);
            }
        }
    }
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
        checkAntiCrawl();
        analyzeAnalysisExtraction();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    logToBackground('SYSTEM', '页签监控已自动激活');
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// --- 初始化与消息处理 ---
// 1. 页面加载时向后台询问当前是否处于监控状态
chrome.runtime.sendMessage({ action: "getMonitorState" }, (response) => {
    if (response?.isMonitoring) {
        isMonitoring = true;
        startObserver();
    }
});

// 2. 监听来自后台的状态切换指令
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "stateChanged") {
        isMonitoring = request.isMonitoring;
        if (isMonitoring) startObserver();
        else stopObserver();
    }
});

// 拦截控制台
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => { logToBackground('LOG', args.join(' ')); originalLog.apply(console, args); };
console.error = (...args) => { logToBackground('ERROR', args.join(' ')); originalError.apply(console, args); };

console.log('Scraper Monitor Plus Content Script Loaded');
