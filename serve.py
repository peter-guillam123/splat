#!/usr/bin/env python3
"""Tiny static dev server that tells the browser never to cache, so edits show
up on a plain reload without version-bumping every file. Local dev only."""
import http.server
import socketserver

PORT = 8642


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
        print(f'Serving Splat! (no-cache) on http://localhost:{PORT}')
        httpd.serve_forever()
