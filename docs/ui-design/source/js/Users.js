  renderVals() {
    return {
      nav: this.navItems('Users'),
      users: [['Dr. Arjun Rao', 'Administration', 'arjun.rao', 'Hospital Super Admin', 'All', 'On', 'Today 08:02', 'Active'], ['Kavita Desai', 'Administration', 'kavita.desai', 'Hospital Admin', 'Main', 'On', 'Today 08:40', 'Active'], ['Dr. Meera Iyer', 'Cardiology', 'meera.iyer', 'Consultant Doctor, HOD', 'Main', 'On', 'Today 09:55', 'Active'],
        ['Anjali Menon', 'Nursing', 'anjali.menon', 'Staff Nurse', 'Main', 'Off', 'Today 07:01', 'Active'], ['Neha Kulkarni', 'Billing', 'neha.k', 'Cashier', 'Main', 'Off', 'Today 08:00', 'Active'], ['Rahul Mehta', 'Billing', 'rahul.mehta', 'Billing Manager', 'Main', 'On', '-', 'Pending approval'],
        ['Lalit G.', 'Laboratory', 'lalit.g', 'Lab Technician', 'Main', 'Off', '05 Oct', 'Locked'], ['Seema P.', 'Nursing', 'seema.p', 'Staff Nurse', 'Main', 'Off', '30 Sep', 'Deactivated']]
        .map(function (u) { return { n: u[0], d: u[1], un: u[2], r: u[3], b: u[4], f: u[5], fc: u[5] === 'On' ? 'bg' : 'bn', l: u[6], s: u[7], sc: u[7] === 'Active' ? 'bg' : (u[7] === 'Pending approval' ? 'ba' : (u[7] === 'Locked' ? 'br' : 'bn')) }; })
    };
  }
