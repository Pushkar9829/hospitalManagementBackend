  renderVals() {
    return {
      nav: this.navItems('PatientProfile'),
      tl: [['09 Oct 11:20', 'IPD', 'bb', 'Admitted to W2-204-B', 'Unstable angina · Dr. Meera Iyer · deposit ₹20,000'], ['09 Oct 10:58', 'OPD', 'bn', 'Consultation, cardiology', 'Follow-up · 4 medicines · 3 orders'], ['09 Oct 10:40', 'Lab', 'bg', 'Lipid profile, HbA1c released', 'LDL 168 mg/dL (high)'], ['09 Oct 10:30', 'Bill', 'bo', 'OP/26-27/000154 · ₹1,385 paid', 'UPI'],
        ['24 Sep', 'OPD', 'bn', 'Consultation, cardiology', 'Amlodipine increased to 10 mg'], ['02 Jun', 'OPD', 'bn', 'Consultation, general medicine', 'Viral fever'], ['15 Jan', 'Check-up', 'bg', 'Executive health check-up', 'Report released, 3 flags'], ['15 Jan', 'Radiology', 'bg', 'Chest X-ray', 'Normal']]
        .map(function (e) { return { d: e[0], k: e[1], c: e[2], t: e[3], s: e[4] }; })
    };
  }
