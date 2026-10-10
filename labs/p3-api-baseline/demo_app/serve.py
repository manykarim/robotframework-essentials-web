"""Start RF Demo Shop: web shop on :7272, JSON API on :7273.

    uv run python demo_app/serve.py

Both servers share one in-memory store (deterministic; POST /api/reset
restores the canonical seed). Stop with Ctrl+C.
"""

from __future__ import annotations

import os
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from api import ApiHandler  # noqa: E402
from web import WebHandler  # noqa: E402

# Ports default to the lesson values; tests override via env to run isolated.
WEB_PORT = int(os.environ.get("DEMO_SHOP_WEB_PORT", "7272"))
API_PORT = int(os.environ.get("DEMO_SHOP_API_PORT", "7273"))


def main() -> None:
    web = ThreadingHTTPServer(("127.0.0.1", WEB_PORT), WebHandler)
    api = ThreadingHTTPServer(("127.0.0.1", API_PORT), ApiHandler)

    threading.Thread(target=api.serve_forever, daemon=True).start()
    print(f"RF Demo Shop is open: web http://localhost:{WEB_PORT}  api http://localhost:{API_PORT}")
    try:
        web.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        web.shutdown()
        api.shutdown()


if __name__ == "__main__":
    main()
