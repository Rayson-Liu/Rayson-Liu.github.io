#!/usr/bin/env bash
# OpusMC 离线单机版 · 一键启动
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 serve.py "${1:-8080}"
elif command -v python >/dev/null 2>&1; then
  exec python serve.py "${1:-8080}"
else
  echo "未找到 Python，请改用任意静态服务器（如 npx serve .）" >&2
  exit 1
fi
