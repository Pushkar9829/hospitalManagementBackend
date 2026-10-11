import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
rows = [
 ('A', 'Emergency admission', ['Emergency triage: admit now', 'Bed or ICU allocated first; no deposit wait', 'Treatment starts on verbal plus written order', 'Registration and consents completed by attendant', 'Deposit or pre-auth within 24 h', 'Joins normal IPD flow']),
 ('B', 'Planned surgery (package)', ['Surgery date booked from OPD', 'Pre-op tests and anaesthesia check in OPD', 'Package estimate signed', 'Admitted on the day; OT scheduled', 'Package billed; extras outside package shown separately', 'Package variance reported']),
 ('C', 'Cashless insurance (TPA)', ['Policy and ID verified', 'Pre-auth sent with documents', 'Approved, query or denied (1 h target)', 'Enhancement when bill nears approval', 'Final approval in 3 h after final bill', 'Claim filed; settlement matched to bill']),
 ('D', 'Government scheme (PM-JAY, CGHS, ECHS)', ['Beneficiary verified on scheme portal', 'Package pre-auth on scheme portal; number recorded', 'Scheme rates; patient pays nothing for package', 'Daily photos and notes as scheme requires', 'Claim with discharge documents', 'Payment matched on receipt']),
 ('E', 'Transfer or ICU step-up', ['Doctor orders transfer', 'Bed request to bed manager', 'Bed allocated; handover note (SBAR)', 'Patient moved; tariff changes from that hour', 'Old bed goes to cleaning', 'Step-down later follows the same steps']),
 ('F', 'Insurance denied', ['Insurer denies or query not resolved', 'Patient and attendant informed with reason', 'Converted to cash or corporate', 'Deposit collected as per category', 'Papers given for reimbursement claim']),
 ('G', 'Leaving against advice (LAMA)', ['Patient or family asks to leave', 'Doctor explains risks, recorded', 'LAMA form signed with witness', 'Bill settled or dues approved', 'Summary marked LAMA; bed released']),
 ('H', 'Death in hospital', ['Death declared and time recorded', 'Cause of death certificate (MCCD)', 'Medico-legal: police informed', 'Body handed over; never held for dues', 'Record to MRD; death review']),
 ('I', 'Absconded patient', ['Patient missing at round or check', 'Search and security informed', 'Police informed as per policy', 'Marked absconded; bed released', 'Bill moved to dues']),
 ('J', 'Day care', ['Booked for dialysis, chemo, cataract and similar', 'Day-care bed; short admission', 'Procedure and observation', 'Same-day discharge; day-care package', 'Next session booked']),
 ('K', 'Mother and newborn', ['Delivery recorded in labour room', 'Baby record and UHID linked to mother', 'Baby on mother’s bill or own (NICU)', 'Birth details for civil registration', 'Joint discharge with both summaries']),
 ('L', 'Medico-legal case (MLC)', ['MLC flagged at admission', 'Police intimation logged', 'Injuries documented; records locked', 'Police informed at discharge or death', 'MLC register updated']),
 ('M', 'Transfer to another hospital', ['Doctor decides referral out', 'Receiving hospital confirmed', 'Consent, summary and ambulance', 'Bill settled or moved to dues', 'Bed released; outcome recorded']),
]
CW, CH, GAP, RH = 200, 84, 56, 132
X0, Y0 = 320, 200
maxn = max(len(r[2]) for r in rows)
W = X0 + maxn * (CW + GAP) - GAP + 80
H = Y0 + len(rows) * RH + 80
d = D(W, H)
d.label(64, 48, 1600, 'IPD alternate and exception flows', fs=30, weight=700, color='#142130')
d.label(64, 96, 1700, 'Every path a real ward sees beyond the planned admission. Each row shows what happens in order; settings that change the behaviour are on the IPD Settings screen.', fs=16, color='#3F4A57')
for i, (k, name, st) in enumerate(rows):
    y = Y0 + i * RH
    d.band(64, y, W - 128, RH - 16, '#F4F6F8' if i % 2 == 0 else '#EEF2F7')
    d.label(84, y + 22, 220, '<span style="display:inline-block;background:#13263F;color:#fff;border-radius:6px;padding:1px 8px;margin-right:6px;font-weight:700">%s</span>' % k, fs=13)
    d.label(84, y + 50, 220, name, fs=15, weight=600, color='#142130')
    cy = y + (RH - 16) // 2
    for j, t in enumerate(st):
        x = X0 + j * (CW + GAP)
        last = j == len(st) - 1
        d.card(x, cy - CH // 2, CW, CH, t, bg='#E3F3EA' if last else '#FFFFFF', border='#9CCBB0' if last else '#C9D1DB', fs=13)
        if not last:
            d.hl(x + CW, cy, x + CW + GAP - 1)
open(os.path.join(OUT, 'IpdAltFlows.dc.html'), 'w').write(page('IPD alternate flows', d.render(''), W, H))
print('IpdAltFlows', W, H)
