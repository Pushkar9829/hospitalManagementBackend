  renderVals() {
    var st = this.state || {};
    var sel = st.sel || 'Seema D.';
    var done = st.done || {};
    var A = [['11:20', 'Seema D.', 'Dr. Meera Iyer', 'Follow-up (free)', 'CC0000144', '52 F', 'Linked', '₹0 · free follow-up (day 12 of 15)', 'T-10', '12', '11:35', 'Pay nothing; go to triage', 'Check in and print token'],
      ['11:30', 'Gopal R.', 'Dr. P. Joshi', 'New', 'CC0000150', '63 M', 'Not linked · offer Scan and Share', '₹900 due', 'T-16', '7', '11:50', 'Billing counter, then triage', 'Check in and send to billing'],
      ['11:40', 'Rahul P.', 'Dr. Meera Iyer', 'Tele-consult (prepaid)', 'CC0000098', '38 M', 'Linked', '₹600 paid online', 'T-11', 'Video', '11:40', 'Video link sent', 'Mark ready for video'],
      ['11:40', 'Kiara S.', 'Dr. A. Thomas', 'Vaccination visit', 'CC0000161', '9 mo F', 'Linked (guardian)', '₹600 due + vaccine', 'T-23', '3', '11:55', 'Billing counter, then triage', 'Check in and send to billing'],
      ['11:50', 'Usha K.', 'Dr. L. Gupta', 'New (prepaid online)', 'CC0000088', '57 F', 'Linked', '₹700 paid online', 'T-13', '9', '12:05', 'Go to triage', 'Check in and print token']];
    var cur = A.filter(function (a) { return a[1] === sel; })[0] || A[0];
    var isDone = !!done[cur[1]];
    return {
      nav: this.navItems('OpdCheckin'),
      waiting: A.filter(function (a) { return !done[a[1]]; }).length,
      arr: A.map((a) => ({ t: a[0], n: a[1], d: a[2], v: a[3], s: done[a[1]] ? 'Checked in' : 'Expected', c: done[a[1]] ? 'bg' : 'bb', bg: a[1] === sel ? '#E6EEF9' : 'transparent', pick: () => this.setState({ sel: a[1] }) })),
      cur: { n: cur[1], t: cur[0], d: cur[2], v: cur[3], u: cur[4], age: cur[5], abha: cur[6], fee: cur[7], tk: cur[8], room: cur[9], eta: cur[10], next: cur[11], action: cur[12], doc: cur[2], s: isDone ? 'Checked in' : 'Expected', c: isDone ? 'bg' : 'bb', isDone: isDone, notDone: !isDone },
      checkin: () => { var o = Object.assign({}, done); o[cur[1]] = true; this.setState({ done: o }); }
    };
  }
