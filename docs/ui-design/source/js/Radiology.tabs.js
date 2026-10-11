  tabDefs() {
    return { main: 'To report 8', tabs: ['To report 8', 'Scheduled 21', 'In progress 3', 'Signed 46', 'PCPNDT register'], panels: {
      'Scheduled 21': { title: 'Modality schedule · today', acts: ['Book slot'], head: ['Time', 'Modality', 'Study', 'Patient', 'Preparation', 'Status'],
        rows: [['14:00', 'CT', 'CT abdomen contrast', 'Gopal R.', '~ba:Creatinine needed', '~bb:Booked'], ['15:00', 'Echo', '2D Echo', 'Ravi Kumar', 'None', '~bb:Booked'], ['15:30', 'MRI', 'MRI knee', 'Sara A.', 'Metal screening done', '~bg:Arrived'], ['16:00', 'USG', 'USG abdomen', 'Nisha J.', 'Fasting 6 h', '~bb:Booked']] },
      'In progress 3': { title: 'In progress', head: ['Study', 'Patient', 'Room', 'Technician', 'Started'], rows: [['MRI L-S spine', 'Usha K.', 'MRI 1', 'Sameer', '14:05'], ['X-ray chest PA', 'S. Patil', 'X-ray 2', 'Asha', '14:12']] },
      'Signed 46': { title: 'Signed reports today', head: ['Study', 'Patient', 'Radiologist', 'Signed', 'Delivered'], rows: [['CT brain plain', 'Mohan Lal', 'Dr. V. Singh', '11:40', '~bg:Doctor, SMS'], ['X-ray knee', 'A. Joshi', 'Dr. V. Singh', '11:10', '~bg:Doctor, film issued']] },
      'PCPNDT register': { title: 'PCPNDT Form F register', sub: 'Mandatory for every ultrasound on a pregnant woman. Kept for the statutory period.', acts: ['Monthly report to authority'],
        head: ['Form F no.', 'Date', 'Patient', 'Referred by', 'Indication', 'Doctor declaration', 'Patient signature'],
        rows: [['#FF/26/0412', '09 Oct', 'Priya Shinde', 'Dr. F. Khan', 'Anomaly scan', '~bg:Signed', '~bg:Signed'], ['#FF/26/0411', '08 Oct', 'Meera D.', 'Dr. F. Khan', 'Dating scan', '~bg:Signed', '~bg:Signed']] }
    } };
  }
