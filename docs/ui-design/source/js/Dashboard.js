  renderVals() {
    return {
      nav: this.navItems('Dashboard'),
      kpis: [
        { l: 'OPD visits', v: '412', n: '64 waiting now', href: 'Opd.dc.html' }, { l: 'Admissions', v: '18', n: '4 planned', href: 'Admission.dc.html' },
        { l: 'Discharges', v: '14', n: '6 due by 2 pm', href: 'Beds.dc.html' }, { l: 'Occupancy', v: '86%', n: '103 of 120 beds', href: 'Beds.dc.html' },
        { l: 'Collection', v: '₹4.82 L', n: 'Up 12% vs last Thu', href: 'Billing.dc.html' }, { l: 'Approvals', v: '5', n: '2 high value', href: 'Approvals.dc.html' }
      ],
      wards: [['General Ward A', 92], ['General Ward B', 81], ['Semi-private', 88], ['Private', 70], ['ICU', 100], ['NICU', 75]].map(function (w) { return { n: w[0], p: w[1] + '%', t: w[0] + ': ' + w[1] + '% occupied' }; }),
      opd: [['General Medicine', 96, 18, '22 min'], ['Paediatrics', 61, 9, '15 min'], ['Orthopaedics', 54, 12, '31 min'], ['Cardiology', 47, 7, '19 min'], ['Gynaecology', 44, 10, '26 min'], ['Dermatology', 38, 8, '12 min']].map(function (o) { return { d: o[0], v: o[1], w: o[2], t: o[3] }; }),
      appr: [
        { t: 'Bill discount 15%', s: 'OP/26-27/000155 · Cashier Neha', b: 'L2', c: 'ba' },
        { t: 'Purchase order ₹1,84,000', s: 'Surgical consumables · Purchase', b: 'High value', c: 'br' },
        { t: 'Payroll September', s: '412 employees · Payroll Officer', b: 'L2', c: 'ba' },
        { t: 'New user with Billing Manager role', s: 'Rahul Mehta · Hospital Admin', b: 'Access', c: 'bb' },
        { t: 'Department: Nephrology', s: 'New department · Hospital Admin', b: 'Setup', c: 'bn' }
      ]
    };
  }
