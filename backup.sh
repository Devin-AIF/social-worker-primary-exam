#!/bin/bash

# ==============================================================================
# 抓取题目 自动化备份脚本
# ==============================================================================

# 配置部分
SOURCE_DIR="/Users/devin_aif/Downloads/抓取题目"
BACKUP_DIR="/Users/devin_aif/Documents/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/抓取题目_backup_${DATE}.tar.gz"

# 确保备份目录存在
mkdir -p "$BACKUP_DIR"

echo "开始备份: $SOURCE_DIR"
echo "目标文件: $BACKUP_FILE"

# 执行压缩备份
# --exclude 指定不需要备份的目录或文件
tar -czf "$BACKUP_FILE" -C "$(dirname "$SOURCE_DIR")" \
    --exclude="node_modules" \
    --exclude=".git" \
    --exclude="*.log" \
    "$(basename "$SOURCE_DIR")"

# 检查备份是否成功
if [ $? -eq 0 ]; then
    echo "-------------------------------------------"
    echo "备份成功！"
    echo "文件大小: $(du -sh "$BACKUP_FILE" | cut -f1)"
    echo "备份位置: $BACKUP_FILE"
    echo "-------------------------------------------"
    
    # 保留最近 5 次备份，删除更旧的备份
    ls -t "${BACKUP_DIR}"/抓取题目_backup_*.tar.gz | tail -n +6 | xargs rm -f
else
    echo "错误：备份失败，请检查目录权限或空间是否充足。"
    exit 1
fi
