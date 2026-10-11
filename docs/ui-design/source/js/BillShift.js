  renderVals() {
    var closed = !!(this.state && this.state.closed);
    var D = [['₹500', 48, '24,000'], ['₹200', 12, '2,400'], ['₹100', 8, '800'], ['₹50', 4, '200'], ['₹20', 3, '60'], ['₹10', 6, '60'], ['Coins', '-', '30']];
    return {
      nav: this.navItems('BillShift'),
      kpis: [{ l: 'Opening cash', v: '₹5,000', n: 'counted at 08:00' }, { l: 'Collected this shift', v: '₹1,12,480', n: '102 receipts' }, { l: 'UPI and card', v: '₹89,830', n: 'matched with devices' }, { l: 'Expected cash', v: '₹27,650', n: 'opening + cash receipts' }, { l: 'Variance', v: '-₹100', n: 'within ₹100 limit' }],
      stl: closed ? 'Closed, awaiting verification' : 'Open since 08:00', stc: closed ? 'ba' : 'bg', open: !closed, closed: closed,
      modes: [['UPI', 41, '58,200.00', '58,200.00', 'Matched', 'bg'], ['Card', 23, '31,630.00', '31,630.00', 'Matched', 'bg'], ['Cash', 38, '22,650.00', 'Counted 22,550.00', '-100', 'ba'], ['Cheque', 0, '0.00', '-', 'None', 'bn'], ['Bank transfer', 0, '0.00', '-', 'None', 'bn']]
        .map(function (m) { return { n: m[0], c: m[1], s: m[2], d: m[3], m: m[4], mc: m[5] }; }),
      notes: D.map(function (n) { return { d: n[0], c: n[1], a: n[2] }; }),
      close: () => this.setState({ closed: true })
    };
  }
