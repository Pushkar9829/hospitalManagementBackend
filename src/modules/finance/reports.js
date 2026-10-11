import { GROUPS, registerReport } from '../../core/reports/registry.js';
import { gstSummary } from './services/finance.service.js';

/** Finance reports. */

registerReport({
  code: 'gst-registers',
  name: 'GST registers',
  group: GROUPS.BILLING,
  module: 'FIN',
  permission: 'reports:finance:read',
  description:
    'Output GST on bills by rate (GSTR-1 style), input credit from purchases, net payable, by month.',
  columns: [
    ['month', 'Month', 'text'],
    ['rate', 'GST rate', 'percent'],
    ['taxable', 'Taxable value', 'money'],
    ['cgst', 'CGST', 'money'],
    ['sgst', 'SGST', 'money'],
  ],
  run: async ({ from, to }) => {
    const items = [];
    let output = 0;
    let input = 0;
    let m = from.slice(0, 7);
    for (let i = 0; i < 13 && m <= to.slice(0, 7); i += 1) {
      const g = await gstSummary({ month: m });
      for (const r of g.output)
        items.push({ month: m, rate: r.rate, taxable: r.taxable, cgst: r.cgst, sgst: r.sgst });
      output += g.outputTax;
      input += g.inputTax;
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return {
      kpis: [
        ['output', 'Output GST', output, 'money'],
        ['input', 'Input credit', input, 'money'],
        ['payable', 'Payable', output - input, 'money'],
      ],
      items,
    };
  },
});
