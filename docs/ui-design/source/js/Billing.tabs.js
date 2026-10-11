  tabDefs() {
    return { main: 'OPD billing', tabs: ['OPD billing', 'IP running bill', 'Deposits', 'Refunds and cancellations', 'Credit and corporate', 'Miscellaneous bill', 'Close shift'], panels: {
      'Miscellaneous bill': { title: 'Miscellaneous bill', sub: 'For items that are not a visit, test or stay. Priced from the miscellaneous price list; series MS/26-27/.', acts: ['Create bill'], head: ['Item', 'Price', 'Revenue head', 'GST'], rows: [['Medical certificate', '₹200', 'Certificates', '~bn:Exempt'], ['Copy of medical records (per page)', '₹10', 'Medical records', '~bn:Exempt'], ['Attendant meal', '₹150', 'Cafeteria', '~bb:5%'], ['Attendant extra bed (per night)', '₹500', 'Room services', '~bn:Exempt'], ['Duplicate UHID card', '₹50', 'Registration', '~bn:Exempt']] },
      'IP running bill': { title: 'Running bill · Ravi Kumar · IP/26-27/000871', sub: 'Day 2 · Semi-private · Self pay', acts: ['Interim bill', 'Final bill', 'Collect deposit'],
        kpis: [['Charges so far', '₹14,860'], ['Deposit received', '₹20,000'], ['Balance', '₹5,140', 'in patient\'s favour'], ['Estimated at discharge', '₹23,500', 'deposit alert at 90%']],
        head: ['Date', 'Service', 'Source', 'Qty', 'Rate', 'Amount'],
        rows: [['08 Oct', 'Bed charge, semi-private', 'Nightly job', '1', '₹2,800', '₹2,800'], ['08 Oct', 'Consultant visit', 'Doctor round', '2', '₹800', '₹1,600'], ['08 Oct', 'Troponin I, CBC, RFT', 'Laboratory', '3', '-', '₹2,350'], ['09 Oct', 'Medicines (ward issue)', 'Pharmacy', '9', '-', '₹4,210'], ['09 Oct', '2D Echo', 'Radiology', '1', '₹2,200', '₹2,200'], ['09 Oct', 'Consumables', 'Nursing', '14', '-', '₹1,900']] },
      'Deposits': { title: 'Deposits and advances', acts: ['Collect deposit', 'Refund excess'], head: ['Receipt', 'Patient', 'IP no.', 'Amount', 'Mode', 'Balance', 'Status'],
        rows: [['#RC/26-27/004512', 'Ravi Kumar', '#IP/26-27/000871', '₹20,000', 'Card', '₹5,140', '~bg:Active'], ['#RC/26-27/004498', 'K. Nair', '#IP/26-27/000842', '₹50,000', 'UPI', '- ₹18,650', '~br:Low deposit'], ['#RC/26-27/004470', 'T. Shah', '#IP/26-27/000839', '₹15,000', 'Cash', '₹0', '~bn:Adjusted']] },
      'Refunds and cancellations': { title: 'Refunds and cancellations', sub: 'Every refund and cancellation needs approval. Originals are never deleted; credit notes are issued.', acts: ['New refund request'],
        head: ['Request', 'Bill', 'Type', 'Amount', 'Reason', 'Requested by', 'Status'],
        rows: [['#RF-0091', '#OP/26-27/000140', 'Partial refund', '₹650', 'Test not done', 'Neha', '~ba:Billing Manager'], ['#RF-0090', '#IP/26-27/000820', 'Excess deposit', '₹8,400', 'Discharge settlement', 'Neha', '~bg:Paid by UPI'], ['#CX-0033', '#OP/26-27/000131', 'Cancellation', '₹500', 'Wrong doctor', 'Ravi (Cashier 2)', '~br:Rejected']] },
      'Credit and corporate': { title: 'Credit and corporate bills', acts: ['Send statement'], head: ['Company', 'Open bills', 'Amount due', 'Over 30 days', 'Over 60 days', 'Credit limit'],
        rows: [['TechPark Ltd', '41', '₹3,82,000', '₹1,10,000', '₹0', '₹5,00,000'], ['City Bus Corporation', '18', '₹2,14,500', '₹96,000', '₹62,000', '₹3,00,000'], ['Green Energy Pvt Ltd', '7', '₹48,300', '₹0', '₹0', '₹2,00,000']] },
      'Close shift': { title: 'Close cashier shift · Counter 1', sub: 'Count the cash in the drawer. Any difference needs a reason.', acts: ['Close shift and print summary'],
        kpis: [['Expected cash', '₹22,650'], ['UPI', '₹58,200'], ['Card', '₹31,630'], ['Bills issued', '64']],
        form: [['Counted cash', '₹22,600', 1], ['Difference', '- ₹50', 1], ['Reason for difference', 'Change given short to patient, noted in register', 2]] }
    } };
  }
