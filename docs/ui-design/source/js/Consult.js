  renderVals() {
    var tab = (this.state && this.state.tab) || 'Prescription';
    var T = ['Notes', 'Prescription', 'Orders', 'Specialty templates', 'Certificates'];
    return {
      nav: this.navItems('Consult'),
      tabs: T.map((t) => ({ l: t, on: t === tab, off: t !== tab, pick: () => this.setState({ tab: t }) })),
      showNotes: tab === 'Notes', showRx: tab === 'Prescription', showOrders: tab === 'Orders', showSpec: tab === 'Specialty templates', showCert: tab === 'Certificates',
      hist: [['24 Sep 2026', 'OPD · Dr. Meera Iyer', 'BP 152/96, amlodipine increased'], ['24 Sep 2026', 'Lab · Lipid profile', 'LDL 168 mg/dL, high'], ['02 Jun 2026', 'OPD · Dr. R. Menon', 'Viral fever'], ['15 Jan 2026', 'Health check-up', 'Executive package'], ['15 Jan 2026', 'Radiology · Chest X-ray', 'Normal']].map(function (h) { return { d: h[0], t: h[1], n: h[2] }; }),
      rx: [['Ecosprin 75 mg tab', 'Aspirin', '1 tab', 'Once daily', 30, 'Oral', 'After lunch'], ['Amlodipine 10 mg tab', 'Amlodipine', '1 tab', 'Once daily', 30, 'Oral', 'Morning'], ['Atorvastatin 40 mg tab', 'Atorvastatin', '1 tab', 'At night', 30, 'Oral', 'After dinner'], ['Sorbitrate 5 mg tab', 'Isosorbide dinitrate', '1 tab', 'If chest pain', 10, 'Under tongue', 'Max 3 in 15 min']].map(function (r) { return { m: r[0], g: r[1], d: r[2], f: r[3], n: r[4], r: r[5], i: r[6] }; }),
      specs: [['Dental', 'Tooth chart and treatment plan'], ['Ophthalmology', 'Acuity, refraction, IOP'], ['Antenatal', 'LMP, EDD, ANC card'], ['Paediatrics', 'Growth chart, vaccines'], ['Dermatology', 'Body map and photos'], ['Physiotherapy', 'Sessions and progress']].map(function (s) { return { n: s[0], d: s[1] }; })
    };
  }
