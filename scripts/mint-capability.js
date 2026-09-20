#!/usr/bin/env node
// Mint a capability token for the new HMAC-based scheme in src/api/_lib.js.
//
// Usage:
//   CAP_SECRET=... node scripts/mint-capability.js deposit 21
//   CAP_SECRET=... node scripts/mint-capability.js final 1
//
// Prints the token to give the client, e.g. as:
//   https://<host>/api/auto-invoice?deal_id=...&email=...&cap=<token>
//
// Rotating CAP_SECRET invalidates every token minted under the old one.

const crypto = require("crypto");

const [kind, slotArg] = process.argv.slice(2);
const slot = Number(slotArg);
const secret = process.env.CAP_SECRET;

if (!secret) {
  console.error("Set CAP_SECRET in the environment first.");
  process.exit(1);
}
if (kind !== "deposit" && kind !== "final") {
  console.error("First argument must be \"deposit\" or \"final\".");
  process.exit(1);
}
if (!Number.isInteger(slot) || slot < 1) {
  console.error("Second argument must be a positive integer slot number.");
  process.exit(1);
}
const max = kind === "deposit" ? 32 : 16;
if (slot > max) {
  console.error(kind + " supports slots 1-" + max + ".");
  process.exit(1);
}

const token = crypto.createHmac("sha256", secret).update(kind + ":" + slot).digest("hex");
console.log(token);
