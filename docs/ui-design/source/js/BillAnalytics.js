  renderVals() {
    var rg = (this.state && this.state.rg) || 'September';
    var M = rg === 'September';
    var f = M ? 1 : 1 / 30;
    var L = function (v) { var x = v * f; return x >= 100 ? '₹' + (x / 100).toFixed(2) + ' Cr' : '₹' + x.toFixed(x < 10 ? 2 : 1) + ' L'; };
    var S = [['Room and nursing', 182], ['Pharmacy', 164], ['Laboratory', 96], ['Procedures and surgery', 148], ['Consultations', 71], ['Radiology', 58], ['Packages and others', 41]];
    var P = [['Cash and self-pay', 312], ['Insurance and TPA', 248], ['Corporate', 96], ['Government schemes', 64], ['Members and wallet', 40]];
    var mx1 = 182, mx2 = 312;
    return {
      nav: this.navItems('BillAnalytics'),
      ranges: ['Today', 'September'].map((r) => ({ l: r, k: r === rg ? 'taba' : 'tab', pick: () => this.setState({ rg: r }) })),
      rl: M ? 'September 2026' : 'Today (average day)',
      kpis: [{ l: 'Net revenue', v: L(760), n: M ? 'up 8% vs August' : 'average day' }, { l: 'Collection efficiency', v: '96.4%', n: 'target 95%' }, { l: 'Days to collect', v: '27', n: 'all payers' }, { l: 'Discounts', v: '1.6%', n: 'of gross · target under 2%' }, { l: 'Refunds and cancellations', v: '0.9%', n: 'of gross' }, { l: 'Digital payments', v: '78%', n: 'UPI, card, transfer' }],
      svc: S.map(function (s) { return { n: s[0], v: L(s[1]), w: Math.round(s[1] / mx1 * 100) + '%', t: s[0] + ': ' + L(s[1]) }; }),
      pay: P.map(function (s) { return { n: s[0], v: L(s[1]), w: Math.round(s[1] / mx2 * 100) + '%', t: s[0] + ': ' + L(s[1]) }; }),
      age: [['Patient dues', '₹4.2 L', '₹1.1 L', '₹0.6 L', '₹0.9 L', '₹6.8 L', '9'], ['Corporate', '₹9.1 L', '₹3.5 L', '₹3.1 L', '₹0', '₹15.7 L', '41'], ['Insurance and TPA', '₹38.2 L', '₹14.6 L', '₹5.9 L', '₹2.5 L', '₹61.2 L', '38'], ['Government schemes', '₹12.4 L', '₹6.8 L', '₹2.2 L', '₹1.1 L', '₹22.5 L', '52']]
        .map(function (a) { return { n: a[0], a: a[1], b: a[2], c: a[3], d: a[4], t: a[5], s: a[6] }; }),
      leak: [['Charges posted after final bill', M ? '11 lines · ₹8,420' : '0', 'Zero', M ? 'Investigate' : 'On target', M ? 'br' : 'bg'], ['Manual charge lines', '3.1%', 'Under 5%', 'On target', 'bg'], ['Package variance (cost over price)', '₹2.9 L', 'Under 10% of package revenue', 'On target', 'bg'], ['Reprinted bills', M ? '212' : '7', 'Falling', 'Watch', 'ba'], ['Shift variance (net)', M ? '-₹1,840' : '-₹100', 'Under ₹100 a shift', 'On target', 'bg'], ['Cash refused at ₹2 lakh limit', M ? '3' : '0', 'Logged', 'Reviewed', 'bn'], ['Claim deductions', '4.1%', 'Under 5%', 'On target', 'bg']]
        .map(function (l) { return { n: l[0], v: l[1], t: l[2], s: l[3], c: l[4] }; })
    };
  }
