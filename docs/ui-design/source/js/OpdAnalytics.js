  renderVals() {
    var S = [['Arrival to check-in', 4], ['Check-in to triage', 9], ['Triage to doctor', 18], ['Consultation', 11], ['Billing for tests', 6], ['Pharmacy', 8]];
    var Hh = [['08', 12], ['09', 48], ['10', 96], ['11', 88], ['12', 61], ['13', 22], ['14', 9], ['15', 18], ['16', 34], ['17', 24]];
    return {
      nav: this.navItems('OpdAnalytics'),
      kpis: [{ l: 'Visits today', v: '412', n: '68% booked, 32% walk-in' }, { l: 'Median total time', v: '64 min', n: 'target under 90' }, { l: 'Wait to doctor', v: '27 min', n: 'NABH target 30' }, { l: 'No-show rate', v: '6.8%', n: '28 of 412 booked' }, { l: 'Revenue per visit', v: '₹1,284', n: 'incl. tests and pharmacy' }, { l: 'OPD to IPD', v: '4.4%', n: '18 admissions' }],
      stages: S.map(function (s) { return { n: s[0], v: s[1], w: Math.round(s[1] / 18 * 100) + '%', t: s[0] + ': ' + s[1] + ' min median' }; }),
      hours: Hh.map(function (h) { return { l: h[0], v: h[1], h: Math.round(h[1] / 96 * 150) + 'px', t: h[0] + ':00 to ' + h[0] + ':59 · ' + h[1] + ' arrivals' }; }),
      docs: [['Dr. Meera Iyer', 18, 15, 1, 'On time', 'bg', '19 min', '12 min', '94%', '1.8', '₹48,200'], ['Dr. P. Joshi', 24, 19, 2, '30 min late', 'br', '41 min', '9 min', '88%', '1.2', '₹39,600'], ['Dr. A. Thomas', 24, 22, 1, 'On time', 'bg', '15 min', '8 min', '96%', '0.9', '₹21,900'], ['Dr. L. Gupta', 18, 16, 2, 'On time', 'bg', '12 min', '7 min', '91%', '0.3', '₹18,400'], ['Dr. R. Menon', 30, 27, 2, '10 min late', 'ba', '24 min', '10 min', '93%', '1.5', '₹52,700']]
        .map(function (d) { return { n: d[0], b: d[1], s: d[2], ns: d[3], st: d[4], lc: d[5], w: d[6], c: d[7], u: d[8], t: d[9], r: d[10] }; })
    };
  }
