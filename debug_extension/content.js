let isMonitoring = false;
let observer = null;
let debugPanel = null;

// --- 增强的消息上报 (带重试机制) ---
async function logToBackground(type, detail) {
    if (!isMonitoring) return;
    const timestamp = new Date().toLocaleTimeString();
    
    const send = () => {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: "logEvent",
                event: { timestamp, type, detail }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    };

    let success = await send();
    if (!success) {
        // 如果失败，尝试通过 storage 直接写入作为后备（防止 background 被挂起）
        chrome.storage.local.get(['capturedEvents'], (result) => {
            let events = result.capturedEvents || [];
            events.push({ timestamp, type: type + '_FALLBACK', detail });
            if (events.length > 1000) events.shift();
            chrome.storage.local.set({ capturedEvents: events });
        });
    }

    updateDebugPanel(timestamp, type, detail);
}

// --- 悬浮调试面板 (HUD) ---
function createDebugPanel() {
    if (debugPanel) return;
    debugPanel = document.createElement('div');
    debugPanel.id = 'scraper-debug-panel';
    debugPanel.style.cssText = 'position:fixed;top:10px;right:10px;width:320px;height:450px;background:rgba(0,0,0,0.9);color:#0f0;z-index:2147483647;font-family:monospace;font-size:11px;padding:10px;border-radius:5px;display:flex;flex-direction:column;border:1px solid #333;box-shadow:0 0 20px #000;pointer-events:auto;';
    
    debugPanel.innerHTML = `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #333;padding-bottom:5px;margin-bottom:5px;cursor:move;">
            <b style="color:#0fa;">DEBUGGER HUD v1.2</b>
            <span id="hud-min" style="cursor:pointer;color:#aaa;">[-]</span>
        </div>
        <div id="hud-content" style="flex:1;overflow-y:auto;background:#050505;padding:5px;"></div>
        <div id="hud-footer" style="font-size:9px;color:#666;margin-top:5px;display:flex;justify-content:space-between;">
            <span id="hud-status">SYNCING...</span>
            <span id="hud-tab-info"></span>
        </div>
    `;
    document.documentElement.appendChild(debugPanel);
    
    // 拖拽逻辑
    const header = debugPanel.firstElementChild;
    header.onmousedown = (e) => {
        let x = e.clientX - debugPanel.offsetLeft;
        let y = e.clientY - debugPanel.offsetTop;
        document.onmousemove = (e) => {
            debugPanel.style.left = (e.clientX - x) + 'px';
            debugPanel.style.top = (e.clientY - y) + 'px';
            debugPanel.style.right = 'auto';
        };
        document.onmouseup = () => { document.onmousemove = null; };
    };

    document.getElementById('hud-min').onclick = () => {
        const content = document.getElementById('hud-content');
        if (content.style.display === 'none') {
            content.style.display = 'block';
            debugPanel.style.height = '450px';
        } else {
            content.style.display = 'none';
            debugPanel.style.height = '40px';
        }
    };
    
    document.getElementById('hud-tab-info').innerText = window.location.pathname.split('/').pop();
}

function updateDebugPanel(timestamp, type, detail) {
    if (!debugPanel) createDebugPanel();
    const content = document.getElementById('hud-content');
    if (!content) return;

    const div = document.createElement('div');
    div.style.cssText = 'border-bottom:1px solid #111;padding:2px 0;word-break:break-all;';
    let color = '#0f0';
    if (type.includes('ANTI')) color = '#f44';
    if (type.includes('ERROR')) color = '#f00';
    
    div.innerHTML = `<span style="color:#666;">[${timestamp}]</span> <b style="color:${color}">${type}</b><br>${detail}`;
    content.appendChild(div);
    content.scrollTop = content.scrollHeight;
    
    if (content.childElementCount > 100) content.removeChild(content.firstChild);
}

// --- 监控核心逻辑 ---
const CHECKERS = {
    antiCrawl: () => {
        const masks = ['.layui-layer-shade', '#video_analysis_ratelimit_overlay', '.layerSaveSuccess', '#popup_box_bg'];
        masks.forEach(s => {
            const el = document.querySelector(s);
            if (el && (el.offsetParent || el.getClientRects().length)) logToBackground('ANTI_CRAWL_HIT', `遮罩: ${s}`);
        });
        const texts = ['频率过快', '异常访问', '人机验证', '滑块'];
        const body = document.body.innerText;
        texts.forEach(t => { if (body.includes(t)) logToBackground('ANTI_CRAWL_TEXT', `关键字: ${t}`); });
    },
    analysis: () => {
        const sel = ['.analysis.pd10', '#answer_analysis .analysis', '.tiku-analysis'];
        sel.forEach(s => {
            const el = document.querySelector(s);
            if (el && (el.offsetParent || el.getClientRects().length) && el.innerText.trim().length > 5) {
                logToBackground('ANALYSIS_LOADED', `容器: ${s}`);
            }
        });
    }
};

function startMonitoring() {
    if (observer) return;
    isMonitoring = true;
    createDebugPanel();
    logToBackground('SYSTEM', '监控已在本页签激活');
    
    observer = new MutationObserver(() => {
        CHECKERS.antiCrawl();
        CHECKERS.analysis();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function stopMonitoring() {
    isMonitoring = false;
    if (observer) { observer.disconnect(); observer = null; }
    if (debugPanel) { debugPanel.remove(); debugPanel = null; }
}

// --- 初始化与生命周期 ---
function init() {
    chrome.runtime.sendMessage({ action: "getMonitorState" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.isMonitoring) startMonitoring();
    });
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "stateChanged") {
        if (request.isMonitoring) startMonitoring();
        else stopMonitoring();
    }
});

// 立即运行初始化
init();

// 拦截控制台 (捕获更早的日志)
const wrap = (orig, type) => (...args) => {
    logToBackground(type, args.join(' '));
    orig.apply(console, args);
};
console.log = wrap(console.log, 'LOG');
console.error = wrap(console.error, 'ERROR');
console.warn = wrap(console.warn, 'WARN');
