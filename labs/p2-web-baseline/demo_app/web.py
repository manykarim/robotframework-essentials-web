"""RF Demo Shop — the shop's web UI (port 7272).

Server-rendered HTML with stable ``data-testid`` attributes; a little inline
JavaScript where the lessons need asynchronous behavior. Reliability
affordances are explicit query flags, default off:

- ``/catalog?delay=<ms>``   product cards render after a delay (client-side)
- ``/catalog?overlay=1``    a dismissible promo overlay covers the page
- ``/catalog?tip=1``        an inline tip banner with a dismiss button
- ``/catalog?unstable=1``   cosmetic ids/classes randomize per request
                            (data-testid stays stable — that is the lesson)
"""

from __future__ import annotations

import os
import secrets
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from store import STORE

API_URL = f"http://localhost:{os.environ.get('DEMO_SHOP_API_PORT', '7273')}"

PAGE_STYLE = """
body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 720px; color: #1c2733; }
header { display: flex; justify-content: space-between; align-items: baseline; }
h1 { color: #b45309; }
.card { border: 1px solid #d8dee5; border-radius: 8px; padding: 1rem; margin: 0.6rem 0; }
button, input { font: inherit; padding: 0.35rem 0.8rem; }
button { background: #1c4b82; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
.error { color: #b3261e; font-weight: 600; }
.overlay { position: fixed; inset: 0; background: rgba(28, 39, 51, 0.85); color: #fff;
           display: flex; flex-direction: column; align-items: center; justify-content: center; }
.tip { background: #fdf3e3; border: 1px solid #b45309; padding: 0.6rem; border-radius: 6px; }
"""


def page(title: str, body: str) -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>{title} — RF Demo Shop</title><style>{PAGE_STYLE}</style></head>"
        f"<body>{body}</body></html>"
    )


class WebHandler(BaseHTTPRequestHandler):
    server_version = "DemoShopWeb/1.0"

    # ── plumbing ────────────────────────────────────────────────────────

    def log_message(self, *args) -> None:  # keep learner terminals quiet
        pass

    def _send_html(self, body: str, status: int = 200, headers: dict | None = None) -> None:
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def _redirect(self, location: str, headers: dict | None = None) -> None:
        self.send_response(303)
        self.send_header("Location", location)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _session(self) -> dict | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        token = cookie["shop_session"].value if "shop_session" in cookie else None
        return STORE.session(token)

    def _form(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        return {k: v[0] for k, v in parse_qs(raw, keep_blank_values=True).items()}

    # ── routing ─────────────────────────────────────────────────────────

    def do_GET(self) -> None:
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        route = url.path.rstrip("/") or "/"
        if route == "/":
            self._redirect("/catalog" if self._session() else "/login")
        elif route == "/health":
            self._send_html("ok")
        elif route == "/login":
            self._render_login(query)
        elif route == "/catalog":
            self._render_catalog(query)
        elif route == "/cart":
            self._render_cart()
        elif route == "/checkout":
            self._render_checkout()
        elif route.startswith("/order/"):
            self._render_order(route.removeprefix("/order/"))
        elif route.startswith("/add/"):
            self._add_to_cart(route.removeprefix("/add/"))
        else:
            self._send_html(page("Not found", "<h1>Page not found</h1>"), status=404)

    def do_POST(self) -> None:
        route = urlparse(self.path).path.rstrip("/")
        if route == "/login":
            self._handle_login()
        elif route == "/checkout":
            self._handle_checkout()
        else:
            self._send_html(page("Not found", "<h1>Page not found</h1>"), status=404)

    # ── pages ───────────────────────────────────────────────────────────

    def _render_login(self, query: dict) -> None:
        errors = {
            "blocked": "Sorry, this account is blocked. Contact support.",
            "invalid": "Sign-in failed: invalid username or password.",
            "required": "Username is required.",
        }
        error_html = (
            f'<p class="error" data-testid="login-error">{errors[query["error"]]}</p>'
            if query.get("error") in errors
            else ""
        )
        self._send_html(
            page(
                "Sign in",
                f"""
                <h1>RF Demo Shop</h1>
                <p>Sign in to browse the catalog.</p>
                {error_html}
                <form method="post" action="/login" class="card">
                  <p><label>Username<br>
                     <input name="username" data-testid="login-username"></label></p>
                  <p><label>Password<br>
                     <input name="password" type="password" data-testid="login-password"></label></p>
                  <button type="submit" data-testid="login-submit">Sign in</button>
                </form>
                """,
            )
        )

    def _handle_login(self) -> None:
        form = self._form()
        username = form.get("username", "")
        if not username:
            self._redirect("/login?error=required")
            return
        token, error = STORE.sign_in(username, form.get("password", ""))
        if error:
            self._redirect(f"/login?error={error}")
            return
        cookie = f"shop_session={token}; Path=/; HttpOnly"
        self._redirect("/catalog", headers={"Set-Cookie": cookie})

    def _render_catalog(self, query: dict) -> None:
        session = self._session()
        if not session:
            self._redirect("/login")
            return
        delay_ms = int(query.get("delay", "0") or 0)
        unstable = query.get("unstable") == "1"

        cards = []
        for product in STORE.products:
            cosmetic = f" id='p-{secrets.token_hex(4)}' class='card gen-{secrets.token_hex(3)}'" if unstable else " class='card'"
            cards.append(
                f"""
                <div{cosmetic} data-testid="catalog-card" data-name="{product['name']}">
                  <h3 data-testid="catalog-card-title">{product['name']}</h3>
                  <p data-testid="catalog-card-price">€{product['price']:.2f}</p>
                  <a href="/add/{product['slug']}"><button data-testid="add-{product['slug']}">Add to cart</button></a>
                </div>
                """
            )
        cards_html = "".join(cards)

        overlay_html = (
            """
            <div class="overlay" data-testid="promo-overlay">
              <h2>Season sale at RF Demo Shop!</h2>
              <button data-testid="notice-close"
                      onclick="document.querySelector('[data-testid=promo-overlay]').remove()">
                Close
              </button>
            </div>
            """
            if query.get("overlay") == "1"
            else ""
        )
        tip_html = (
            """
            <div class="tip" data-testid="catalog-tip">
              Tip: use the search box to filter products.
              <button data-testid="tip-dismiss"
                      onclick="document.querySelector('[data-testid=catalog-tip]').remove()">
                Dismiss
              </button>
            </div>
            """
            if query.get("tip") == "1"
            else ""
        )

        # Search calls the API asynchronously so network-waiting lessons are real.
        body = f"""
        <header>
          <h1 data-testid="catalog-title">RF Demo Shop Catalog</h1>
          <nav><a href="/cart" data-testid="nav-cart">Cart ({len(session['cart'])})</a></nav>
        </header>
        {tip_html}
        <form onsubmit="return runSearch(event)">
          <input data-testid="catalog-search" id="search-input" placeholder="Search products">
          <button type="submit" data-testid="search-submit">Search</button>
        </form>
        <p><span data-testid="result-count">{len(STORE.products)}</span>
           <span data-testid="result-summary">products in the catalog</span></p>
        <section id="cards" style="visibility: {'hidden' if delay_ms else 'visible'}">{cards_html}</section>
        {overlay_html}
        <script>
          const DELAY = {delay_ms};
          if (DELAY > 0) {{
            setTimeout(() => {{ document.getElementById('cards').style.visibility = 'visible'; }}, DELAY);
          }}
          async function runSearch(event) {{
            event.preventDefault();
            const q = document.getElementById('search-input').value;
            const response = await fetch('{API_URL}/api/catalog/search?q=' + encodeURIComponent(q) + (DELAY ? '&delay=' + DELAY : ''));
            const data = await response.json();
            document.querySelector('[data-testid=result-count]').textContent = data.count;
            document.querySelector('[data-testid=result-summary]').textContent =
              data.count === 1 ? 'product matches your search' : 'products match your search';
            document.getElementById('cards').innerHTML = data.products.map((p) => `
                <div class="card" data-testid="catalog-card" data-name="${{p.name}}">
                  <h3 data-testid="catalog-card-title">${{p.name}}</h3>
                  <p data-testid="catalog-card-price">€${{p.price.toFixed(2)}}</p>
                  <a href="/add/${{p.slug}}"><button data-testid="add-${{p.slug}}">Add to cart</button></a>
                </div>`).join('');
            return false;
          }}
        </script>
        """
        self._send_html(page("Catalog", body))

    def _add_to_cart(self, slug: str) -> None:
        session = self._session()
        if not session:
            self._redirect("/login")
            return
        if STORE.product(slug):
            session["cart"].append(slug)
        self._redirect("/cart")

    def _render_cart(self) -> None:
        session = self._session()
        if not session:
            self._redirect("/login")
            return
        items = [STORE.product(slug) for slug in session["cart"]]
        rows = "".join(
            f"<li class='card' data-testid='cart-item'>{item['name']} — €{item['price']:.2f}</li>"
            for item in items
            if item
        ) or "<p data-testid='cart-empty'>Your cart is empty.</p>"
        total = sum(item["price"] for item in items if item)
        self._send_html(
            page(
                "Cart",
                f"""
                <h1 data-testid="cart-heading">Your Cart</h1>
                <ul>{rows}</ul>
                <p>Total: <span data-testid="cart-total">€{total:.2f}</span></p>
                <p><a href="/catalog">Keep shopping</a>
                   <a href="/checkout"><button data-testid="go-checkout">Checkout</button></a></p>
                """,
            )
        )

    def _render_checkout(self) -> None:
        session = self._session()
        if not session:
            self._redirect("/login")
            return
        self._send_html(
            page(
                "Checkout",
                """
                <h1 data-testid="checkout-heading">Checkout</h1>
                <form method="post" action="/checkout" class="card">
                  <p><label>First name<br><input name="first" data-testid="checkout-first"></label></p>
                  <p><label>Last name<br><input name="last" data-testid="checkout-last"></label></p>
                  <p><label>Postal code<br><input name="zip" data-testid="checkout-zip"></label></p>
                  <button type="submit" data-testid="place-order">Place order</button>
                </form>
                """,
            )
        )

    def _handle_checkout(self) -> None:
        session = self._session()
        if not session:
            self._redirect("/login")
            return
        form = self._form()
        if not form.get("first") or not form.get("last"):
            self._redirect("/checkout")
            return
        slug = session["cart"][0] if session["cart"] else "travel-mug"
        order = STORE.place_order(slug, max(len(session["cart"]), 1))
        session["cart"] = []
        self._redirect(f"/order/{order['id']}")

    def _render_order(self, order_id: str) -> None:
        order = STORE.order(order_id)
        if not order:
            self._send_html(page("Not found", "<h1>Order not found</h1>"), status=404)
            return
        product = STORE.product(order["product"])
        self._send_html(
            page(
                "Order confirmed",
                f"""
                <h1>Thank you for your order!</h1>
                <div class="card">
                  <p>Order <strong data-testid="order-id">{order['id']}</strong>
                     (ref <span data-testid="order-ref">{order['ref']}</span>)</p>
                  <p>{order['quantity']} × {product['name'] if product else order['product']}</p>
                  <p>Status: <strong data-testid="order-status">{order['status']}</strong></p>
                </div>
                <p><a href="/catalog">Back to the catalog</a></p>
                """,
            )
        )
