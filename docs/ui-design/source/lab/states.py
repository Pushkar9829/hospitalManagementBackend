import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
machines = [
 ('Test order', ['Ordered', 'Billed', 'Collected', 'Received', 'Resulted', 'Validated', 'Released'], {0: 'Cancelled', 3: 'Rejected: recollect', 4: 'Sent out'}),
 ('Sample', ['Labelled', 'Collected', 'In transit', 'Received', 'Stored', 'Discarded'], {2: 'Lost: recollect', 3: 'Rejected'}),
 ('Result', ['Entered', 'Technically verified', 'Validated', 'Released'], {1: 'Held: delta or critical', 3: 'Amended (new version)'}),
 ('QC run', ['Run', 'Checked', 'In control'], {1: 'Warning 1-2s', 2: 'Rejected (1-3s, 2-2s)'}),
 ('Culture', ['Received', 'Plated', 'Growth read', 'Identified', 'Sensitivity done', 'Final'], {2: 'No growth at 48 h: final'}),
 ('Histopathology case', ['Received', 'Grossed', 'Processed', 'Blocks and slides', 'Reported', 'Released'], {4: 'Special stains or review'}),
]
SW, SH, GAP, RH = 196, 48, 64, 196
X0, Y0 = 260, 200
maxn = max(len(m[1]) for m in machines)
W = X0 + maxn * (SW + GAP) - GAP + 80
H = Y0 + len(machines) * RH + 40
d = D(W, H)
d.label(64, 48, 1500, 'Laboratory status lifecycles', fs=30, weight=700, color='#142130')
d.label(64, 96, 1600, 'Green is the normal end state. Red boxes are side exits. Nothing is ever deleted: the API rejects any move not drawn here and every move is time-stamped with the user.', fs=16, color='#3F4A57')
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
open(os.path.join(OUT, 'LabStates.dc.html'), 'w').write(page('Laboratory status lifecycles', d.render(''), W, H))
print('LabStates', W, H)
