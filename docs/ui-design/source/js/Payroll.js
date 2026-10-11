  renderVals() {
    var S = ['Draft', 'Calculated', 'Submitted', 'HR approved', 'Released', 'Locked'];
    var cur = 3;
    return {
      nav: this.navItems('Payroll'),
      steps: S.map(function (l, i) { return { n: 'Step ' + (i + 1), l: l, bg: i === cur ? '#E6EEF9' : (i < cur ? '#F3FAF6' : '#fff'), bd: i === cur ? '#1F5FAD' : '#DDE2E8' }; }),
      rows: [['Anjali Menon', 'Staff Nurse', 30, '₹38,400', '₹4,200', '₹1,800', '₹288', '₹200', '₹0', '₹40,312', ''], ['Rose Thomas', 'Staff Nurse', 30, '₹38,400', '₹7,800', '₹1,800', '₹347', '₹200', '₹0', '₹43,853', 'Net +27%'], ['Kavya N.', 'Staff Nurse', 26, '₹33,280', '₹0', '₹1,560', '₹250', '₹200', '₹0', '₹31,270', 'LOP 4 days'],
        ['Dr. R. Menon', 'Consultant', 30, '₹2,40,000', '₹0', '₹1,800', '₹0', '₹200', '₹38,500', '₹1,99,500', ''], ['Suresh Patil', 'Pharmacist', 30, '₹42,000', '₹1,200', '₹1,800', '₹0', '₹200', '₹0', '₹41,200', ''], ['Neha Kulkarni', 'Cashier', 30, '₹26,500', '₹0', '₹1,800', '₹199', '₹200', '₹0', '₹24,301', ''],
        ['M. Fernandes', 'Housekeeping Supervisor', 30, '₹24,000', '₹2,400', '₹1,800', '₹198', '₹200', '₹0', '₹24,202', ''], ['Imran A.', 'Staff Nurse', 30, '₹38,400', '₹9,600', '₹1,800', '₹360', '₹200', '₹0', '₹45,640', 'Net +31%']]
        .map(function (r) { return { n: r[0], g: r[1], d: r[2], gr: r[3], ot: r[4], pf: r[5], esi: r[6], pt: r[7], tds: r[8], net: r[9], w: r[10], warn: !!r[10] }; })
    };
  }
