# BPO Control API

PayPal-backed invoicing control plane: capability-gated deposit/final invoice
creation and status lookup, PayPal webhook verification, and three daily
cron jobs (health check, invoice scan, draft/overdue cycle report).

Live production deployment: `bpo-control-api` on Vercel (`bpo-control-api.vercel.app`,
Vercel Auth protected). A read-only status page for that project is published
separately at **https://bpo-control-dashboard.vercel.app** (its own project,
does not call or modify this API) — that same project now also hosts the
public inquiry form at `/inquire.html`.

## Getting customers

See [`demand-gen/README.md`](demand-gen/README.md) for how this system finds
people who actually want BPO help — an inbound landing page, real UK
procurement tenders, and public posts from people explicitly asking — and
why an invoice only ever fires from an explicit "accept" click, never from
inferred interest.

## How this repo came to exist

The `calvinbrink-create/BPO` GitHub repo had zero commits — the working code
only existed baked into the live Vercel deployment, deployed directly (not
git-linked; `source: "redeploy"`). Every file below was pulled back out of
that production deployment's build output and reconstructed into a real,
reviewable, git-tracked codebase.

**⚠️ Nothing in this repo has been redeployed to the live `bpo-control-api`
project.** Production keeps running its original, working code untouched.
This repo is meant for review first — see "What's exact vs. reconstructed"
below before deploying any of it.

## What's exact vs. reconstructed

The Vercel API used to recover source truncates large inline files. Files
under the truncation limit came back byte-for-byte; larger ones were cut off
mid-file. Recovered code is used verbatim wherever it exists; only the
missing tail of a file is rebuilt, and every reconstructed block is marked
with a comment in the source explaining exactly what's inferred and why.

| File | Status |
|---|---|
| `vercel.json` | Exact |
| `src/api/health.js` | Exact |
| `src/api/paypal-create-invoice.js`, `src/api/bpo-invoice-bridge.js` | Exact (both are the same deprecated `410` stub in production) |
| `src/api/invoice-status.js`, `src/api/final-invoice-status.js` | Exact |
| `src/api/paypal-webhook.js` | Exact |
| `src/api/cron/bpo-health.js`, `src/api/cron/bpo-scan.js` | Exact |
| `src/api/_cronlib.js` | Exact except `ledger()`, whose body fell past the truncation cutoff — reimplemented as a best-effort webhook POST, gated on `BPO_LEDGER_URL` |
| `src/api/cron/bpo-cycle.js` | Exact through the drafts/overdue collection loop; the final response shape is reconstructed to match the established pattern in the two files above |
| `src/api/_lib.js` | Mostly reconstructed. `require("crypto")` and 20 of 32 deposit-capability SHA-256 hashes recovered verbatim; everything else (`cors`, `pp`, `depSlot`/`finalSlot`, `no`, `findInvoice`, `details`) rebuilt from the exact contract every consumer file proves. See in-file note. |
| `src/api/auto-invoice.js`, `src/api/auto-final-invoice.js` | The capability check and the idempotent-existing-invoice branch (including the exact `/send` call) are recovered verbatim. The invoice-creation payload itself (the part that builds and POSTs a new PayPal invoice draft) is reconstructed from the PayPal Invoicing v2 API and has **not** been tested against PayPal — run it against `PAYPAL_MODE=sandbox` before any live use. |

## Capability tokens

Production gated deposit/final invoice links with a hardcoded map of
`SHA-256(token) -> slot number` (32 deposit slots, 16 final slots). Only 20
of the 32 deposit hashes were recoverable; none of the final ones were. Two
things follow from that:

1. The 20 recovered deposit hashes are preserved exactly in `src/api/_lib.js`
   so any already-issued link for those slots keeps working if this code is
   ever deployed.
2. Everything else now uses a new, stateless scheme instead of a literal
   hash table: `token = HMAC-SHA256(CAP_SECRET, "<kind>:<slot>")`. Mint one
   with:

   ```
   CAP_SECRET=... node scripts/mint-capability.js deposit 21
   CAP_SECRET=... node scripts/mint-capability.js final 1
   ```

   Rotating `CAP_SECRET` invalidates every token minted under the old value.

## Environment

See `.env.example`. All of `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
`PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID`, `CRON_SECRET`, `BPO_API_KEY`,
`BUSINESS_EMAIL`, and `BPO_LEDGER_WEBHOOK_TOKEN` are already configured in
the live Vercel project (values are write-only via the API and were not, and
could not be, read by this recovery).

## Before deploying any of this

1. Set `CAP_SECRET` in Vercel and mint fresh capability tokens for any
   client-facing link outside the 20 recovered deposit slots.
2. Exercise `auto-invoice` / `auto-final-invoice` against
   `PAYPAL_MODE=sandbox` end to end (create, send, status lookup) before
   pointing them at live PayPal.
3. Confirm the final-invoice amount rule in `auto-final-invoice.js`
   (`amount`, else `contract - deposit`, else `contract`) matches actual
   business rules — it's a reasonable inference from the recovered query
   parameters, not a recovered fact.
