  renderVals() {
    var off = (this.state && this.state.off) || {};
    var L = [['Consultation · Cardiology (follow-up)', 'Cardiology', 1, 0, 0], ['Lipid profile', 'Laboratory', 1, 650, 32.5], ['HbA1c', 'Laboratory', 1, 450, 22.5], ['ECG 12-lead', 'Cardiology', 1, 300, 0], ['2D Echo', 'Radiology', 1, 2200, 0]];
    var inr = function (n) { return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var g = 0, d = 0;
    L.forEach(function (l, i) { if (!off[i]) { g += l[3] * l[2]; d += l[4]; } });
    return {
      nav: this.navItems('Billing'),
      lines: L.map((l, i) => ({ s: l[0], d: l[1], q: l[2], r: l[3] ? inr(l[3]) : 'Free follow-up', disc: l[4] ? inr(l[4]) : '-', a: inr(l[3] * l[2] - l[4]), on: !off[i],
        toggle: () => { var o = Object.assign({}, off); o[i] = !o[i]; this.setState({ off: o }); } })),
      gross: inr(g), disc: '- ' + inr(d), net: inr(g - d)
    };
  }
