#!/bin/bash

# ==============================================================================
# 自动化后台循环备份脚本 (每 2 分钟一次)
# ==============================================================================

SCRIPT_DIR="/Users/devin_aif/Downloads/抓取题目"
LOG_FILE="${SCRIPT_DIR}/auto_backup.log"

echo "自动化备份已启动。每 120 秒执行一次备份和同步。"
echo "日志文件位置: $LOG_FILE"

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 启动定时备份任务..." >> "$LOG_FILE"
    
    # 执行本地备份
    "$SCRIPT_DIR/backup.sh" >> "$LOG_FILE" 2>&1
    
    # 执行 GitHub 同步
    "$SCRIPT_DIR/github_sync.sh" >> "$LOG_FILE" 2>&1
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 任务完成。等待 120 秒..." >> "$LOG_FILE"
    
    # 等待 2 分钟
    sleep 120
done
