  renderVals() {
    var st = this.state || {};
    var idx = st.i || 0;
    var A = [
      { t: 'Bill discount 15%', s: 'OP/26-27/000155 · Sana Sheikh', w: '10:42 today', b: 'L2', c: 'ba', maker: 'Neha (Cashier)', l1: 'Billing Manager approved', l1c: 'bg', l2: 'Super Admin pending', l2c: 'ba',
        diff: [{ f: 'Discount', a: '0%', b: '15% (₹360)' }, { f: 'Net amount', a: '₹2,400', b: '₹2,040' }, { f: 'Reason code', a: '-', b: 'Senior citizen, hardship' }], why: 'Patient is 74, pensioner, repeat visits for dialysis review.' },
      { t: 'Purchase order ₹1,84,000', s: 'PO/26-27/000412 · Medline Surgicals', w: '09:15 today', b: 'High value', c: 'br', maker: 'Vikram (Purchase)', l1: 'HOD approved', l1c: 'bg', l2: 'Super Admin pending', l2c: 'ba',
        diff: [{ f: 'Items', a: '-', b: '14 lines, surgical consumables' }, { f: 'Value', a: '-', b: '₹1,84,000 + GST' }, { f: 'Budget left (Surgery)', a: '₹6,10,000', b: '₹4,26,000' }], why: 'Monthly replenishment; two items below reorder level.' },
      { t: 'Payroll September 2026', s: '412 employees · Net ₹1.63 Cr', w: 'yesterday', b: 'L2', c: 'ba', maker: 'Kiran (Payroll)', l1: 'HR Manager approved', l1c: 'bg', l2: 'Finance Controller pending', l2c: 'ba',
        diff: [{ f: 'Gross', a: '₹1.79 Cr (Aug)', b: '₹1.84 Cr' }, { f: 'Net', a: '₹1.59 Cr (Aug)', b: '₹1.63 Cr' }, { f: 'Variance warnings', a: '-', b: '3 employees over 25%' }], why: 'Includes arrears for 18 nurses after increment.' },
      { t: 'User role: Billing Manager', s: 'Rahul Mehta · new user', w: 'yesterday', b: 'Access', c: 'bb', maker: 'Hospital Admin', l1: 'Super Admin pending', l1c: 'ba', l2: 'not needed', l2c: 'bn',
        diff: [{ f: 'Roles', a: '-', b: 'Billing Manager' }, { f: 'Branch', a: '-', b: 'Main' }, { f: '2FA', a: '-', b: 'Required' }], why: 'Replacement for outgoing billing manager.' },
      { t: 'Department: Nephrology', s: 'New clinical department', w: '2 days ago', b: 'Setup', c: 'bn', maker: 'Hospital Admin', l1: 'Super Admin pending', l1c: 'ba', l2: 'not needed', l2c: 'bn',
        diff: [{ f: 'Code', a: '-', b: 'NEPH' }, { f: 'HOD', a: '-', b: 'Dr. S. Kulkarni' }, { f: 'Cost centre', a: '-', b: 'CC-114' }], why: 'Starting dialysis OPD from November.' }
    ];
    return {
      nav: this.navItems('Approvals'),
      items: A.map((a, i) => ({ t: a.t, s: a.s, w: a.w, b: a.b, c: a.c, on: i === idx, off: i !== idx, pick: () => this.setState({ i: i, d: null }) })),
      cur: A[idx], decided: !!st.d, decision: st.d || '',
      approve: () => this.setState({ d: 'Approved' }), reject: () => this.setState({ d: 'Rejected' })
    };
  }
