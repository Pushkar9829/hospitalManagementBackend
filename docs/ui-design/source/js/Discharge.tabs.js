  tabDefs() {
    return { main: 'Discharge desk', tabs: ['Discharge desk', 'Completed today', 'With dues', 'LAMA and transfers', 'Deaths'], panels: {
      'Completed today': { title: 'Completed discharges today', head: ['Patient', 'IP no.', 'Decision', 'Left', 'Turnaround', 'Bed status'], rows: [['D. Mehta', '#IP/26-27/000833', '07:45', '10:20', '2 h 40 min', '~ba:Cleaning'], ['S. Gokhale', '#IP/26-27/000820', '08:00', '10:05', '2 h 05 min', '~bg:Available']] },
      'With dues': { title: 'Discharge with dues', sub: 'Needs Medical Superintendent approval; dues go to patient outstanding', head: ['Patient', 'Bill', 'Due', 'Reason', 'Approval'], rows: [['A. Joshi', '#IP/26-27/000836', '₹18,400', 'Family arranging funds, guarantor given', '~ba:Pending']] },
      'LAMA and transfers': { title: 'Left against advice and transfers out', head: ['Patient', 'Type', 'Date', 'Form', 'Destination'], rows: [['Ganesh P.', 'LAMA', '06 Oct', '~bg:Signed and uploaded', '-'], ['Baby of Sonal', 'Transfer out', '04 Oct', '~bg:Summary printed', 'City Children’s Hospital (NICU)']] },
      'Deaths': { title: 'Deaths', head: ['Patient', 'Date and time', 'Cause (MCCD)', 'Medico-legal', 'Records'], rows: [['H. Singh, 81 M', '06 Oct 03:10', 'Septic shock; pneumonia', 'No', '~bg:Sent to MRD']] }
    } };
  }
