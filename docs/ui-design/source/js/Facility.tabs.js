  tabDefs() {
    return { main: 'Housekeeping', tabs: ['Housekeeping', 'Linen and laundry', 'Maintenance tickets', 'Biomedical equipment', 'Biomedical waste', 'Patient transport'], panels: {
      'Linen and laundry': { title: 'Linen and laundry', acts: ['Collect soiled linen', 'Receive from laundry'], kpis: [['Sent to laundry today', '418 pcs'], ['Received back', '396 pcs'], ['Shortage', '22 pcs'], ['Condemned this month', '64 pcs']],
        head: ['Ward', 'Linen type', 'Par level', 'On ward', 'Soiled collected', 'Status'], rows: [['Ward 2', 'Bedsheet', '36', '30', '14', '~ba:Below par'], ['ICU', 'Bedsheet', '24', '24', '18', '~bg:OK'], ['Ward 2', 'Patient gown', '30', '27', '11', '~bg:OK']] },
      'Maintenance tickets': { title: 'Maintenance tickets', acts: ['Raise ticket'], head: ['Ticket', 'Issue', 'Location', 'Category', 'Priority', 'Assigned to', 'Age', 'Status'],
        rows: [['#MT-1188', 'AC not cooling', 'OT corridor', 'Electrical', '~br:High', 'Ramesh (Electrician)', '2 h', '~bb:In progress'], ['#MT-1187', 'Printer offline', 'Billing 2', 'IT', '~ba:Medium', 'IT desk', '40 min', '~bo:Assigned'], ['#MT-1185', 'Leaking tap', 'W2 toilet 3', 'Plumbing', '~bn:Low', 'Santosh', '1 day', '~bg:Resolved']] },
      'Biomedical equipment': { title: 'Biomedical equipment', acts: ['Add equipment', 'PM calendar'], head: ['Equipment', 'Location', 'Risk', 'Last PM', 'Next PM', 'Calibration', 'Contract', 'Status'],
        rows: [['Ventilator V-03', 'ICU', 'High', '02 Jul', '~br:05 Oct (overdue)', 'Valid', 'AMC to Mar 2027', '~bg:In use'], ['Infusion pump IP-17', 'ICU bed 4', 'High', '10 Aug', '10 Nov', 'Valid', 'Warranty', '~br:Breakdown'], ['Defibrillator D-02', 'Ward 2', 'High', '20 Apr', '20 Oct', '~ba:Due 20 Oct', 'CMC', '~bg:In use'], ['USG machine', 'Radiology', 'Medium', '01 Sep', '01 Dec', 'Valid', '~bo:AMC renews 30 Nov', '~bg:In use']] },
      'Biomedical waste': { title: 'Biomedical waste register', sub: 'Bio-Medical Waste Management Rules, 2016', acts: ['Daily entry', 'Monthly report'],
        head: ['Date', 'Yellow (kg)', 'Red (kg)', 'White (kg)', 'Blue (kg)', 'Total', 'Manifest', 'Handover'],
        rows: [['09 Oct', '42', '31', '6', '9', '88', '#BMW/26/1009', '~bg:08:30'], ['08 Oct', '39', '29', '5', '8', '81', '#BMW/26/1008', '~bg:08:25'], ['07 Oct', '44', '33', '6', '10', '93', '#BMW/26/1007', '~bg:08:40']] },
      'Patient transport': { title: 'Patient transport requests', acts: ['New request'], head: ['Request', 'Patient', 'From', 'To', 'Mode', 'Requested', 'Porter', 'Status'],
        rows: [['#PT-0441', 'Ravi Kumar', 'W2-204-B', 'Radiology (2D Echo)', 'Wheelchair', '14:40', 'Ganesh', '~bo:Assigned'], ['#PT-0440', 'R. Shetty', 'ICU-04', 'CT scan', 'Stretcher + O2', '13:10', 'Raju, Vinod', '~bg:Done'], ['#PT-0439', 'T. Shah', 'W1-112-B', 'Main gate (discharge)', 'Wheelchair', '12:20', 'Ganesh', '~bg:Done']] }
    } };
  }
