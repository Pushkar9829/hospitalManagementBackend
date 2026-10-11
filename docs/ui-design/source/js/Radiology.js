  renderVals() {
    return {
      nav: this.navItems('Radiology'),
      list: [['USG Obstetric', 'RD-26-004410', 'Priya Shinde', 'Reporting', 'bo'], ['CT Brain plain', 'RD-26-004407', 'Mohan Lal', 'To report', 'ba'], ['X-ray Chest PA', 'RD-26-004405', 'S. Patil', 'To report', 'ba'], ['MRI L-S spine', 'RD-26-004401', 'Usha K.', 'To report', 'ba'], ['USG Abdomen', 'RD-26-004398', 'Arif Khan', 'Draft by resident', 'bb'], ['X-ray Knee AP/Lat', 'RD-26-004396', 'A. Joshi', 'To report', 'ba'], ['2D Echo', 'RD-26-004390', 'Ravi Kumar', 'Scheduled 15:00', 'bn']].map(function (s, i) { return { st: s[0], acc: s[1], p: s[2], s: s[3], c: s[4], bg: i === 0 ? '#E6EEF9' : 'transparent' }; })
    };
  }
