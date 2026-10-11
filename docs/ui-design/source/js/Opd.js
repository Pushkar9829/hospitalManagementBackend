  renderVals() {
    var docs = [{ n: 'Dr. Meera Iyer', s: 'Cardiology', r: 'Room 12' }, { n: 'Dr. P. Joshi', s: 'Orthopaedics', r: 'Room 7' }, { n: 'Dr. A. Thomas', s: 'Paediatrics', r: 'Room 3' }, { n: 'Dr. L. Gupta', s: 'Dermatology', r: 'Room 9' }];
    var times = ['10:00', '10:10', '10:20', '10:30', '10:40', '10:50', '11:00', '11:10', '11:20', '11:30', '11:40', '11:50'];
    var M = { F: ['Free', 'bn'], B: ['Booked', 'bb'], C: ['Checked in', 'bg'], I: ['In consult', 'bo'], N: ['No-show', 'br'], D: ['Done', 'bn'] };
    var grid = [
      ['D:Sana S.', 'D:Arif K.', 'D:Lata M.', 'N:Prakash S.'], ['D:Mohan L.', 'D:Kavya N.', 'D:Baby Riya', 'D:Farah A.'], ['D:Joseph D.', 'I:Neeta P.', 'D:Aarav S.', 'D:Imran S.'],
      ['I:Ravi Kumar', 'C:Suresh B.', 'I:Baby Ishan', 'I:Rekha P.'], ['C:Divya R.', 'C:Anil T.', 'C:Myra K.', 'C:Tanvi G.'], ['C:Harish V.', 'B:Gopal R.', 'C:Ayaan M.', 'B:Nisha J.'],
      ['B:Seema D.', 'F:', 'B:Kiara S.', 'F:'], ['B:Rahul P.', 'B:Usha K.', 'F:', 'B:Om P.'], ['F:', 'B:Raj M.', 'B:Vihaan T.', 'F:'],
      ['B:Leela N.', 'F:', 'F:', 'B:Pooja S.'], ['F:', 'B:Kamal D.', 'B:Sara A.', 'F:'], ['B:Ritu J.', 'F:', 'F:', 'F:']];
    return {
      nav: this.navItems('Opd'), docs: docs,
      rows: times.map(function (t, i) { return { t: t, cells: grid[i].map(function (g) { var k = g.split(':'); var m = M[k[0]]; return { l: k[1] || m[0], c: m[1] }; }) }; }),
      queue: [['T-07', 'Ravi Kumar', 'Follow-up', '14 min', 'In consult', 'bo'], ['T-08', 'Divya R.', 'New', '9 min', 'Vitals done', 'bg'], ['T-09', 'Harish V.', 'New', '4 min', 'Checked in', 'bg'], ['T-10', 'Seema D.', 'Follow-up', '-', 'Booked', 'bb'], ['T-11', 'Rahul P.', 'Tele-consult', '-', 'Booked', 'bb'], ['T-06', 'Joseph D.', 'New', '-', 'Completed', 'bn']].map(function (q) { return { tk: q[0], n: q[1], v: q[2], w: q[3], s: q[4], c: q[5] }; })
    };
  }
