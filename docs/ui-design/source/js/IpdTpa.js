  renderVals() {
    var st = this.state || {};
    var sel = st.c || 'C2';
    var sent = st.sent || {};
    var Y = ['Sent', 'bg'], N = ['Missing', 'br'], NA = ['Not needed', 'bn'];
    var C = [
      ['C1', 'Ramesh Gupta', 'IP/26-27/000858', 'Star Health (direct)', 'SH-4471-2209', 'Pre-auth sent', 'ba', 'No reply 44 min', '₹5,00,000', '₹4,000 per day', '-', '₹4,200', 0, '₹0', 'Send reminder to insurer',
        [['10:58', 'Pre-auth sent with doctor’s note and chest X-ray'], ['10:40', 'Policy verified on insurer portal'], ['10:30', 'Admission advised by Dr. R. Menon']], [['Pre-auth form signed', Y], ['ID and policy card', Y], ['Doctor’s notes and X-ray', Y], ['Estimate', Y]]],
      ['C2', 'J. Dsouza', 'IP/26-27/000846', 'HDFC Ergo via Medi Assist (TPA)', 'HE-88213-01', 'Enhancement due', 'br', 'Bill at 92%', '₹3,00,000', '₹5,000 per day', '₹85,000', '₹78,600', 92, '₹2,150', 'Send enhancement request',
        [['09:00', 'Bill reached 92% of approval: enhancement suggested'], ['07 Oct 18:20', 'Approved ₹85,000 (initial)'], ['07 Oct 17:35', 'Pre-auth sent'], ['07 Oct 16:50', 'Admitted to W2-205-B']], [['Pre-auth form signed', Y], ['ID and policy card', Y], ['Updated treatment note', Y], ['Interim bill', Y], ['Latest investigations', N]]],
      ['C3', 'L. Das', 'IP/26-27/000840', 'ICICI Lombard (direct)', 'IL-55102-77', 'Final approval pending', 'ba', '1 h 05 min of 3 h', '₹10,00,000', 'No limit', '₹1,50,000', '₹1,42,300', 95, '₹3,400', 'Escalate to insurer helpdesk',
        [['10:37', 'Final bill and discharge summary sent for final approval'], ['10:15', 'Discharge advised for 14:00 by Dr. F. Khan'], ['06 Oct', 'Enhancement approved to ₹1,50,000'], ['04 Oct', 'Approved ₹90,000 (initial)']], [['Final bill', Y], ['Discharge summary (signed)', Y], ['Investigation reports', Y], ['Pharmacy bills', Y]]],
      ['C4', 'Mohan Rao', 'IP/26-27/000855', 'Niva Bupa (direct)', 'NB-30917-12', 'Query raised', 'br', 'Since 09:40', '₹5,00,000', '1% of sum insured', '-', '₹38,900', 0, '₹0', 'Send query reply',
        [['09:40', 'Query: send ECG and troponin report'], ['08:55', 'Pre-auth sent (within 24 h of emergency admission)'], ['08 Oct 22:10', 'Admitted from emergency to W1-106-A']], [['Pre-auth form signed', Y], ['ID and policy card', Y], ['ECG', N], ['Troponin report', N]]],
      ['C5', 'G. Kale', 'IP/26-27/000849', 'CGHS (government scheme)', 'CGHS-77120', 'Approved', 'bg', 'Package', 'Package rates', 'General ward eligible', '₹62,000', '₹41,000', 66, '₹0', 'Upload daily notes',
        [['08:00', 'Daily notes uploaded'], ['05 Oct', 'Approved: pneumonia package ₹62,000 (ICU step-down planned)'], ['05 Oct', 'Beneficiary verified']], [['Referral letter', Y], ['CGHS card', Y], ['Daily notes', Y], ['Photos as scheme requires', NA]]],
      ['C6', 'T. Shah', 'IP/26-27/000839', 'Bajaj Allianz (direct)', 'BA-20931-08', 'Final approved', 'bg', 'In 1 h 20 min', '₹4,00,000', '₹6,000 per day', '₹54,200', '₹54,200', 100, '₹1,850', 'File claim',
        [['10:50', 'Final approval ₹54,200; patient paid ₹1,850'], ['09:30', 'Sent for final approval'], ['05 Oct', 'Approved ₹60,000']], [['Final bill', Y], ['Discharge summary', Y], ['Pharmacy bills', Y], ['Claim form', N]]]
    ];
    var cur = C.filter(function (c) { return c[0] === sel; })[0] || C[1];
    var isSent = !!sent[cur[0]];
    var tl = cur[15].slice();
    if (isSent) tl.unshift(['now', cur[14].replace('Send ', '').replace(/^./, function (x) { return x.toUpperCase(); }) + ' sent']);
    return {
      nav: this.navItems('IpdTpa'),
      kpis: [{ l: 'Insured in hospital', v: '38', n: 'of 103 in-patients' }, { l: 'Waiting for insurer', v: '3', n: 'oldest 44 min' }, { l: 'Median first reply', v: '52 min', n: 'IRDAI target 1 h' }, { l: 'Final approval time', v: '2 h 05 min', n: 'median this week · target 3 h' }, { l: 'Claims unpaid over 45 days', v: '₹8.4 L', n: '17 claims' }],
      cases: C.map((c) => ({ n: c[1], ins: c[3], s: c[5], sc: c[6], t: c[7], bg: c[0] === cur[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ c: c[0] }) })),
      cur: { n: cur[1], ip: cur[2], ins: cur[3], insShort: cur[3].split(' (')[0].split(' via ')[0], pol: cur[4], s: cur[5], sc: cur[6], si: cur[8], rr: cur[9], ap: cur[10], bill: cur[11], pct: cur[12] ? cur[12] + '%' : 'Not approved yet', w: cur[12] + '%', barc: cur[12] >= 90 ? '#A3201A' : '#1D3557', ps: cur[13], act: cur[14], isSent: isSent, notSent: !isSent,
        tl: tl.map(function (e) { return { t: e[0], d: e[1] }; }), docs: cur[16].map(function (d) { return { n: d[0], s: d[1][0], c: d[1][1] }; }) },
      send: () => { var m = Object.assign({}, sent); m[cur[0]] = true; this.setState({ sent: m }); }
    };
  }
