#!/usr/bin/env python3
"""KODOMO WORLD のローカルサーバー。

素の http.server だとブラウザが JS/CSS をキャッシュして、
編集した内容が反映されない（ES module は特に握られやすい）。
開発中に困るだけなので、常に no-store を返す。

    python3 serve.py [ポート番号]      # 既定 8949
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8949
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):   # アクセスログは静かに
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print("KODOMO WORLD → http://localhost:%d  (Ctrl+C で終了)" % PORT)
        httpd.serve_forever()
