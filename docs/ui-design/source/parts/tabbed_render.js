  renderVals() {
    var d = this.tabDefs();
    var cur = this.tabState(d.main);
    var v = this.baseVals();
    v.tabs = this.tabsOf(d.tabs, cur);
    v.main = cur === d.main;
    v.other = cur !== d.main;
    v.p = this.panel(d.panels[cur]);
    return v;
  }
