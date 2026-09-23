#!/usr/bin/env bash
# Wait for Resend to finish verifying the sending domain, then complete the
# mail cutover: MAIL_FROM -> noreply@<domain>, one real production OTP send,
# and a Bark notification. Exits 1 if verification does not conclude.
#
# Required env (never hardcode these):
#   RESEND_API_KEY   Resend API key
#   RESEND_DOMAIN_ID Resend domain id (from the Domains page or POST /domains)
#   BARK_KEY         Bark device key (optional; skips the push if unset)
#   TEST_EMAIL       inbox for the production OTP send (optional)
set -uo pipefail

: "${RESEND_API_KEY:?RESEND_API_KEY is required}"
: "${RESEND_DOMAIN_ID:?RESEND_DOMAIN_ID is required}"
DOM="$RESEND_DOMAIN_ID"

for i in $(seq 1 40); do
  ST=$(curl -s --max-time 15 "https://api.resend.com/domains/$DOM" \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")
  echo "[$(date +%H:%M:%S)] attempt $i: $ST"
  if [ "$ST" = "verified" ]; then
    printf '鸭先知 <noreply@weichao.ren>' | npx wrangler secret put MAIL_FROM --config worker/wrangler.toml --env production
    sleep 5
    DELIVERY=""
    if [ -n "${TEST_EMAIL:-}" ]; then
      DELIVERY=$(curl -s --max-time 20 -X POST "https://quack.weichao.ren/api/v1/auth/request-code" \
        -H "content-type: application/json" \
        -d "{\"email\":\"$TEST_EMAIL\"}" \
        | python3 -c "import json,sys; print(json.load(sys.stdin).get('delivery',''))")
      echo "production OTP delivery: ${DELIVERY}"
    fi
    if [ -n "${BARK_KEY:-}" ]; then
      curl -s --max-time 20 -X POST "${BARK_BASE_URL:-https://api.day.app}/$BARK_KEY" \
        -H "Content-Type: application/json; charset=utf-8" \
        -d "{\"title\":\"鸭先知：邮件域名已验证\",\"body\":\"域名验证通过，MAIL_FROM 已切换，生产验证码投递 ${DELIVERY:-skipped}。\",\"group\":\"aquasight\"}" > /dev/null
    fi
    echo "DONE"
    exit 0
  fi
  curl -s --max-time 15 -X POST "https://api.resend.com/domains/$DOM/verify" \
    -H "Authorization: Bearer $RESEND_API_KEY" > /dev/null
  sleep 90
done
echo "TIMEOUT: still not verified after 60 minutes"
exit 1
