let isMonitoring = false;

function updateEvents() {
    chrome.runtime.sendMessage({ action: "getFullReport" }, (response) => {
        if (!response) return;
        
        // 更新 UI 状态
        isMonitoring = response.isMonitoring;
        const btn = document.getElementById('monitorBtn');
        const indicator = document.getElementById('statusIndicator');
        
        if (isMonitoring) {
            btn.textContent = "停止监控";
            btn.classList.add('active');
            indicator.classList.add('on');
        } else {
            btn.textContent = "开始全域监控";
            btn.classList.remove('active');
            indicator.classList.remove('on');
        }

        // 更新日志列表
        const container = document.getElementById('eventContainer');
        container.innerHTML = '';
        if (response.events) {
            response.events.slice().reverse().forEach(event => {
                const div = document.createElement('div');
                div.className = `log-entry ${event.type}`;
                // 显示来自哪个 URL/页签
                const source = event.url ? `[${event.url}] ` : '';
                div.textContent = `[${event.timestamp}] ${source}${event.detail || event.msg || ''}`;
                container.appendChild(div);
            });
        }
    });
}

document.getElementById('monitorBtn').addEventListener('click', () => {
    const newState = !isMonitoring;
    chrome.runtime.sendMessage({ action: "setMonitorState", state: newState }, () => {
        updateEvents();
    });
});

document.getElementById('exportBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "getFullReport" }, (response) => {
        if (response) {
            const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `scraper-global-report-${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    });
});

setInterval(updateEvents, 1000);
updateEvents();
