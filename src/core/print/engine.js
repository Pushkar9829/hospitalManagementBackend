import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bwipjs from 'bwip-js';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
const vfsModule = require('pdfmake/build/vfs_fonts.js');

/**
 * Server-side PDFs (spec: A4, A5 and 80 mm thermal). Roboto covers English and the ₹ sign.
 * Hindi text uses a Devanagari font (Noto Sans Devanagari, SIL Open Font License) from
 * api/assets/fonts, or the files named in PDF_DEVANAGARI_FONT / PDF_DEVANAGARI_FONT_BOLD;
 * pdfmake's fontkit shapes Devanagari (matras, conjuncts, reph) itself. Without the font, Hindi
 * documents fall back to English.
 */
const vfs = vfsModule.pdfMake?.vfs ?? vfsModule;
const font = (name) => Buffer.from(vfs[name], 'base64');
const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');

/** A font file, or "collection.ttc#PostScriptName" for one face of a font collection. */
function fontFile(value) {
  const [file, face] = value.split('#');
  if (!existsSync(file)) return null;
  return face ? [file, face] : file;
}

function devanagariFiles() {
  const regular = fontFile(
    process.env.PDF_DEVANAGARI_FONT || resolve(FONT_DIR, 'NotoSansDevanagari-Regular.ttf'),
  );
  if (!regular) return null;
  const bold =
    fontFile(
      process.env.PDF_DEVANAGARI_FONT_BOLD || resolve(FONT_DIR, 'NotoSansDevanagari-Bold.ttf'),
    ) ?? regular;
  return { normal: regular, bold, italics: regular, bolditalics: bold };
}

const DEVANAGARI = devanagariFiles();
const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
  ...(DEVANAGARI ? { Devanagari: DEVANAGARI } : {}),
});

/** Whether Hindi documents can be printed (the Devanagari font is installed). */
export const hindiAvailable = () => Boolean(DEVANAGARI);

/** The language a document prints in: Hindi only when asked for and the font is there. */
export const printLanguage = (wanted) => (wanted === 'hi' && DEVANAGARI ? 'hi' : 'en');

/** A text node in Hindi (the Devanagari font), for labels inside an otherwise Roboto document. */
export const hi = (text, extra = {}) => ({ text, font: 'Devanagari', ...extra });

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
