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
d = json.loads(subprocess.run(['node', '-e', node, os.path.join(H, 'rules_data.js'), next(p for p in [os.path.join(S, '..', 'boards', 'LabModule.dc.html')] if os.path.exists(p))], capture_output=True, text=True, check=True).stdout)
K = {'s': 'Market standard', 'a': 'Advanced', 'o': 'Our edge'}
L = []; w = L.append
w('# Laboratory (LIS) - module specification\n')
w('Module 4 of 16. Design boards: canvas pages "Lab 1 · Module flow end to end" and "Lab 2 · Role-wise flows" (https://claude.ai/artifact/Fnp7CKPFT5jbiEFyMFNRq2). Board sources are in docs/ui-design/boards (Lab*.dc.html, PhleboPhone.dc.html); generators in docs/ui-design/source/lab.\n')
w('## 1. Scope\n')
w('From the test order to the released report: barcoded collection on the ward, at the counter and at home, sample receipt and rejection, analyser interfaces, quality control with Westgard rules, reference ranges, delta and critical checks, two-step validation, microbiology with sensitivity and antibiogram, histopathology, send-out tests, report delivery and NABL quality indicators. Radiology is a separate module.\n')
w('## 2. End-to-end flow (order to report)\n')
w('| Step | Who | What happens |'); w('|---|---|---|')
for i, (lane, txt) in enumerate(flow['steps']):
    b = re.match(r'<b>(.*?)</b><br>(.*)', txt)
    w('| %d | %s | **%s.** %s |' % (i + 1, flow['lanes'][lane], b.group(1), b.group(2)))
w('\nA result cannot be released while QC for its run is out of control, the sample was rejected, or a delta or critical check is still open. Every step is time-stamped, so TAT is measured per stage.\n')
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
w('## %d. Role-wise flows\n' % n); w('Each role works in its own panel and sees only its own laboratory work.\n')
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
for s in ['CrelioHealth medical lab LIS: https://creliohealth.com/lis/medical-lab/medical-lab-information-system',
          'CrelioHealth LIS for multi-site labs (QC, Levey-Jennings): https://creliohealth.com/us/lis/lis-system/texas-laboratory-information-system',
          'CrelioHealth Q1 2026 updates (delta check, QC lots): https://blog.creliohealth.com/smarter-faster-better-transformative-lis-updates-q1-2026/',
          'CrelioHealth Q2 2025 updates (vial tracking): https://blog.creliohealth.com/q2-2025-recap-catch-up-on-whats-new-at-creliohealth',
          'CrelioHealth pathology lab automation: https://creliohealth.com/lims/pathology-lab/pathology-lab-automation',
          'KareXpert Smart Hospital on Capterra: https://www.capterra.com/p/186949/Smart-Hospital/',
          'Epic Beaker (Mindbowser): https://www.mindbowser.com/epic-beaker-for-healthcare-it-teams/',
          'Epic Beaker (Folio3 Digital Health): https://digitalhealth.folio3.com/blog/?p=15406',
          'Epic Beaker in practice (CAP Today): https://www.captodayonline.com/benefits-bumps-shifting-beaker/',
          'Bahmni Lab Dashboard: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32014460/Using+Lab+Dashboard',
          'Bahmni Laboratory Management: https://bahmni.atlassian.net/wiki/spaces/BAH/pages/32604211/Laboratory+Management',
          'Westgard rules: https://en.wikipedia.org/wiki/Westgard_rules',
          'Critical value reporting and NABL 112 (Thieme): https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0043-1775573']:
    w('- ' + s)
w('\nCritical-value timings, QC rules and retention periods are defaults; confirm the exact NABL 112 clause wording with the lab\u2019s assessor.\n')
w('## %d. Screens\n' % (n + 3)); w('| Screen | Role | Board |'); w('|---|---|---|')
for r in [('Laboratory worklists (collect, receive, result entry, validate, released, home)', 'Lab technician, pathologist', 'Lab'), ('Sample collection and receipt', 'Lab reception, nurse', 'LabSample'), ('Quality control (Levey-Jennings, Westgard, EQAS)', 'Lab technician, pathologist', 'LabQC'),
          ('Microbiology (cultures, sensitivity, antibiogram)', 'Microbiologist', 'LabMicro'), ('Histopathology', 'Pathologist', 'LabHisto'), ('Lab settings (tests, ranges, critical values, analysers, partners)', 'Lab in-charge', 'LabConfig'),
          ('Lab analytics', 'Management, lab in-charge', 'LabAnalytics'), ('Phlebotomist phone screens', 'Phlebotomist', 'PhleboPhone'), ('Lab report print', 'Patient, doctor', 'PrintLab')]:
    w('| %s | %s | %s |' % r)
open(OUT, 'w').write('\n'.join(L) + '\n')
print('wrote', OUT, len(L), 'lines')
