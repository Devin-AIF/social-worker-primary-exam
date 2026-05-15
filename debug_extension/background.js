// --- Background Service Worker (加固版) ---
let isMonitoring = false;
let capturedEvents = [];
const MAX_EVENTS = 1000;

// 同步初始状态
chrome.storage.local.get(['isMonitoring', 'capturedEvents'], (result) => {
    isMonitoring = result.isMonitoring || false;
    capturedEvents = result.capturedEvents || [];
    console.log('Background initialized, monitoring:', isMonitoring);
});

// 监听存储变化（防止内存变量丢失）
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isMonitoring) {
        isMonitoring = changes.isMonitoring.newValue;
        console.log('Monitoring state updated via storage:', isMonitoring);
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 增加 ping 机制检查 content script 连接
    if (request.action === "ping") {
        sendResponse({ status: "pong", isMonitoring });
        return true;
    }

    if (request.action === "getMonitorState") {
        sendResponse({ isMonitoring });
        return true;
    } 
    
    if (request.action === "setMonitorState") {
        isMonitoring = request.state;
        if (isMonitoring) {
            capturedEvents = [];
            addSystemEvent("监控已开启 (全局)");
        } else {
            addSystemEvent("监控已手动关闭");
        }
        chrome.storage.local.set({ isMonitoring, capturedEvents }, () => {
            broadcastState(isMonitoring);
            sendResponse({ status: "ok", isMonitoring });
        });
        return true;
    }

    if (request.action === "logEvent") {
        if (!isMonitoring) {
            sendResponse({ status: "ignored_not_monitoring" });
            return true;
        }
        
        const event = {
            ...request.event,
            tabId: sender.tab?.id,
            url: sender.tab?.url?.split('/').pop() || 'unknown'
        };
        
        capturedEvents.push(event);
        if (capturedEvents.length > MAX_EVENTS) capturedEvents.shift();
        
        // 异步保存，不阻塞响应
        chrome.storage.local.set({ capturedEvents });
        sendResponse({ status: "logged" });
        return true;
    }

    if (request.action === "getFullReport") {
        chrome.storage.local.get(['isMonitoring', 'capturedEvents'], (result) => {
            sendResponse({ 
                isMonitoring: result.isMonitoring, 
                events: result.capturedEvents || [] 
            });
        });
        return true;
    }
});

function addSystemEvent(msg) {
    const timestamp = new Date().toLocaleTimeString();
    capturedEvents.push({ timestamp, type: 'SYSTEM', detail: msg });
}

function broadcastState(state) {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url && tab.url.includes('xs507.com')) {
                chrome.tabs.sendMessage(tab.id, { action: "stateChanged", isMonitoring: state }).catch(() => {});
            }
        });
    });
}
