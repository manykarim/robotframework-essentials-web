"""RF Demo Shop — the shop's data, deterministic by design.

Everything lives in memory; ``reset()`` restores the canonical seed. The
identities below are the training identities the whole course relies on —
change them and the checks (rightly) complain.
"""

from __future__ import annotations

import secrets

USERS = {
    "primary_user": {"password": "learning-password", "blocked": False},
    "reviewer_user": {"password": "learning-password", "blocked": False},
    "blocked_user": {"password": "learning-password", "blocked": True},
}

_SEED_PRODUCTS = [
    {"slug": "trail-backpack", "name": "Trail Backpack", "price": 79.00, "stock": 12},
    {"slug": "desk-lamp", "name": "Desk Lamp", "price": 34.50, "stock": 8},
    {"slug": "travel-mug", "name": "Travel Mug", "price": 19.90, "stock": 24},
    {"slug": "notebook-set", "name": "Notebook Set", "price": 12.00, "stock": 30},
]

_SEED_ORDERS = [
    {
        "id": "order-1042",
        "ref": "TRN-0042",
        "product": "travel-mug",
        "quantity": 2,
        "status": "complete",
    },
]


class Store:
    """Mutable shop state with a canonical reset."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.products = [dict(p) for p in _SEED_PRODUCTS]
        self.orders = [dict(o) for o in _SEED_ORDERS]
        self.sessions: dict[str, dict] = {}
        self._order_counter = 1042

    # ── sessions ────────────────────────────────────────────────────────

    def sign_in(self, username: str, password: str) -> tuple[str | None, str | None]:
        """Return (session_token, error_code)."""
        user = USERS.get(username)
        if user is None or user["password"] != password or not username:
            return None, "invalid"
        if user["blocked"]:
            return None, "blocked"
        token = secrets.token_hex(16)
        self.sessions[token] = {"user": username, "cart": []}
        return token, None

    def session(self, token: str | None) -> dict | None:
        return self.sessions.get(token) if token else None

    # ── catalog ─────────────────────────────────────────────────────────

    def product(self, slug: str) -> dict | None:
        for item in self.products:
            if item["slug"] == slug:
                return item
        return None

    def search(self, query: str) -> list[dict]:
        needle = query.strip().lower()
        if not needle:
            return list(self.products)
        return [p for p in self.products if needle in p["name"].lower()]

    # ── orders ──────────────────────────────────────────────────────────

    def place_order(self, product_slug: str, quantity: int) -> dict:
        self._order_counter += 1
        order = {
            "id": f"order-{self._order_counter}",
            "ref": f"TRN-{self._order_counter - 1000:04d}",
            "product": product_slug,
            "quantity": quantity,
            "status": "complete",
        }
        self.orders.append(order)
        return order

    def order(self, order_id: str) -> dict | None:
        for item in self.orders:
            if item["id"] == order_id:
                return item
        return None


STORE = Store()
