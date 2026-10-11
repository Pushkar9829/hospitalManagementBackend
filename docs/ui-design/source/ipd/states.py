import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
machines = [
 ('Admission request', ['Requested', 'Estimate given', 'Bed reserved', 'Admitted'], {0: 'Cancelled', 1: 'Waiting for bed', 2: 'Reservation expired (2 h)'}),
 ('Bed', ['Available', 'Reserved', 'Occupied', 'Vacated', 'Cleaned (Available)'], {0: 'Blocked (maintenance)', 3: 'Terminal clean (isolation)'}),
 ('In-patient stay', ['Admitted', 'Under treatment', 'Discharge planned', 'Discharge started', 'Discharged'], {1: 'Transferred (bed or ICU)', 2: 'LAMA, absconded, referred out', 3: 'Death'}),
 ('Pre-authorisation', ['Draft', 'Sent', 'Approved', 'Enhanced', 'Final approved', 'Settled'], {1: 'Query or denied (to cash)', 4: 'Approved less: patient pays', 5: 'Short-paid: deduction'}),
 ('In-patient bill', ['Running', 'Interim', 'Final draft', 'Audited', 'Settled'], {2: 'Discount pending approval', 3: 'Discharged with dues'}),
 ('Medicine order', ['Ordered', 'Pharmacist verified', 'Issued to ward', 'Given (MAR)'], {1: 'Rejected by pharmacist', 2: 'Held or refused (reason)'}),
 ('Discharge', ['Planned', 'Summary signed', 'Bill cleared', 'Documents given', 'Patient left'], {1: 'Awaiting insurer approval'}),
]
SW, SH, GAP, RH = 196, 48, 64, 196
X0, Y0 = 260, 200
maxn = max(len(m[1]) for m in machines)
W = X0 + maxn * (SW + GAP) - GAP + 80
H = Y0 + len(machines) * RH + 40
d = D(W, H)
d.label(64, 48, 1500, 'IPD status lifecycles', fs=30, weight=700, color='#142130')
d.label(64, 96, 1600, 'Green is the normal end state. Red boxes are side exits. The API rejects any move not drawn here; every move is time-stamped with the user.', fs=16, color='#3F4A57')
for i, (name, st, br) in enumerate(machines):
    y = Y0 + i * RH
    d.label(64, y + 12, 180, name, fs=17, weight=700, color='#142130')
    for j, s in enumerate(st):
        x = X0 + j * (SW + GAP); last = j == len(st) - 1
        d.card(x, y, SW, SH, s, bg='#E3F3EA' if last else '#E6EEF9', border='#1A6B44' if last else '#1F5FAD', fs=14, radius=24)
        if not last:
            d.hl(x + SW, y + SH // 2, x + SW + GAP - 1)
        if j in br:
            by = y + SH + 56
            d.vl(x + SW // 2, y + SH, by - 1, color='#A3201A')
            d.card(x, by, SW, 44, br[j], bg='#FDECEA', border='#A3201A', fs=13, radius=22)
open(os.path.join(OUT, 'IpdStates.dc.html'), 'w').write(page('IPD status lifecycles', d.render(''), W, H))
print('IpdStates', W, H)
