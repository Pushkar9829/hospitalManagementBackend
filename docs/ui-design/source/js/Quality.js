  renderVals() {
    var I = [['OPD waiting time', '21 min', 'under 30 min', 'Met', 'bg'], ['Discharge TAT', '3.4 h', 'under 3 h', 'Missed', 'br'], ['Lab report TAT (routine)', '3.1 h', 'under 4 h', 'Met', 'bg'], ['Critical value reported', '12 min', 'under 30 min', 'Met', 'bg'],
      ['Medication errors per 1,000 patient days', '0.6', 'under 1.0', 'Met', 'bg'], ['Patient falls per 1,000 patient days', '1.4', 'under 1.0', 'Missed', 'br'], ['Return to ICU within 48 h', '2.1%', 'under 3%', 'Met', 'bg'], ['Bed occupancy', '84%', '75 to 90%', 'Met', 'bg']];
    return {
      nav: this.navItems('Quality'),
      ind: I.map(function (i) { return { n: i[0], v: i[1], t: i[2], s: i[3], c: i[4] }; })
    };
  }
