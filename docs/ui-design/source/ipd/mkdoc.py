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
d = json.loads(subprocess.run(['node', '-e', node, os.path.join(H, 'rules_data.js'), next(p for p in [os.path.join(S, 'hms-ui/project/IpdModule.dc.html'), os.path.join(S, '..', 'boards', 'IpdModule.dc.html')] if os.path.exists(p))], capture_output=True, text=True, check=True).stdout)
K = {'s': 'Market standard', 'a': 'Advanced', 'o': 'Our edge'}
L = []; w = L.append
w('# IPD: admission to discharge - module specification\n')
w('Module 2 of 16. Design boards: canvas pages "IPD 1 · Module flow end to end" and "IPD 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Ipd*.dc.html, PortalStay.dc.html); generators in docs/ui-design/source/ipd.\n')
w('## 1. Scope\n')
w('From admission advice to a clean bed: estimate and financial counselling, insurance pre-authorisation, bed allocation, admission, ward care (assessments, orders, medicine rounds, charts), daily charges and deposits, transfers, discharge, bed turnaround and the insurance claim. It covers cash, corporate, private insurance (direct and through TPAs) and government schemes (PM-JAY, CGHS, ECHS). Emergency care starts before any payment. OPD hands over through the admission request; OT, ICU charts, pharmacy, lab, diet and housekeeping plug in through orders and tasks.\n')
w('## 2. End-to-end flow (planned admission)\n')
w('| Step | Who | What happens |'); w('|---|---|---|')
for i, (lane, txt) in enumerate(flow['steps']):
    b = re.match(r'<b>(.*?)</b><br>(.*)', txt)
    w('| %d | %s | **%s.** %s |' % (i + 1, flow['lanes'][lane], b.group(1), b.group(2)))
w('\nSteps 9 to 13 repeat every day until discharge is planned. A transfer can happen at any point and changes the room tariff from that hour. IRDAI Master Circular on health insurance (May 2024): the insurer decides a cashless request within 1 hour and the final discharge approval within 3 hours of the hospital\'s request.\n')
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
w('## %d. Role-wise flows\n' % n); w('Each role works in its own panel and sees only its own IPD work.\n')
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
for s in ['MocDoc, overcoming in-patient management software challenges: https://mocdoc.com/blog/overcoming-inpatient-management-software-challenges',
          'Codingclave hospital management software: https://codingclave.com/products/hospital-management-software',
          'Doctors App IPD software: https://www.doctorsapp.in/ipd',
          'OneCity patient management software (OPD/IPD, ABHA): https://onecity.co.in/patient-management-software-bangalore',
          'KareXpert Smart Hospital on Capterra: https://www.capterra.com/p/186949/Smart-Hospital/',
          'KareXpert Smart Hospital on GetApp: https://www.getapp.com/healthcare-pharmaceuticals-software/a/smart-hospital/',
          'KareXpert, emergency medicine blog: https://www.karexpert.com/blogs/from-er-chaos-to-systemized-care-how-karexpert-is-transforming-emergency-medicine/',
          'Epic Grand Central (IntuitionLabs): https://intuitionlabs.ai/software/healthcare-provider-operations/bed-management-and-patient-flow/epic-grand-central',
          'Epic Grand Central (Alberta Connect Care): https://ehealth.connect-care.ca/epic-systems/epic-modules/grand-central',
          'Grand Central capacity poster, NSUH 2025: https://academicworks.medicine.hofstra.edu/nsuh_ccc_posters/2025/posters/21',
          'Bahmni Bed Management: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/699400201/Bed+Management+BM',
          'Bahmni In-Patient Management (IPD): https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32604214/In-Patient+Management+IPD',
          'IRDAI 2024 master circular timelines (BusinessWorld): https://businessworld.in/article/cashless-claims-within-an-hour-discharge-from-hospital-in-3-hrs-irdai-521477',
          'IRDAI 2024 master circular (The Week): https://www.theweek.in/news/india/2024/05/30/irdai-issues-new-master-circular-to-make-health-insurance-claims-process-more-seamless.amp.html',
          'Indicator formulas, MJPJAY output indicators: https://www.jeevandayee.gov.in/MJPJAY/RGJAYDocuments/List_of_35_Output_Indicators_and_Software_User_Manual.pdf']:
    w('- ' + s)
w('\nCheck the IRDAI circular text itself and the current NABH indicator guide before using these timelines and formulas for compliance.\n')
w('## %d. Screens\n' % (n + 3)); w('| Screen | Role | Board |'); w('|---|---|---|')
for r in [('Attendant mobile screens', 'Patient, attendant', 'PortalStay'), ('Admit patient', 'Admission desk', 'Admission'), ('Live bed board', 'Admission desk, ward, housekeeping', 'Beds'), ('Bed requests and transfers', 'Ward in-charge, admission desk', 'IpdBedRequests'),
          ('Insurance and TPA desk', 'Billing Manager (TPA desk)', 'IpdTpa'), ('In-patient bill', 'Cashier', 'IpdBill'), ('In-patient rounds', 'Doctor', 'IpdRounds'), ('Nursing station (MAR, vitals, charts)', 'Staff nurse', 'Nursing'),
          ('Discharge desk', 'Doctor, billing', 'Discharge'), ('Diet and kitchen', 'Dietitian, nurse', 'Diet'), ('Facility and housekeeping', 'Housekeeping', 'Facility'), ('IPD settings', 'Hospital Admin', 'IpdConfig'),
          ('IPD analytics', 'Management', 'IpdAnalytics'), ('Final bill and discharge summary prints', 'Billing, doctor', 'PrintBill, PrintDischarge')]:
    w('| %s | %s | %s |' % r)
open(OUT, 'w').write('\n'.join(L) + '\n')
print('wrote', OUT, len(L), 'lines')
