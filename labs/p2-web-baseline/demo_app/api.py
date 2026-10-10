"""RF Demo Shop — the shop's JSON API (port 7273).

Deterministic, open (no auth — the lessons test contracts, not tokens), and
CORS-friendly so the catalog page's search can call it from the browser.
``?delay=<ms>`` on the search route is the explicit affordance the
network-waiting lessons rely on.
"""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from store import STORE


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "DemoShopApi/1.0"

    def log_message(self, *args) -> None:
        pass

    def _send_json(self, data, status: int = 200) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    def do_GET(self) -> None:
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = url.path.rstrip("/")

        if route == "/api/health":
            self._send_json({"status": "ok"})
        elif route == "/api/products":
            self._send_json(STORE.products)
        elif route.startswith("/api/products/"):
            product = STORE.product(route.removeprefix("/api/products/"))
            if product:
                self._send_json(product)
            else:
                self._send_json({"error": "product not found"}, status=404)
        elif route == "/api/catalog/search":
            delay_ms = int(query.get("delay", "0") or 0)
            if delay_ms:
                time.sleep(min(delay_ms, 5000) / 1000)
            results = STORE.search(query.get("q", ""))
            self._send_json(
                {
                    "query": query.get("q", ""),
                    "count": len(results),
                    "results": [p["name"] for p in results],
                    "products": results,
                }
            )
        elif route == "/api/orders":
            self._send_json(STORE.orders)
        elif route.startswith("/api/orders/"):
            order = STORE.order(route.removeprefix("/api/orders/"))
            if order:
                self._send_json(order)
            else:
                self._send_json({"error": "order not found"}, status=404)
        else:
            self._send_json({"error": "unknown route"}, status=404)

    def do_POST(self) -> None:
        route = urlparse(self.path).path.rstrip("/")

        if route == "/api/reset":
            STORE.reset()
            self._send_json({"status": "reset"})
        elif route == "/api/orders":
            body = self._body()
            product_slug = body.get("product")
            quantity = body.get("quantity")
            if not product_slug or quantity is None:
                self._send_json({"error": "product and quantity are required"}, status=400)
                return
            if not STORE.product(product_slug):
                self._send_json({"error": "product not found"}, status=400)
                return
            try:
                quantity = int(quantity)
            except (TypeError, ValueError):
                self._send_json({"error": "quantity must be a number"}, status=400)
                return
            if quantity < 1:
                self._send_json({"error": "quantity must be at least 1"}, status=400)
                return
            order = STORE.place_order(product_slug, quantity)
            self._send_json(order, status=201)
        else:
            self._send_json({"error": "unknown route"}, status=404)
