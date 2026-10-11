  tabDefs() {
    return { main: 'Stock', tabs: ['Stock', 'Indents 11', 'Requisitions', 'Purchase orders', 'GRN', 'Transfers', 'Stock audit', 'Assets'], panels: {
      'Indents 11': { title: 'Department indents', acts: ['Issue selected'], head: ['Indent', 'Department', 'Items', 'Raised by', 'Raised', 'Status'],
        rows: [['#SI-1402', 'Ward 2', 'Gloves, syringes, IV sets (6 lines)', 'Lata Desai', '09 Oct 09:10', '~bo:To issue'], ['#SI-1401', 'ICU', 'ECG electrodes, suction catheters', 'ICU in-charge', '09 Oct 08:40', '~bo:To issue'], ['#SI-1399', 'OPD', 'Printer paper, wristbands', 'Front office', '08 Oct', '~bb:Partly issued'], ['#SI-1395', 'Kitchen', 'Rice, dal, oil (kitchen store)', 'Kitchen Supervisor', '08 Oct', '~bg:Issued']] },
      'Requisitions': { title: 'Purchase requisitions', acts: ['New requisition'], head: ['Requisition', 'Raised by', 'Reason', 'Items', 'Estimated value', 'Status'],
        rows: [['#PR-0611', 'System (reorder)', 'Below reorder level', '6', '₹48,200', '~bb:Ready for PO'], ['#PR-0610', 'Dr. P. Joshi', 'New orthopaedic implants trial', '3', '₹1,20,000', '~ba:HOD approval'], ['#PR-0608', 'Housekeeping', 'Mops and disinfectant', '4', '₹18,600', '~bg:PO created']] },
      'Purchase orders': { title: 'Purchase orders', acts: ['New purchase order'], head: ['PO', 'Vendor', 'Value', 'Lines', 'Approval', 'Delivery', 'Status'],
        rows: [['#PO-000412', 'Medline Surgicals', '₹1,84,000', '14', '~ba:L2 Super Admin', '15 Oct', '~bn:Draft'], ['#PO-000409', 'CleanCo Supplies', '₹42,300', '5', '~bg:Approved', '11 Oct', '~bb:Sent'], ['#PO-000405', 'Linen House', '₹68,900', '4', '~bg:Approved', '06 Oct', '~bo:Part received']] },
      'GRN': { title: 'Goods receipt notes', acts: ['New GRN'], head: ['GRN', 'PO', 'Vendor', 'Received', 'Accepted', 'Rejected', 'Status'],
        rows: [['#GRN-000522', '#PO-000405', 'Linen House', '600 bedsheets', '580', '20 (stained)', '~bg:Posted'], ['#GRN-000521', '#PO-000401', 'Office Mart', '42 lines', '42', '0', '~bg:Posted']] },
      'Transfers': { title: 'Store transfers', acts: ['New transfer'], head: ['Transfer', 'From', 'To', 'Items', 'Sent', 'Status'],
        rows: [['#TR-0331', 'Central Store', 'ICU sub-store', '8 lines', '09 Oct 10:30', '~bo:In transit'], ['#TR-0330', 'Central Store', 'Ward 2 stock point', '5 lines', '08 Oct', '~bg:Received']] },
      'Stock audit': { title: 'Physical stock audit · Central Store', sub: 'Variances go to maker-checker before stock is adjusted', acts: ['Start new count', 'Submit variances'],
        head: ['Item', 'System qty', 'Counted', 'Variance', 'Value', 'Reason'], rows: [['Nitrile gloves, medium', '42', '40', '- 2', '- ₹820', 'Damaged boxes'], ['IV infusion set', '610', '610', '0', '₹0', '-'], ['Bedsheet, single', '920', '912', '- 8', '- ₹2,480', 'Sent to laundry, not logged']] },
      'Assets': { title: 'Asset register', acts: ['Add asset'], head: ['Tag', 'Asset', 'Location', 'Purchased', 'Book value', 'Warranty / AMC', 'Status'],
        rows: [['#AST-0912', 'Ventilator V-03', 'ICU', 'Mar 2022', '₹6,40,000', 'AMC to Mar 2027', '~br:PM overdue'], ['#AST-0451', 'USG machine', 'Radiology', 'Nov 2021', '₹9,80,000', 'AMC renews 30 Nov', '~bo:Renewal'], ['#AST-1102', 'Hospital beds × 12', 'Ward 2', 'Jan 2024', '₹3,60,000', 'Warranty to Jan 2027', '~bg:In use']] }
    } };
  }
