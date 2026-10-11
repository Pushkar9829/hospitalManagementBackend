"""Write docs/modules/IPD.md from the same data the IPD boards are generated from."""
import sys, os, json, re, subprocess, html, tempfile
H = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(H)
OUT = sys.argv[1]
def load(py):
    g = {'__file__': os.path.join(H, py)}; old = sys.argv
    sys.argv = ['x', tempfile.mkdtemp()]
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()): exec(open(os.path.join(H, py)).read(), g)
    sys.argv = old; return g
flow, alt, st = load('flow.py'), load('alt.py'), load('states.py')
roles = json.load(open(os.path.join(H, 'roles.json')))
strip = lambda s: re.sub(r'<[^>]+>', ' ', s).replace('  ', ' ').strip()
node = r'''const fs=require('fs');const t=fs.readFileSync(process.argv[1],'utf8');const m=fs.readFileSync(process.argv[2],'utf8');
const S=(new Function(t+';return S;'))();const js=m.match(/(var G = \[[\s\S]*?\n    \];)\n    var Y[\s\S]*?(var B = \[[\s\S]*?\]\];)/);
const G=(new Function(js[1]+';return G;'))();var Y=['Yes'],N=['Not found'],P=['Partly'],O=['Yes'],X=['Other Epic modules'];const B=(new Function('Y','N','P','O','X',js[2]+';return B;'))(Y,N,P,O,X);
console.log(JSON.stringify({S,G,B}));'''
d = json.loads(subprocess.run(['node', '-e', node, os.path.join(H, 'rules_data.js'), next(p for p in [os.path.join(S, '..', 'boards', 'BillModule.dc.html')] if os.path.exists(p))], capture_output=True, text=True, check=True).stdout)
K = {'s': 'Market standard', 'a': 'Advanced', 'o': 'Our edge'}
L = []; w = L.append
w('# Billing, Payments and Insurance - module specification\n')
w('Module 3 of 16. Design boards: canvas pages "Billing 1 · Module flow end to end" and "Billing 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Bill*.dc.html, PortalPay.dc.html); generators in docs/ui-design/source/bill. The in-patient insurance and TPA flow is in IPD.md.\n')
w('## 1. Scope\n')
w('Everything from the first charge to the ledger: payer-based pricing, OPD, IPD, pharmacy, walk-in and miscellaneous bills, deposits, every payment mode (UPI, card, cash, cheque, bank transfer, wallet, payment link), discounts, cancellations and refunds with approval, insurance, scheme and corporate shares, corporate credit and e-invoices, cashier shifts, day-end close, GST and revenue analytics. Insurance pre-authorisation and claims for in-patients are specified in IPD.md and reused here.\n')
w('## 2. End-to-end flow (charge to ledger)\n')
w('| Step | Who | What happens |'); w('|---|---|---|')
for i, (lane, txt) in enumerate(flow['steps']):
    b = re.match(r'<b>(.*?)</b><br>(.*)', txt)
    w('| %d | %s | **%s.** %s |' % (i + 1, flow['lanes'][lane], b.group(1), b.group(2)))
w('\nNothing is deleted: every charge has a source, and mistakes are cancelled or reversed with a reason, an approval and a credit note. Steps 2 to 6 repeat all day at every counter; steps 10 to 13 close each shift and each day.\n')
w('## 3. Alternate and exception flows\n')
for k, name, steps in alt['rows']:
    w('- **%s. %s.** %s.' % (k, name, '; '.join(steps)))
w('\n## 4. Status lifecycles\n')
w('| Object | Normal path | Side exits (from) |'); w('|---|---|---|')
for name, sts, br in st['machines']:
    w('| %s | %s | %s |' % (name, ' → '.join(sts), ', '.join('%s (%s)' % (v, sts[k]) for k, v in sorted(br.items()))))
w('\nThe API rejects any status change not listed; every change stores time and user.\n')
titles = ['Business rules', 'Settings (IPD Settings screen)', 'Notifications', 'Reports', 'Measures and formulas', 'Edge cases', 'Acceptance tests (sample)']
for n, sec in enumerate(d['S']):
    w('## %d. %s\n' % (n + 5, sec[0])); w(sec[1] + '.\n' if not sec[1].endswith('.') else sec[1] + '\n')
    w('| ' + ' | '.join(sec[2]) + ' |'); w('|' + '---|' * len(sec[2]))
    for r in sec[3]: w('| ' + ' | '.join(c.replace('|', '/') for c in r) + ' |')
    w('')
n = 5 + len(d['S'])
w('## %d. Role-wise flows\n' % n); w('Each role works in its own panel and sees only its own billing work.\n')
for r in roles:
    w('### %s\n' % r['name']); w(r['sub'] + '\n')
    for i, s in enumerate(r['steps']): w('%d. %s' % (i + 1, s))
    w('')
    w('- **Screens:** ' + ', '.join('%s (%s)' % (s[0], s[1]) for s in r['screens']))
    w('- **Can:** ' + '; '.join(r['can'])); w('- **Cannot:** ' + '; '.join(r['cannot']))
    w('- **Notified when:** ' + '; '.join(r['notify'])); w('- **Measured by:** ' + '; '.join('%s (%s)' % (k[0], k[1]) for k in r['kpis'])); w('')
w('## %d. Capabilities\n' % (n + 1)); w('Market standard = offered by most hospital systems. Advanced = leading or enterprise systems. Our edge = not found in the public material reviewed.\n')
for g in d['G']:
    w('**%s**\n' % g[0])
    for it in g[1]: w('- %s (%s)' % (it[0], K[it[1]]))
    w('')
w('## %d. Competitor benchmark\n' % (n + 2))
w('From public product pages, directory listings and documentation, reviewed October 2026. "Not found" means not confirmed publicly, not that the product lacks it. "Other Epic modules" means the feature sits outside Grand Central. Verify in vendor demos before quoting.\n')
w('| Capability | Indian HMS vendors (MocDoc and others) | KareXpert Smart Hospital | Epic Grand Central | Bahmni | Ours |'); w('|---|---|---|---|---|---|')
for b in d['B']: w('| ' + b[0] + ' | ' + ' | '.join(c[0] for c in b[1:]) + ' |')
w('\nSources:\n')
for s in ['MocDoc HMS on G2: https://www.g2.com/products/mocdoc-hms/discuss',
          'MocDoc HMS on AlternativeTo: https://alternativeto.net/software/mocdoc-hms/about',
          'MocDoc HMS reviews on Capterra: https://www.capterra.com/p/161290/MocDoc-HMS/reviews/?page=2',
          'KareXpert on G2: https://www.g2.com/sellers/karexpert-technologies',
          'KareXpert Smart Hospital on Capterra: https://www.capterra.com/p/186949/Smart-Hospital/',
          'Epic charge capture (University of Iowa Epic support): https://epicsupport.sites.uiowa.edu/epic-resources/charge-capture',
          'Epic Hospital Billing follow-up (University of Iowa Epic support): https://epicsupport.sites.uiowa.edu/epic-resources/hospital-billing-hb-follow',
          'Medical billing listings with patient payment portals (IndiaMART): https://m.indiamart.com/impcat/medical-billing-software.html',
          'e-Invoicing under GST (Zoho Books): https://www.zoho.com/in/books/e-invoicing']:
    w('- ' + s)
w('\nGST rates, the room-rent rule, e-invoice thresholds and the section 269ST cash limit are set as defaults from public rules; the hospital\u2019s chartered accountant must confirm them before go-live.\n')
w('## %d. Screens\n' % (n + 3)); w('| Screen | Role | Board |'); w('|---|---|---|')
for r in [('Patient payments on the phone', 'Patient, family', 'PortalPay'), ('Billing counter (OPD, IP, deposits, refunds, misc bill)', 'Cashier', 'Billing'), ('Cashier shift and day-end', 'Cashier, Billing Manager', 'BillShift'),
          ('In-patient bill', 'Cashier', 'IpdBill'), ('Insurance and TPA desk', 'Insurance desk', 'IpdTpa'), ('Corporate and credit desk', 'Billing Manager', 'BillCorporate'), ('Approvals', 'Billing Manager, Super Admin', 'Approvals'),
          ('Billing settings', 'Hospital Admin', 'BillConfig'), ('Billing analytics', 'Management, Accounts', 'BillAnalytics'), ('Finance (ledger, bank, GST)', 'Accounts', 'Finance'), ('Bill and receipt prints', 'Cashier', 'PrintBill, PrintReceipt')]:
    w('| %s | %s | %s |' % r)
open(OUT, 'w').write('\n'.join(L) + '\n')
print('wrote', OUT, len(L), 'lines')
