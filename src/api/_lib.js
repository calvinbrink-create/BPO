const crypto = require("crypto");

// ---------------------------------------------------------------------------
// RECOVERY NOTE (read this before touching capability logic)
//
// This file could only be partially recovered from the live deployment: the
// Vercel file-content API truncates large inline files, and _lib.js's
// original body ran past that cutoff. What survived verbatim was the
// `require("crypto")` line and 20 of the 32 SHA-256 -> deposit-slot entries
// from the original DEP_MAP literal (entry #21 was cut mid-hash and is
// unusable). None of the FIN_MAP (final-invoice capability) entries, and
// none of cors()/pp()/depSlot()/finalSlot()/no()/findInvoice()/details(),
// survived at all.
//
// Rather than fabricate the missing SHA-256 preimages (impossible) or leave
// gaps, this file:
//   1. Preserves the 20 recovered deposit-capability hashes exactly as
//      pulled from production, so any already-issued capability link for
//      slots 1-20 keeps working unchanged.
//   2. Replaces the "hardcode 32/16 SHA-256 hashes in source" design with a
//      stateless HMAC-derived capability scheme, keyed off CAP_SECRET, for
//      every slot that wasn't recoverable (deposit slots 21-32, and all of
//      final slots 1-16). See scripts/mint-capability.js to issue new links.
//
// This is the "correct" fix, not just a patch: capability tokens no longer
// need to live as literals in source control at all going forward.
//
// IMPORTANT: none of this has been redeployed to the live bpo-control-api
// project. Production is still running its original (working) code. Do not
// deploy this file until the reconstructed pieces below have been reviewed
// and, ideally, exercised against PayPal's sandbox.
// ---------------------------------------------------------------------------

const BASE = String(process.env.PAYPAL_MODE || "live").toLowerCase() === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";

// Recovered verbatim from the live deployment (20 of the original 32 entries;
// entries 21-32 were lost to truncation and cannot be reconstructed).
const DEP_MAP = {
  "025abc41679c0df18957af93640f4058ca2da22424acdac527a9d3773ba60d50": 1,
  "78b374e1c33459baecc155326a91cba3398ca4c41910e417c33b7b71930ba823": 2,
  "e69e92c33ec9f0e4fb784a747604c862df0df3bc09e9365b5472249967550d87": 3,
  "3306c1d3c0dc85b215febb7e0369f0fc5d459efe72dc0cc3c905962d6dd7c54c": 4,
  "aa0ed2648877e07d811a9c0b6492c6604ab9f972caa54bc296f37eb083b6f95f": 5,
  "4dc0218b522fca5bc6a8cba9317aa6e6fd0d1761e88c332f0ef84cf01535ff67": 6,
  "3f036c8f413f7b30ab909b58a980291ffd5a9b93be5610576459914a420d3ae8": 7,
  "55748df458ad47165efb0e9f1ac1f32ad7f177d3220da990efc4ca78e865e221": 8,
  "73552736e53e264ba272d9212b8d0ad1a73a2b2ff783386a3409e2fbe2a325e1": 9,
  "4cab195329bec81687f14aff302604e3d1ab01b561aed2b43f3e20974a39999d": 10,
  "85daa9d107b6699c61085691659cd6046dc13ca8a70bae75849aacb0445aaa19": 11,
  "26e762be1815ab0d8fd198e523c8cbd461acabac1f517626c1be8c5db10d80b7": 12,
  "0723e38e32f16bc93d2b2ad33bfe1fbfe6d18b1bab6807f1b9d14dbaa229b610": 13,
  "b7b8b975b4d47d735ac6bd43c559f162077859bea30fc2968217877acfdb4aac": 14,
  "2132fddc05f7740b3db83546191b3f3f3d7e098c7acdaa140427dc3a5dac3135": 15,
  "9e6803960e958c3074c5b3a02660905af9f736e81ed6eeaedab5b95623e83019": 16,
  "68d7b5b57aeb3643671450c3d5b43bfb6a07606905b385ef59308cd7c18dafd1": 17,
  "1616bef24d9314d00ba6433890adeb3ec625b0232b9dbca38a52e8ad106ac414": 18,
  "92bcee19dd6f842450f028b630e786adb00e4658f94bce52a73fde90d899aa68": 19,
  "641821a0ecfe54f52e0783f28b7d013c8410232270bc2f67750c9b87fa1a1708": 20
};

const DEPOSIT_SLOTS = 32;
const FINAL_SLOTS = 16;

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

// New capability format: HMAC-SHA256(CAP_SECRET, "<kind>:<slot>"), hex.
// Deterministic, verifiable with no stored table, rotatable by changing
// CAP_SECRET (which invalidates every previously-minted token at once).
function deriveToken(kind, slot) {
  const secret = process.env.CAP_SECRET || "";
  return crypto.createHmac("sha256", secret).update(kind + ":" + slot).digest("hex");
}

function slotFromToken(cap, kind, maxSlots, legacyMap) {
  const token = String(cap || "").trim();
  if (!token) return null;
  if (legacyMap) {
    const legacy = legacyMap[sha256Hex(token)];
    if (legacy) return legacy;
  }
  if (!process.env.CAP_SECRET) return null;
  for (let slot = 1; slot <= maxSlots; slot++) {
    if (safeEqual(token, deriveToken(kind, slot))) return slot;
  }
  return null;
}

function depSlot(cap) {
  return slotFromToken(cap, "deposit", DEPOSIT_SLOTS, DEP_MAP);
}

function finalSlot(cap) {
  // No FIN_MAP entries survived recovery at all -- final capability tokens
  // are exclusively the new HMAC scheme.
  return slotFromToken(cap, "final", FINAL_SLOTS, null);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// RECONSTRUCTED: exact invoice-number format used in production is unknown
// (this detail fell inside the truncated region). What's certain from every
// surviving call site is that no(kind, slot) must be a pure, deterministic
// function of (kind, slot) alone, since it's used both to create an invoice
// and, independently, to look that same invoice back up for idempotency.
function no(kind, slot) {
  const tag = kind === "final" ? "FIN" : "DEP";
  return "BPO-" + tag + "-" + String(slot).padStart(3, "0");
}

async function token() {
  const id = process.env.PAYPAL_CLIENT_ID, sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("paypal_creds_missing");
  const r = await fetch(BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(id + ":" + sec).toString("base64")
    },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error("paypal_auth_" + r.status);
  const j = await r.json();
  return j.access_token;
}

async function pp(path, opts) {
  const o = opts || {};
  const t = await token();
  const r = await fetch(BASE + path, {
    method: o.method || "GET",
    headers: Object.assign({ "Authorization": "Bearer " + t, "Content-Type": "application/json" }, o.headers || {}),
    body: o.body
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, body: body };
}

// RECONSTRUCTED: searches the same invoice-listing endpoint the cron jobs
// use elsewhere in this codebase (verbatim, recovered) for an invoice whose
// detail.invoice_number matches. Only scans the first page (100 invoices),
// matching the pagination depth used everywhere else in this codebase.
async function findInvoice(invNo) {
  const r = await pp("/v2/invoicing/invoices?page_size=100&total_required=true");
  if (!r.ok) return null;
  const items = (r.body && r.body.items) || [];
  for (const i of items) {
    const d = i.detail || {};
    if (d.invoice_number === invNo) return i;
  }
  return null;
}

async function details(id) {
  return pp("/v2/invoicing/invoices/" + encodeURIComponent(id));
}

module.exports = { crypto, cors, pp, depSlot, finalSlot, no, findInvoice, details, deriveToken };
