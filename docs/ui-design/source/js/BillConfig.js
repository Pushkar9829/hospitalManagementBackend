  renderVals() {
    var off = (this.state && this.state.off) || {};
    var M = [['UPI (QR on device)', 'Axis soundbox on every counter; auto-match by amount and time'], ['Card machine', 'Pine Labs terminal; batch settles next day'], ['Cash', 'Limit ₹1,99,999 per person per day (section 269ST)'], ['Cheque', 'Corporates and deposits only; name and bank recorded'], ['Bank transfer (NEFT, RTGS, IMPS)', 'UTR entered; matched with bank statement'], ['Wallet and membership', 'Patient wallet balance; member price lists'], ['Payment link', 'UPI or card link by WhatsApp and SMS']];
    return {
      nav: this.navItems('BillConfig'),
      modes: M.map((m) => { var isOff = !!off[m[0]]; return { n: m[0], d: m[1], s: isOff ? 'Off' : 'On', c: isOff ? 'bn' : 'bg', pick: () => { var o = Object.assign({}, off); o[m[0]] = !isOff; this.setState({ off: o }); } }; }),
      series: [['OPD bill', 'OP/26-27/', '000931', 'Each financial year', 'A4 or 80 mm'], ['IPD final bill', 'IP/26-27/F/', '000318', 'Each financial year', 'A4'], ['Pharmacy sale', 'PH/26-27/', '004521', 'Each financial year', '80 mm'], ['Receipt', 'RC/26-27/', '004530', 'Each financial year', '80 mm'], ['Credit note', 'CN/26-27/', '000413', 'Each financial year', 'A4'], ['Corporate invoice', 'CI/26-27/', '0093', 'Each financial year', 'A4 with IRN QR'], ['Miscellaneous bill', 'MS/26-27/', '000077', 'Each financial year', '80 mm']]
        .map(function (s) { return { t: s[0], p: s[1], n: s[2], r: s[3], f: s[4] }; })
    };
  }
