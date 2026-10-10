#!/bin/sh
# Serving checks for the published site or a local preview.
# Usage: scripts/smoke.sh [base-url]
#   scripts/smoke.sh                                                    # the live site
#   scripts/smoke.sh http://localhost:4321/robotframework-essentials-web  # npm run preview
BASE="${1:-https://manykarim.github.io/robotframework-essentials-web}"
BASE="${BASE%/}"
fail=0

check() { # desc expected actual
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (expected '$2', got '$3')"; fail=1; fi
}
status() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1"; }
final_status() { curl -sL -o /dev/null -w '%{http_code}' "$BASE$1"; }
content_type() { curl -s -o /dev/null -w '%{content_type}' "$BASE$1" | cut -d';' -f1; }
title() { curl -sL "$BASE$1" | grep -o '<title>[^<]*' | head -1 | sed 's/<title>//'; }

check "landing /" 200 "$(status /)"
check "lesson /ch02-first-suite/syntax-rules/" 200 "$(status /ch02-first-suite/syntax-rules/)"
check "glossary /glossary/" 200 "$(status /glossary/)"

check "no trailing slash /glossary reaches the page" 200 "$(final_status /glossary)"
case "$(title /glossary)" in Glossary*) check "no trailing slash /glossary shows the glossary" yes yes ;;
    *) check "no trailing slash /glossary shows the glossary" "Glossary ..." "$(title /glossary)" ;; esac

check "unknown path is 404" 404 "$(status /does-not-exist/)"
case "$(title /does-not-exist/)" in 404*) check "404 body is the site 404 page" yes yes ;;
    *) check "404 body is the site 404 page" "404 ..." "$(title /does-not-exist/)" ;; esac

# GitHub Pages serves .zip as application/x-zip-compressed; local previews use application/zip.
for lab in ch09-web-flows rf-essentials-starter-kit; do
    check "lab $lab.zip status" 200 "$(status "/labs/$lab.zip")"
    type=$(content_type "/labs/$lab.zip")
    case "$type" in application/zip|application/x-zip-compressed) check "lab $lab.zip type is zip" yes yes ;;
        *) check "lab $lab.zip type is zip" "application/zip or application/x-zip-compressed" "$type" ;; esac
done

# Browser lab: a playground page, the runtime, the results service worker, no page for web labs.
RUNTIME=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$(dirname "$0")/../src/rfe/play/runtime.lock.json" | head -1)
check "browser lab /labs/ch03-keywords-imports/" 200 "$(status /labs/ch03-keywords-imports/)"
check "runtime rfe-runtime/$RUNTIME/pyodide.asm.wasm status" 200 "$(status "/rfe-runtime/$RUNTIME/pyodide.asm.wasm")"
check "runtime pyodide.asm.wasm type" application/wasm "$(content_type "/rfe-runtime/$RUNTIME/pyodide.asm.wasm")"
check "results worker labs/rfe-results-sw.js status" 200 "$(status /labs/rfe-results-sw.js)"
type=$(content_type /labs/rfe-results-sw.js)
case "$type" in text/javascript|application/javascript) check "results worker type is JavaScript" yes yes ;;
    *) check "results worker type is JavaScript" "text/javascript or application/javascript" "$type" ;; esac
check "no browser lab for web labs /labs/ch09-web-flows/" 404 "$(status /labs/ch09-web-flows/)"

[ "$fail" = 0 ] && echo "all checks ok" || echo "some checks FAILED"
exit "$fail"
