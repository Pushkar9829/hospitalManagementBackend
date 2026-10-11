  renderVals() {
    var pick = this.state && this.state.pick;
    var rows = [['Core Platform', 3000, 'Mandatory', 'on'], ['OPD and Appointments', 2000, 'Per branch', 'on'], ['IPD and Beds', 4800, '120 beds', 'on'], ['Nursing Station', 2400, 'Needs IPD', 'on'],
      ['Laboratory', 2500, 'Per branch', 'on'], ['Radiology', 2500, 'Per branch', 'off'], ['Pharmacy', 2500, 'Per branch', 'on'], ['Inventory', 2500, 'Per branch', 'on'],
      ['HR and Attendance', 6900, '230 employees', 'on'], ['Payroll', 5750, 'Needs HR', 'on'], ['Finance and Accounts', 3000, 'Per entity', 'on'], ['Medical Records', 1500, 'Per branch', 'off'],
      ['Diet and Kitchen', 1500, 'Needs IPD', 'off'], ['Housekeeping and Facility', 2000, 'Per branch', 'on'], ['Quality', 1500, 'Per branch', 'removing'], ['Patient CRM', 2000, 'Per branch', 'off']];
    var inr = function (n) { return '₹' + Math.round(n).toLocaleString('en-IN'); };
    var sel = rows.filter(function (r) { return r[0] === pick; })[0];
    var now = sel ? sel[1] * 20 / 30 : 0;
    return {
      nav: this.navItems('Subscription'),
      usage: [
        { l: 'Named users', v: '74 of 100', w: '74%', c: '#1D3557', n: '26 left' },
        { l: 'Licensed beds', v: '116 of 120', w: '97%', c: '#B4501A', n: 'Near limit: add beds before activating more' },
        { l: 'Branches', v: '2 of 3', w: '67%', c: '#1D3557', n: '1 left' },
        { l: 'Document storage', v: '88 of 250 GB', w: '35%', c: '#1D3557', n: 'Grows about 6 GB a month' },
        { l: 'SMS credits', v: '6,420 left', w: '13%', c: '#B4501A', n: 'Low balance: buy a pack' },
        { l: 'WhatsApp credits', v: '18,900 left', w: '63%', c: '#1D3557', n: 'Prepaid' }
      ],
      mods: rows.map((r) => {
        var on = r[3] === 'on', off = r[3] === 'off';
        return { n: r[0], p: inr(r[1]) + ' / mo', d: r[2], s: on ? 'Active' : (off ? 'Not subscribed' : 'Ends 31 Oct'), sc: on ? 'bg' : (off ? 'bn' : 'ba'),
          a: off ? 'Add' : (r[0] === 'Core Platform' ? 'Included' : (on ? 'Remove' : 'Undo')), pick: () => this.setState({ pick: off ? r[0] : null }) };
      }),
      hasChange: !!sel, noChange: !sel,
      pickName: sel ? sel[0] : '', pickPrice: sel ? inr(sel[1]) : '', pickNow: inr(now), pickGst: inr(now * 0.18), pickTotal: inr(now * 1.18)
    };
  }
