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

for lab in ch09-web-flows rf-essentials-starter-kit; do
    check "lab $lab.zip status" 200 "$(status "/labs/$lab.zip")"
    check "lab $lab.zip type" application/zip "$(content_type "/labs/$lab.zip")"
done

[ "$fail" = 0 ] && echo "all checks ok" || echo "some checks FAILED"
exit "$fail"
