#!/usr/bin/env python3
"""OpusMC 离线单机版 · 本地静态服务器

用法:
    python3 serve.py [端口]        # 默认 8080
    python3 serve.py 9000

浏览器打开 http://localhost:<端口> 即可。
不要用 file:// 直接打开 index.html —— Web Worker / IndexedDB / 纹理加载需要 HTTP 同源环境。
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 开发期禁用缓存，改完代码刷新即生效
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with Server(("0.0.0.0", port), Handler) as httpd:
        print(f"OpusMC 离线单机版已启动: http://localhost:{port}")
        print("按 Ctrl+C 停止")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")


if __name__ == "__main__":
    main()
