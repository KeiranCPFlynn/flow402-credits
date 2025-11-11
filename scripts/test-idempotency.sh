#!/usr/bin/env bash
set -euo pipefail

: "${FLOW402_GATEWAY:=http://localhost:3000/api/gateway/deduct}"
: "${FLOW402_TOPUP:=http://localhost:3000/api/topup/mock}"
: "${FLOW402_VENDOR_KEY:=demo}"
: "${FLOW402_SIGNING_SECRET:=demo-signing-secret}"
: "${FLOW402_USER_ID:=9c0383a1-0887-4c0f-98ca-cb71ffc4e76c}"

sign_deduct() {
  local body="$1"
  local ts body_sha sig
  ts=$(date +%s)
  body_sha=$(node -e "const crypto=require('node:crypto');process.stdout.write(crypto.createHash('sha256').update(process.argv[1]).digest('hex'))" "$body")
  sig=$(node -e "const crypto=require('node:crypto');const body=process.argv[1];const secret=process.argv[2];const ts=process.argv[3];process.stdout.write(crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex'))" "$body" "$FLOW402_SIGNING_SECRET" "$ts")
  printf '%s|%s|t=%s,v1=%s\n' "$ts" "$body_sha" "$ts" "$sig"
}

make_body() {
  local ref="$1" amount="$2"
  cat <<JSON
{"userId":"$FLOW402_USER_ID","ref":"$ref","amount_credits":$amount}
JSON
}

curl_deduct() {
  local body_sha sig_header idem body label
  label="$1"; shift
  body_sha="$1"; shift
  sig_header="$1"; shift
  idem="$1"; shift
  body="$1"
  echo -e "\n== $label =="
  curl -i "$FLOW402_GATEWAY" \
    -H "Content-Type: application/json" \
    -H "x-f402-key: $FLOW402_VENDOR_KEY" \
    -H "x-f402-body-sha: $body_sha" \
    -H "x-f402-sig: $sig_header" \
    -H "Idempotency-Key: $idem" \
    --data "$body"
}

main() {
  local ref amount idem body ts body_sha sig_header
  ref="cli_ref_$(date +%s)"
  amount=5
  idem="$ref"
  body=$(make_body "$ref" "$amount")
  IFS='|' read -r ts body_sha sig_header < <(sign_deduct "$body")
  curl_deduct "primary charge" "$body_sha" "$sig_header" "$idem" "$body"
  curl_deduct "replay" "$body_sha" "$sig_header" "$idem" "$body"

  local conflict_body conflict_sha conflict_sig
  conflict_body=$(make_body "${ref}_mutate" 50)
  IFS='|' read -r _ conflict_sha conflict_sig < <(sign_deduct "$conflict_body")
  curl_deduct "conflict" "$conflict_sha" "$conflict_sig" "$idem" "$conflict_body"
}

main "$@"
