  renderVals() {
    var st = this.state || {};
    var sel = st.s || 'LB-26-018880', act = st.act || {};
    var OK = ['OK', 'bg'], BAD = ['Fails', 'br'], WARN = ['Check', 'ba'];
    var L = [
      ['LB-26-018880', 'G. Kale', 'ICU-02', 'KFT, electrolytes', '10:55', 'ICU nurse Joseph', 'Urgent', 'bo', 'Biochemistry', 'Rack B4, 7 days', 'ICU-02 nurse', [['Label matches wristband scan', 'Yes', OK], ['Container', 'Gold top (serum)', OK], ['Volume', '3.5 mL', OK], ['Time since collection', '25 min', OK], ['Haemolysis', 'None', OK], ['Payment or credit', 'In-patient running bill', OK]], 'None'],
      ['LB-26-018883', 'P. Rao', 'Ward 2 · W2-206-B', 'Electrolytes', '10:40', 'Nurse Anjali', 'Routine', 'bn', 'Biochemistry', 'Rack B4, 7 days', 'Ward 2 nurse', [['Label matches wristband scan', 'Yes', OK], ['Container', 'Gold top (serum)', OK], ['Volume', '3 mL', OK], ['Time since collection', '40 min', OK], ['Haemolysis', 'Moderate (pink serum)', BAD], ['Payment or credit', 'In-patient running bill', OK]], 'Haemolysed'],
      ['LB-26-018881', 'Sunita Pawar', 'OPD counter', 'CBC, fasting sugar', '11:20', 'Priya (counter)', 'Routine', 'bn', 'Haematology and biochemistry', 'Rack H2, 3 days', 'patient', [['Label matches', 'Yes', OK], ['Containers', 'EDTA purple, fluoride grey', OK], ['Volume', '2 mL, 2 mL', OK], ['Time since collection', '5 min', OK], ['Haemolysis', 'None', OK], ['Payment', 'Paid by UPI', OK]], 'None'],
      ['LB-26-018866', 'M. Lal', 'Ward 2 · W2-203-A', 'Wound swab culture', '09:50', 'Nurse Anjali', 'Micro', 'bb', 'Microbiology', 'Micro fridge, 7 days', 'Ward 2 nurse', [['Label matches wristband scan', 'Yes', OK], ['Container', 'Sterile swab in transport medium', OK], ['Site written', 'Left foot ulcer', OK], ['Time since collection', '1 h 30 min', WARN], ['Antibiotics started', 'Not yet', OK], ['Payment or credit', 'In-patient running bill', OK]], 'None'],
      ['HC-26-000410', 'Shobha Kale', 'Home · Kothrud', 'Fasting sugar, lipid profile', '08:00', 'Kiran (home)', 'Home', 'ba', 'Biochemistry', 'Rack B4, 7 days', 'patient', [['Bag seal intact', 'Yes', OK], ['Cool box temperature', '6 °C', OK], ['Label matches', 'Yes', OK], ['Time since collection', '3 h 30 min', OK], ['Haemolysis', 'None', OK], ['Payment', 'Paid at home by UPI', OK]], 'None']
    ];
    var c = L.filter(function (x) { return x[0] === sel; })[0] || L[0];
    var a = act[c[0]] || '';
    var T = function (x) { return a && x[0] === c[0] ? (a === 'acc' ? 'Accepted' : 'Rejected') : x[6]; };
    return {
      nav: this.navItems('LabSample'),
      kpis: [{ l: 'Received today', v: '412', n: 'samples' }, { l: 'Waiting for receipt', v: '18', n: '2 STAT in transit' }, { l: 'Rejected today', v: '4', n: '0.97% · target under 1%' }, { l: 'Median collection to receipt', v: '22 min', n: 'target 30' }, { l: 'Send-outs today', v: '9', n: '2 partner labs' }],
      list: L.map((x) => ({ id: x[0], n: x[1], src: x[2], st: act[x[0]] ? (act[x[0]] === 'acc' ? 'Accepted' : 'Rejected') : x[6], c: act[x[0]] ? (act[x[0]] === 'acc' ? 'bg' : 'br') : x[7], bg: x[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ s: x[0] }) })),
      cur: { id: c[0], n: c[1], src: c[2], tests: c[3], col: c[4], by: c[5], pr: c[6], pc: c[7], bench: c[8], store: c[9], tell: c[10], reason: c[12] === 'None' ? 'Choose a reason' : c[12],
        checks: c[11].map(function (k) { return { n: k[0], v: k[1], r: k[2][0], c: k[2][1] }; }) },
      open: !a, isAcc: a === 'acc', isRej: a === 'rej', now: '11:21',
      accept: () => { var m = Object.assign({}, act); m[c[0]] = 'acc'; this.setState({ act: m }); },
      reject: () => { var m = Object.assign({}, act); m[c[0]] = 'rej'; this.setState({ act: m }); }
    };
  }
