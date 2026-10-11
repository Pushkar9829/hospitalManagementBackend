  tabDefs() {
    return { main: 'Today', tabs: ['Today', 'Employees', 'Attendance', 'Leave', 'Recruitment', 'Training', 'Appraisal', 'Exits'], panels: {
      'Employees': { title: 'Employee directory', sub: '412 active · 24 contract · 18 visiting consultants', acts: ['Add employee', 'Export'],
        head: ['Emp. code', 'Name', 'Department', 'Designation', 'Type', 'Joined', 'Registration', 'Status'],
        rows: [['#EMP0042', 'Anjali Menon', 'Nursing', 'Staff Nurse', 'Permanent', 'Jun 2021', 'MNC-41220', '~bg:Active'], ['#EMP0118', 'Dr. Meera Iyer', 'Cardiology', 'Consultant', 'Permanent', 'Jan 2019', 'MMC-33012', '~bg:Active'], ['#EMP0230', 'Rose Thomas', 'Nursing', 'Staff Nurse', 'Permanent', 'Aug 2022', '~br:Expires in 12 days', '~bg:Active'], ['#EMP0301', 'Neha Kulkarni', 'Billing', 'Cashier', 'Permanent', 'Feb 2023', '-', '~bg:Active'], ['#EMP0408', 'Sneha R.', 'Nursing', 'Trainee Nurse', 'Contract', 'Sep 2026', 'Pending', '~ba:Probation'], ['#VC0012', 'Dr. S. Bhide', 'Orthopaedics', 'Visiting Consultant', 'Visiting', 'Mar 2024', 'MMC-50112', '~bg:Active']] },
      'Attendance': { title: 'Attendance register · October', sub: 'Biometric punches matched to roster', acts: ['Import punches', 'Lock month'],
        head: ['Employee', 'Rostered', 'Present', 'Late', 'Early out', 'Overtime', 'Absent', 'Regularisation'],
        rows: [['Anjali Menon', '8', '8', '0', '0', '2.5 h', '0', '-'], ['Kavya N.', '8', '4', '1', '0', '0', '0', '~ba:2 requests'], ['Imran A.', '8', '8', '2', '0', '6 h', '0', '-'], ['Joseph K.', '7', '6', '0', '1', '0', '1', '~br:Absent 6 Oct']] },
      'Leave': { title: 'Leave balances and policies', acts: ['Holiday calendar', 'Leave policy'], head: ['Leave type', 'Accrual', 'Carry forward', 'Encashment', 'Approver'],
        rows: [['Casual leave', '8 per year', 'No', 'No', 'Reporting manager'], ['Sick leave', '10 per year', 'Up to 30', 'No', 'Reporting manager'], ['Earned leave', '1.25 per month', 'Up to 45', 'Yes, at exit', 'HOD'], ['Maternity leave', '26 weeks', '-', '-', 'HR Manager'], ['Comp-off', 'For holiday work', '60 days validity', 'No', 'Reporting manager']] },
      'Recruitment': { title: 'Recruitment', acts: ['New job opening', 'Add candidate'], head: ['Candidate', 'Opening', 'Stage', 'Interview', 'Panel feedback', 'Next step'],
        rows: [['Priya Lobo', 'Staff Nurse (ICU)', '~bb:Interviewed', '07 Oct', '4.2 / 5', 'Offer letter'], ['Arun M.', 'Staff Nurse (ICU)', '~ba:Scheduled', '11 Oct 11:00', '-', 'Interview'], ['Dr. Sahil K.', 'Resident, Medicine', '~bg:Offer accepted', '02 Oct', '4.6 / 5', 'Convert to employee'], ['Ritu S.', 'Front Office Executive', '~bn:Applied', '-', '-', 'Screen']] },
      'Training': { title: 'Training and certifications', acts: ['Schedule training'], head: ['Training', 'Mandatory for', 'Next session', 'Due', 'Expired'],
        rows: [['Basic Life Support (BLS)', 'All clinical staff', '15 Oct', '18', '~br:3'], ['ACLS', 'ICU nurses and doctors', '22 Oct', '6', '0'], ['Fire safety', 'Everyone', '20 Oct', '41', '~ba:7'], ['Infection control', 'Clinical and housekeeping', '18 Oct', '26', '0']] },
      'Appraisal': { title: 'Annual appraisal 2026-27', sub: 'Self review, manager review, HOD review, increment recommendation', acts: ['Start cycle'],
        head: ['Department', 'Employees', 'Self review done', 'Manager review', 'HOD review', 'Recommended increment'],
        rows: [['Nursing', '168', '142', '96', '40', '6.5% average'], ['Laboratory', '17', '17', '17', '17', '7.0% average'], ['Front office and billing', '26', '20', '8', '0', '-']] },
      'Exits': { title: 'Exits and full and final settlement', acts: ['Record resignation'], head: ['Employee', 'Last day', 'Notice', 'Clearance', 'Full and final', 'Status'],
        rows: [['Lalit G. (Lab Tech)', '31 Oct', '30 days', '~ba:Lab, IT pending', '₹41,200', '~bb:Notice period'], ['Seema P. (Nurse)', '30 Sep', 'Served', '~bg:All cleared', '₹58,900', '~bg:Paid']] }
    } };
  }
