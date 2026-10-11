  renderVals() {
    var st = this.state || {};
    var sel = st.sel || 'T-07', pr = st.pr || 'Amber';
    var Q = [['T-07', 'Ravi Kumar', 'Dr. Meera Iyer', '6 min', '47 Y M', 'In triage', 'bo'], ['T-08', 'Divya R.', 'Dr. R. Menon', '4 min', '29 Y F', 'Waiting', 'bb'], ['T-16', 'Gopal R.', 'Dr. P. Joshi', '2 min', '63 Y M', 'Waiting', 'bb'], ['T-23', 'Kiara S.', 'Dr. A. Thomas', '1 min', '9 mo F', 'Waiting', 'bb'], ['T-13', 'Usha K.', 'Dr. L. Gupta', 'just now', '57 Y F', 'Waiting', 'bb']];
    var cur = Q.filter(function (q) { return q[0] === sel; })[0] || Q[0];
    var P = [['Green', 'Routine', '#E3F3EA', '#1A6B44'], ['Amber', 'See soon', '#FFF1D6', '#7A4E00'], ['Red', 'Urgent', '#FDECEA', '#A3201A']];
    return {
      nav: this.navItems('OpdTriage'), left: Q.length,
      q: Q.map((q) => ({ tk: q[0], n: q[1], d: q[2], w: q[3], s: q[5], c: q[6], bg: q[0] === sel ? '#E6EEF9' : 'transparent', pick: () => this.setState({ sel: q[0] }) })),
      cur: { tk: cur[0], n: cur[1], d: cur[2], age: cur[4] },
      pri: P.map((p) => ({ l: p[0] + ' · ' + p[1], bg: p[0] === pr ? p[2] : '#fff', bd: p[0] === pr ? p[3] : '#C9D1DB', pick: () => this.setState({ pr: p[0] }) })),
      isRed: pr === 'Red'
    };
  }
