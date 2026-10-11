  renderVals() {
    var rg = (this.state && this.state.rg) || 'September';
    var M = rg === 'September';
    var Wd = [['ICU', 100], ['HDU', 83], ['Private', 88], ['Ward 2 · Semi-private', 92], ['Ward 1 · General', 88], ['Ward 3 · General', 80], ['Maternity', 71], ['Paediatrics', 67]];
    var S = [['Advice to summary signed', 64], ['Summary to final bill', 38], ['Final bill to insurer approval (insured)', 74], ['Bill paid to patient leaving', 26], ['Patient left to bed ready', 38]];
    var Dp = [['Cardiology', 96, '4.1 days', '91%', '₹18,900', '48%', 2, 1, '3.1%'], ['Medicine', 182, '5.2 days', '88%', '₹11,600', '35%', 4, 3, '4.9%'], ['Orthopaedics', 74, '3.8 days', '84%', '₹21,400', '61%', 0, 0, '1.4%'], ['Obstetrics', 88, '2.9 days', '71%', '₹9,800', '22%', 0, 1, '1.1%'], ['Paediatrics', 61, '3.2 days', '67%', '₹8,700', '18%', 0, 1, '1.6%'], ['Surgery', 122, '3.6 days', '85%', '₹16,300', '44%', 1, 1, '2.5%'], ['Pulmonology', 42, '6.0 days', '90%', '₹12,900', '31%', 2, 0, '7.1%']];
    var f = M ? 1 : 0.233;
    return {
      nav: this.navItems('IpdAnalytics'),
      ranges: ['Last 7 days', 'September'].map((r) => ({ l: r, k: r === rg ? 'taba' : 'tab', pick: () => this.setState({ rg: r }) })),
      rangeLabel: rg === 'September' ? 'September 2026' : 'last 7 days',
      kpis: [{ l: 'Occupancy now', v: '86%', n: '103 of 120 beds' }, { l: 'Average stay', v: '4.6 days', n: 'September' }, { l: 'Discharge turnaround', v: '2 h 50 min', n: 'October so far · target 3 h' }, { l: 'Bed turnaround', v: '38 min', n: 'target 45 min' }, { l: 'Revenue per bed day', v: '₹14,200', n: 'occupied bed day' }, { l: 'Readmitted in 30 days', v: '3.8%', n: 'target under 5%' }],
      wards: Wd.map(function (w) { return { n: w[0], v: w[1], c: w[1] >= 95 ? '#A3201A' : (w[1] < 75 ? '#9AA6B4' : '#1D3557'), t: w[0] + ': ' + w[1] + '% occupied' }; }),
      stages: S.map(function (s) { return { n: s[0], v: s[1], w: Math.round(s[1] / 74 * 100) + '%', t: s[0] + ': ' + s[1] + ' min median' }; }),
      depts: Dp.map(function (d) { return { n: d[0], a: Math.max(1, Math.round(d[1] * f)), l: d[2], o: d[3], r: d[4], i: d[5], d: M ? d[6] : 0, la: M ? d[7] : 0, re: d[8] }; }),
      ind: [['Bed occupancy rate', '85.0%', 'Occupied bed days 3,060 × 100 ÷ (120 beds × 30 days)', '80 to 90%', 'On target', 'bg'], ['Average length of stay', '4.6 days', 'In-patient days 3,060 ÷ discharges 665', 'Department targets', 'On target', 'bg'], ['Bed turnover rate', '5.5', 'Discharges, deaths, LAMA and transfers out 665 ÷ 120 beds', '5 or more', 'On target', 'bg'], ['Bed turnover interval', '0.8 days', '(Available bed days 3,600 − occupied 3,060) ÷ 665', 'Under 1 day', 'On target', 'bg'], ['Discharge turnaround', '3 h 24 min', 'Median of patient left − discharge advice', 'Under 3 h', 'Missed', 'br'], ['Discharges before noon', '31%', 'Discharges with patient left before 12:00 ÷ all', '40%', 'Below goal', 'ba'], ['Gross death rate', '1.4%', 'Deaths 9 × 100 ÷ discharges including deaths 665', 'Watch trend', 'Reviewed', 'bn'], ['LAMA rate', '1.1%', 'LAMA 7 × 100 ÷ discharges 665', 'Under 2%', 'On target', 'bg'], ['Medicine doses on time', '93%', 'Doses given within 30 min of due ÷ doses due', '95%', 'Below goal', 'ba']]
        .map(function (i) { return { n: i[0], v: i[1], f: i[2], t: i[3], s: i[4], c: i[5] }; })
    };
  }
