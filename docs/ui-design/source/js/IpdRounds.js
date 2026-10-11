  renderVals() {
    var sel = (this.state && this.state.p) || 'Vijay Pawar';
    var P = [['Vijay Pawar', 'PVT-03', 2, 'NSTEMI', 'New results', 'bo', 3], ['Ravi Kumar', 'W2-204-B', 1, 'Unstable angina', 'New admission', 'bb', 3], ['N. Iyer', 'W2-203-B', 3, 'Heart failure', 'Critical', 'br', 5], ['K. Nair', 'W2-205-A', 6, 'COPD', 'Discharge', 'bg', 1], ['Usha K.', 'ICU-05', 4, 'Post-MI', 'ICU', 'br', 6], ['Arif Khan', 'W1-110-A', 2, 'Arrhythmia', 'Stable', 'bn', 1]];
    var cur = P.filter(function (p) { return p[0] === sel; })[0] || P[0];
    return {
      nav: this.navItems('IpdRounds'),
      pts: P.map((p) => ({ n: p[0], bed: p[1], day: p[2], dx: p[3], f: p[4], fc: p[5], bg: p[0] === sel ? '#E6EEF9' : 'transparent', pick: () => this.setState({ p: p[0] }) })),
      cur: { n: cur[0], bed: cur[1], day: cur[2], dx: cur[3], news: cur[6] }
    };
  }
