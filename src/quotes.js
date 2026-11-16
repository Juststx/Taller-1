const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// The discount is a fixed amount applied before tax.
function quoteTotals(subtotal, discount, taxRate) {
  const sub = round2(subtotal);
  const disc = round2(Math.min(Number(discount) || 0, sub));
  const taxable = sub - disc;
  const tax = round2(taxable * (Number(taxRate) || 0) / 100);
  return { subtotal: sub, discount: disc, tax, total: round2(taxable + tax) };
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const KIND_LABELS = { repuesto: 'Repuesto', mano_obra: 'Mano de obra', otro: 'Otro' };

function renderQuoteEmail({ quote, settings, link, message }) {
  const money = (n) => `${escapeHtml(settings.currency)} ${Number(n).toFixed(2)}`;
  const rows = quote.items.map((i) => `
    <tr>
      <td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(i.description)}<br><small style="color:#777">${KIND_LABELS[i.kind] || ''}</small></td>
      <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${i.quantity}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${money(i.unit_price)}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${money(i.quantity * i.unit_price)}</td>
    </tr>`).join('');
  const vehicle = quote.vehicle
    ? `<p><strong>Vehículo:</strong> ${escapeHtml(quote.vehicle.make)} ${escapeHtml(quote.vehicle.model)} ${quote.vehicle.year || ''} — ${escapeHtml(quote.vehicle.plate)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;max-width:640px;margin:auto">
  <h2 style="margin-bottom:0">${escapeHtml(settings.workshop_name)}</h2>
  <p style="color:#666;margin-top:4px">${escapeHtml(settings.workshop_address)} ${escapeHtml(settings.workshop_phone)}</p>
  <p>Hola ${escapeHtml(quote.client.name)},</p>
  ${message ? `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
  <p>Te enviamos la cotización <strong>${escapeHtml(quote.number)}</strong>${quote.valid_until ? `, válida hasta el ${escapeHtml(quote.valid_until)}` : ''}.</p>
  ${vehicle}
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead><tr style="background:#f4f4f4"><th style="padding:6px;text-align:left">Descripción</th><th style="padding:6px;text-align:right">Cant.</th><th style="padding:6px;text-align:right">Precio</th><th style="padding:6px;text-align:right">Importe</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="text-align:right">Subtotal: ${money(quote.subtotal)}<br>
  ${quote.discount ? `Descuento: -${money(quote.discount)}<br>` : ''}
  ${quote.tax_rate ? `Impuesto (${quote.tax_rate}%): ${money(quote.tax)}<br>` : ''}
  <strong style="font-size:18px">Total: ${money(quote.total)}</strong></p>
  ${quote.notes ? `<p><strong>Observaciones:</strong><br>${escapeHtml(quote.notes).replace(/\n/g, '<br>')}</p>` : ''}
  <p style="text-align:center;margin:28px 0"><a href="${escapeHtml(link)}" style="background:#1f6feb;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Ver y aprobar la cotización</a></p>
  <p style="color:#777;font-size:13px">${escapeHtml(settings.quote_footer)}</p>
</body></html>`;
}

module.exports = { round2, quoteTotals, renderQuoteEmail, escapeHtml };
