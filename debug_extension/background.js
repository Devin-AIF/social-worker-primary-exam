// --- Background Service Worker ---
let isMonitoring = false;
let capturedEvents = [];
const MAX_EVENTS = 500;

// 初始化状态
chrome.storage.local.get(['isMonitoring', 'capturedEvents'], (result) => {
    isMonitoring = result.isMonitoring || false;
    capturedEvents = result.capturedEvents || [];
});

// 监听来自 Content Script 或 Popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getMonitorState") {
        sendResponse({ isMonitoring });
    } 
    else if (request.action === "setMonitorState") {
        isMonitoring = request.state;
        if (isMonitoring) capturedEvents = []; // 开启新监控时清空旧日志
        chrome.storage.local.set({ isMonitoring, capturedEvents });
        // 通知所有相关的页签状态已改变
        broadcastState(isMonitoring);
        sendResponse({ status: "ok" });
    }
    else if (request.action === "logEvent") {
        if (!isMonitoring) return;
        
        const event = {
            ...request.event,
            tabId: sender.tab?.id,
            url: sender.tab?.url?.split('/').pop() // 仅保留文件名或路径末尾，节省空间
        };
        
        capturedEvents.push(event);
        if (capturedEvents.length > MAX_EVENTS) capturedEvents.shift();
        chrome.storage.local.set({ capturedEvents });
    }
    else if (request.action === "getFullReport") {
        sendResponse({ isMonitoring, events: capturedEvents });
    }
});

function broadcastState(state) {
    chrome.tabs.query({ url: "*://www.xs507.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: "stateChanged", isMonitoring: state }).catch(() => {});
        });
    });
}
