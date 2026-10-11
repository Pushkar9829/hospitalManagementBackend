  renderVals() {
    var P = [['Normal', 14, 6, 0, 9, 22], ['Soft', 3, 2, 1, 1, 0], ['Liquid', 1, 1, 3, 0, 0], ['Diabetic', 5, 3, 1, 2, 0], ['Low-salt cardiac', 2, 2, 2, 1, 0], ['Renal', 1, 0, 1, 0, 0], ['High protein', 2, 1, 0, 1, 0], ['Tube feed', 0, 0, 3, 0, 0]];
    return {
      nav: this.navItems('Diet'),
      prod: P.map(function (p) { return { t: p[0], a: p[1], b: p[2], c: p[3], d: p[4], e: p[5], s: p[1] + p[2] + p[3] + p[4] + p[5] }; })
    };
  }
