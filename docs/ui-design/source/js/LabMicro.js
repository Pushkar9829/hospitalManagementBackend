  renderVals() {
    var st = this.state || {};
    var sel = st.c || 'BC', sent = st.sent || {};
    var R = function (d, m, r, s) { return [d, m, r, s]; };
    var C = [
      ['BC', 'LB-26-018874', 'S. Patil', 'Blood culture (2 sets)', 'Ward 2 · W2-201-A · Dr. R. Menon', '08 Oct 22:10', 'Ceftriaxone started 08 Oct 23:00', 'Prelim', 'bo', 'Gram-positive cocci in clusters at 18 h in 1 of 2 sets', 'Staphylococcus aureus (identification at 36 h)', 2, 'Send prelim to doctor', 'Dr. R. Menon',
        [R('Cefoxitin screen', '-', 'Pending', '-'), R('Oxacillin', 'pending', 'Pending', '-'), R('Vancomycin', 'pending', 'Pending', '-')]],
      ['SP', 'LB-26-018821', 'K. Nair', 'Sputum culture', 'Ward 2 · W2-205-A · Dr. R. Menon', '04 Oct 08:30', 'Piperacillin-tazobactam from 03 Oct', 'Final ready', 'bg', 'Gram-negative bacilli; heavy growth at 24 h', 'Klebsiella pneumoniae', 5, 'Release final report', 'Dr. R. Menon',
        [R('Amoxicillin-clavulanate', '≥32', 'R', 'Shown'), R('Ceftriaxone', '≥64', 'R', 'Shown'), R('Piperacillin-tazobactam', '8', 'S', 'Shown'), R('Ciprofloxacin', '0.5', 'S', 'Shown'), R('Amikacin', '4', 'S', 'Shown'), R('Meropenem', '≤0.25', 'S', 'Hidden (reserve; first-line sensitive)'), R('Colistin', '≤0.5', 'S', 'Hidden (reserve)')]],
      ['WS', 'LB-26-018866', 'M. Lal', 'Wound swab (left foot ulcer)', 'Ward 2 · W2-203-A · Dr. P. Joshi', 'Today 11:10', 'No antibiotics yet', 'Plated', 'bb', 'Gram stain: pus cells ++, Gram-positive cocci in chains', 'Pending (read at 24 h)', 1, 'Send Gram stain to doctor', 'Dr. P. Joshi', []],
      ['UR', 'LB-26-018790', 'F. Ali', 'Urine culture', 'Ward 2 · W2-204-A · Dr. R. Menon', '07 Oct 07:40', 'No antibiotics', 'No growth', 'bn', 'No growth at 48 h', 'No growth', 5, 'Release final report', 'Dr. R. Menon', []]
    ];
    var S = ['Received', 'Plated', 'Growth read', 'Identified', 'Sensitivity', 'Final'];
    var c = C.filter(function (x) { return x[0] === sel; })[0] || C[0];
    var isSent = !!sent[c[0]];
    return {
      nav: this.navItems('LabMicro'),
      kpis: [{ l: 'Cultures in progress', v: '38', n: '12 blood cultures' }, { l: 'Positive today', v: '6', n: '2 blood cultures' }, { l: 'Prelim within 24 h', v: '97%', n: 'target 95%' }, { l: 'Multi-drug resistant', v: '3', n: 'infection control told' }, { l: 'Contaminated blood cultures', v: '2.1%', n: 'target under 3%' }],
      list: C.map((x) => ({ n: x[2], sp: x[3], age: 'received ' + x[5], st: sent[x[0]] ? 'Sent' : x[7], c: sent[x[0]] ? 'bg' : x[8], bg: x[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ c: x[0] }) })),
      cur: { id: c[1], n: c[2], sp: c[3], loc: c[4], rec: c[5], abx: c[6], st: isSent ? 'Sent' : c[7], c: isSent ? 'bg' : c[8], gram: c[9], org: c[10], act: c[12], doc: c[13],
        steps: S.map(function (l, i) { return { l: l, c: i < c[11] ? 'bg' : (i === c[11] ? 'bb' : 'bn') }; }),
        hasAst: c[14].length > 0, ast: c[14].map(function (a) { return { d: a[0], m: a[1], r: a[2] === 'R' ? 'Resistant' : (a[2] === 'S' ? 'Sensitive' : (a[2] === 'I' ? 'Intermediate' : a[2])), c: a[2] === 'R' ? 'br' : (a[2] === 'S' ? 'bg' : 'bn'), s: a[3] }; }) },
      sent: isSent, notSent: !isSent,
      send: () => { var m = Object.assign({}, sent); m[c[0]] = true; this.setState({ sent: m }); }
    };
  }
