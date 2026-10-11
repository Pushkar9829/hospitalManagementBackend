import { formatINR } from '@hms/shared';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { current } from '../../../core/tenancy/context.js';
import {
  STYLES,
  THERMAL_80,
  barcode,
  letterhead,
  printLanguage,
  renderPdf,
} from '../../../core/print/engine.js';
import { Patient } from '../../patients/index.js';
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

const HI_ONES = (
  ' एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस' +
  ' बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस' +
  ' चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस' +
  ' छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन' +
  ' उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर' +
  ' तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी' +
  ' पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे' +
  ' सत्तानबे अट्ठानबे निन्यानबे'
).split(' ');

/** Amount in words in Hindi: "एक हज़ार नौ रुपये मात्र". */
export function rupeesInWordsHi(paise) {
  const three = (n) =>
    [n >= 100 ? `${HI_ONES[Math.floor(n / 100)]} सौ` : '', HI_ONES[n % 100]]
      .filter(Boolean)
      .join(' ');
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  const parts = [];
  for (const [size, label] of [
    [1_00_00_000, 'करोड़'],
    [1_00_000, 'लाख'],
    [1000, 'हज़ार'],
  ]) {
    if (r >= size) {
      parts.push(`${three(Math.floor(r / size))} ${label}`);
      r %= size;
    }
  }
  if (r) parts.push(three(r));
  const rupees = parts.length ? `${parts.join(' ')} रुपये` : 'शून्य रुपये';
  return `${rupees}${p ? ` और ${HI_ONES[p]} पैसे` : ''} मात्र`;
}

/** Printed labels in English and Hindi (spec: bill and receipt templates in both). */
const LABELS = {
  en: {
    patient: 'Patient',
    bill: 'Bill',
    BILL: 'BILL',
    BILL_CANCELLED: 'BILL (CANCELLED)',
    priceList: 'Price list',
    mobile: 'Mobile',
    cols: ['#', 'Service', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'GST', 'Amount'],
    exempt: 'Exempt',
    gross: 'Gross',
    discount: 'Discount',
    roundOff: 'Round off',
    total: 'Total',
    paid: 'Paid',
    balance: 'Balance',
    cancelled: (reason, cn) => `Cancelled: ${reason}. Credit note ${cn}.`,
    gstNote:
      'Health care services by a clinical establishment are exempt from GST unless shown above.',
    signatory: 'Authorised signatory',
    page: (a, b) => `Page ${a} of ${b}`,
    RECEIPT: 'RECEIPT',
    receipt: 'Receipt',
    date: 'Date',
    mode: 'Mode',
    pending: 'PAYMENT PENDING CONFIRMATION',
    thanks: 'Thank you. Get well soon.',
    words: rupeesInWords,
  },
  hi: {
    patient: 'रोगी',
    bill: 'बिल',
    BILL: 'बिल',
    BILL_CANCELLED: 'बिल (रद्द)',
    priceList: 'मूल्य सूची',
    mobile: 'मोबाइल',
    cols: ['#', 'सेवा', 'HSN/SAC', 'मात्रा', 'दर', 'छूट', 'जीएसटी', 'राशि'],
    exempt: 'मुक्त',
    gross: 'सकल',
    discount: 'छूट',
    roundOff: 'पूर्णांकन',
    total: 'कुल',
    paid: 'भुगतान',
    balance: 'शेष',
    cancelled: (reason, cn) => `रद्द: ${reason}। क्रेडिट नोट ${cn}।`,
    gstNote:
      'चिकित्सा प्रतिष्ठान की स्वास्थ्य सेवाएँ जीएसटी से मुक्त हैं, जब तक ऊपर न दिखाया गया हो।',
    signatory: 'अधिकृत हस्ताक्षरकर्ता',
    page: (a, b) => `पृष्ठ ${a} / ${b}`,
    RECEIPT: 'रसीद',
    receipt: 'रसीद',
    date: 'तिथि',
    mode: 'माध्यम',
    pending: 'भुगतान की पुष्टि बाकी',
    thanks: 'धन्यवाद। शीघ्र स्वस्थ हों।',
    words: rupeesInWordsHi,
  },
};

/**
 * The language a patient's document prints in: the one asked for, else the patient's preferred
 * language; Hindi only when the Devanagari font is installed. Also the patient's name in their
 * own script, when registered.
 */
export async function documentLanguage(patientId, wanted) {
  const p = patientId
    ? await Patient.findById(patientId).select('preferredLanguage name').lean()
    : null;
  return {
    lang: printLanguage(wanted ?? p?.preferredLanguage),
    regionalName: p?.name?.regional || null,
  };
}

/** Label text node: Hindi labels use the Devanagari font; values stay in Roboto. */
const labeller = (lang) => {
  const L = LABELS[lang];
  const t = (key, ...args) => {
    const v = typeof L[key] === 'function' ? L[key](...args) : L[key];
    return lang === 'hi' ? { text: v, font: 'Devanagari' } : { text: v };
  };
  return { L, t };
};

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
export async function billPdf(bill, { duplicate, lang: wanted } = {}) {
  const h = await header(bill.branchId);
  const { lang, regionalName } = await documentLanguage(bill.patientId, wanted);
  const { L, t: lab } = labeller(lang);
  const settings = await billingSettings();
  const rows = bill.lines.map((l, i) => [
    String(i + 1),
    { text: `${l.name}\n`, fontSize: 9 },
    l.hsnSac ?? '',
    String(l.qty),
    inr(l.unitPrice),
    l.discount ? inr(l.discount) : '',
    l.taxRate ? `${l.taxRate}%` : lab('exempt'),
    { text: inr(l.net), alignment: 'right' },
  ]);
  const t = bill.totals;
  const sumRow = (key, value, bold) => [
    { ...lab(key), colSpan: 7, alignment: 'right', bold },
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
        ...(lang === 'hi' ? { font: 'Devanagari' } : {}),
        text: [settings.billFooter || h.footer, L.page(page, pages)].filter(Boolean).join('  ·  '),
        alignment: 'center',
        fontSize: 7,
        color: '#5B6878',
      }),
      content: [
        letterhead(h),
        {
          columns: [
            { ...lab(bill.status === 'CANCELLED' ? 'BILL_CANCELLED' : 'BILL'), style: 'title' },
            { image: await barcode(bill.billNo), width: 140, alignment: 'right' },
          ],
        },
        {
          columns: [
            {
              stack: [
                { ...lab('patient'), style: 'label' },
                {
                  text: `${bill.patient.name}  (${bill.patient.age}, ${bill.patient.gender})`,
                  bold: true,
                },
                ...(lang === 'hi' && regionalName
                  ? [{ text: regionalName, font: 'Devanagari' }]
                  : []),
                {
                  text: [`UHID ${bill.patient.uhid}   `, lab('mobile'), ` ${bill.patient.mobile}`],
                },
              ],
            },
            {
              stack: [
                { ...lab('bill'), style: 'label' },
                { text: bill.billNo, bold: true },
                ist(bill.finalizedAt ?? bill.createdAt),
                { text: [lab('priceList'), ` ${bill.payer?.priceListCode ?? ''}`] },
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
              L.cols.map((x) => ({
                text: x,
                style: 'th',
                ...(lang === 'hi' ? { font: 'Devanagari' } : {}),
              })),
              ...rows,
              sumRow('gross', inr(t.gross)),
              ...(t.discount ? [sumRow('discount', `- ${inr(t.discount)}`)] : []),
              ...(t.tax
                ? [
                    [
                      { text: 'CGST', colSpan: 7, alignment: 'right' },
                      {},
                      {},
                      {},
                      {},
                      {},
                      {},
                      { text: inr(t.cgst), alignment: 'right' },
                    ],
                    [
                      { text: 'SGST', colSpan: 7, alignment: 'right' },
                      {},
                      {},
                      {},
                      {},
                      {},
                      {},
                      { text: inr(t.sgst), alignment: 'right' },
                    ],
                  ]
                : []),
              ...(t.roundOff ? [sumRow('roundOff', inr(t.roundOff))] : []),
              sumRow('total', inr(t.total), true),
              sumRow('paid', inr(t.paid)),
              sumRow('balance', inr(t.balance), true),
            ],
          },
          layout: 'lightHorizontalLines',
        },
        { ...lab('words', t.total), italics: lang !== 'hi', margin: [0, 8, 0, 0] },
        ...(bill.cancellation?.creditNoteNo
          ? [
              {
                ...lab('cancelled', bill.cancellation.reason, bill.cancellation.creditNoteNo),
                color: '#A3201A',
                margin: [0, 6, 0, 0],
              },
            ]
          : []),
        {
          ...lab('gstNote'),
          fontSize: 7,
          color: '#5B6878',
          margin: [0, 16, 0, 0],
        },
        {
          columns: [
            { text: '' },
            { ...lab('signatory'), alignment: 'right', margin: [0, 36, 0, 0] },
          ],
        },
      ],
    },
    { duplicate },
  );
}

/** Receipt on an 80 mm thermal roll, or A5 (billing settings). */
export async function receiptPdf(payment, { duplicate, lang: wanted } = {}) {
  const h = await header(payment.branchId);
  const settings = await billingSettings();
  const { lang } = await documentLanguage(payment.patientId, wanted);
  const { t: lab } = labeller(lang);
  const line = (a, b, bold) => ({
    columns: [
      { ...(typeof a === 'string' ? { text: a } : a), bold },
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
        { ...lab('RECEIPT'), bold: true, alignment: 'center', fontSize: 9, margin: [0, 2, 0, 4] },
        line(lab('receipt'), payment.receiptNo, true),
        line(lab('date'), ist(payment.createdAt)),
        line(lab('patient'), payment.patient.name),
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
        line(lab('paid'), inr(payment.amount), true),
        line(lab('mode'), `${payment.mode}${payment.reference ? ` ${payment.reference}` : ''}`),
        {
          ...lab('words', payment.amount),
          fontSize: 7,
          italics: lang !== 'hi',
          margin: [0, 4, 0, 4],
        },
        {
          ...lab(payment.status === 'PENDING' ? 'pending' : 'thanks'),
          alignment: 'center',
          fontSize: 7,
          bold: payment.status === 'PENDING',
        },
      ],
    },
    { duplicate },
  );
}
