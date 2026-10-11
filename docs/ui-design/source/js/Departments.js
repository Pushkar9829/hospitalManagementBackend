  renderVals() {
    var D = [['GMED', 'General Medicine', 'Clinical', 'Dr. R. Menon', 38, 'OPD, IPD', 'CC-101', 'Active'], ['CARD', 'Cardiology', 'Clinical', 'Dr. Meera Iyer', 21, 'OPD, IPD, Procedures', 'CC-102', 'Active'],
      ['ORTH', 'Orthopaedics', 'Clinical', 'Dr. P. Joshi', 19, 'OPD, IPD', 'CC-103', 'Active'], ['PAED', 'Paediatrics', 'Clinical', 'Dr. A. Thomas', 24, 'OPD, IPD, NICU', 'CC-104', 'Active'],
      ['OBGY', 'Obstetrics and Gynaecology', 'Clinical', 'Dr. F. Khan', 26, 'OPD, IPD', 'CC-105', 'Active'], ['PATH', 'Laboratory', 'Diagnostic', 'Dr. N. Rao', 17, 'Diagnostics', 'CC-201', 'Active'],
      ['RADI', 'Radiology', 'Diagnostic', 'Dr. V. Singh', 12, 'Diagnostics', 'CC-202', 'Active'], ['PHAR', 'Pharmacy', 'Support', 'S. Patil', 10, 'Dispensing', 'CC-301', 'Active'],
      ['HKP', 'Housekeeping', 'Support', 'M. Fernandes', 46, '-', 'CC-305', 'Active'], ['NEPH', 'Nephrology', 'Clinical', 'Dr. S. Kulkarni', 0, 'OPD, IPD', 'CC-114', 'Pending approval'],
      ['DERM', 'Dermatology', 'Clinical', 'Dr. L. Gupta', 6, 'OPD, Procedures', 'CC-110', 'Active'], ['ADMN', 'Administration', 'Administrative', 'K. Desai', 22, '-', 'CC-401', 'Active']];
    return {
      nav: this.navItems('Departments'),
      deps: D.map(function (d) { return { c: d[0], n: d[1], t: d[2], h: d[3], s: d[4], v: d[5], cc: d[6], st: d[7], bc: d[7] === 'Active' ? 'bg' : 'ba' }; })
    };
  }
