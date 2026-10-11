import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
rows = [
 ('A', 'STAT and emergency', ['Doctor marks STAT', 'Collected at once; red label', 'Front of every worklist', 'Released in 1 hour; doctor alerted']),
 ('B', 'Home collection', ['Slot booked on portal, call centre or WhatsApp', 'Phlebotomist route; patient gets ETA', 'Collected; payment at the door', 'Cool box logged; handed over in 4 h', 'Report on WhatsApp']),
 ('C', 'Sample rejected', ['Haemolysed, clotted, wrong tube or unlabelled', 'Rejected with reason at reception', 'Recollection order created', 'Nurse or patient informed', 'Rejection counted by ward']),
 ('D', 'Critical value', ['Result beyond critical limit', 'Technician repeats if policy says', 'Phones doctor or nurse; read-back', 'Escalates to HOD if not reached in 15 min', 'Call logged with time and person']),
 ('E', 'Delta check failure', ['Big change from last result', 'Result held for pathologist', 'Sample identity checked or recollected', 'Released with comment']),
 ('F', 'QC failure', ['Control breaks a Westgard rule', 'Run rejected; patient results held', 'Fault fixed, recalibrated', 'QC repeated and in control', 'Held samples rerun and released']),
 ('G', 'Send-out test', ['Test not done in-house', 'Packed with dispatch slip', 'Courier and temperature logged', 'Result uploaded from partner lab', 'Report shows the performing lab']),
 ('H', 'Culture and sensitivity', ['Sample plated', 'Prelim at 24 h: growth or no growth', 'Organism identified', 'Sensitivity S, I, R', 'Final report; antibiogram updated']),
 ('I', 'Histopathology', ['Specimen received in formalin', 'Grossing with photos', 'Processing, blocks, slides', 'Pathologist reports', 'Blocks and slides archived']),
 ('J', 'Amend released report', ['Error found after release', 'Pathologist amends with reason', 'New version; old one kept', 'Doctor and patient informed']),
 ('K', 'Add-on test', ['Doctor adds a test', 'Same sample used if stable', 'Billed and run', 'Added to the same report']),
 ('L', 'Walk-in with outside prescription', ['Quick registration', 'Tests billed and paid', 'Collected at the counter', 'Report on WhatsApp and portal']),
 ('M', 'Analyser down', ['Analyser fault logged', 'Work moved to backup or manual method', 'Doctors told about delays', 'Service ticket raised']),
]
CW, CH, GAP, RH = 200, 84, 56, 132
X0, Y0 = 320, 200
maxn = max(len(r[2]) for r in rows)
W = X0 + maxn * (CW + GAP) - GAP + 80
H = Y0 + len(rows) * RH + 80
d = D(W, H)
d.label(64, 48, 1600, 'Laboratory alternate and exception flows', fs=30, weight=700, color='#142130')
d.label(64, 96, 1700, 'Every path a real laboratory sees. Each row shows what happens in order; settings that change the behaviour are on the Lab Settings screen.', fs=16, color='#3F4A57')
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
open(os.path.join(OUT, 'LabAltFlows.dc.html'), 'w').write(page('Laboratory alternate flows', d.render(''), W, H))
print('LabAltFlows', W, H)
