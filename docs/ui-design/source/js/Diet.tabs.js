  tabDefs() {
    return { main: 'Production sheet', tabs: ['Production sheet', 'Diet orders', 'Dietitian assessments', 'Menu and diet master', 'Meal billing'], panels: {
      'Diet orders': { title: 'Active diet orders', acts: ['New diet order'], head: ['Bed', 'Patient', 'Diet', 'Texture', 'Allergies', 'Nil by mouth', 'Ordered by'],
        rows: [['#W2-204-B', 'Ravi Kumar', 'Low-salt cardiac', 'Normal', '~br:Penicillin (drug)', '-', 'Dr. Meera Iyer'], ['#W2-206-B', 'P. Rao', 'Liquid', 'Liquid', '-', '~br:Until 14:00', 'Dr. R. Menon'], ['#W2-203-A', 'M. Lal', 'Diabetic 1,800 kcal', 'Normal', '-', '-', 'Dietitian'], ['#ICU-04', 'K. Nair', 'Tube feed 1.5 kcal/ml', 'Feed', '-', '-', 'Dr. R. Menon']] },
      'Dietitian assessments': { title: 'Nutrition assessments', acts: ['New assessment'], head: ['Patient', 'BMI', 'Risk', 'Plan', 'Counselling', 'Billed'],
        rows: [['M. Lal', '27.4', '~ba:Moderate', 'Diabetic diet, carb counting', 'Done 10:20', '~bg:₹500'], ['R. Shetty', '19.1', '~br:High', 'High-protein tube feed', 'With family', '~bg:₹500'], ['New admissions (5)', '-', '-', '-', '-', '~bb:Due today']] },
      'Menu and diet master': { title: 'Diet types and menu cycle', acts: ['Add diet type'], head: ['Diet type', 'Calories', 'Restrictions', 'Breakfast', 'Lunch'],
        rows: [['Normal', '2,000', '-', 'Poha, milk', 'Rice, dal, sabzi, roti'], ['Diabetic', '1,800', 'No sugar, low GI', 'Oats, milk without sugar', 'Brown rice, dal, salad'], ['Low-salt cardiac', '1,800', 'Salt under 2 g', 'Upma, fruit', 'Roti, dal, steamed veg'], ['Renal', '1,600', 'Low potassium and protein', 'Bread, butter', 'Rice, leached veg']] },
      'Meal billing': { title: 'Chargeable meals', sub: 'Private rooms and attendant meals post to the running bill', head: ['Bed', 'Patient', 'Meals today', 'Rate', 'Posted'],
        rows: [['#PVT-05', 'L. Das', '3 patient + 3 attendant', '₹150 per attendant meal', '~bg:₹450'], ['#W1-112-B', 'T. Shah', '2 attendant', '₹150', '~bg:₹300']] }
    } };
  }
