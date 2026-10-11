import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
lanes = ['Patient and attendant', 'Doctor (consultant, RMO)', 'Admission desk', 'Insurance (TPA) desk', 'In-patient billing', 'Ward nurse', 'Bed manager and housekeeping', 'Pharmacy, lab and diet', 'System (automatic)']
steps = [
 (1, '<b>Admission advised</b><br>From OPD, emergency or planned surgery; reason, stay, bed type'),
 (2, '<b>Estimate and counselling</b><br>Room tariff, package, deposit; estimate e-signed'),
 (3, '<b>Pre-authorisation</b><br>Policy checked; request with documents; insurer replies in 1 h'),
 (6, '<b>Bed allocated</b><br>By category, gender and isolation need; reserved 2 h'),
 (2, '<b>Admitted</b><br>IP number, consents, barcode wristband, attendant pass'),
 (0, '<b>Pays deposit</b><br>UPI, card or cash by bed category; none if cashless approved'),
 (5, '<b>Received in ward</b><br>Nursing assessment in 2 h: allergies, falls and pressure risk'),
 (1, '<b>Initial assessment</b><br>History, plan and orders in 24 h: medicines, tests, diet'),
 (7, '<b>Orders fulfilled</b><br>Medicines issued patient-wise; samples; diet from kitchen'),
 (5, '<b>Care every shift</b><br>Barcode medicine round (MAR), vitals, intake-output, notes'),
 (1, '<b>Daily rounds</b><br>Progress notes, results reviewed, orders changed'),
 (8, '<b>Charges posted</b><br>Room, nursing, services daily; alert at 80% of deposit'),
 (3, '<b>Enhancement</b><br>Raised when bill reaches 90% of the approved amount'),
 (1, '<b>Discharge planned</b><br>Expected date set a day ahead; summary drafted'),
 (4, '<b>Final bill</b><br>Pharmacy returns credited; insurer final approval in 3 h'),
 (0, '<b>Goes home</b><br>Medicines explained, summary and bill on WhatsApp, gate pass'),
 (6, '<b>Bed turned around</b><br>Cleaning task; bed available again in 45 min'),
 (8, '<b>After discharge</b><br>Follow-up booked, feedback, record to MRD, claim filed'),
]
CW, CH, GAP, LH = 200, 96, 96, 132
X0, Y0 = 300, 216
W = X0 + len(steps) * (CW + GAP) - GAP + 80
H = Y0 + len(lanes) * LH + 300
d = D(W, H)
d.label(64, 48, 2400, 'IPD end-to-end flow · a planned admission from advice to bed turnaround', fs=30, weight=700, color='#142130')
d.label(64, 96, 3000, 'Each column is one step in time; each lane is the person or system doing it. Emergency, cashless, government scheme, transfer, LAMA, death and other paths are on the Alternate flows board.', fs=16, color='#3F4A57')
for i, ln in enumerate(lanes):
    y = Y0 + i * LH
    d.band(64, y, W - 128, LH - 12, '#F4F6F8' if i % 2 == 0 else '#EEF2F7')
    d.label(80, y + LH // 2 - 22, 200, ln, fs=15, weight=600, color='#142130')
pos = []
for i, (lane, txt) in enumerate(steps):
    x = X0 + i * (CW + GAP); y = Y0 + lane * LH + (LH - 12 - CH) // 2
    pos.append((x, y))
    bg, bd = ('#E6EEF9', '#9DB4D3') if lane == 8 else ('#FFFFFF', '#C9D1DB')
    d.card(x, y, CW, CH, '<span style="display:block;font-size:11px;color:#9A4413;font-weight:700;margin-bottom:2px">STEP %d</span>%s' % (i + 1, txt), bg=bg, border=bd, fs=13)
for i in range(len(steps) - 1):
    (x1, y1), (x2, y2) = pos[i], pos[i + 1]
    cy1, cy2 = y1 + CH // 2, y2 + CH // 2
    sx = x1 + CW
    if cy1 == cy2:
        d.hl(sx, cy1, x2 - 1)
    else:
        mx = sx + GAP // 2
        d.hl(sx, cy1, mx, head=False)
        d.vl(mx, cy1, cy2, head=False)
        d.hl(mx, cy2, x2 - 1)
fy = Y0 + len(lanes) * LH + 24
d.label(64, fy, 900, 'Time stamps captured on every admission', fs=16, weight=700, color='#142130')
d.label(64, fy + 30, 1500, 'Advised · estimate signed · pre-auth sent and answered · bed reserved · admitted · received in ward · first nursing and doctor assessment · every medicine given · discharge advised · bill final · insurer final approval · patient left · bed cleaned. These give admission time, discharge turnaround and bed turnaround (NABH indicators).', fs=14, color='#3F4A57', lh=22)
d.label(1700, fy, 700, 'Loop every day of the stay', fs=16, weight=700, color='#142130')
d.label(1700, fy + 30, 1300, 'Steps 9 to 13 repeat daily until discharge is planned. Transfers to another bed or ICU can happen at any point and change the room tariff from that hour.', fs=14, color='#3F4A57', lh=22)
d.label(3200, fy, 600, 'Blue cards', fs=16, weight=700, color='#142130')
d.label(3200, fy + 30, 1200, 'Steps the system does on its own: daily charges, deposit and approval alerts, follow-up booking, record completion reminders and claim filing.', fs=14, color='#3F4A57', lh=22)
d.label(4600, fy, 700, 'Insurance timings', fs=16, weight=700, color='#142130')
d.label(4600, fy + 30, 900, 'IRDAI Master Circular on health insurance (May 2024): insurer decides cashless requests within 1 hour and final discharge approval within 3 hours. The TPA desk screen shows both timers.', fs=14, color='#3F4A57', lh=22)
open(os.path.join(OUT, 'IpdFlow.dc.html'), 'w').write(page('IPD end-to-end flow', d.render(''), W, H))
print('IpdFlow', W, H)
