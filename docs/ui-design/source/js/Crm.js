  renderVals() {
    var st = (this.state && this.state.st) || {};
    var STG = ['New', 'Contacted', 'Counselled', 'Booked'];
    var L = [['Meena J.', 'Knee replacement', 'Phone', 'today', 0], ['Prakash S.', 'MRI brain', 'Website', 'today', 0], ['Divya R.', 'Executive health check', 'WhatsApp', '10 Oct', 1], ['Gopal R.', 'Cataract surgery', 'Camp', '11 Oct', 1],
      ['Anita P.', 'Normal delivery package', 'Referral', '12 Oct', 2], ['Rakesh M.', 'Angiography', 'Call centre', '10 Oct', 2], ['Sara A.', 'Physiotherapy 10 sessions', 'Walk-in', 'booked 14 Oct', 3]];
    var cur = L.map(function (l, i) { return st[i] != null ? st[i] : l[4]; });
    return {
      nav: this.navItems('Crm'),
      cols: STG.map((t, si) => {
        var items = [];
        L.forEach((l, i) => { if (cur[i] === si) items.push({ n: l[0], i: l[1], s: l[2], f: l[3], canMove: si < 3, nx: STG[Math.min(3, si + 1)], move: () => { var o = Object.assign({}, st); o[i] = Math.min(3, cur[i] + 1); this.setState({ st: o }); } }); });
        return { t: t, n: items.length, items: items };
      })
    };
  }
