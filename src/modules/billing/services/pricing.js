import { roundOff } from '@hms/shared';

/** Price list kind for a patient category (rule R1); corporate, insurer and scheme lists come with those payers. */
export const CATEGORY_LIST_KIND = Object.freeze({
  GENERAL: 'GENERAL',
  STAFF: 'STAFF',
  SENIOR: 'SENIOR',
  CORPORATE: 'GENERAL',
});

/**
 * Picks the patient's price list and the rate of each service, falling back to the default
 * list when the patient's list has no rate for an item (rule R1).
 */
export function priceLine({ service, qty, priceList, defaultList, taxCode }) {
  const rateOf = (list) =>
    list && service.rates.find((r) => String(r.priceListId) === String(list._id))?.amount;
  let unitPrice = rateOf(priceList);
  let usedList = priceList;
  if (unitPrice === undefined) {
    unitPrice = rateOf(defaultList);
    usedList = defaultList;
  }
  if (unitPrice === undefined)
    return {
      error: `${service.code} ${service.name} has no rate in ${priceList?.code ?? 'the price list'} or the default list`,
    };
  return {
    line: {
      serviceId: service._id,
      code: service.code,
      name: service.name,
      category: service.category,
      departmentId: service.departmentId,
      qty,
      unitPrice,
      gross: unitPrice * qty,
      discount: 0,
      taxRate: taxCode?.rate ?? 0,
      hsnSac: taxCode?.hsnSac,
    },
    priceListCode: usedList.code,
  };
}

/**
 * Spreads a bill-level discount over the lines in proportion to their value, to the exact paisa
 * (the largest line takes the remainder), so line and bill totals always agree.
 */
export function spreadDiscount(lines, amount) {
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  if (!gross || !amount) return lines.map((l) => ({ ...l, discount: 0 }));
  const capped = Math.min(amount, gross);
  const shares = lines.map((l) => Math.floor((l.gross * capped) / gross));
  let rest = capped - shares.reduce((s, x) => s + x, 0);
  const order = lines.map((l, i) => i).sort((a, b) => lines[b].gross - lines[a].gross);
  for (const i of order) {
    if (!rest) break;
    if (shares[i] < lines[i].gross) {
      shares[i] += 1;
      rest -= 1;
    }
  }
  return lines.map((l, i) => ({ ...l, discount: shares[i] }));
}

/**
 * GST after discount (discount lowers the taxable value); intra-state CGST + SGST halves. Item
 * lines sold at MRP (medicines) carry the tax inside the price: the taxable value is taken out of
 * it, so the patient pays the printed MRP.
 */
export function taxLine(line) {
  if (line.taxInclusive) {
    const value = line.gross - line.discount;
    const taxable = Math.round((value * 100) / (100 + line.taxRate));
    const tax = value - taxable;
    const cgst = Math.floor(tax / 2);
    return { ...line, taxable, cgst, sgst: tax - cgst, net: value };
  }
  const taxable = line.gross - line.discount;
  const tax = Math.round((taxable * line.taxRate) / 100);
  const cgst = Math.floor(tax / 2);
  return { ...line, taxable, cgst, sgst: tax - cgst, net: taxable + tax };
}

/** Bill totals from priced lines; the total is rounded to the rupee as printed on Indian bills. */
export function billTotals(lines, { paid = 0, refunded = 0 } = {}) {
  const sum = (k) => lines.reduce((s, l) => s + (l[k] ?? 0), 0);
  const net = sum('net');
  const { rounded, roundOff: ro } = roundOff(net);
  return {
    gross: sum('gross'),
    discount: sum('discount'),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    tax: sum('cgst') + sum('sgst'),
    net,
    roundOff: ro,
    total: rounded,
    paid,
    refunded,
    balance: Math.max(rounded - paid, 0),
  };
}

/** Discount amount in paise for a request, on the bill's value before tax. */
export function discountAmount({ kind, value }, gross) {
  return kind === 'PERCENT' ? Math.round((gross * value) / 100) : Math.round(value * 100);
}

/** Recomputes lines and totals with a discount amount (0 removes it). */
export function applyDiscount(lines, amount, paid = 0, refunded = 0) {
  const priced = spreadDiscount(lines, amount).map(taxLine);
  return { lines: priced, totals: billTotals(priced, { paid, refunded }) };
}

/** IST calendar date "2026-10-10", for the day-wise cash limit (section 269ST). */
export function istDate(d = new Date()) {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
