import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
lanes = ['Patient', 'Doctor', 'Nurse or phlebotomist', 'Lab reception', 'Lab technician', 'Pathologist', 'Billing', 'System (automatic)']
steps = [
 (1, '<b>Tests ordered</b><br>Order set or single tests; priority routine, urgent or STAT'),
 (6, '<b>Order billed</b><br>OPD pays before collection; IPD to running bill'),
 (7, '<b>Labels and list</b><br>Barcode per container; collection list by ward and time'),
 (2, '<b>Sample collected</b><br>Wristband and label scanned; collector and time saved'),
 (3, '<b>Received</b><br>Label, container, volume checked; accept or reject with reason'),
 (7, '<b>Routed</b><br>To bench and analyser worklists; orders sent to the analyser'),
 (4, '<b>Run</b><br>Only after QC for the run is in control; results uploaded'),
 (7, '<b>Checks</b><br>Range flags, delta check, critical limits'),
 (4, '<b>Critical value phoned</b><br>To doctor or nurse in 30 min; read-back logged'),
 (5, '<b>Validated</b><br>Pathologist reviews and releases (maker-checker)'),
 (7, '<b>Report delivered</b><br>Doctor inbox, patient WhatsApp, ABHA; print with QR'),
 (1, '<b>Reviews and acts</b><br>Result acknowledged; plan changed if needed'),
 (0, '<b>Sees report</b><br>Phone link with trend of past results'),
 (4, '<b>Sample stored</b><br>Kept for the retention period, then discarded as waste'),
 (7, '<b>Quality logged</b><br>TAT by stage, rejections, QC, NABL indicators'),
]
CW, CH, GAP, LH = 200, 96, 96, 132
X0, Y0 = 330, 216
W = X0 + len(steps) * (CW + GAP) - GAP + 80
H = Y0 + len(lanes) * LH + 300
d = D(W, H)
d.label(64, 48, 2400, 'Laboratory end-to-end flow · from order to report', fs=30, weight=700, color='#142130')
d.label(64, 96, 3000, 'Each column is one step in time; each lane is the person or system doing it. STAT, home collection, rejection, QC failure, send-out, culture, histopathology and other paths are on the Alternate flows board.', fs=16, color='#3F4A57')
for i, ln in enumerate(lanes):
    y = Y0 + i * LH
    d.band(64, y, W - 128, LH - 12, '#F4F6F8' if i % 2 == 0 else '#EEF2F7')
    d.label(80, y + LH // 2 - 22, 230, ln, fs=15, weight=600, color='#142130')
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
d.label(64, fy, 900, 'Time stamps on every sample', fs=16, weight=700, color='#142130')
d.label(64, fy + 30, 1300, 'Ordered · billed · collected · received · run · entered · validated · released · viewed by doctor. TAT is measured from collection for in-patients and from receipt for walk-ins, per test and priority.', fs=14, color='#3F4A57', lh=22)
d.label(1500, fy, 700, 'Quality gates', fs=16, weight=700, color='#142130')
d.label(1500, fy + 30, 1200, 'A result cannot be released when QC for its run is out of control, when the sample was rejected, or when a delta or critical check is still open.', fs=14, color='#3F4A57', lh=22)
d.label(2800, fy, 600, 'Blue cards', fs=16, weight=700, color='#142130')
d.label(2800, fy + 30, 1100, 'Steps the system does on its own: labels, routing, checks, delivery and quality measures.', fs=14, color='#3F4A57', lh=22)
open(os.path.join(OUT, 'LabFlow.dc.html'), 'w').write(page('Laboratory end-to-end flow', d.render(''), W, H))
print('LabFlow', W, H)
