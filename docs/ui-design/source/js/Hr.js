  renderVals() {
    var dec = (this.state && this.state.dec) || {};
    var L = [['Kavya N.', 'Earned leave', '14 to 17 Oct', '9 days'], ['Joseph K.', 'Casual leave', '20 Oct', '3 days'], ['Meera Pillai', 'Sick leave', '9 Oct (today)', '5 days'], ['Ramesh Iyer', 'Comp-off', '13 Oct', '1 day']];
    var open = L.filter(function (l, i) { return !dec[i]; }).length;
    return {
      nav: this.navItems('Hr'), pending: open + ' pending',
      kpis: [{ l: 'Headcount', v: '412', n: '388 permanent' }, { l: 'Present', v: '361', n: '87.6%' }, { l: 'Late', v: '14', n: 'beyond grace' }, { l: 'On leave', v: '22', n: 'approved' }, { l: 'Absent', v: '9', n: 'not informed' }, { l: 'Joining this month', v: '7', n: '3 nurses' }],
      att: [['Nursing', 168, 151, 6, 11, 6, 'br'], ['Medicine and residents', 54, 50, 2, 2, 0, 'bg'], ['Laboratory', 17, 16, 1, 0, 0, 'bg'], ['Pharmacy', 10, 9, 0, 1, 0, 'bg'], ['Front office and billing', 26, 23, 3, 1, 2, 'ba'], ['Housekeeping', 46, 41, 2, 4, 1, 'ba']].map(function (a) { return { d: a[0], r: a[1], p: a[2], l: a[3], lv: a[4], ab: a[5], ac: a[6] }; }),
      leaves: L.map((l, i) => ({ n: l[0], t: l[1], d: l[2], b: l[3], open: !dec[i], done: !!dec[i], ds: dec[i] || '', dc: dec[i] === 'Approved' ? 'bg' : 'br',
        ok: () => { var o = Object.assign({}, dec); o[i] = 'Approved'; this.setState({ dec: o }); }, no: () => { var o = Object.assign({}, dec); o[i] = 'Rejected'; this.setState({ dec: o }); } }))
    };
  }
