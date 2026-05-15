function updateLogs() {
    chrome.storage.local.get(['lastLogs'], (result) => {
        const container = document.getElementById('logContainer');
        container.innerHTML = '';
        if (result.lastLogs) {
            result.lastLogs.reverse().forEach(log => {
                const div = document.createElement('div');
                div.className = `log-entry ${log.type}`;
                div.textContent = `[${log.timestamp}] [${log.type}] ${log.msg}`;
                container.appendChild(div);
            });
        }
    });
}

document.getElementById('captureBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('xs507.com')) {
        document.getElementById('status').textContent = '错误：请在 xs507.com 页面使用此插件';
        document.getElementById('status').style.color = 'red';
        return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "captureData" }, (response) => {
        if (chrome.runtime.lastError) {
            document.getElementById('status').textContent = '错误：无法连接到页面，请刷新页面后再试';
            document.getElementById('status').style.color = 'red';
            return;
        }

        if (response) {
            const report = {
                pageData: response.data,
                logs: response.logs
            };
            
            const reportStr = JSON.stringify(report, null, 2);
            navigator.clipboard.writeText(reportStr).then(() => {
                document.getElementById('status').textContent = '报告已复制到剪贴板！';
                document.getElementById('status').style.color = 'green';
            }).catch(err => {
                document.getElementById('status').textContent = '复制失败，请查看控制台';
                console.error(err);
            });
        }
    });
});

document.getElementById('exportBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('xs507.com')) {
        document.getElementById('status').textContent = '错误：请在 xs507.com 页面使用此插件';
        document.getElementById('status').style.color = 'red';
        return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "captureData" }, (response) => {
        if (chrome.runtime.lastError) {
            document.getElementById('status').textContent = '错误：无法连接到页面';
            document.getElementById('status').style.color = 'red';
            return;
        }

        if (response) {
            const report = {
                pageData: response.data,
                logs: response.logs
            };
            
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `scraper-debug-report-${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            document.getElementById('status').textContent = 'JSON 文件已导出！';
            document.getElementById('status').style.color = 'green';
        }
    });
});

// 每秒刷新一次日志
setInterval(updateLogs, 1000);
updateLogs();
