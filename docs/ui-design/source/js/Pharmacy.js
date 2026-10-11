  renderVals() {
    return {
      nav: this.navItems('Pharmacy'),
      queue: [['P-087', 'Ravi Kumar', 'Dr. Meera Iyer', 4, 'Picking', 'bo'], ['P-088', 'Divya R.', 'Dr. R. Menon', 2, 'Waiting', 'bb'], ['P-089', 'Baby Ishan', 'Dr. A. Thomas', 3, 'Waiting', 'bb'], ['P-090', 'Neeta P.', 'Dr. P. Joshi', 5, 'Waiting', 'bb'], ['P-086', 'Joseph D.', 'Dr. L. Gupta', 2, 'Paid', 'bg'], ['P-085', 'Sana S.', 'Dr. Meera Iyer', 3, 'Collected', 'bn']].map(function (q, i) { return { t: q[0], n: q[1], d: q[2], i: q[3], s: q[4], c: q[5], bg: i === 0 ? '#E6EEF9' : 'transparent' }; }),
      lines: [['Ecosprin 75 mg tab', 'Aspirin', 30, 'AS2401 (20) + AS2407 (10)', 'Jan 2027', '1,240', '₹4.35', '12%', '₹130.50'], ['Amlodipine 10 mg tab', 'Amlodipine', 30, 'AM1188', 'Sep 2027', '860', '₹6.20', '12%', '₹186.00'], ['Atorvastatin 40 mg tab', 'Atorvastatin', 30, 'AT2290', 'May 2027', '420', '₹21.10', '12%', '₹633.00'], ['Isordil 5 mg tab (substitute)', 'Isosorbide dinitrate', 10, 'IS0931', 'Dec 2026', '95', '₹11.29', '12%', '₹112.90']].map(function (l) { return { m: l[0], g: l[1], q: l[2], b: l[3], e: l[4], s: l[5], mrp: l[6], gst: l[7], a: l[8] }; })
    };
  }
