// Printable receipt HTML builder — extracted from Receipt.jsx so the
// component stays presentational and this stays unit-testable.

const ts = (iso) => (iso ? new Date(iso).toLocaleString("en-HK", { timeZone: "Asia/Hong_Kong" }) : "");

export function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function lineRows(order) {
  return (order.lines || [])
    .map((l) => {
      const mods = l.modifiers?.length
        ? `<br><span class="s">+ ${escapeHtml(l.modifiers.join(", "))}</span>`
        : "";
      return `<tr><td>${l.qty}× ${escapeHtml(l.name)}${mods}</td><td class="r">HK$ ${(l.price * l.qty).toFixed(2)}</td></tr>`;
    })
    .join("");
}

function splitRows(order) {
  if (order.payment?.method !== "split" || !order.payment.splits) return "";
  return order.payment.splits
    .map((s) => `<tr><td class="s">&nbsp;· ${s.method}</td><td class="r s">HK$ ${(s.amount || 0).toFixed(2)}</td></tr>`)
    .join("");
}

function paymentSection(order) {
  if (!order.payment) return "";
  const tipRow = order.payment.tip > 0
    ? `<tr><td>Tip</td><td class="r">HK$ ${order.payment.tip.toFixed(2)}</td></tr>` : "";
  const changeRow = order.payment.change > 0
    ? `<tr><td>Change</td><td class="r">HK$ ${order.payment.change.toFixed(2)}</td></tr>` : "";
  return `<hr/><table>
<tr><td>Paid (${order.payment.method})</td><td class="r">HK$ ${(order.payment.amount || 0).toFixed(2)}</td></tr>
${splitRows(order)}
${tipRow}
${changeRow}
</table>`;
}

export function receiptHtml(order, memberName) {
  const memberRow = memberName ? `<div class="s">Member: ${escapeHtml(memberName)}</div>` : "";
  const discountRow = order.discount > 0
    ? `<tr><td>Discount</td><td class="r">- HK$ ${order.discount.toFixed(2)}</td></tr>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Receipt</title>
<style>body{font-family:'JetBrains Mono',monospace;font-size:12px;width:280px;margin:0;padding:12px;color:#000}
h1{font-size:20px;text-align:center;margin:0;letter-spacing:.15em}
h2{font-size:10px;text-align:center;margin:0 0 10px;letter-spacing:.25em;color:#666}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
.r{text-align:right}
.s{color:#666;font-size:10px}
.big{font-size:15px;font-weight:900}
table{width:100%;border-collapse:collapse}
td{padding:2px 0;vertical-align:top}
.center{text-align:center}
@page{size:auto;margin:4mm}
</style></head><body>
<h1>HK · BAR</h1><h2>ADVANCED POS · HONG KONG</h2>
<div class="s">Receipt #${(order.id || "").slice(-6).toUpperCase()}</div>
<div class="s">${ts(order.closed_at || order.opened_at)}</div>
<div class="s">Type: ${order.order_type} · Guests: ${order.guests}</div>
${memberRow}
<hr/>
<table>${lineRows(order)}</table>
<hr/>
<table>
<tr><td>Subtotal</td><td class="r">HK$ ${(order.subtotal || 0).toFixed(2)}</td></tr>
${discountRow}
<tr><td>Service (${order.service_charge_pct || 10}%)</td><td class="r">HK$ ${(order.service_charge || 0).toFixed(2)}</td></tr>
</table>
<hr/>
<table><tr><td class="big">TOTAL</td><td class="big r">HK$ ${(order.total || 0).toFixed(2)}</td></tr></table>
${paymentSection(order)}
<hr/>
<div class="center s">THANK YOU · SEE YOU AGAIN</div>
</body></html>`;
}
