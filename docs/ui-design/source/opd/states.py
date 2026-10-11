import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
machines = [
 ('Appointment', ['Booked', 'Confirmed', 'Checked in', 'In consult', 'Completed'], {0: 'Cancelled', 1: 'No-show', 2: 'Rescheduled'}),
 ('Queue token', ['Issued', 'Waiting', 'Called', 'With doctor', 'Done'], {2: 'Skipped (recall later)', 1: 'Priority moved up'}),
 ('Visit', ['Open', 'Triage done', 'Consulted', 'Orders pending', 'Closed'], {2: 'Admitted (to IPD)', 3: 'Referred'}),
 ('OPD bill', ['Draft', 'Final', 'Partly paid', 'Paid'], {1: 'Discount pending approval', 3: 'Refunded or cancelled'}),
 ('Test order', ['Ordered', 'Billed', 'Sample or scan done', 'Reported', 'Reviewed by doctor'], {2: 'Rejected sample, recollect'}),
 ('Prescription', ['Draft', 'Signed', 'At pharmacy', 'Dispensed'], {3: 'Partly dispensed (stock)', 2: 'Substitute approved'}),
]
SW, SH, GAP, RH = 196, 48, 64, 196
X0, Y0 = 260, 200
W = X0 + 5 * (SW + GAP) - GAP + 80
H = Y0 + len(machines) * RH + 40
d = D(W, H)
d.label(64, 48, 1500, 'OPD status lifecycles', fs=30, weight=700, color='#142130')
d.label(64, 96, 1500, 'Green is the normal end state. Red boxes are side exits. The API rejects any move not drawn here.', fs=16, color='#3F4A57')
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
open(os.path.join(OUT, 'OpdStates.dc.html'), 'w').write(page('OPD status lifecycles', d.render(''), W, H))
print('OpdStates', W, H)
