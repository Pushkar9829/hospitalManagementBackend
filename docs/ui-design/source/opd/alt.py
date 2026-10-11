import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
rows = [
 ('A', 'Walk-in, no appointment', ['Arrives at desk', 'Finds UHID or quick-registers', 'Picks doctor; next free slot or walk-in series W-', 'Pays fee', 'Token merged into queue: 1 walk-in after every 3 booked (setting)', 'Normal triage and consult']),
 ('B', 'Online prepaid booking', ['Searches doctor on portal or WhatsApp', 'Slot held 5 minutes', 'Pays by UPI or card', 'Confirmed; QR pass sent', 'Scans QR at kiosk or desk', 'Token issued, no fee counter']),
 ('C', 'Reschedule or cancel', ['Patient, call centre or desk requests', 'Policy check: before cut-off?', 'Slot released', 'First waitlisted patient offered the slot', 'Refund or credit as per policy', 'All changes logged']),
 ('D', 'No-show', ['Slot time + 30 min grace passes', 'Marked No-show automatically', 'SMS: rebook link', 'Prepaid fee: credit or forfeit per policy', 'Third no-show in 90 days: prepay required']),
 ('E', 'Doctor leave or late', ['Leave approved in HR, or ad-hoc block', 'Affected bookings listed', 'Bulk move to same-specialty doctor or new date', 'Patients informed by SMS and WhatsApp', 'Refund if patient cancels']),
 ('F', 'Free follow-up', ['Booked within N days of last paid visit', 'Same doctor and visit linked', 'Fee waived automatically', 'Shown as follow-up on token and bill', 'Paid again after N days or new complaint']),
 ('G', 'Tele-consultation', ['Books tele slot and prepays', 'Consent recorded', 'Video link by SMS and portal', 'Doctor starts call from queue', 'e-Rx sent; tests booked at nearest centre']),
 ('H', 'Referral or cross-consult', ['Doctor refers in consultation', 'Same-day priority slot in other department', 'Referral note visible to second doctor', 'Second consult (fee per policy)', 'Both visits on one bill']),
 ('I', 'Admission from OPD', ['Doctor raises admission request', 'Admission desk allocates bed', 'Deposit collected', 'IPD module takes over', 'OPD visit closed as Admitted']),
 ('J', 'Priority or red flag', ['Triage sets red (e.g. chest pain)', 'Moves to top of queue; doctor alerted', 'Emergency referral if needed (Phase 2 ER)', 'Every queue jump audited with reason']),
 ('K', 'Health check-up package', ['Package booked (self or corporate)', 'Check-in creates all orders', 'Route sheet: stations tracked', 'Physician review of all results', 'One consolidated report released']),
]
CW, CH, GAP, RH = 200, 84, 56, 132
X0, Y0 = 320, 200
maxn = max(len(r[2]) for r in rows)
W = X0 + maxn * (CW + GAP) - GAP + 80
H = Y0 + len(rows) * RH + 80
d = D(W, H)
d.label(64, 48, 1600, 'OPD alternate and exception flows', fs=30, weight=700, color='#142130')
d.label(64, 96, 1700, 'Every path a real OPD sees beyond the happy path. Each row shows what happens in order; settings that change the behaviour are on the OPD Settings screen.', fs=16, color='#3F4A57')
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
open(os.path.join(OUT, 'OpdAltFlows.dc.html'), 'w').write(page('OPD alternate flows', d.render(''), W, H))
print('OpdAltFlows', W, H)
