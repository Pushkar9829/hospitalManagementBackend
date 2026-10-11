  renderVals() {
    var W = [['Thu', '9', 'Morning', 'bb'], ['Fri', '10', 'Morning', 'bb'], ['Sat', '11', 'Evening', 'bo'], ['Sun', '12', 'Off', 'bg'], ['Mon', '13', 'Night', 'bn'], ['Tue', '14', 'Night', 'bn'], ['Wed', '15', 'Evening', 'bo']];
    return { nav: this.navItems('MySpace'), week: W.map(function (w) { return { d: w[0], n: w[1], s: w[2], c: w[3] }; }) };
  }
