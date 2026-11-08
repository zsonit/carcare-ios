#!/usr/bin/env bash
# 从上游 car-maintenance 仓库同步离线版网页到本工程
# 用法：./tools/sync-web.sh /path/to/car-maintenance
set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -d "$SRC/docs" ]; then
  echo "用法：$0 /path/to/car-maintenance" >&2
  exit 1
fi

DEST="$(cd "$(dirname "$0")/.." && pwd)/Resources/web"
mkdir -p "$DEST"

# 保留本工程的 bridge.js，只同步上游页面资源
for f in index.html manifest.json sw.js icon-192.png icon-512.png; do
  if [ -f "$SRC/docs/$f" ]; then
    cp "$SRC/docs/$f" "$DEST/$f"
    echo "同步 $f"
  fi
done

echo "完成：$DEST"
