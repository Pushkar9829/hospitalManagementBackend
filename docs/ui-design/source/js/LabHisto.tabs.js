  tabDefs() {
    return { main: 'Cases', tabs: ['Cases', 'Grossing list', 'Blocks and slides archive', 'Special stains', 'Turnaround'], panels: {
      'Grossing list': { title: 'Waiting for grossing', head: ['Case', 'Specimen', 'From', 'Received', 'Fixed for', 'Status'], rows: [['#HP-26-0413', 'Appendix', 'OT · Dr. K. Rao', '14:10', '2 h', '~ba:Needs 6 h fixation'], ['#HP-26-0414', 'Skin punch biopsy', 'OPD · Dermatology', '14:25', '1 h 45 min', '~ba:Needs 6 h fixation']] },
      'Blocks and slides archive': { title: 'Archive', sub: 'Blocks and slides are kept for 10 years; every issue and return is logged.', acts: ['Issue for review'], head: ['Case', 'Blocks', 'Slides', 'Location', 'Issued to'], rows: [['#HP-26-0398', '4', '6', 'Cabinet 3, drawer 12', '-'], ['#HP-26-0371', '2', '3', 'Cabinet 3, drawer 9', '~bb:Tata Memorial (second opinion)'], ['#HP-25-1188', '6', '9', 'Cabinet 1, drawer 2', '-']] },
      'Special stains': { title: 'Special stains and immunohistochemistry', head: ['Case', 'Stains', 'Ordered', 'Done by', 'Status'], rows: [['#HP-26-0405', 'ER, PR, HER2', '05 Oct', 'In-house IHC', '~ba:Slides ready 10 Oct'], ['#HP-26-0401', 'Ziehl-Neelsen, PAS', '04 Oct', 'In-house', '~bg:Done']] },
      'Turnaround': { title: 'Turnaround (working days)', head: ['Specimen type', 'Cases this month', 'Target', 'Median', 'Within target'], rows: [['Small biopsy', '42', '2 days', '1.8 days', '93%'], ['Surgical specimen', '61', '3 days', '2.6 days', '90%'], ['Specimen needing IHC', '9', '5 days', '4.4 days', '78%']] }
    } };
  }
