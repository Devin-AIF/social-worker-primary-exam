let isMonitoring = false;

function updateEvents() {
    chrome.storage.local.get(['capturedEvents'], (result) => {
        const container = document.getElementById('eventContainer');
        container.innerHTML = '';
        if (result.capturedEvents) {
            result.capturedEvents.slice().reverse().forEach(event => {
                const div = document.createElement('div');
                div.className = `log-entry ${event.type}`;
                div.textContent = `[${event.timestamp}] ${event.detail || event.msg || ''}`;
                container.appendChild(div);
            });
        }
    });
}

document.getElementById('monitorBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const btn = document.getElementById('monitorBtn');
    const indicator = document.getElementById('statusIndicator');

    if (!isMonitoring) {
        chrome.tabs.sendMessage(tab.id, { action: "startMonitoring" }, (response) => {
            if (response?.status === "started") {
                isMonitoring = true;
                btn.textContent = "停止监控";
                btn.classList.add('active');
                indicator.classList.add('on');
            }
        });
    } else {
        chrome.tabs.sendMessage(tab.id, { action: "stopMonitoring" }, (response) => {
            if (response?.status === "stopped") {
                isMonitoring = false;
                btn.textContent = "开始实时监控";
                btn.classList.remove('active');
                indicator.classList.remove('on');
            }
        });
    }
});

document.getElementById('exportBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.sendMessage(tab.id, { action: "captureData" }, (response) => {
        if (response) {
            const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `scraper-monitor-report-${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    });
});

setInterval(updateEvents, 1000);
updateEvents();
