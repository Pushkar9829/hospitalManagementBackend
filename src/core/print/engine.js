import { createRequire } from 'node:module';
import bwipjs from 'bwip-js';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
const vfsModule = require('pdfmake/build/vfs_fonts.js');

/**
 * Server-side PDFs (spec: A4, A5 and 80 mm thermal). Roboto covers English and the ₹ sign;
 * documents in Indian scripts are rendered from HTML in the browser until a Devanagari font
 * pipeline is added.
 */
const vfs = vfsModule.pdfMake?.vfs ?? vfsModule;
const font = (name) => Buffer.from(vfs[name], 'base64');
const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
});

/** 80 mm thermal roll: 72 mm printable width; the height grows with the content. */
export const THERMAL_80 = { width: 226.77, height: 'auto' };

export function renderPdf(definition, { duplicate = false } = {}) {
  const doc = printer.createPdfKitDocument({
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    info: { creator: 'Hospital Management System', producer: 'HMS' },
    ...(duplicate ? { watermark: { text: 'DUPLICATE', opacity: 0.12, bold: true } } : {}),
    ...definition,
  });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Code 128 barcode as a PNG data URL for pdfmake images (UHID, bill number). */
export async function barcode(text, { height = 8 } = {}) {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 2,
    height,
    includetext: false,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** Letterhead block used at the top of A4 documents. */
/** The hospital's letterhead; `note` is the header line set in hospital print settings. */
export function letterhead({ name, address, gstin, phone, note }) {
  const addr = [address?.line1, address?.line2, address?.city, address?.state, address?.pin]
    .filter(Boolean)
    .join(', ');
  return {
    stack: [
      { text: name, style: 'hospital' },
      ...(addr ? [{ text: addr, fontSize: 8, color: '#5B6878' }] : []),
      {
        text: [phone ? `Phone ${phone}` : null, gstin ? `GSTIN ${gstin}` : null]
          .filter(Boolean)
          .join('   '),
        fontSize: 8,
        color: '#5B6878',
      },
      ...(note ? [{ text: note, fontSize: 8, italics: true, color: '#5B6878' }] : []),
    ],
    margin: [0, 0, 0, 8],
  };
}

export const STYLES = {
  hospital: { fontSize: 14, bold: true, color: '#142130' },
  title: { fontSize: 12, bold: true, margin: [0, 6, 0, 6] },
  label: { fontSize: 8, color: '#5B6878' },
  th: { bold: true, fontSize: 8, color: '#142130' },
  total: { bold: true, fontSize: 10 },
};
