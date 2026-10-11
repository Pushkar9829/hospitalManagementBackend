  tabDefs() {
    return { main: 'Full registration', tabs: ['Quick registration', 'Full registration', 'ABHA Scan and Share', 'Search and merge'], panels: {
      'Quick registration': { title: 'Quick registration', sub: 'For busy counters. Missing details are flagged on the patient record until completed.', acts: ['Save and issue token', 'Save and bill'],
        form: [['Full name *', 'Mohan Lal', 2], ['Gender *', 'Male', 1], ['Age *', '62 years', 1], ['Mobile *', '98220 11223', 2], ['Visit for', 'General Medicine OPD', 2]],
        note: 'Quick registration takes 15 seconds. The UHID card prints and the welcome SMS goes out automatically.' },
      'ABHA Scan and Share': { title: 'ABHA Scan and Share', sub: 'Patients scan the hospital QR with an ABHA app. Their profile arrives here and a token is issued.', acts: ['Show hospital QR on screen', 'Print QR poster'],
        head: ['Time', 'Name', 'ABHA address', 'Age / sex', 'Match', 'Token', 'Action'],
        rows: [['10:52', 'Kiran Rao', 'kiranrao@abdm', '34 F', '~bg:New patient created', '#R-043', 'Open'], ['10:47', 'Vijay Pawar', 'vpawar@abdm', '58 M', '~bb:Existing UHID linked', '#R-042', 'Open'], ['10:40', 'Asha Kale', 'asha.k@abdm', '41 F', '~ba:Review possible match', '-', 'Review']] },
      'Search and merge': { title: 'Search and merge', sub: 'Duplicate records are merged with maker-checker approval. The merged UHID redirects to the surviving one.', acts: ['Request merge'],
        head: ['UHID', 'Name', 'Age', 'Mobile', 'Last visit', 'Visits', 'Duplicate score'],
        rows: [['#CC0000123', 'Ravi Kumar', '47 M', '98765 43210', '09 Oct 2026', '6', '-'], ['#CC0000077', 'Ravi Kumaar', '47 M', '98765 43210', '12 Aug 2026', '2', '~br:0.91'], ['#CC0000310', 'R. Kumar', '46 M', '98765 43211', '02 Feb 2026', '1', '~ba:0.64']] }
    } };
  }
