  tabDefs() {
    return { main: 'Payroll run', tabs: ['Payroll run', 'Salary structures', 'Variable inputs', 'Loans and advances', 'Statutory settings', 'Payslips'], panels: {
      'Salary structures': { title: 'Salary structure templates', acts: ['New structure'], head: ['Structure', 'Grade', 'Components', 'Basic', 'HRA', 'Night allowance', 'Employees'],
        rows: [['Nursing N2', 'Staff Nurse', 'Basic, DA, HRA, Special, Night, Uniform', '₹18,000', '40% of Basic', '₹300 per night', '138'], ['Doctors C1', 'Consultant', 'Basic, HRA, Clinical allowance, Variable', '₹1,20,000', '40% of Basic', '-', '46'], ['Support S1', 'Housekeeping, kitchen', 'Basic, DA, HRA, Conveyance', '₹12,500', '20% of Basic', '₹150 per night', '92']] },
      'Variable inputs': { title: 'Variable inputs · September', sub: 'Imported from attendance and rosters, or uploaded from Excel', acts: ['Import from attendance', 'Upload Excel'],
        head: ['Employee', 'Overtime hours', 'Night shifts', 'On-call', 'Incentive', 'Arrears', 'Other deductions'],
        rows: [['Rose Thomas', '12', '14', '0', '₹0', '₹2,400', '₹0'], ['Imran A.', '16', '12', '0', '₹0', '₹2,400', '₹300 canteen'], ['Dr. R. Menon', '0', '0', '6', '₹12,000', '₹0', '₹0']] },
      'Loans and advances': { title: 'Loans and salary advances', acts: ['New loan'], head: ['Employee', 'Type', 'Amount', 'EMI', 'Paid', 'Balance', 'Status'],
        rows: [['Joseph K.', 'Salary advance', '₹20,000', '₹5,000', '₹10,000', '₹10,000', '~bg:Active'], ['M. Fernandes', 'Personal loan', '₹60,000', '₹5,000', '₹45,000', '₹15,000', '~bg:Active']] },
      'Statutory settings': { title: 'Statutory rates (configuration, not code)', acts: ['Edit (approval)'], head: ['Item', 'Employee', 'Employer', 'Wage limit / rule', 'Effective from'],
        rows: [['Provident Fund', '12%', '12% (3.67% EPF + 8.33% EPS)', 'Wage ceiling ₹15,000', '01 Apr 2026'], ['ESI', '0.75%', '3.25%', 'Gross up to ₹21,000', '01 Apr 2026'], ['Professional Tax (Maharashtra)', 'Slab', '-', '₹200, ₹300 in February', '01 Apr 2026'], ['TDS', 'Per declaration', '-', 'Old or new regime', '01 Apr 2026'], ['Labour Welfare Fund', '₹12', '₹36', 'June and December', '01 Apr 2026']] },
      'Payslips': { title: 'Payslips', acts: ['E-mail all', 'Download ZIP'], head: ['Month', 'Employees', 'Generated', 'E-mailed', 'Viewed in self-service'],
        rows: [['August 2026', '408', '408', '402', '361'], ['July 2026', '405', '405', '400', '377']] }
    } };
  }
