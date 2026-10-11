import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
rows = [
 ('A', 'Walk-in test only', ['Patient walks in with an outside prescription', 'Quick registration', 'Tests priced by payer list', 'Paid before sample or scan', 'Report and receipt on WhatsApp']),
 ('B', 'Pharmacy counter sale', ['Prescription scanned or typed', 'Batches picked, earliest expiry first', 'GST by HSN on the bill', 'Paid; return within policy gives a credit note']),
 ('C', 'Package', ['Package chosen at estimate', 'Charges inside the package show as included', 'Extras billed separately and shown daily', 'Variance reported to admin']),
 ('D', 'Deposit and refund', ['Deposit collected at admission', 'Top-ups when 80% used', 'Final bill adjusts all deposits', 'Excess refunded to original mode same day']),
 ('E', 'Cancel after payment', ['Cashier requests cancellation with reason', 'Billing Manager approves', 'Credit note issued; number kept', 'Refund paid; audit trail complete']),
 ('F', 'Discount', ['Cashier asks with reason', 'Billing Manager up to 10% or ₹10,000', 'Super Admin above that', 'Bill recalculates; patient notified']),
 ('G', 'Corporate credit', ['Employee shows letter of credit', 'Patient pays nothing within limit', 'Monthly invoice; e-invoice when taxable', 'Payment matched; ageing tracked']),
 ('H', 'Insurance split', ['Approved amount on the bill', 'Non-payables and co-pay to patient', 'Insurer share to claim', 'Deductions booked with reason']),
 ('I', 'Government scheme', ['Scheme package fixed', 'Patient pays nothing for the package', 'Claim with scheme documents', 'Payment matched on receipt']),
 ('J', 'Wallet and membership', ['Health card or wallet linked', 'Member price list applied', 'Pays from wallet, tops up by UPI', 'Balance on the receipt']),
 ('K', 'Concession', ['Staff, family or free-care policy', 'Policy picks the discount', 'Approval if above policy', 'Concession report monthly']),
 ('L', 'Payment failed or pending', ['UPI paid but no receipt (timeout)', 'Bill shows payment pending', 'Webhook or settlement confirms', 'Receipt sent; no double charge']),
 ('M', 'Cheque bounce', ['Cheque deposited', 'Bank returns it', 'Receipt reversed; dues reopened', 'Patient informed; charges as per policy']),
 ('N', 'Miscellaneous bill', ['Certificate, record copy, attendant meal', 'Service from misc price list', 'Paid at counter', 'Revenue to the right head']),
]
CW, CH, GAP, RH = 200, 84, 56, 132
X0, Y0 = 320, 200
maxn = max(len(r[2]) for r in rows)
W = X0 + maxn * (CW + GAP) - GAP + 80
H = Y0 + len(rows) * RH + 80
d = D(W, H)
d.label(64, 48, 1600, 'Billing alternate and exception flows', fs=30, weight=700, color='#142130')
d.label(64, 96, 1700, 'Every path a real billing counter sees. Each row shows what happens in order; settings that change the behaviour are on the Billing Settings screen.', fs=16, color='#3F4A57')
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
open(os.path.join(OUT, 'BillAltFlows.dc.html'), 'w').write(page('Billing alternate flows', d.render(''), W, H))
print('BillAltFlows', W, H)
