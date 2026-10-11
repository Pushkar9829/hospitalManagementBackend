  tabDefs() {
    return { main: 'Appointment calendar', tabs: ['Appointment calendar', 'Doctor schedules', 'Health check-ups', 'Tele-consultations', 'Treatment plans', 'Resources'], panels: {
      'Doctor schedules': { title: 'Doctor schedule templates', acts: ['New schedule', 'Block leave'], head: ['Doctor', 'Days', 'Session', 'Room', 'Slot', 'Max', 'New fee', 'Follow-up'],
        rows: [['Dr. Meera Iyer', 'Mon to Sat', '10:00 to 13:00', 'Room 12', '10 min', '18', '₹800', 'Free within 15 days'], ['Dr. P. Joshi', 'Mon, Wed, Fri', '10:00 to 14:00, 17:00 to 19:00', 'Room 7', '15 min', '24', '₹900', 'Free within 10 days'], ['Dr. A. Thomas', 'Mon to Sat', '09:00 to 13:00', 'Room 3', '10 min', '24', '₹600', 'Free within 7 days'], ['Dr. S. Bhide (visiting)', 'Saturday', '15:00 to 18:00', 'Room 7', '15 min', '12', '₹1,000', 'Paid']] },
      'Health check-ups': { title: 'Health check-ups today', acts: ['Book check-up', 'Corporate bulk upload'], head: ['Person', 'Package', 'Company', 'Stations done', 'Next station', 'Report'],
        rows: [['Divya R.', 'Executive health check', '-', '6 of 9', 'Eye check', '~bn:Pending'], ['Amit S.', 'Pre-employment', 'TechPark Ltd', '4 of 4', '-', '~ba:Physician review'], ['Leena P.', 'Women’s wellness', '-', '2 of 8', 'Mammography', '~bn:Pending']] },
      'Tele-consultations': { title: 'Tele-consultations', sub: 'Prepaid online, video link by SMS and in the patient portal', acts: ['Start next call'], head: ['Time', 'Patient', 'Doctor', 'Paid', 'Consent', 'Status'],
        rows: [['11:40', 'Rahul P.', 'Dr. Meera Iyer', '~bg:₹600', '~bg:Recorded', '~bb:Waiting room'], ['12:20', 'Kamal D.', 'Dr. P. Joshi', '~bg:₹700', '~bg:Recorded', '~bn:Scheduled']] },
      'Treatment plans': { title: 'Multi-session treatment plans', acts: ['New plan'], head: ['Patient', 'Plan', 'Sessions', 'Done', 'Next session', 'Billing'],
        rows: [['Sara A.', 'Physiotherapy, knee', '10', '3', '14 Oct 10:00', 'Package ₹4,500'], ['Joseph D.', 'Root canal and crown', '4', '1', '16 Oct 11:30', 'Per session'], ['Tanvi G.', 'Laser, acne scars', '6', '2', '23 Oct 17:00', 'Package ₹18,000']] },
      'Resources': { title: 'Rooms, equipment and therapists', acts: ['Add resource'], head: ['Resource', 'Type', 'Bookable for', 'Today booked', 'Status'],
        rows: [['Procedure room 1', 'Room', 'Minor procedures, dressings', '6 of 12 slots', '~bg:Available'], ['Laser machine', 'Equipment', 'Dermatology', '3 of 8 slots', '~bg:Available'], ['Physiotherapist Kiran', 'Therapist', 'Physiotherapy', '9 of 10 slots', '~ba:Nearly full']] }
    } };
  }
