  renderVals() {
    var R = [['Inpatient services', 58.2], ['Pharmacy', 31.4], ['OPD consultations', 17.8], ['Laboratory', 14.6], ['Radiology', 12.1], ['Health check-ups', 5.3], ['Other', 3.2]];
    return {
      nav: this.navItems('Finance'),
      kpis: [{ l: 'Revenue MTD', v: '₹1.43 Cr', n: 'Up 8% vs Sep' }, { l: 'Expenses MTD', v: '₹1.16 Cr', n: '81% of revenue' }, { l: 'Operating profit', v: '₹26.2 L', n: '18.4% margin' }, { l: 'Receivables', v: '₹42.7 L', n: '₹9.4 L over 60 days' }, { l: 'Payables', v: '₹31.9 L', n: '₹18.6 L due this week' }, { l: 'Cash and bank', v: '₹1.08 Cr', n: '3 accounts' }],
      rev: R.map(function (r) { return { n: r[0], v: r[1].toFixed(1), w: Math.round(r[1] / 58.2 * 100) + '%', t: r[0] + ': ₹' + r[1].toFixed(1) + ' lakh' }; })
    };
  }
