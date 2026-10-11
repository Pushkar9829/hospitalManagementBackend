  renderVals() {
    var st = (this.state && this.state.st) || {};
    var T = [['W2-202-B', 'Discharged 10:20 · bed clean and linen change', 'P', '40 min', 'ba'], ['PVT-06', 'Discharged 10:35 · routine clean', 'P', '5 min', 'bn'], ['ISO-01', 'Isolation terminal clean after transfer', 'I', '25 min', 'bo'],
      ['OPD toilets, floor 1', 'Scheduled 2-hourly checklist', 'I', '10 min', 'bn'], ['W1-105-A', 'Cleaned by Suresh · needs supervisor check', 'V', '38 min', 'bg']];
    var COL = [['P', 'Pending', 'Start'], ['I', 'In progress', 'Mark cleaned'], ['V', 'To verify', 'Verify, bed available']];
    var cur = T.map(function (t, i) { return st[i] || t[2]; });
    var next = { P: 'I', I: 'V', V: 'X' };
    return {
      nav: this.navItems('Facility'),
      cols: COL.map((c) => {
        var items = [];
        T.forEach((t, i) => { if (cur[i] === c[0]) items.push({ w: t[0], d: t[1], tm: t[3], c: t[4], a: c[2], move: () => { var o = Object.assign({}, st); o[i] = next[cur[i]]; this.setState({ st: o }); } }); });
        return { t: c[1], n: items.length, items: items };
      }),
      bmw: [['Yellow (infectious)', 42], ['Red (plastics)', 31], ['White (sharps)', 6], ['Blue (glass)', 9]].map(function (b) { return { n: b[0], v: b[1] + ' kg', w: Math.round(b[1] / 42 * 100) + '%', t: b[0] + ': ' + b[1] + ' kg' }; })
    };
  }
