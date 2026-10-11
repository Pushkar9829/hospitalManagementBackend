import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
lanes = ['Patient', 'Call centre and portal', 'Front office', 'Cashier', 'Nurse (triage)', 'Doctor', 'Lab and radiology', 'Pharmacy', 'System (automatic)']
steps = [
 (0, '<b>Needs a doctor</b><br>Calls, books on the portal or WhatsApp, or walks in'),
 (1, '<b>Books a slot</b><br>Doctor, date and slot; OTP check; pay online if wanted'),
 (8, '<b>Confirms</b><br>SMS and WhatsApp now; reminders 24 h and 2 h before'),
 (2, '<b>Check-in</b><br>Finds UHID or registers; ABHA scan; consents'),
 (3, '<b>Consultation fee</b><br>Collected, or waived by the free follow-up rule'),
 (8, '<b>Token issued</b><br>Joins doctor queue; TV and SMS show position'),
 (4, '<b>Triage</b><br>Vitals, complaint, pain score, priority'),
 (5, '<b>Consultation</b><br>History, examination, diagnosis (ICD-10)'),
 (5, '<b>Plan</b><br>e-Prescription, test orders, advice, admit or refer'),
 (3, '<b>Bills orders</b><br>One bill for all tests; member and package prices'),
 (6, '<b>Tests done</b><br>Sample or scan; report sent to doctor and patient'),
 (7, '<b>Dispenses</b><br>Rx from queue; earliest-expiry batches; counselling'),
 (5, '<b>Reviews results</b><br>Same-day review when needed; updates plan'),
 (8, '<b>Closes visit</b><br>Follow-up booked; feedback link; wait times logged'),
]
CW, CH, GAP, LH = 200, 96, 96, 132
X0, Y0 = 280, 216
W = X0 + len(steps) * (CW + GAP) - GAP + 80
H = Y0 + len(lanes) * LH + 300
d = D(W, H)
d.label(64, 48, 2400, 'OPD end-to-end flow · happy path for a booked patient', fs=30, weight=700, color='#142130')
d.label(64, 96, 2600, 'Each column is one step in time; each lane is the person or system doing it. Alternate paths (walk-in, no-show, cancellation, doctor leave, tele-consult, admission) are on the Alternate flows board.', fs=16, color='#3F4A57')
for i, ln in enumerate(lanes):
    y = Y0 + i * LH
    d.band(64, y, W - 128, LH - 12, '#F4F6F8' if i % 2 == 0 else '#EEF2F7')
    d.label(80, y + LH // 2 - 22, 180, ln, fs=15, weight=600, color='#142130')
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
d.label(64, fy, 600, 'Time stamps captured on every visit', fs=16, weight=700, color='#142130')
d.label(64, fy + 30, 1400, 'Booked · arrived · checked in · fee paid · triage start and end · consult start and end · orders billed · sample collected · report released · medicines dispensed · visit closed. These give wait time per stage, doctor consult time and total time in hospital (NABH indicator and Phase 2 analytics).', fs=14, color='#3F4A57', lh=22)
d.label(1560, fy, 600, 'Parallel work', fs=16, weight=700, color='#142130')
d.label(1560, fy + 30, 1100, 'Steps 10 to 12 can happen in any order: the patient may go to the pharmacy before the lab. Each counter has its own token series (B-, S-, P-) on the same TV screen.', fs=14, color='#3F4A57', lh=22)
d.label(2760, fy, 600, 'Blue cards', fs=16, weight=700, color='#142130')
d.label(2760, fy + 30, 1000, 'Steps the system does on its own: messages, tokens, queue updates and closing the visit. Nobody has to click.', fs=14, color='#3F4A57', lh=22)
open(os.path.join(OUT, 'OpdFlow.dc.html'), 'w').write(page('OPD end-to-end flow', d.render(''), W, H))
print('OpdFlow', W, H)
