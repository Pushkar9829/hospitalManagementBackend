  tabDefs() {
    return { main: 'Activity', tabs: ['Activity', 'Patient record access', 'Logins', 'Daily exceptions'], panels: {
      'Patient record access': { title: 'Who opened this patient record', sub: 'Ravi Kumar · CC0000123', head: ['Time', 'User', 'Role', 'Section', 'Reason'], rows: [['10:45', 'Dr. Meera Iyer', 'Consultant', 'Clinical record', 'Treating doctor'], ['10:41', 'Anjali Menon', 'Staff Nurse', 'MAR', 'Assigned ward'], ['10:30', 'Neha Kulkarni', 'Cashier', 'Bills', 'Billing'], ['09:12', 'Ramesh K.', 'Staff Nurse (ICU)', 'Clinical record', '~ba:Not assigned to patient']] },
      'Logins': { title: 'Logins', head: ['Time', 'User', 'Result', 'IP', 'Method'], rows: [['10:12', 'lalit.g', '~br:Failed (locked)', '#10.0.6.40', 'Password'], ['09:55', 'meera.iyer', '~bg:Success', '#10.0.4.22', 'Password + OTP'], ['02:14', 'ramesh.iyer', '~ba:Outside working hours', '#49.36.12.8', 'Password + authenticator']] },
      'Daily exceptions': { title: 'Exceptions to review', sub: 'Sent to the Super Admin every morning', head: ['Exception', 'Count', 'Example'], rows: [['Out-of-hours access to finance', '1', 'ramesh.iyer at 02:14 from outside network'], ['Record opened by non-assigned staff', '3', 'Ramesh K. opened CC0000123'], ['Bulk exports', '2', 'Revenue by department, 18,440 rows'], ['Duplicate prints', '7', 'Receipts reprinted at Billing 1']] }
    } };
  }
