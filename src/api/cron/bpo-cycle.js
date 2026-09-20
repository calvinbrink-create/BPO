const { authorized, pp, ledger } = require("../_cronlib");

function daysPast(d) {
  const t = new Date(d).getTime();
  if (!t) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const r = await pp("/v2/invoicing/invoices?page_size=100&total_required=true");
    if (!r.ok) return res.status(502).json({ ok: false, error: "paypal_list_failed", status: r.status });
    const items = (r.body && r.body.items) || [];
    const drafts = [];
    const overdue = [];
    for (const i of items) {
      const st = String(i.status || "").toUpperCase();
      const d = i.detail || {};
      if (st === "DRAFT") {
        drafts.push({ id: i.id, number: d.invoice_number || null, invoice_date: d.invoice_date || null });
      }
      if (st === "SENT" || st === "UNPAID" || st === "PARTIALLY_PAID") {
        const due = d.payment_term && d.payment_term.due_date;
        if (due && daysPast(due) > 0) {
          overdue.push({
            id: i.id,
            number: d.invoice_number || null,
            status: st,
            days_overdue: daysPast(due),
            amount: (i.amount && i.amount.value) || null
          });
        }
      }
    }
    const out = {
      ok: true,
      ran_at: new Date().toISOString(),
      mode: "report_only",
      invoices_sent: 0,
      unsent_drafts: drafts.length,
      drafts: drafts.slice(0, 50),
      // RECONSTRUCTED TAIL: the original response past this point fell past the
      // tool's truncation cutoff. This mirrors the exact field-naming
      // convention already established (verbatim, recovered) in bpo-scan.js
      // for the same open/overdue-invoice shape, kept in "report_only" mode
      // consistent with invoices_sent: 0 above — this cron reports, it does
      // not autonomously send or cancel invoices.
      overdue_count: overdue.length,
      overdue: overdue.slice(0, 50)
    };
    const led = await ledger("cycle", out);
    return res.status(200).json(Object.assign({}, out, { ledger: led }));
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
