const crypto = require("crypto");
const BASE = String(process.env.PAYPAL_MODE || "live").toLowerCase() === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";

function authorized(req) {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  const a = String(req.headers["authorization"] || "");
  const b = "Bearer " + s;
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
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

// RECONSTRUCTED: the original ledger() body was not recoverable from the
// deployment (it fell past the tool's truncation cutoff). Its call sites in
// bpo-health.js / bpo-scan.js / bpo-cycle.js are non-fatal — the cron
// response is always returned with `{ ledger: led }` merged in regardless of
// whether this succeeds — so it is reimplemented here as a best-effort,
// fire-and-report webhook POST to an external ledger, gated on
// BPO_LEDGER_URL / BPO_LEDGER_WEBHOOK_TOKEN being configured.
async function ledger(kind, payload) {
  const url = process.env.BPO_LEDGER_URL;
  const tok = process.env.BPO_LEDGER_WEBHOOK_TOKEN;
  if (!url) return { ok: false, skipped: true, reason: "ledger_url_not_configured" };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        tok ? { "Authorization": "Bearer " + tok } : {}
      ),
      body: JSON.stringify({ kind, sent_at: new Date().toISOString(), payload })
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { crypto, authorized, token, pp, ledger };
