  renderVals() {
    var st = this.state || {};
    var sel = st.p || 'T2', step = st.step || 1, mode = st.mode || 'UPI', done = st.done || {};
    var Q = [
      ['T1', 'Sneha Patil', 'Follow-up, thyroid', 'Done', 'bg', 'CL-000412', 'F, 34', '98220 11873', 'Follow-up (free)', 'Review thyroid report', 'None known', '24 Sep', 'E03.9 Hypothyroidism'],
      ['T2', 'Rohan Gupta', 'Fever 3 days', 'With doctor', 'bb', 'CL-000588', 'M, 29', '99230 44120', 'New visit', 'Fever with body ache for 3 days', 'Sulfa drugs', 'First visit', 'A90 Dengue fever, suspected'],
      ['T3', 'Asha Kulkarni', 'BP review', 'Waiting', 'ba', 'CL-000201', 'F, 61', '98810 55210', 'Paid follow-up', 'BP review, headache', 'None known', '12 Aug', 'I10 Essential hypertension'],
      ['T4', 'Mohd. Arif', 'Cough, cold', 'Waiting', 'ba', 'CL-000590', 'M, 8', '97654 22018', 'New visit (walk-in)', 'Cough and cold for 2 days', 'None known', 'First visit', 'J06.9 Upper respiratory infection'],
      ['T5', 'Lata Shinde', 'Diabetes check', 'Booked 11:30', 'bn', 'CL-000356', 'F, 55', '90110 83472', 'Paid follow-up', 'Sugar review', 'Penicillin', '10 Sep', 'E11.9 Type 2 diabetes']
    ];
    var c = Q.filter(function (q) { return q[0] === sel; })[0] || Q[1];
    var isDone = !!done[c[0]];
    var S = ['1 · Patient and vitals', '2 · Consult and prescription', '3 · Bill', '4 · Print and send'];
    var bill = [['Consultation (new visit)', '1', '500.00'], ['Dengue NS1 rapid test (in-clinic)', '1', '600.00'], ['CBC (in-clinic)', '1', '350.00'], ['Paracetamol 650 mg', '10', '22.00'], ['ORS sachets', '6', '120.00']];
    return {
      nav: this.navItems('ClinicDesk'),
      waiting: Q.filter(function (q) { return q[3] === 'Waiting'; }).length,
      queue: Q.map((q) => ({ t: q[0], n: q[1], why: q[2], s: done[q[0]] ? 'Done' : q[3], c: done[q[0]] ? 'bg' : q[4], bg: q[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ p: q[0], step: 1 }) })),
      cur: { t: c[0], n: c[1], u: c[5], age: c[6], mob: c[7], visit: c[8], cc: c[9], allergy: c[10], last: c[11], dx: c[12], tests: c[0] === 'T2' ? 'Dengue NS1 rapid, CBC (in-clinic)' : 'None', fu: c[0] === 'T2' ? 'Sun 12 Oct with CBC' : 'In 30 days' },
      steps: S.map((l, i) => ({ l: l, k: i + 1 === step ? 'taba' : 'tab', pick: () => this.setState({ step: i + 1 }) })),
      s1: step === 1, s2: step === 2, s3: step === 3, s4: step === 4,
      vitals: [['BP', '118/76'], ['Pulse', '96'], ['Temp (°F)', '101.2'], ['SpO2', '98%'], ['Weight (kg)', '71']].map(function (v, i) { return { l: v[0], v: v[1], id: 'cdv' + i }; }),
      rx: [['Paracetamol 650 mg', '1 tablet', 'If fever, max 4 a day', '5', 'In stock', 'bg'], ['ORS sachet', '1 in 1 litre water', 'Through the day', '3', 'In stock', 'bg'], ['Avoid ibuprofen and aspirin', '-', 'Until dengue ruled out', '-', 'Advice', 'bn']].map(function (r) { return { d: r[0], o: r[1], w: r[2], n: r[3], s: r[4], c: r[5] }; }),
      bill: bill.map(function (b) { return { i: b[0], q: b[1], a: b[2] }; }), total: '1,592.00',
      modes: ['UPI', 'Card', 'Cash'].map((m) => ({ l: m, k: m === mode ? 'btn' : 'btn2', pick: () => this.setState({ mode: m }) })),
      outs: ['Print prescription (A5, English and Hindi)', 'Print receipt', 'Send prescription and bill on WhatsApp', 'Book follow-up and send reminder'],
      isDone: isDone, notLast: step < 4, canFinish: step === 4 && !isDone,
      nextLabel: ['Next: consult', 'Next: bill', 'Next: print and send'][step - 1] || '',
      next: () => this.setState({ step: Math.min(4, step + 1) }),
      finish: () => { var m = Object.assign({}, done); m[c[0]] = true; this.setState({ done: m }); }
    };
  }
