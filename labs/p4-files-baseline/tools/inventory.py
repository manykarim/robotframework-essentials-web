#!/usr/bin/env python3
"""Inventory — a tiny CLI over the RF Demo Shop catalog.

Standard-library only (argparse + ElementTree), so Process lessons can run it
offline. Every mode has a meaningful exit code, which is the point the Process
library lessons build on:

    0  success
    1  a check found a problem (e.g. stock below the threshold)
    2  a usage or input error (bad path, unparseable catalog)

Modes:

    list                       print each product name, one per line
    count                      print how many products are in the catalog
    check --min-stock N        pass only if every product has stock >= N;
                               offending products go to stderr, exit 1
    fail                       always exit 1 with a message on stderr
                               (for practising failure handling)

The catalog path defaults to ``sample_data/catalog.xml`` relative to the
current directory; override it with ``--catalog PATH``.
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

EXIT_OK = 0
EXIT_CHECK_FAILED = 1
EXIT_USAGE = 2


def load_products(catalog: Path) -> list[dict]:
    """Parse the catalog into a list of {name, slug, stock} dicts."""
    if not catalog.exists():
        raise FileNotFoundError(f"catalog not found: {catalog}")
    root = ET.parse(catalog).getroot()
    products = []
    for element in root.findall("product"):
        name = element.findtext("name", default="").strip()
        products.append(
            {
                "name": name,
                "slug": element.get("slug", ""),
                "stock": int(element.get("stock", "0")),
            }
        )
    return products


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="inventory", description=__doc__)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("sample_data/catalog.xml"),
        help="path to the catalog XML (default: sample_data/catalog.xml)",
    )
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("list", help="print each product name")
    sub.add_parser("count", help="print the product count")
    check = sub.add_parser("check", help="fail if any product is below --min-stock")
    check.add_argument("--min-stock", type=int, default=1)
    sub.add_parser("fail", help="always fail (exit 1)")

    args = parser.parse_args(argv)

    if args.mode == "fail":
        print("inventory: deliberate failure", file=sys.stderr)
        return EXIT_CHECK_FAILED

    try:
        products = load_products(args.catalog)
    except (FileNotFoundError, ET.ParseError) as exc:
        print(f"inventory: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if args.mode == "list":
        for product in products:
            print(product["name"])
        return EXIT_OK

    if args.mode == "count":
        print(len(products))
        return EXIT_OK

    if args.mode == "check":
        low = [p for p in products if p["stock"] < args.min_stock]
        for product in low:
            print(
                f"low stock: {product['slug']} has {product['stock']} "
                f"(< {args.min_stock})",
                file=sys.stderr,
            )
        if low:
            return EXIT_CHECK_FAILED
        print(f"all {len(products)} products stocked at >= {args.min_stock}")
        return EXIT_OK

    return EXIT_USAGE  # unreachable: subparser is required


if __name__ == "__main__":
    raise SystemExit(main())
