  renderVals() {
    return {
      nav: this.navItems('Patients'),
      recent: [['Sana Sheikh', 'CC0000122', '10:38'], ['Mohan Lal', 'CC0000121', '10:31'], ['Baby of Priya', 'CC0000120', '10:12'], ['Farah Ali', 'CC0000119', '10:05'], ['Joseph D.', 'CC0000118', '09:58'], ['Kavya N.', 'CC0000117', '09:41']].map(function (r) {
        return { n: r[0], u: r[1], t: r[2], i: r[0].split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2) };
      })
    };
  }
