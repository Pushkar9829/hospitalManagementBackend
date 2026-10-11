  renderVals() {
    var cur = (this.state && this.state.ward) || 'Ward 2';
    var W = [['Ward 1', 'General', 'Floor 1', 24, '1:6', 'W1-1'], ['Ward 2', 'Semi-private', 'Floor 2', 12, '1:4', 'W2-2'], ['Ward 3', 'General', 'Floor 1', 30, '1:6', 'W3-1'], ['ICU', 'ICU', 'Floor 3', 8, '1:1', 'ICU-'], ['HDU', 'High dependency', 'Floor 3', 6, '1:2', 'HDU-'], ['NICU', 'Neonatal ICU', 'Floor 3', 4, '1:2', 'NICU-'], ['Private', 'Private', 'Floor 4', 8, '1:3', 'PVT-'], ['Maternity', 'General and labour', 'Floor 2', 14, '1:4', 'MAT-'], ['Paediatrics', 'General', 'Floor 2', 12, '1:5', 'PED-'], ['Isolation', 'Isolation', 'Floor 1', 2, '1:2', 'ISO-']];
    var w = W.filter(function (x) { return x[0] === cur; })[0] || W[1];
    var beds = [];
    if (w[0] === 'Ward 2') {
      var bay = { 1: 'Female', 2: 'Male', 3: 'Female', 4: 'Male', 5: 'Male', 6: 'Male' };
      for (var r = 1; r <= 6; r++) ['A', 'B'].forEach(function (s) {
        var id = 'W2-20' + r + '-' + s;
        beds.push([id, 'Semi-private', bay[r], r === 1 ? 'Oxygen, suction, near nursing station' : 'Oxygen, suction', 'No', id === 'W2-206-A' ? 'Blocked (maintenance)' : 'Active']);
      });
    } else {
      var n = Math.min(w[3], 8);
      for (var i = 1; i <= n; i++) {
        var id2 = w[5] + (w[5].indexOf('-') === w[5].length - 1 ? (i < 10 ? '0' : '') + i : (i < 10 ? '0' : '') + i);
        beds.push([id2, w[1], w[0] === 'ICU' || w[0] === 'Isolation' || w[0] === 'Private' ? 'Single room' : (i % 2 ? 'Female' : 'Male'), w[0] === 'ICU' ? 'Monitor, ventilator point, oxygen' : 'Oxygen', w[0] === 'Isolation' ? 'Airborne (negative pressure)' : 'No', 'Active']);
      }
    }
    return {
      nav: this.navItems('IpdConfig'),
      wards: W.map((x) => ({ n: x[0], cat: x[1], fl: x[2], beds: x[3], bg: x[0] === w[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ ward: x[0] }) })),
      cur: { n: w[0], cat: w[1], fl: w[2], ratio: w[4], beds: beds.map(function (b) { return { id: b[0], cat: b[1], bay: b[2], f: b[3], iso: b[4], s: b[5], c: b[5] === 'Active' ? 'bg' : 'ba' }; }) }
    };
  }
