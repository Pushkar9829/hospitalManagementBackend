  renderVals() {
    var tab = (this.state && this.state.tab) || 'Completion and coding';
    var T = ['Completion and coding', 'Release requests', 'Birth register', 'Death and mortuary', 'Medico-legal', 'Statistics'];
    return {
      nav: this.navItems('Records'),
      tabs: T.map((t) => ({ l: t, on: t === tab, off: t !== tab, pick: () => this.setState({ tab: t }) })),
      showDef: tab === T[0], showRel: tab === T[1], showBirth: tab === T[2], showDeath: tab === T[3], showMlc: tab === T[4], showStats: tab === T[5],
      defs: [['IP/26-27/000837', 'R. Bose', '08 Oct', 'Dr. P. Joshi', 'Summary unsigned', 'Pending', 'ba'], ['IP/26-27/000833', 'D. Mehta', '09 Oct', 'Dr. P. Joshi', 'Consent scan, op notes', 'Pending', 'ba'], ['IP/26-27/000830', 'B. Gaikwad', '06 Oct', 'Dr. F. Khan', 'None', 'Coded', 'bg'], ['IP/26-27/000831', 'V. Deshmukh', '05 Oct', 'Dr. Meera Iyer', 'Progress note day 2', 'Pending', 'ba'], ['IP/26-27/000828', 'H. Singh', '06 Oct', 'Dr. R. Menon', 'MCCD copy', 'Pending', 'ba'], ['IP/26-27/000818', 'A. Pillai', '04 Oct', 'Dr. A. Thomas', 'None', 'Closed', 'bn']]
        .map(function (d) { return { ip: d[0], p: d[1], dt: d[2], dr: d[3], m: d[4], c: d[5], cc: d[6] }; })
    };
  }
