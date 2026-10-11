  renderVals() {
    var st = this.state || {};
    var view = st.view || 'By service';
    var credited = !!st.credited, fin = !!st.fin;
    var G = [['Room and nursing (semi-private)', '6 days × ₹2,800', 'Midnight census', '16,800.00'], ['Consultant visits', '12 × ₹800', 'Rounds note signed', '9,600.00'], ['Chest physiotherapy', '5 × ₹500', 'Service order', '2,500.00'], ['Laboratory', '14 tests', 'Lab orders', '9,850.00'], ['Radiology', '3 studies', 'Radiology orders', '1,900.00'], ['Pharmacy (incl. GST)', '46 items', 'Ward issues', '14,320.00'], ['Consumables', '38 items', 'Ward issues', '4,260.00'], ['Oxygen', '62 h × ₹60', 'Nursing chart', '3,720.00'], ['BiPAP', '2 days × ₹1,500', 'Equipment log', '3,000.00'], ['Diet', '18 meals', 'Kitchen', '2,700.00']];
    var D = [['03 Oct (Fri)', 'Admitted 22:40 from emergency', 'Room, BiPAP, oxygen, lab panel', '14,980.00'], ['04 Oct (Sat)', 'Day 2', 'Room, BiPAP, oxygen, 2 visits', '13,450.00'], ['05 Oct (Sun)', 'Day 3', 'Room, oxygen, X-ray, pharmacy', '12,300.00'], ['06 Oct (Mon)', 'Day 4 · deposit top-up ₹20,000', 'Room, oxygen, physiotherapy', '10,120.00'], ['07 Oct (Tue)', 'Day 5', 'Room, physiotherapy, lab', '8,640.00'], ['08 Oct (Wed)', 'Day 6', 'Room, visits, pharmacy', '6,210.00'], ['09 Oct (Thu)', 'Day 7 · discharge 14:00', 'Visits, discharge medicines', '2,950.00']];
    var L = view === 'By service' ? G : D;
    var Y = ['Done', 'bg'], Pd = ['Pending', 'ba'];
    return {
      nav: this.navItems('IpdBill'),
      kpis: [{ l: 'In-patients on cash or corporate', v: '65', n: '38 more on insurance' }, { l: 'Deposit below 20%', v: '4', n: 'top-up SMS sent' }, { l: 'Discharges to bill today', v: '6', n: '1 final, 2 drafts' }, { l: 'Final bill time', v: '38 min', n: 'median this week · target 45' }, { l: 'Refunds due', v: '₹22,600', n: '3 patients' }],
      pts: [['K. Nair', 'W2-205-A', 'Cash', fin ? 'Final' : 'Final draft', fin ? 'bg' : 'ba', true], ['A. Joshi', 'W2-202-A', 'Cash', 'Dues ₹18,400', 'br'], ['F. Ali', 'W2-204-A', 'Cash (claim denied)', 'Deposit 85% used', 'bo'], ['L. Das', 'PVT-05', 'ICICI Lombard', 'Insurer final pending', 'ba'], ['Ravi Kumar', 'W2-204-B', 'Self', 'Running', 'bn'], ['J. Dsouza', 'W2-205-B', 'HDFC Ergo', 'Enhancement due', 'bo']]
        .map(function (p) { return { n: p[0], bed: p[1], payer: p[2], s: p[3], c: p[4], bg: p[5] ? '#E6EEF9' : 'transparent' }; }),
      stl: fin ? 'Final bill made' : 'Final draft', stc: fin ? 'bg' : 'ba',
      cred: credited ? '₹1,240' : '₹0', bal: credited ? '₹17,410' : '₹18,650',
      views: ['By service', 'By day'].map((v) => ({ l: v, k: v === view ? 'taba' : 'tab', pick: () => this.setState({ view: v }) })),
      head: view === 'By service' ? ['Service group', 'Quantity', 'Source', 'Amount (₹)'] : ['Date', 'Note', 'Main charges', 'Amount (₹)'],
      lines: L.map(function (l) { return { a: l[0], b: l[1], c: l[2], d: l[3] }; }),
      checks: [['Discharge summary signed', ['Awaiting consultant', 'ba']], ['All lab and radiology charges posted', Y], ['Pharmacy returns credited', credited ? Y : Pd], ['No pending discount approvals', Y], ['Final bill made', fin ? Y : Pd]].map(function (c) { return { n: c[0], s: c[1][0], c: c[1][1] }; }),
      needReturns: !credited, canFinal: credited && !fin, isFinal: fin,
      credit: () => this.setState({ credited: true }), finalise: () => this.setState({ fin: true })
    };
  }
