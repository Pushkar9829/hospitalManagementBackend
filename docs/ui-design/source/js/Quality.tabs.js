  tabDefs() {
    return { main: 'Indicators', tabs: ['Indicators', 'Incidents', 'Complaints', 'Feedback', 'Infection control', 'Audits', 'Documents'], panels: {
      'Incidents': { title: 'Incident register', acts: ['Report incident'], head: ['No.', 'Date', 'Type', 'Where', 'Severity', 'Root cause', 'Corrective action', 'Stage'],
        rows: [['#INC-0192', '09 Oct', 'Patient fall', 'Ward 2', '~ba:Moderate', 'Wet floor, no sign', 'Signage SOP, bed rails audit', '~bb:Investigation'], ['#INC-0191', '08 Oct', 'Medication error (near miss)', 'ICU', '~bn:No harm', 'Look-alike vials', 'Separate storage, tall-man labels', '~bo:Corrective action'], ['#INC-0188', '06 Oct', 'Needle-stick', 'Laboratory', '~ba:Moderate', 'Recapping', 'Retraining, safety needles', '~bo:Follow-up']] },
      'Complaints': { title: 'Complaints and grievances', acts: ['Log complaint'], head: ['No.', 'Patient', 'Category', 'Received', 'Owner', 'TAT', 'Status'],
        rows: [['#CMP-0311', 'Sana S.', 'Billing wait time', '08 Oct', 'Billing Manager', '~br:Over 72 h', '~bb:Open'], ['#CMP-0310', 'Mohan L.', 'Food temperature', '08 Oct', 'Kitchen Supervisor', '30 h', '~bb:Open'], ['#CMP-0306', 'Arif K.', 'Staff behaviour', '05 Oct', 'Nursing Supt.', '48 h', '~bg:Closed, patient informed']] },
      'Feedback': { title: 'Patient feedback', kpis: [['Net Promoter Score', '+62'], ['Responses this month', '1,284'], ['OPD rating', '4.4 / 5'], ['IPD rating', '4.6 / 5']],
        head: ['Department', 'Responses', 'Rating', 'Top praise', 'Top concern'], rows: [['Cardiology', '182', '4.7', 'Doctor explained clearly', 'Waiting time'], ['Billing', '410', '3.9', 'Quick UPI payment', 'Queue at noon'], ['Nursing (IPD)', '214', '4.6', 'Caring staff', 'Night noise']] },
      'Infection control': { title: 'Hospital-acquired infection surveillance', acts: ['Log infection event'], head: ['Indicator', 'Events', 'Device days', 'Rate per 1,000', 'Benchmark'],
        rows: [['Catheter-associated UTI', '2', '1,104', '1.8', '~bg:Below 3.0'], ['Central line bloodstream infection', '1', '1,112', '0.9', '~bg:Below 2.0'], ['Ventilator-associated pneumonia', '2', '620', '3.2', '~ba:Near 3.5'], ['Surgical site infection (Phase 2 OT)', '-', '-', '-', '~bn:Phase 2']] },
      'Audits': { title: 'Clinical and process audits', acts: ['New audit'], head: ['Audit', 'Area', 'Date', 'Score', 'Actions', 'Status'],
        rows: [['Hand hygiene', 'ICU', '07 Oct', '~bg:91%', '1', '~bg:Closed'], ['MAR compliance', 'Ward 2', '05 Oct', '~ba:84%', '3', '~bb:Actions open'], ['Crash cart check', 'All wards', '01 Oct', '~bg:100%', '0', '~bg:Closed']] },
      'Documents': { title: 'Policies and SOPs', acts: ['Upload document'], head: ['Document', 'Version', 'Owner', 'Review due', 'Read by staff'],
        rows: [['Medication management policy', 'v4.1', 'Pharmacy In-charge', 'Mar 2027', '~bg:96%'], ['Fall prevention SOP', 'v2.0', 'Nursing Supt.', 'Dec 2026', '~ba:78%'], ['Biomedical waste SOP', 'v3.2', 'Infection Control', 'Jan 2027', '~bg:92%']] }
    } };
  }
