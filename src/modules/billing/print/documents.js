import { formatINR } from '@hms/shared';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { current } from '../../../core/tenancy/context.js';
import { STYLES, THERMAL_80, barcode, letterhead, renderPdf } from '../../../core/print/engine.js';
import { HospitalSettings } from '../../setup/index.js';
import { billingSettings } from '../services/settings.service.js';

const inr = (p) => formatINR(p);
const ist = (d) =>
  new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Indian-style amount in words: "One Thousand Nine Rupees only". */
export function rupeesInWords(paise) {
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];
  const two = (n) =>
    n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
  const three = (n) =>
    [n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : '', two(n % 100)]
      .filter(Boolean)
      .join(' ');
  let r = Math.floor(paise / 100);
  if (r === 0) return 'Zero Rupees only';
  const parts = [];
  for (const [size, label] of [
    [1_00_00_000, 'Crore'],
    [1_00_000, 'Lakh'],
    [1000, 'Thousand'],
  ]) {
    if (r >= size) {
      parts.push(`${three(Math.floor(r / size))} ${label}`);
      r %= size;
    }
  }
  if (r) parts.push(three(r));
  const p = paise % 100;
  return `${parts.join(' ')} Rupees${p ? ` and ${two(p)} Paise` : ''} only`;
}

async function header(branchId) {
  const [settings, branch] = await Promise.all([
    HospitalSettings.findOne({ key: 'hospital' }).lean(),
    Branch.findById(branchId).lean(),
  ]);
  return {
    name: settings?.displayName ?? current().tenant?.name ?? 'Hospital',
    address: branch?.address,
    gstin: branch?.gstin,
    phone: branch?.phone,
    branchName: branch?.name,
    note: settings?.print?.headerNote,
    footer: settings?.print?.footerNote,
  };
}

/** A4 bill (rule R18: reprints say DUPLICATE). */
export async function billPdf(bill, { duplicate }) {
  const h = await header(bill.branchId);
  const settings = await billingSettings();
  const rows = bill.lines.map((l, i) => [
    String(i + 1),
    { text: `${l.name}\n`, fontSize: 9 },
    l.hsnSac ?? '',
    String(l.qty),
    inr(l.unitPrice),
    l.discount ? inr(l.discount) : '',
    l.taxRate ? `${l.taxRate}%` : 'Exempt',
    { text: inr(l.net), alignment: 'right' },
  ]);
  const t = bill.totals;
  const sumRow = (label, value, bold) => [
    { text: label, colSpan: 7, alignment: 'right', bold },
    {},
    {},
    {},
    {},
    {},
    {},
    { text: value, alignment: 'right', bold },
  ];
  return renderPdf(
    {
      pageSize: settings.billPaper ?? 'A4',
      pageMargins: [36, 36, 36, 48],
      styles: STYLES,
      footer: (page, pages) => ({
        text: [settings.billFooter || h.footer, `Page ${page} of ${pages}`]
          .filter(Boolean)
          .join('  ·  '),
        alignment: 'center',
        fontSize: 7,
        color: '#5B6878',
      }),
      content: [
        letterhead(h),
        {
          columns: [
            { text: bill.status === 'CANCELLED' ? 'BILL (CANCELLED)' : 'BILL', style: 'title' },
            { image: await barcode(bill.billNo), width: 140, alignment: 'right' },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'Patient', style: 'label' },
                {
                  text: `${bill.patient.name}  (${bill.patient.age}, ${bill.patient.gender})`,
                  bold: true,
                },
                `UHID ${bill.patient.uhid}   Mobile ${bill.patient.mobile}`,
              ],
            },
            {
              stack: [
                { text: 'Bill', style: 'label' },
                { text: bill.billNo, bold: true },
                ist(bill.finalizedAt ?? bill.createdAt),
                `Price list ${bill.payer?.priceListCode ?? ''}`,
              ],
              alignment: 'right',
            },
          ],
          margin: [0, 0, 0, 10],
        },
        {
          table: {
            headerRows: 1,
            widths: [16, '*', 40, 22, 52, 44, 36, 60],
            body: [
              ['#', 'Service', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'GST', 'Amount'].map((x) => ({
                text: x,
                style: 'th',
              })),
              ...rows,
              sumRow('Gross', inr(t.gross)),
              ...(t.discount ? [sumRow('Discount', `- ${inr(t.discount)}`)] : []),
              ...(t.tax ? [sumRow('CGST', inr(t.cgst)), sumRow('SGST', inr(t.sgst))] : []),
              ...(t.roundOff ? [sumRow('Round off', inr(t.roundOff))] : []),
              sumRow('Total', inr(t.total), true),
              sumRow('Paid', inr(t.paid)),
              sumRow('Balance', inr(t.balance), true),
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { text: rupeesInWords(t.total), italics: true, margin: [0, 8, 0, 0] },
        ...(bill.cancellation?.creditNoteNo
          ? [
              {
                text: `Cancelled: ${bill.cancellation.reason}. Credit note ${bill.cancellation.creditNoteNo}.`,
                color: '#A3201A',
                margin: [0, 6, 0, 0],
              },
            ]
          : []),
        {
          text: 'Health care services by a clinical establishment are exempt from GST unless shown above.',
          fontSize: 7,
          color: '#5B6878',
          margin: [0, 16, 0, 0],
        },
        {
          columns: [
            { text: '' },
            { text: 'Authorised signatory', alignment: 'right', margin: [0, 36, 0, 0] },
          ],
        },
      ],
    },
    { duplicate },
  );
}

/** Receipt on an 80 mm thermal roll, or A5 (billing settings). */
export async function receiptPdf(payment, { duplicate }) {
  const h = await header(payment.branchId);
  const settings = await billingSettings();
  const line = (a, b, bold) => ({
    columns: [
      { text: a, bold },
      { text: b, alignment: 'right', bold },
    ],
    fontSize: 8,
  });
  return renderPdf(
    {
      pageSize: settings.receiptPaper === 'A5' ? 'A5' : THERMAL_80,
      pageMargins: settings.receiptPaper === 'A5' ? [36, 36, 36, 36] : [8, 8, 8, 8],
      content: [
        { text: h.name, bold: true, alignment: 'center', fontSize: 10 },
        { text: h.branchName ?? '', alignment: 'center', fontSize: 7 },
        {
          text: h.gstin ? `GSTIN ${h.gstin}` : '',
          alignment: 'center',
          fontSize: 7,
          margin: [0, 0, 0, 4],
        },
        { text: 'RECEIPT', bold: true, alignment: 'center', fontSize: 9, margin: [0, 2, 0, 4] },
        line('Receipt', payment.receiptNo, true),
        line('Date', ist(payment.createdAt)),
        line('Patient', payment.patient.name),
        line('UHID', payment.patient.uhid),
        {
          canvas: [{ type: 'line', x1: 0, y1: 2, x2: 210, y2: 2, dash: { length: 2 } }],
          margin: [0, 4, 0, 4],
        },
        ...payment.allocations.map((a) => line(a.billNo, inr(a.amount))),
        {
          canvas: [{ type: 'line', x1: 0, y1: 2, x2: 210, y2: 2, dash: { length: 2 } }],
          margin: [0, 4, 0, 4],
        },
        line('Paid', inr(payment.amount), true),
        line('Mode', `${payment.mode}${payment.reference ? ` ${payment.reference}` : ''}`),
        { text: rupeesInWords(payment.amount), fontSize: 7, italics: true, margin: [0, 4, 0, 4] },
        {
          text:
            payment.status === 'PENDING'
              ? 'PAYMENT PENDING CONFIRMATION'
              : 'Thank you. Get well soon.',
          alignment: 'center',
          fontSize: 7,
          bold: payment.status === 'PENDING',
        },
      ],
    },
    { duplicate },
  );
}
