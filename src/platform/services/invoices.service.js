import { financialYear, formatINR, formatSequence } from '@hms/shared';
import { env } from '../../config/env.js';
import { AppError, errors } from '../../core/errors/index.js';
import { withTransaction } from '../../core/db/model.js';
import { platformAudit } from '../audit.js';
import { maybeCurrent } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { tenantRegistry } from '../../core/tenancy/tenant.registry.js';
import { STYLES, renderPdf } from '../../core/print/engine.js';
import { PlatformCounter, PlatformInvoice, Subscription } from '../models/platform.models.js';

export const invoiceDto = (i) => ({
  id: String(i._id),
  number: i.number,
  tenantId: String(i.tenantId),
  kind: i.kind,
  period: i.period,
  lines: i.lines,
  subtotal: i.subtotal,
  gst: i.gst,
  total: i.total,
  currency: i.currency,
  status: i.status,
  issuedAt: i.issuedAt,
  dueAt: i.dueAt,
  paidAt: i.paidAt,
  payment: i.payment,
  onPaid: i.onPaid,
  billTo: i.billTo,
});

async function nextNumber(date = new Date()) {
  const fy = financialYear(date);
  const c = await PlatformCounter.findOneAndUpdate(
    { _id: `PI:${fy}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return formatSequence('PI', fy, c.seq);
}

/** Platform GST invoice (18%, spec 3.5). Due on issue (renewals: on the period start); the lifecycle grace starts from there. */
export async function issueInvoice({ tenantId, kind, period, quote, onPaid, dueAt = new Date() }) {
  const tenant = await Tenant.findById(tenantId).lean();
  const [inv] = await PlatformInvoice.create([
    {
      number: await nextNumber(),
      tenantId,
      kind,
      period,
      lines: quote.lines,
      subtotal: quote.subtotal,
      gst: quote.gst,
      total: quote.total,
      dueAt,
      onPaid,
      billTo: {
        legalName: tenant.billing?.legalName ?? tenant.name,
        gstin: tenant.billing?.gstin,
        city: tenant.billing?.city,
      },
    },
  ]);
  return inv;
}

/** Tenant goes back to ACTIVE once nothing is overdue. */
export async function reactivateIfClear(tenantId) {
  const overdue = await PlatformInvoice.exists({
    tenantId,
    status: 'ISSUED',
    dueAt: { $lte: new Date() },
  });
  const tenant = await Tenant.findById(tenantId);
  const sub = await Subscription.findOne({ tenantId }).lean();
  if (
    !overdue &&
    sub?.converted &&
    ['PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'TRIAL'].includes(tenant.status)
  ) {
    tenant.set({ status: 'ACTIVE', statusChangedAt: new Date(), statusReason: 'Paid' });
    await tenant.save();
    await tenantRegistry.invalidate(tenant);
  }
}

/** Records a payment (gateway webhook, or a bank transfer entered by platform finance). */
export async function recordPayment(
  invoiceId,
  { provider, reference, amount, recordedBy },
  { applyOnPaid },
) {
  const inv = await PlatformInvoice.findById(invoiceId);
  if (!inv) throw errors.notFound('Invoice');
  if (inv.status === 'PAID') return invoiceDto(inv); // webhooks may repeat
  if (inv.status !== 'ISSUED') throw new AppError(409, 'INVALID_STATE', 'This invoice is void');
  if (amount !== inv.total)
    throw errors.validation([
      { path: 'amount', message: `The invoice total is ${formatINR(inv.total)}` },
    ]);
  // Claim ISSUED -> PAID atomically, so a webhook and a manual entry (or two webhook
  // deliveries) can never both switch on what the invoice pays for.
  const paid = await withTransaction(async () => {
    const claimed = await PlatformInvoice.findOneAndUpdate(
      { _id: inv._id, status: 'ISSUED' },
      {
        $set: {
          status: 'PAID',
          paidAt: new Date(),
          payment: { provider, reference, amount, recordedBy },
        },
      },
      { new: true },
    );
    if (!claimed) return null;
    await applyOnPaid(claimed);
    await platformAudit(claimed.tenantId, {
      action: 'UPDATE',
      entity: 'PlatformInvoice',
      entityId: claimed._id,
      summary: `Invoice ${claimed.number} paid (${provider} ${reference ?? ''})`,
      userName: maybeCurrent()?.userName ?? provider,
    });
    return claimed;
  });
  if (!paid) {
    const now = await PlatformInvoice.findById(inv._id);
    if (now?.status === 'PAID') return invoiceDto(now);
    throw new AppError(409, 'INVALID_STATE', 'This invoice is void');
  }
  await reactivateIfClear(paid.tenantId);
  return invoiceDto(paid);
}

export async function invoicePdf(inv) {
  const ist = (d) =>
    new Date(d).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  const half = Math.floor(inv.gst / 2);
  return renderPdf({
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    styles: STYLES,
    content: [
      { text: env.PLATFORM_LEGAL_NAME, style: 'hospital' },
      { text: env.PLATFORM_GSTIN ? `GSTIN ${env.PLATFORM_GSTIN}` : '', fontSize: 8 },
      { text: inv.status === 'PAID' ? 'TAX INVOICE (PAID)' : 'TAX INVOICE', style: 'title' },
      {
        columns: [
          {
            stack: [
              { text: 'Bill to', style: 'label' },
              { text: inv.billTo?.legalName ?? '', bold: true },
              inv.billTo?.gstin ? `GSTIN ${inv.billTo.gstin}` : '',
              inv.billTo?.city ?? '',
            ],
          },
          {
            stack: [
              { text: inv.number, bold: true },
              `Issued ${ist(inv.issuedAt)}`,
              inv.period?.start ? `Period ${ist(inv.period.start)} – ${ist(inv.period.end)}` : '',
            ],
            alignment: 'right',
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 40, 80, 80],
          body: [
            ['Description', 'Qty', 'Rate', 'Amount'].map((x) => ({ text: x, style: 'th' })),
            ...inv.lines.map((l) => [
              l.description,
              String(l.qty),
              formatINR(l.unitAmount),
              { text: formatINR(l.amount), alignment: 'right' },
            ]),
            [
              { text: 'Subtotal', colSpan: 3, alignment: 'right' },
              {},
              {},
              { text: formatINR(inv.subtotal), alignment: 'right' },
            ],
            [
              { text: 'CGST 9%', colSpan: 3, alignment: 'right' },
              {},
              {},
              { text: formatINR(half), alignment: 'right' },
            ],
            [
              { text: 'SGST 9%', colSpan: 3, alignment: 'right' },
              {},
              {},
              { text: formatINR(inv.gst - half), alignment: 'right' },
            ],
            [
              { text: 'Total', colSpan: 3, alignment: 'right', bold: true },
              {},
              {},
              { text: formatINR(inv.total), alignment: 'right', bold: true },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        text: 'SAC 998315 (IT infrastructure and hosting). The hospital may claim input tax credit on this invoice.',
        fontSize: 7,
        margin: [0, 12, 0, 0],
      },
    ],
  });
}
