"""The lab's demo shop, answered inside the browser.

Every requests adapter sends `localhost`/`127.0.0.1` on port 7272 (web shop) and 7273 (JSON
API) to the lab's own demo_app handlers through an in-memory socket, for http and https.
No server is started, and requests to any other host fail: the browser lab never sends a
request to another site.
"""

import io
import os
import sys
from http.client import HTTPResponse as _ClientResponse
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3 import HTTPResponse

PORTS = {7272: 'web shop', 7273: 'JSON API'}
REFUSED = ('{host} is not reachable from the browser lab: only the demo shop on ports 7272 and 7273 '
           'is. Download the lab to reach other hosts.')

_routes = {}


class _Sink(io.BytesIO):
    def close(self):
        pass


class _Socket:
    """Just enough of a socket for BaseHTTPRequestHandler."""

    def __init__(self, request):
        self.rfile, self.wfile = io.BytesIO(request), _Sink()

    def makefile(self, mode, *args, **kwargs):
        return self.rfile if 'r' in mode else self.wfile

    def sendall(self, data):
        self.wfile.write(data)

    def settimeout(self, timeout):
        pass

    def setsockopt(self, *args):
        pass


class _Server:
    server_name, server_port = 'localhost', 0


def _body(request):
    body = request.body
    if body is None:
        return b''
    if isinstance(body, str):
        return body.encode('utf-8')
    if hasattr(body, 'read'):
        return body.read()
    if isinstance(body, (bytes, bytearray)):
        return bytes(body)
    return b''.join(body)


def _send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
    url = urlsplit(request.url)
    host = (url.hostname or '').lower()
    port = url.port or (443 if url.scheme == 'https' else 80)
    handler = _routes.get(port) if host in ('localhost', '127.0.0.1') else None
    if handler is None:
        raise requests.ConnectionError(REFUSED.format(host=url.netloc or request.url), request=request)
    body = _body(request)
    target = url.path or '/'
    if url.query:
        target += '?' + url.query
    head = f'{request.method} {target} HTTP/1.1\r\nHost: {url.netloc}\r\n'
    head += ''.join(f'{k}: {v}\r\n' for k, v in request.headers.items() if k.lower() not in ('content-length', 'host'))
    head += f'Content-Length: {len(body)}\r\nConnection: close\r\n\r\n'
    sock = _Socket(head.encode('latin-1') + body)
    handler(sock, ('127.0.0.1', 0), _Server())
    response = _ClientResponse(_Socket(sock.wfile.getvalue()), method=request.method)
    response.begin()
    content = response.read()
    raw = HTTPResponse(body=io.BytesIO(content), headers=dict(response.getheaders()), status=response.status,
                       reason=response.reason, preload_content=False, decode_content=False,
                       original_response=response)
    return self.build_response(request, raw)


def install(root):
    """Route the demo shop ports to `<root>/demo_app/`, if the lab has it; refuse everything else."""
    _routes.clear()
    demo_app = os.path.join(root, 'demo_app')
    if os.path.exists(os.path.join(demo_app, 'api.py')):
        if demo_app not in sys.path:
            sys.path.insert(0, demo_app)
        from api import ApiHandler
        _routes[7273] = ApiHandler
        if os.path.exists(os.path.join(demo_app, 'web.py')):
            from web import WebHandler
            _routes[7272] = WebHandler
    HTTPAdapter.send = _send
    return sorted(_routes)
