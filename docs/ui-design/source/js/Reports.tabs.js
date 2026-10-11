  tabDefs() {
    return { main: 'Catalogue', tabs: ['Catalogue', 'Scheduled', 'My exports', 'Daily collection (sample)'], panels: {
      'Scheduled': { title: 'Scheduled reports', acts: ['Schedule a report'], head: ['Report', 'Frequency', 'Recipients', 'Format', 'Next run'], rows: [['Daily collection by mode', 'Daily 21:00', 'Super Admin, Finance', 'PDF', 'Today 21:00'], ['Bed occupancy', 'Daily 08:00', 'Medical Superintendent', 'PDF', 'Tomorrow 08:00'], ['NABH indicators', 'Monthly, 1st', 'Quality Manager', 'Excel', '01 Nov']] },
      'My exports': { title: 'My exports', sub: 'Large exports run in the background; you get a notification when ready', head: ['Report', 'Requested', 'Rows', 'Status', 'File'], rows: [['Revenue by department, Sep', '09 Oct 10:02', '18,440', '~bg:Ready', 'Download'], ['Payroll register, Sep', '08 Oct', '412', '~bg:Ready', 'Download']] },
      'Daily collection (sample)': { title: 'Daily collection by mode · 9 Oct 2026', acts: ['Export Excel', 'Export PDF'], kpis: [['Total', '₹4,82,350'], ['Bills', '412'], ['Refunds', '₹9,050'], ['Net', '₹4,73,300']],
        head: ['Counter', 'Cashier', 'Cash', 'UPI', 'Card', 'Deposits', 'Total'], rows: [['Billing 1', 'Neha Kulkarni', '₹22,650', '₹58,200', '₹31,630', '₹0', '₹1,12,480'], ['Billing 2', 'Ravi S.', '₹31,400', '₹61,000', '₹42,300', '₹0', '₹1,34,700'], ['Pharmacy', 'Suresh Patil', '₹28,900', '₹71,400', '₹38,470', '₹0', '₹1,38,770'], ['Admission desk', 'Rohit Verma', '₹13,500', '₹24,000', '₹20,500', '₹38,400', '₹96,400']] }
    } };
  }
