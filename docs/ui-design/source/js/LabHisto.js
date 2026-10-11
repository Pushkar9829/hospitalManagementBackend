  renderVals() {
    var st = this.state || {};
    var sel = st.c || 'HP412', done = st.done || {};
    var S = ['Received', 'Grossed', 'Processed', 'Blocks and slides', 'Reported', 'Released'];
    var C = [
      ['HP412', 'HP-26-0412', 'Meena Kadam', 'Synovial tissue, right knee', 'OT · Dr. P. Joshi', 'Today 13:40', '10% formalin', 1, 'Grossed', 'bb', 'Knee arthroscopy for locking; suspected synovitis', 'Multiple grey-white soft tissue fragments, together 2.5 × 2 × 0.5 cm. All embedded.', [['A1', 'Synovial fragments', '2 (H&E)', 'H&E']], 'Pending (slides tomorrow)', 'Pending', 'Dr. P. Joshi'],
      ['HP409', 'HP-26-0409', 'D. Mehta', 'Gallbladder', 'OT · Dr. K. Rao (Surgery)', '06 Oct 15:20', '10% formalin', 4, 'Ready to report', 'bo', 'Cholecystectomy for gallstones', 'Gallbladder 8 × 3 cm, wall 0.4 cm, 6 mixed stones. Sections from fundus, body, neck and cystic duct node.', [['A1', 'Fundus', '1', 'H&E'], ['A2', 'Body and neck', '1', 'H&E'], ['A3', 'Cystic duct lymph node', '1', 'H&E']], 'Mucosa shows chronic inflammation with Rokitansky-Aschoff sinuses; no dysplasia or malignancy. Lymph node reactive.', 'Chronic calculous cholecystitis. No dysplasia or malignancy.', 'Dr. K. Rao'],
      ['HP405', 'HP-26-0405', 'Kavya Joshi', 'Breast lump, core biopsy', 'OPD · Dr. K. Rao (Surgery)', '03 Oct 11:00', '10% formalin, 8 h', 4, 'Special stains', 'ba', 'Left breast lump 2 cm, BI-RADS 4', '3 grey-white cores, 1 to 1.5 cm long, all embedded.', [['A1', 'Cores', '3 (H&E)', 'H&E, ER, PR, HER2 ordered']], 'Fibroepithelial lesion; immunostains pending to complete the report.', 'Pending immunohistochemistry', 'Dr. K. Rao']
    ];
    var c = C.filter(function (x) { return x[0] === sel; })[0] || C[0];
    var d = !!done[c[0]];
    return {
      nav: this.navItems('LabHisto'),
      kpis: [{ l: 'Cases in progress', v: '14', n: '3 biopsies urgent' }, { l: 'Received today', v: '5', n: '4 OT, 1 OPD' }, { l: 'Reported in 3 working days', v: '91%', n: 'target 90%' }, { l: 'Awaiting special stains', v: '2', n: 'immunohistochemistry' }, { l: 'Second opinions', v: '1', n: 'sent out' }],
      list: C.map((x) => ({ id: x[1], n: x[2], sp: x[3], st: done[x[0]] ? 'Released' : x[8], c: done[x[0]] ? 'bg' : x[9], bg: x[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ c: x[0] }) })),
      cur: { id: c[1], n: c[2], sp: c[3], from: c[4], rec: c[5], fix: c[6], st: d ? 'Released' : c[8], c: d ? 'bg' : c[9], clin: c[10], gross: c[11], micro: c[13], dx: c[14], doc: c[15],
        steps: S.map(function (l, i) { var k = d ? 6 : c[7]; return { l: l, c: i < k ? 'bg' : (i === k ? 'bb' : 'bn') }; }),
        blocks: c[12].map(function (b) { return { b: b[0], t: b[1], s: b[2], st: b[3] }; }) },
      done: d, canSign: !d && c[0] === 'HP409',
      sign: () => { var m = Object.assign({}, done); m[c[0]] = true; this.setState({ done: m }); }
    };
  }
