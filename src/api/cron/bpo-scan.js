const { authorized, pp, ledger } = require("../_cronlib");

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const r = await pp("/v2/invoicing/invoices?page_size=100&total_required=true");
    if (!r.ok) return res.status(502).json({ ok: false, error: "paypal_list_failed", status: r.status });
    const items = (r.body && r.body.items) || [];
    const by = {};
    const open = [];
    for (const i of items) {
      const st = String(i.status || "UNKNOWN").toUpperCase();
      by[st] = (by[st] || 0) + 1;
      if (st === "SENT" || st === "UNPAID" || st === "PARTIALLY_PAID") {
        const d = i.detail || {};
        open.push({
          id: i.id,
          number: d.invoice_number || null,
          status: st,
          due_date: (d.payment_term && d.payment_term.due_date) || null,
          amount: (i.amount && i.amount.value) || null,
          currency: (i.amount && i.amount.currency_code) || null
        });
      }
    }
    const out = {
      ok: true,
      scanned_at: new Date().toISOString(),
      total: items.length,
      by_status: by,
      open_count: open.length,
      open: open.slice(0, 50)
    };
    const led = await ledger("scan", out);
    return res.status(200).json(Object.assign({}, out, { ledger: led }));
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
