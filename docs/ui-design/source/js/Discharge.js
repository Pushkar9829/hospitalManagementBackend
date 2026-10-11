  renderVals() {
    var Y = ['bg', 'Clear'], N = ['ba', 'Pending'], R = ['br', 'Dues'];
    var D = [['K. Nair', 'W2-205-A', '14:00', Y, Y, Y, N], ['T. Shah', 'W1-112-B', '12:30', Y, Y, Y, Y], ['L. Das', 'PVT-05', '14:00', N, Y, N, N], ['ICU-02 patient', 'ICU-02', '11:00', Y, N, Y, N], ['A. Joshi', 'W2-202-A', '16:00', N, Y, Y, R], ['T. Kulkarni', 'W1-104-A', '17:00', N, N, N, N]];
    return {
      nav: this.navItems('Discharge'),
      dis: D.map(function (d, i) { return { n: d[0], b: d[1], t: d[2], p: d[3][0], pt: d[3][1], l: d[4][0], lt: d[4][1], u: d[5][0], ut: d[5][1], f: d[6][0], ft: d[6][1], bg: i === 0 ? '#E6EEF9' : 'transparent' }; })
    };
  }
