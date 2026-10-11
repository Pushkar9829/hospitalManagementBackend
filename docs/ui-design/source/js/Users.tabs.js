  tabDefs() {
    return { main: 'Users', tabs: ['Users', 'Invitations', 'Active sessions', 'Login history'], panels: {
      'Invitations': { title: 'Invitations', head: ['User', 'Role', 'Sent', 'Expires', 'Status'], rows: [['Rahul Mehta', 'Billing Manager', '-', '-', '~ba:Waiting for Super Admin'], ['Sneha R.', 'Trainee Nurse', '01 Oct', '08 Oct', '~bg:Accepted']] },
      'Active sessions': { title: 'Active sessions', acts: ['Sign out selected'], head: ['User', 'Device', 'IP', 'Signed in', 'Last activity'], rows: [['Dr. Meera Iyer', 'Chrome on Windows, Room 12', '#10.0.4.22', '09:55', '1 min ago'], ['Dr. Meera Iyer', 'Safari on iPad', '#10.0.8.17', '07:40', '2 h ago'], ['Neha Kulkarni', 'Chrome, Billing 1', '#10.0.2.11', '08:00', 'now']] },
      'Login history': { title: 'Login history', head: ['Time', 'User', 'Result', 'IP', 'Method'], rows: [['10:12', 'lalit.g', '~br:Locked after 5 failures', '#10.0.6.40', 'Password'], ['09:55', 'meera.iyer', '~bg:Success', '#10.0.4.22', 'Password + OTP'], ['08:40', 'kavita.desai', '~bg:Success', '#10.0.1.8', 'Password + authenticator']] }
    } };
  }
