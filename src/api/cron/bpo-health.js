const { authorized, pp, ledger } = require("../_cronlib");

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const env = {
    paypal_client_id: !!process.env.PAYPAL_CLIENT_ID,
    paypal_client_secret: !!process.env.PAYPAL_CLIENT_SECRET,
    paypal_webhook_id: !!process.env.PAYPAL_WEBHOOK_ID,
    bpo_api_key: !!process.env.BPO_API_KEY,
    ledger_url: !!process.env.BPO_LEDGER_URL,
    ledger_token: !!process.env.BPO_LEDGER_WEBHOOK_TOKEN
  };
  let paypal;
  try {
    const r = await pp("/v2/invoicing/invoices?page_size=1");
    paypal = { ok: r.ok, status: r.status };
  } catch (e) {
    paypal = { ok: false, error: String((e && e.message) || e) };
  }
  const missing = Object.keys(env).filter(function (k) { return !env[k]; });
  const out = {
    ok: true,
    checked_at: new Date().toISOString(),
    mode: String(process.env.PAYPAL_MODE || "live").toLowerCase(),
    status: (missing.length || !paypal.ok) ? "degraded" : "healthy",
    missing_config: missing,
    paypal: paypal
  };
  const led = await ledger("health", out);
  return res.status(200).json(Object.assign({}, out, { ledger: led }));
};
