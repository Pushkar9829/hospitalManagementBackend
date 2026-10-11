import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
lanes = ['Patient and payer', 'Front office and admission', 'Clinical (doctor, nurse, lab, pharmacy)', 'Cashier', 'Billing manager', 'Insurance and corporate desk', 'Accounts', 'System (automatic)']
steps = [
 (1, '<b>Payer set</b><br>Cash, corporate, insurer or scheme; price list follows the payer'),
 (2, '<b>Services ordered</b><br>Consult, tests, procedures, medicines, room'),
 (7, '<b>Charges captured</b><br>Priced by payer list; package and GST rules applied'),
 (3, '<b>Bill raised</b><br>OPD pay first; IPD running bill and deposit'),
 (0, '<b>Pays</b><br>UPI, card, cash, cheque, wallet or split'),
 (7, '<b>Receipt</b><br>Printed and sent on WhatsApp; posted to day book'),
 (3, '<b>Discount or refund asked</b><br>Always with a reason'),
 (4, '<b>Approves</b><br>Maker-checker; Super Admin above the limit'),
 (5, '<b>Payer share billed</b><br>Insurer claim or corporate invoice; patient pays the rest'),
 (3, '<b>Shift closed</b><br>Cash counted by note; card and UPI matched; handover'),
 (4, '<b>Day-end verified</b><br>Variances explained before the day locks'),
 (6, '<b>Banked and reconciled</b><br>Deposit slip, bank statement and settlements matched'),
 (7, '<b>Posted to ledger</b><br>Revenue by department, receivables by payer, GST'),
 (6, '<b>Receivables chased</b><br>Corporate, insurer and patient dues by age'),
 (7, '<b>Revenue analytics</b><br>By service, payer, doctor; collection and leakage'),
]
CW, CH, GAP, LH = 200, 96, 96, 132
X0, Y0 = 330, 216
W = X0 + len(steps) * (CW + GAP) - GAP + 80
H = Y0 + len(lanes) * LH + 300
d = D(W, H)
d.label(64, 48, 2400, 'Billing end-to-end flow · from charge to ledger', fs=30, weight=700, color='#142130')
d.label(64, 96, 3000, 'Each column is one step in time; each lane is the person or system doing it. Walk-in, pharmacy, package, deposit, corporate, insurance, wallet and other paths are on the Alternate flows board.', fs=16, color='#3F4A57')
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
d.label(64, fy, 900, 'One rule underneath everything', fs=16, weight=700, color='#142130')
d.label(64, fy + 30, 1300, 'Nothing is deleted. Every charge has a source (order, census or manual entry with a reason); mistakes are cancelled or reversed with a reason and a credit note, and every change is in the audit log.', fs=14, color='#3F4A57', lh=22)
d.label(1500, fy, 700, 'Loop every day', fs=16, weight=700, color='#142130')
d.label(1500, fy + 30, 1200, 'Steps 2 to 6 happen many times a day at every counter; steps 10 to 13 close each shift and each day.', fs=14, color='#3F4A57', lh=22)
d.label(2800, fy, 600, 'Blue cards', fs=16, weight=700, color='#142130')
d.label(2800, fy + 30, 1100, 'Steps the system does on its own: pricing, receipts, ledger posting and analytics. Nobody re-types a number.', fs=14, color='#3F4A57', lh=22)
open(os.path.join(OUT, 'BillFlow.dc.html'), 'w').write(page('Billing end-to-end flow', d.render(''), W, H))
print('BillFlow', W, H)
