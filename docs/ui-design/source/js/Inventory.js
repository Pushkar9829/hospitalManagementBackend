  renderVals() {
    var S = [['CS-1021', 'Nitrile gloves, medium (box 100)', 'Consumables', 42, 60, '₹410', '₹17,220', 'Reorder', 'bo'], ['CS-1044', 'Syringe 5 ml (box 100)', 'Consumables', 180, 80, '₹520', '₹93,600', 'OK', 'bg'],
      ['CS-1102', 'IV infusion set', 'Consumables', 610, 300, '₹38', '₹23,180', 'OK', 'bg'], ['SU-2010', 'Suture 2-0 absorbable', 'Surgical', 24, 50, '₹265', '₹6,360', 'Reorder', 'bo'],
      ['LN-3001', 'Bedsheet, single', 'Linen', 920, 600, '₹310', '₹2,85,200', 'OK', 'bg'], ['HK-4012', 'Surface disinfectant 5 L', 'Housekeeping', 14, 20, '₹1,150', '₹16,100', 'Reorder', 'bo'],
      ['ST-5003', 'Patient wristband (roll)', 'Stationery', 9, 10, '₹980', '₹8,820', 'Reorder', 'bo'], ['CS-1210', 'Urine bag 2 L', 'Consumables', 0, 100, '₹42', '₹0', 'Out of stock', 'br'], ['BM-6005', 'ECG electrodes (pack 50)', 'Biomedical', 75, 40, '₹640', '₹48,000', 'OK', 'bg']];
    return {
      nav: this.navItems('Inventory'),
      stock: S.map(function (s) { return { c: s[0], n: s[1], cat: s[2], q: s[3], r: s[4], u: s[5], v: s[6], st: s[7], bc: s[8] }; })
    };
  }
