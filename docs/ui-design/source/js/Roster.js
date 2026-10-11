  renderVals() {
    var st = this.state || {};
    var ov = st.ov || {};
    var DW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var days = []; for (var i = 0; i < 14; i++) days.push({ dw: DW[(6 + i) % 7], dn: 12 + i });
    var C = { M: 'bb', E: 'bo', N: 'bn', OFF: 'bg', L: 'ba' };
    var ORDER = ['M', 'E', 'N', 'OFF'];
    var S = [['Anjali Menon', 'Staff Nurse', 'M M E E OFF N N M M E OFF OFF M M'], ['Meera Pillai', 'Staff Nurse', 'E E M M M OFF E E N N OFF M M E'], ['Rose Thomas', 'Staff Nurse', 'N N N N OFF OFF M M E E M OFF N N'],
      ['Joseph K.', 'Staff Nurse', 'M E E OFF M M N N OFF M E E OFF M'], ['Priya S.', 'Staff Nurse', 'OFF M M N N OFF E M M OFF N N E E'], ['Lata Desai', 'Ward In-charge', 'M M M M M OFF OFF M M M M M OFF OFF'],
      ['Kavya N.', 'Staff Nurse', 'E OFF L L L L E E M M N OFF OFF E'], ['Imran A.', 'Staff Nurse', 'N OFF M M E E OFF N N OFF M M E E'], ['Sneha R.', 'Trainee Nurse', 'M M OFF E E M M OFF E E M M OFF OFF']];
    var grid = S.map(function (s, r) { return s[2].split(' ').map(function (v, d) { return ov[r + '-' + d] || v; }); });
    return {
      nav: this.navItems('Roster'), days: days,
      staff: S.map((s, r) => ({ n: s[0], g: s[1], cells: grid[r].map((v, d) => ({ l: v, c: C[v], aria: s[0] + ' day ' + (12 + d) + ' ' + v,
        cycle: () => { var o = Object.assign({}, ov); var cur = grid[r][d]; o[r + '-' + d] = ORDER[(ORDER.indexOf(cur) + 1) % 4]; this.setState({ ov: o }); } })) })),
      cover: days.map(function (x, d) { var n = grid.filter(function (g) { return g[d] === 'N'; }).length; return { v: n, c: n < 2 ? 'br' : 'bg' }; })
    };
  }
