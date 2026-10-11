  renderVals() {
    var sel = (this.state && this.state.t) || 'CBC';
    var T = [
      ['CBC', 'Complete blood count', 'Haematology', 'Panel', 'bb', 'HEM-001', [['Sample', 'Whole blood'], ['Container', 'EDTA (purple), 2 mL'], ['Method', 'Sysmex XN-550, impedance and flow'], ['Routine TAT', '2 h'], ['STAT TAT', '45 min'], ['Price (General)', '₹350'], ['NABL accredited', 'Yes'], ['Stability', '24 h at 4 °C']],
        [['Haemoglobin', 'g/dL', '13.0 to 17.0', '12.0 to 15.0', '11.0 to 14.0', '7.0', '20.0', '2.0 g/dL in 7 days'], ['WBC count', '/µL', '4,000 to 11,000', '4,000 to 11,000', '5,000 to 15,000', '2,000', '30,000', '50%'], ['Platelets', '/µL', '1,50,000 to 4,10,000', '1,50,000 to 4,10,000', '1,50,000 to 4,50,000', '50,000', '10,00,000', '50%'], ['Haematocrit', '%', '40 to 50', '36 to 46', '33 to 42', '20', '60', '-'], ['MCV', 'fL', '80 to 100', '80 to 100', '75 to 90', '-', '-', '-']]],
      ['TROP', 'Troponin I', 'Immunoassay', 'Test', 'bn', 'IMM-014', [['Sample', 'Serum or plasma'], ['Container', 'Gold top or lithium heparin'], ['Method', 'Mini Vidas, ELFA'], ['Routine TAT', '1 h'], ['STAT TAT', '45 min'], ['Price (General)', '₹1,200'], ['NABL accredited', 'Yes'], ['Stability', '8 h at room temperature']],
        [['Troponin I', 'ng/mL', 'Under 0.02', 'Under 0.02', 'Under 0.02', '-', '0.10', 'Any rise above 20%']]],
      ['KFT', 'Kidney function test', 'Biochemistry', 'Panel', 'bb', 'BIO-021', [['Sample', 'Serum'], ['Container', 'Gold top, 3 mL'], ['Method', 'Cobas c311'], ['Routine TAT', '4 h'], ['STAT TAT', '1 h'], ['Price (General)', '₹600'], ['NABL accredited', 'Yes'], ['Stability', '7 days at 4 °C']],
        [['Urea', 'mg/dL', '17 to 43', '17 to 43', '11 to 36', '-', '200', '-'], ['Creatinine', 'mg/dL', '0.7 to 1.3', '0.6 to 1.1', '0.3 to 0.7', '-', '7.0', '50% in 48 h'], ['Sodium', 'mmol/L', '136 to 145', '136 to 145', '136 to 145', '120', '160', '8 mmol/L'], ['Potassium', 'mmol/L', '3.5 to 5.1', '3.5 to 5.1', '3.4 to 4.7', '2.8', '6.2', '1.0 mmol/L']]],
      ['TSH', 'TSH', 'Immunoassay', 'Test', 'bn', 'IMM-003', [['Sample', 'Serum'], ['Container', 'Gold top'], ['Method', 'Chemiluminescence'], ['Routine TAT', '6 h'], ['STAT TAT', '-'], ['Price (General)', '₹450'], ['NABL accredited', 'Yes'], ['Stability', '7 days at 4 °C']],
        [['TSH', 'µIU/mL', '0.4 to 4.0', '0.4 to 4.0 (pregnancy by trimester)', '0.7 to 6.4', '-', '-', '-']]],
      ['BCUL', 'Blood culture and sensitivity', 'Microbiology', 'Test', 'bn', 'MIC-001', [['Sample', 'Blood, 2 sets'], ['Container', 'Culture bottles, 8 to 10 mL each'], ['Method', 'Automated culture, VITEK identification'], ['Routine TAT', 'Prelim 24 h, final 72 h'], ['STAT TAT', '-'], ['Price (General)', '₹1,100'], ['NABL accredited', 'Yes'], ['Stability', 'Load within 2 h']],
        [['Growth', '-', 'No growth', 'No growth', 'No growth', '-', 'Any growth', '-']]],
      ['VITD', 'Vitamin D (25-OH)', 'Send-out', 'Send-out', 'ba', 'OUT-007', [['Sample', 'Serum'], ['Container', 'Gold top'], ['Method', 'Partner: Metro Reference Lab'], ['Routine TAT', '48 h'], ['STAT TAT', '-'], ['Price (General)', '₹1,400'], ['NABL accredited', 'Partner NABL'], ['Stability', '7 days at 4 °C']],
        [['25-OH vitamin D', 'ng/mL', '30 to 100', '30 to 100', '30 to 100', '-', '150', '-']]],
      ['HPS', 'Histopathology, small biopsy', 'Histopathology', 'Test', 'bn', 'HIS-001', [['Sample', 'Tissue'], ['Container', '10% formalin, 10 times volume'], ['Method', 'Processing, H&E'], ['Routine TAT', '2 working days'], ['STAT TAT', '-'], ['Price (General)', '₹1,800'], ['NABL accredited', 'Yes'], ['Stability', 'Fix 6 to 48 h']],
        [['Report', '-', 'Pathologist narrative', '-', '-', '-', '-', '-']]]
    ];
    var c = T.filter(function (x) { return x[0] === sel; })[0] || T[0];
    return {
      nav: this.navItems('LabConfig'),
      tests: T.map((x) => ({ n: x[1], d: x[2], k: x[3], c: x[4], bg: x[0] === c[0] ? '#E6EEF9' : 'transparent', pick: () => this.setState({ t: x[0] }) })),
      cur: { n: c[1], d: c[2], code: c[5], f: c[6].map(function (f, i) { return { l: f[0], v: f[1], id: 'lc' + i }; }),
        p: c[7].map(function (p) { return { n: p[0], u: p[1], m: p[2], f: p[3], c: p[4], cl: p[5], ch: p[6], dl: p[7] }; }) }
    };
  }
