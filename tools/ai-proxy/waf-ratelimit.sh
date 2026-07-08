#!/usr/bin/env bash
# Global WAF rate-limit for the AI face proxy — an account-level ceiling that
# sits IN FRONT of the Worker's per-IP binding. The binding stops one client
# draining your Gemini quota; this rule caps TOTAL traffic to the proxy hostname
# so a distributed flood (many IPs) can't run up an unbounded bill.
#
# WAF rules can't be set from wrangler.toml — they're a zone/account API object.
# This uses the Cloudflare API. You need:
#   CF_API_TOKEN  — token with "Account WAF: Edit" + "Zone WAF: Edit" (or Global)
#   CF_ZONE_ID    — the zone that serves your proxy hostname
# For a *.workers.dev Worker there is no custom zone; to use a WAF rule you must
# put the Worker on a route under a domain you own (recommended for scale), e.g.
#   ai.bhatball.com/*  → bhatball-ai-proxy
# Then set CF_ZONE_ID to that domain's zone and HOSTNAME below.
#
# Tunables:
HOSTNAME="${HOSTNAME:-ai.bhatball.com}"   # the proxy hostname this rule guards
LIMIT="${LIMIT:-300}"                     # max requests...
PERIOD="${PERIOD:-60}"                     # ...per this many seconds (10/60/...)
MITIGATION_TIMEOUT="${MITIGATION_TIMEOUT:-60}"  # block duration once tripped
set -euo pipefail

: "${CF_API_TOKEN:?set CF_API_TOKEN (Zone WAF: Edit)}"
: "${CF_ZONE_ID:?set CF_ZONE_ID for the proxy's domain}"

api="https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint"

echo "Setting WAF rate-limit: ${LIMIT} req / ${PERIOD}s to ${HOSTNAME} (block ${MITIGATION_TIMEOUT}s)…"
curl -sS -X PUT "$api" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<JSON | python3 -c 'import sys,json; d=json.load(sys.stdin); print("✓ success" if d.get("success") else json.dumps(d["errors"], indent=2))'
{
  "rules": [
    {
      "action": "block",
      "description": "BhatBall AI face proxy — global cap",
      "expression": "(http.host eq \"${HOSTNAME}\" and http.request.method eq \"POST\")",
      "ratelimit": {
        "characteristics": ["cf.colo.id", "ip.src"],
        "period": ${PERIOD},
        "requests_per_period": ${LIMIT},
        "mitigation_timeout": ${MITIGATION_TIMEOUT}
      }
    }
  ]
}
JSON
