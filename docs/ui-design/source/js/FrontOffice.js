  renderVals() {
    return {
      nav: this.navItems('FrontOffice'),
      counters: [['Registration', 'R-042', 6, '4 min'], ['Billing 1', 'B-118', 9, '6 min'], ['Billing 2', 'B-119', 7, '5 min'], ['Pharmacy', 'P-087', 12, '8 min'], ['Sample collection', 'S-064', 5, '7 min'], ['Radiology', 'X-021', 3, '11 min']].map(function (c) { return { n: c[0], t: c[1], w: c[2], a: c[3] }; }),
      enq: [['10:41', 'Meena J.', 'Knee replacement package cost', 'Phone', 'Lead to CRM', 'bo'], ['10:30', 'Arif Khan', 'Cardiologist availability Saturday', 'Walk-in', 'Booked', 'bg'], ['10:18', 'Divya R.', 'Executive health check-up', 'WhatsApp', 'Booked', 'bg'], ['10:02', 'Unknown', 'Visiting hours ICU', 'Phone', 'Answered', 'bn'], ['09:47', 'Prakash S.', 'MRI brain tariff', 'Phone', 'Follow-up', 'ba'], ['09:31', 'Lata M.', 'Bed availability private room', 'Walk-in', 'Answered', 'bn']].map(function (e) { return { t: e[0], n: e[1], q: e[2], c: e[3], o: e[4], bc: e[5] }; })
    };
  }
