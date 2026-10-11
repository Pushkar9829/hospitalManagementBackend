  renderVals() {
    var st = this.state || {};
    var sel = st.req || 'RQ-118';
    var done = st.done || {};
    var P = { E: ['Emergency', 'br'], U: ['Urgent', 'bo'], R: ['Routine', 'bn'], T: ['Transfer', 'bb'] };
    var R = [
      ['RQ-119', 'Ravi Kumar', 'Step-up from W2-204-B', 'ICU bed', 'E', '20 min', 'Dr. Meera Iyer (Cardiology)', 'M, 47 · IP/26-27/000871', 'Self', 'Cardiac monitor; nitroglycerin infusion', [['ICU-02', 'ICU', 'Frees when G. Kale steps down to Ward 2 (RQ-122)', 'Step-down pending', 'bo'], ['ICU-08', 'ICU', 'Reserved for a post-op patient at 15:00; only the Medical Superintendent can release it', 'Reserved', 'bb']], 'ICU is full. Fastest route: W2-202-B finishes cleaning, G. Kale moves out of ICU-02, ICU-02 is cleaned for Ravi Kumar (about 40 minutes). Escalated to the Medical Superintendent at 11:20; ward nurse keeps him on the cardiac monitor until then.'],
      ['RQ-123', 'Ramesh Gupta', 'New admission from OPD', 'Isolation room', 'U', '50 min', 'Dr. R. Menon (Medicine)', 'M, 47 · UHID CC0000502', 'Star Health (cashless, pre-auth sent)', 'Airborne isolation (suspected TB)', [['ISO-01', 'Isolation', 'Only isolation room; terminal clean in progress', 'Cleaning', 'ba'], ['ISO-02', 'Isolation', 'Occupied till 13 Oct', 'Occupied', 'br']], 'No isolation room free now. ISO-01 should be ready in about 20 minutes. Keep the patient masked in the OPD side room; do not place in an open ward.'],
      ['RQ-118', 'Sunita Pawar', 'New admission from OPD', 'Semi-private, female bay', 'R', '25 min', 'Dr. R. Menon (Medicine)', 'F, 54 · UHID CC0000471', 'Cash', 'Diabetic diet', [['W2-201-B', 'Semi-private', 'Female bay; near nursing station', 'Available', 'bg'], ['W2-202-B', 'Semi-private', 'Cleaning; ready in about 10 min', 'Cleaning', 'ba'], ['PVT-02', 'Private', 'Higher category: needs signed consent for ₹6,500 per day', 'Available', 'ba']], ''],
      ['RQ-122', 'G. Kale', 'Step-down from ICU-02', 'Semi-private, male bay', 'T', '15 min', 'Dr. R. Menon (Medicine)', 'M, 66 · IP/26-27/000849', 'CGHS', 'Fall risk: bed near station', [['W2-202-B', 'Semi-private', 'Male bay; cleaning, ready in about 10 min', 'Cleaning', 'ba'], ['PVT-08', 'Private', 'Higher category; CGHS covers general ward only, so the patient pays the difference', 'Available', 'ba']], 'No male semi-private bed is free right now. W2-202-B will be ready after cleaning; keep G. Kale in ICU-02 until then.'],
      ['RQ-120', 'J. Dsouza', 'Upgrade request from W2-205-B', 'Private', 'T', '40 min', 'Attendant at admission desk', 'M, 38 · IP/26-27/000846', 'HDFC Ergo (room rent limit ₹5,000 per day)', 'None', [['PVT-02', 'Private', '₹6,500 per day', 'Available', 'bg'], ['PVT-08', 'Private', '₹6,500 per day; corner room', 'Available', 'bg']], 'Insurance room-rent limit is ₹5,000 per day. A ₹6,500 room means the insurer may cut other charges in the same ratio (proportionate deduction). Attendant must sign the upgrade consent first.'],
      ['RQ-121', 'Meena Kadam', 'Planned surgery today 15:00', 'Private', 'R', 'Planned', 'Dr. P. Joshi (Orthopaedics)', 'F, 33 · UHID CC0000390', 'Package: knee arthroscopy', 'Pre-op: nil by mouth from 07:00', [['PVT-05', 'Private', 'Discharge due 14:00 (L. Das); package includes private room', 'Discharge due', 'bo'], ['PVT-08', 'Private', 'Free now', 'Available', 'bg']], '']
    ];
    var cur = R.filter(function (r) { return r[0] === sel; })[0] || R[0];
    var chosen = (st.bed && st.bed[cur[0]]) || cur[10][0][0];
    var isDone = !!done[cur[0]];
    return {
      nav: this.navItems('IpdBedRequests'),
      kpis: [{ l: 'Open requests', v: '6', n: '1 emergency, 2 transfers' }, { l: 'Request to bed', v: '24 min', n: 'median today · target 30' }, { l: 'Occupancy', v: '86%', n: '103 of 120 beds' }, { l: 'Discharges due today', v: '6', n: 'next at 11:00' }, { l: 'Beds in cleaning', v: '3', n: 'median 38 min' }],
      reqs: R.map((r) => ({ n: r[1], kind: r[2], want: r[3], pr: P[r[4]][0], pc: P[r[4]][1], wait: done[r[0]] ? 'Reserved' : r[5], bg: r[0] === cur[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ req: r[0] }) })),
      cur: { id: cur[0], n: cur[1], kind: cur[2], want: cur[3], pr: P[cur[4]][0], pc: P[cur[4]][1], wait: cur[5], by: cur[6], pt: cur[7], payer: cur[8], sp: cur[9], hasWarn: !!cur[11], warn: cur[11], chosen: chosen, isDone: isDone, canAlloc: !isDone && cur[10].some(function (b) { return b[0] === chosen && (b[3] === 'Available'); }),
        beds: cur[10].map((b) => ({ id: b[0], cat: b[1], why: b[2], s: b[3], c: b[4], bg: b[0] === chosen ? '#F1F6FD' : 'transparent', act: b[0] === chosen ? 'Selected' : 'Choose', pick: () => { var m = Object.assign({}, st.bed || {}); m[cur[0]] = b[0]; this.setState({ bed: m }); } })) },
      alloc: () => { var m = Object.assign({}, done); m[cur[0]] = true; this.setState({ done: m }); }
    };
  }
