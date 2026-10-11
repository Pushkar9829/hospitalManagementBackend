  renderVals() {
    var cur = (this.state && this.state.doc) || 'Dr. Meera Iyer';
    var D = [['Dr. Meera Iyer', 'Cardiology · 6 sessions'], ['Dr. P. Joshi', 'Orthopaedics · 5 sessions'], ['Dr. A. Thomas', 'Paediatrics · 6 sessions'], ['Dr. L. Gupta', 'Dermatology · 6 sessions'], ['Dr. R. Menon', 'Medicine · 6 sessions'], ['Dr. S. Bhide (visiting)', 'Orthopaedics · 1 session']];
    var W = [['Monday', '10:00 to 13:00', '12', '10 / 5 min', '18', '+2', 'Yes', 'No'], ['Tuesday', '10:00 to 13:00', '12', '10 / 5 min', '18', '+2', 'Yes', 'No'], ['Wednesday', '10:00 to 13:00 · 17:00 to 19:00', '12', '10 / 5 min', '18 · 12', '+2', 'Yes', '17:00 to 19:00'], ['Thursday', '10:00 to 13:00', '12', '10 / 5 min', '18', '+2', 'Yes', 'No'], ['Friday', '10:00 to 13:00', '12', '10 / 5 min', '18', '+2', 'Yes', 'No'], ['Saturday', '10:00 to 12:00', '12', '10 / 5 min', '12', '0', 'Yes', 'No'], ['Sunday', 'No OPD', '-', '-', '-', '-', 'No', 'No']];
    return {
      nav: this.navItems('OpdConfig'), cur: cur,
      docs: D.map((d) => ({ n: d[0], s: d[1], bg: d[0] === cur ? '#E6EEF9' : 'transparent', pick: () => this.setState({ doc: d[0] }) })),
      week: W.map(function (w) { return { d: w[0], s: w[1], r: w[2], sl: w[3], m: w[4], o: w[5], on: w[6], oc: w[6] === 'Yes' ? 'bg' : 'bn', t: w[7], tc: w[7] === 'No' ? 'bn' : 'bb' }; })
    };
  }
