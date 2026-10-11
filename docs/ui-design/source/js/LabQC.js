  renderVals() {
    var sel = (this.state && this.state.q) || 'GLU1';
    var C = [
      ['GLU1', 'Glucose', 'Cobas c311 (biochemistry)', 'Level 1', 'L1-2604', 98, 'mg/dL', 3, 'Run rejected', 'br', [0.2, -0.5, 0.8, 1.1, -0.3, 0.4, -1.2, 0.6, 1.4, -0.7, 0.1, 0.9, -0.4, 1.6, 2.2, 0.3, -0.8, 0.5, 1.1, 3.2]],
      ['GLU2', 'Glucose', 'Cobas c311 (biochemistry)', 'Level 2', 'L2-2604', 278, 'mg/dL', 7, 'In control', 'bg', [0.1, 0.6, -0.4, 0.3, -1.1, 0.8, 0.2, -0.6, 1.0, -0.2, 0.5, -0.9, 0.4, 1.3, -0.5, 0.2, 0.7, -0.3, 0.9, 0.4]],
      ['HB1', 'Haemoglobin', 'Sysmex XN-550 (haematology)', 'Level 1', 'XN-L1-26', 6.2, 'g/dL', 0.15, 'Warning', 'ba', [-0.3, 0.4, 0.9, -0.6, 0.2, 1.1, -0.4, 0.5, -1.0, 0.3, 0.7, -0.2, 0.6, -0.8, 0.1, 1.2, 0.4, -0.5, 0.8, 2.1]],
      ['TROP', 'Troponin I', 'Mini Vidas (immunoassay)', 'Level 1', 'TN-0911', 0.12, 'ng/mL', 0.01, 'In control', 'bg', [0.4, -0.2, 0.3, -0.7, 0.9, 0.1, -0.4, 0.6, -0.1, 0.5, -0.9, 0.2, 0.8, -0.3, 0.4, -0.6, 0.3, 0.1, -0.2, 0.6]]
    ];
    var c = C.filter(function (x) { return x[0] === sel; })[0] || C[0];
    var Y = function (z) { return Math.round(130 - z * 36); };
    var Z = c[10];
    var pts = Z.map(function (z, i) { var a = Math.abs(z); return { x: (2 + i * 5).toFixed(1), y: Y(z), r: a >= 2 ? 6 : 4, d: a >= 2 ? 12 : 8, c: a >= 3 ? '#A3201A' : (a >= 2 ? '#B7791F' : '#1D3557'), t: 'Run ' + (i + 1) + ': ' + (c[5] + z * c[7]).toFixed(c[7] < 1 ? 2 : 0) + ' ' + c[6] + ' (' + (z > 0 ? '+' : '') + z.toFixed(1) + ' SD)' }; });
    var last = Z[Z.length - 1], prev = Z[Z.length - 2];
    var v = function (z) { return (c[5] + z * c[7]).toFixed(c[7] < 1 ? 2 : (c[7] < 1 ? 2 : 0)); };
    return {
      nav: this.navItems('LabQC'),
      kpis: [{ l: 'QC runs today', v: '46', n: '8 analysers' }, { l: 'In control', v: '44', n: '95.7%' }, { l: 'Runs rejected', v: '1', n: 'Glucose L1, 11:02' }, { l: 'Patient results held', v: '23', n: 'waiting for rerun' }, { l: 'EQAS this cycle', v: '96%', n: 'acceptable' }],
      ctl: C.map((x) => ({ t: x[1] + ' · ' + x[3], a: x[2].split(' (')[0], l: 'lot ' + x[4], s: x[8], c: x[9], bg: x[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ q: x[0] }) })),
      cur: { t: c[1], a: c[2], l: c[3], lot: c[4], m: c[5], u: c[6], sd: c[7], s: c[8], c: c[9] },
      bands: [[3, '+3 SD', '#A3201A', '4 4'], [2, '+2 SD', '#B7791F', '4 4'], [1, '+1 SD', '#9AA6B4', '2 4'], [0, 'Mean', '#1D3557', ''], [-1, '-1 SD', '#9AA6B4', '2 4'], [-2, '-2 SD', '#B7791F', '4 4'], [-3, '-3 SD', '#A3201A', '4 4']].map(function (b) { return { y: Y(b[0]), ty: Y(b[0]) - 7, l: b[1], c: b[2], st: b[3] ? 'dashed' : 'solid' }; }),
      pts: pts,
      log: [['Today 11:02 (run 20)', v(last), (last > 0 ? '+' : '') + last.toFixed(1), Math.abs(last) >= 3 ? '1-3s' : (Math.abs(last) >= 2 ? '1-2s' : 'None'), Math.abs(last) >= 3 ? 'br' : (Math.abs(last) >= 2 ? 'ba' : 'bg'), Math.abs(last) >= 3 ? 'Run rejected; 23 patient results held; reagent changed, recalibrating' : (Math.abs(last) >= 2 ? 'Warning; checked other rules, run accepted' : 'Accepted')],
            ['Today 07:30 (run 19)', v(prev), (prev > 0 ? '+' : '') + prev.toFixed(1), Math.abs(prev) >= 2 ? '1-2s' : 'None', Math.abs(prev) >= 2 ? 'ba' : 'bg', 'Accepted']]
        .map(function (r) { return { r: r[0], v: r[1], z: r[2], rule: r[3], c: r[4], a: r[5] }; })
    };
  }
