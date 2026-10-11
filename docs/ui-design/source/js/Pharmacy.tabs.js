  tabDefs() {
    return { main: 'OPD prescriptions 12', tabs: ['OPD prescriptions 12', 'Ward indents 7', 'Counter sale', 'Returns', 'Purchase and GRN', 'Controlled drugs'], panels: {
      'Ward indents 7': { title: 'Ward indents', sub: 'Issued against the patient and posted to the running bill', acts: ['Issue selected'],
        head: ['Indent', 'Ward', 'Patient', 'Items', 'Raised by', 'Raised', 'Status'],
        rows: [['#IND-2210', 'Ward 2', 'Ravi Kumar · W2-204-B', 'Enoxaparin 60 mg × 2, NTG infusion', 'Anjali (Nurse)', '10:15', '~bo:To issue'], ['#IND-2209', 'ICU', 'R. Shetty · ICU-04', 'Noradrenaline 4 mg × 5, Midazolam × 3', 'ICU nurse', '09:58', '~bo:To issue'], ['#IND-2207', 'Ward 1', 'H. Rane · W1-110-B', 'Ceftriaxone 1 g × 2', 'Ward 1 nurse', '09:20', '~bb:Partly issued'], ['#IND-2205', 'Paeds', 'Baby Ishan · PICU-2', 'Paracetamol syrup', 'Paeds nurse', '08:42', '~bg:Issued']] },
      'Counter sale': { title: 'Counter sale', sub: 'Walk-in sale against an outside prescription', acts: ['Add item', 'Upload prescription image'],
        form: [['Customer name', 'Walk-in · Prakash S.', 2], ['Mobile', '98111 22334', 1], ['Prescribing doctor', 'Dr. A. Bhide (outside)', 1]],
        head: ['Medicine', 'Batch (FEFO)', 'Expiry', 'Qty', 'MRP', 'Amount'], rows: [['Pantoprazole 40 mg tab', '#PN7781', 'Jan 2027', '15', '₹8.20', '₹123.00'], ['Cetirizine 10 mg tab', '#CZ2290', 'Apr 2027', '10', '₹2.10', '₹21.00']],
        note: 'Schedule H1 and narcotic medicines need prescriber details and a prescription copy before sale.' },
      'Returns': { title: 'Returns', acts: ['New patient return', 'Return to vendor'], head: ['Return no.', 'Type', 'From', 'Items', 'Value', 'Credit note', 'Status'],
        rows: [['#RT-0412', 'Patient return', 'K. Nair (discharge)', '6 items', '₹1,240', '#CN-0412', '~ba:Credit note sent to billing'], ['#RT-0411', 'Vendor return', 'Medline Pharma', 'Near-expiry 3 batches', '₹12,400', '#VCN-118', '~ba:Awaiting vendor'], ['#RT-0409', 'Expiry write-off', 'Main Pharmacy', '9 batches', '₹6,230', '-', '~ba:Approval']] },
      'Purchase and GRN': { title: 'Pharmacy purchase and goods receipt', acts: ['New purchase order', 'New GRN'], head: ['Document', 'Distributor', 'Value', 'Lines', 'Price variance', 'Status'],
        rows: [['#PPO-000221', 'Medline Pharma', '₹2,48,600', '38', '-', '~bb:Sent'], ['#GRN-000318', 'Apex Distributors', '₹96,420', '17', '~br:2 lines over PO rate', '~ba:Approval'], ['#GRN-000317', 'Medline Pharma', '₹1,12,050', '24', '-', '~bg:Stock added']],
        note: 'GRN captures batch, expiry, MRP, purchase rate and free quantity. The payable goes to Finance automatically.' },
      'Controlled drugs': { title: 'Schedule H1 and narcotic register', acts: ['Export register'], head: ['Date', 'Medicine', 'Patient', 'Prescriber', 'Reg. no.', 'Qty', 'Balance'],
        rows: [['09 Oct', 'Tramadol 50 mg', 'A. Joshi', 'Dr. P. Joshi', '#MMC-55120', '6', '130'], ['08 Oct', 'Morphine 10 mg inj', 'R. Shetty', 'Dr. R. Menon', '#MMC-40218', '2', '18'], ['08 Oct', 'Alprazolam 0.25 mg', 'Usha K.', 'Dr. L. Gupta', '#MMC-61002', '10', '240']] }
    } };
  }
