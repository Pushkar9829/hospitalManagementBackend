  renderVals() {
    var rg = (this.state && this.state.rg) || 'September';
    var M = rg === 'September';
    var f = M ? 1 : 1 / 30;
    var n = function (v) { return Math.round(v * f).toLocaleString('en-IN'); };
    var S = [['Collection to receipt', 22], ['Receipt to result', 48], ['Result to validation', 18], ['Validation to doctor viewing', 41]];
    var D = [['Biochemistry', 16840], ['Haematology', 9620], ['Immunoassay', 4180], ['Clinical pathology', 3260], ['Microbiology', 1240], ['Histopathology and cytology', 310]];
    return {
      nav: this.navItems('LabAnalytics'),
      ranges: ['Today', 'September'].map((r) => ({ l: r, k: r === rg ? 'taba' : 'tab', pick: () => this.setState({ rg: r }) })),
      rl: M ? 'September 2026' : 'average day',
      kpis: [{ l: 'Tests', v: n(35450), n: M ? 'September' : 'average day' }, { l: 'TAT within target', v: '94.2%', n: 'target 95%' }, { l: 'Sample rejection', v: '0.9%', n: 'target under 1%' }, { l: 'Critical calls in 30 min', v: '98.1%', n: 'target 100%' }, { l: 'QC runs rejected', v: '1.4%', n: 'of 1,380 runs' }, { l: 'Send-outs', v: '3.8%', n: 'of tests' }],
      stages: S.map(function (s) { return { n: s[0], v: s[1], w: Math.round(s[1] / 48 * 100) + '%', t: s[0] + ': ' + s[1] + ' min' }; }),
      depts: D.map(function (d) { return { n: d[0], v: n(d[1]), w: Math.round(d[1] / 16840 * 100) + '%', t: d[0] + ': ' + n(d[1]) + ' tests' }; }),
      tat: [['CBC', n(6210), '2 h', '1 h 10 min', '97%', 'On target', 'bg'], ['KFT and electrolytes', n(4880), '4 h', '2 h 05 min', '96%', 'On target', 'bg'], ['Troponin I', n(640), '1 h', '52 min', '88%', 'Below target', 'br'], ['TSH', n(1520), '6 h', '4 h 40 min', '93%', 'Watch', 'ba'], ['Blood culture (prelim)', n(410), '24 h', '19 h', '97%', 'On target', 'bg'], ['Histopathology', n(112), '3 days', '2.6 days', '90%', 'On target', 'bg']]
        .map(function (a) { return { n: a[0], v: a[1], t: a[2], m: a[3], p: a[4], s: a[5], c: a[6] }; }),
      ind: [['TAT within target', '94.2%', '95%', 'Below goal', 'ba'], ['Sample rejection rate', '0.9%', 'Under 1%', 'On target', 'bg'], ['Critical values called within 30 min', '98.1%', '100%', 'Missed (6 late calls)', 'br'], ['QC runs rejected', '1.4%', 'Under 2%', 'On target', 'bg'], ['EQAS acceptable', '96%', '95% or more', 'On target', 'bg'], ['Amended reports', '0.04%', 'Under 0.1%', 'On target', 'bg'], ['Blood culture contamination', '2.1%', 'Under 3%', 'On target', 'bg']]
        .map(function (i) { return { n: i[0], v: i[1], t: i[2], s: i[3], c: i[4] }; })
    };
  }
