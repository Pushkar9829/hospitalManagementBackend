  tabDefs() {
    return { main: 'Leads', tabs: ['Leads', 'Call centre', 'Campaigns', 'Health camps', 'Memberships', 'Referral partners'], panels: {
      'Call centre': { title: 'Call centre', sub: 'Caller lookup by phone number · cloud telephony optional', acts: ['Dial', 'Book appointment'], kpis: [['Calls today', '214'], ['Answered', '205'], ['Missed', '9', '7 called back'], ['Average wait', '18 s']],
        head: ['Time', 'Caller', 'Matched patient', 'Purpose', 'Agent', 'Outcome'], rows: [['11:02', '98220 11223', 'Mohan Lal · CC0000121', 'Report status', 'Pooja', '~bg:Answered'], ['10:58', '98111 22334', '-', 'MRI price', 'Rahul', '~bo:Lead created'], ['10:51', '99876 54321', 'Usha K. · CC0000088', 'Reschedule', 'Pooja', '~bg:Booked']] },
      'Campaigns': { title: 'Campaigns', acts: ['New campaign'], head: ['Campaign', 'Channel', 'Audience rule', 'Sent', 'Response', 'Status'],
        rows: [['HbA1c reminder for diabetics', 'WhatsApp', 'Diabetes and last HbA1c over 90 days, consented', '1,920', '14% booked', '~bg:Sent'], ['Free bone density camp', 'SMS', 'Women 45+, 10 km radius', '3,400', '-', '~bb:Scheduled'], ['Membership renewal', 'E-mail', 'Expiring this month', '63', '21 renewed', '~bo:Running']] },
      'Health camps': { title: 'Health camps', acts: ['Plan camp'], head: ['Camp', 'Date', 'Team', 'Registered', 'Screened', 'Abnormal', 'Converted'],
        rows: [['Housing society, Baner', '28 Sep', '6', '160', '146', '38', '23'], ['Corporate park, Hinjewadi', '21 Sep', '8', '240', '212', '51', '31'], ['Senior citizens’ club', '12 Oct', '5', '84', '-', '-', '-']] },
      'Memberships': { title: 'Memberships and wallet', acts: ['New membership'], head: ['Plan', 'Price', 'Benefits', 'Members', 'Renewal due'],
        rows: [['Family Gold', '₹4,999 / year', '4 members, 5% lab, 2 free consultations', '612', '41'], ['Senior Care', '₹2,499 / year', '10% on all OPD, home collection free', '418', '19'], ['Wallet top-ups', '-', 'Prepaid balance across counters', '1,148 wallets', '-']] },
      'Referral partners': { title: 'Referral partners', sub: 'Referral fees only where hospital policy and law permit', acts: ['Add partner'], head: ['Partner', 'Type', 'Referrals (month)', 'Revenue', 'Statement'],
        rows: [['Dr. S. Bhide Clinic', 'Clinic', '22', '₹4,10,000', '~bg:Sent'], ['Wellness Diagnostics', 'Collection centre', '140', '₹2,86,000', '~bg:Sent'], ['Dr. N. Kale', 'General practitioner', '9', '₹1,02,000', '~ba:Draft']] }
    } };
  }
