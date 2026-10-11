  tabDefs() {
    return { main: 'Today', tabs: ['Today', 'Visitor log', 'Patient locator', 'Enquiry history'], panels: {
      'Visitor log': { title: 'Visitor log', acts: ['Export'], head: ['Time in', 'Visitor', 'Patient', 'Bed', 'Pass', 'Time out'],
        rows: [['10:12', 'Sunita Kumar', 'Ravi Kumar', '#W2-204-B', 'Attendant', '-'], ['09:40', 'Imran Sheikh', 'R. Shetty', '#ICU-04', 'Visitor', '11:20'], ['09:05', 'Rekha Pillai', 'L. Das', '#PVT-05', 'Attendant', '-']] },
      'Patient locator': { title: 'Patient locator', sub: 'Shows ward and bed only. No clinical details. VIP and medico-legal patients are hidden.', form: [['Search admitted patient', 'Kumar', 2]],
        head: ['Patient', 'Ward', 'Bed', 'Visiting hours'], rows: [['Ravi Kumar', 'Ward 2, floor 2', '#W2-204-B', '16:00 to 19:00'], ['Sunil Kumar', 'General Ward A', '#W1-104-B', '16:00 to 19:00']] },
      'Enquiry history': { title: 'Enquiry history', head: ['Date', 'Enquiries', 'Booked', 'Leads to CRM', 'Top topic'], rows: [['09 Oct', '31', '12', '4', 'Doctor availability'], ['08 Oct', '44', '19', '6', 'Health check-up packages'], ['07 Oct', '38', '15', '3', 'MRI tariff']] }
    } };
  }
