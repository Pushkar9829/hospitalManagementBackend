  renderVals() {
    var st = this.state || {};
    var tab = st.tab || 'Medication (MAR)', selP = st.p || 'W2-204-B';
    var T = ['Medication (MAR)', 'Vitals', 'Nursing notes', 'Intake and output', 'ICU chart', 'Indents'];
    var P = [['W2-201-A', 'S. Patil', 'Pneumonia', 'Meds due', 'bo'], ['W2-202-A', 'A. Joshi', 'Post-op knee', 'Fall risk', 'ba'], ['W2-203-A', 'M. Lal', 'Diabetic foot', 'Dressing', 'bb'], ['W2-204-A', 'F. Ali', 'Dengue', 'Vitals due', 'ba'],
      ['W2-204-B', 'Ravi Kumar', 'Unstable angina', 'Meds due', 'bo'], ['W2-205-A', 'K. Nair', 'COPD', 'Discharge', 'bg'], ['W2-205-B', 'J. Dsouza', 'Cellulitis', 'Stable', 'bn'], ['W2-206-B', 'P. Rao', 'Gastroenteritis', 'NBM', 'br']];
    var times = ['06:00', '08:00', '10:00', '12:00', '14:00', '18:00', '22:00'];
    var G = { g: ['Given', 'bg'], d: ['Due', 'bo'], l: ['Late', 'br'], h: ['Held', 'bn'], u: ['Upcoming', 'bb'], x: ['-', 'bn'] };
    var mar = [['Ecosprin 75 mg', 'Oral · once daily', 'xxgxxxx'], ['Enoxaparin 60 mg', 'SC · twice daily', 'xxdxxxu'], ['Atorvastatin 40 mg', 'Oral · night', 'xxxxxxu'], ['Metoprolol 25 mg', 'Oral · twice daily', 'xgxxxux'], ['Pantoprazole 40 mg', 'IV · before breakfast', 'gxxxxxx'], ['Nitroglycerin infusion', 'IV · titrate to pain', 'hxlxxxx']];
    return {
      nav: this.navItems('Nursing'),
      tabs: T.map((t) => ({ l: t, on: t === tab, off: t !== tab, pick: () => this.setState({ tab: t }) })),
      showMar: tab === T[0], showVitals: tab === T[1], showNotes: tab === T[2], showIo: tab === T[3], showIcu: tab === T[4], showInd: tab === T[5],
      pts: P.map((p) => ({ bed: p[0], n: p[1], dx: p[2], f: p[3], fc: p[4], bg: p[0] === selP ? '#E6EEF9' : 'transparent', pick: () => this.setState({ p: p[0] }) })),
      times: times,
      mar: mar.map(function (m) { return { d: m[0], o: m[1], cells: m[2].split('').map(function (k) { return { l: G[k][0], c: G[k][1] }; }) }; })
    };
  }
