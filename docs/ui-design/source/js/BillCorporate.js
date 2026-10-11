  renderVals() {
    var st = this.state || {};
    var sel = st.c || 'TM', sent = !!st.sent;
    var C = [
      ['TM', 'Tata Motors', 'Corporate · employees and families', '27AAACT2727Q1ZW', 'Tariff less 15%', 'Active', 'bg', '₹10,00,000', '₹6,42,300', 64, '30 days', '₹0', 'Draft ready · 41 bills · ₹3,18,640', [['Anil Pawar', 'OPD + tests', '#OP/26-27/000812', '₹4,260', 'No (exempt)'], ['Seema Rao', 'IPD 3 days, private room ₹6,500', '#IP/26-27/000809', '₹68,400', 'Room rent 5% GST'], ['Kiran Deshmukh', 'Health check-up', '#OP/26-27/000790', '₹3,200', 'No (exempt)'], ['Rohit Kale', 'Pharmacy (OPD)', '#PH/26-27/004410', '₹1,840', 'Yes (by HSN)']]],
      ['BA', 'Bajaj Auto', 'Corporate · employees only', '27AAACB3370K1ZQ', 'Tariff less 10%', 'Near limit', 'ba', '₹5,00,000', '₹4,61,000', 92, '45 days', '₹1,12,000', 'Draft ready · 22 bills · ₹1,84,200', [['Vivek Joshi', 'IPD 2 days', '#IP/26-27/000801', '₹42,300', 'No (exempt)'], ['Sanjay Patil', 'OPD + MRI', '#OP/26-27/000799', '₹9,800', 'No (exempt)']]],
      ['PMC', 'Pune Municipal Corporation', 'Government body · credit', '27AAALP0222M1Z1', 'CGHS-like rates', 'Active', 'bg', '₹20,00,000', '₹7,10,000', 36, '60 days', '₹2,40,000', 'Draft ready · 58 bills · ₹4,02,900', [['Ward staff (12)', 'OPD', 'Several', '₹38,400', 'No (exempt)']]],
      ['INF', 'Infosys, Pune campus', 'Health check-up partner', '27AAACI4798L1ZE', 'Package rates', 'On hold', 'br', '₹3,00,000', '₹3,12,000', 104, '30 days', '₹3,12,000 (68 days)', 'On hold: payment overdue', [['Annual check-ups (96)', 'Packages', 'Several', '₹3,12,000', 'No (exempt)']]]
    ];
    var c = C.filter(function (x) { return x[0] === sel; })[0] || C[0];
    return {
      nav: this.navItems('BillCorporate'),
      kpis: [{ l: 'Active corporates', v: '18', n: '2 on hold' }, { l: 'Credit outstanding', v: '₹15.7 L', n: 'all corporates' }, { l: 'Overdue', v: '₹6.6 L', n: '3 corporates' }, { l: 'Days to collect', v: '41', n: 'target under 45' }, { l: 'September invoices', v: '14 of 18', n: '4 drafts late (due 5 Oct)' }],
      list: C.map((x) => ({ n: x[1], t: x[2], s: x[5], sc: x[6], bg: x[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ c: x[0], sent: false }) })),
      cur: { n: c[1], t: c[2], g: c[3], rc: c[4], s: c[5], sc: c[6], lim: c[7], used: c[8], pct: Math.min(c[9], 100) + '%', barc: c[9] >= 90 ? '#A3201A' : '#1D3557', per: c[10], od: c[11], inv: c[12],
        rows: c[13].map(function (r) { return { e: r[0], v: r[1], b: r[2], a: r[3], t: r[4] }; }) },
      sent: sent, notSent: !sent && c[5] !== 'On hold',
      send: () => this.setState({ sent: true })
    };
  }
