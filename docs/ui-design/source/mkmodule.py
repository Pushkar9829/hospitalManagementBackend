"""Build a module overview + benchmark board from a data module.
python3 mkmodule.py <module_data.py> <OutName>
The data module defines: TITLE, KICKER, H1, LEAD, ALTS, ROLES, LINKS [(file,label)], ROLE_LINKS [(file,label)],
COMPETITORS [4 headers], SOURCES, DIFF [(bold, text)], DATA_JS (defines var G, Y/N/P/O/X and var B), HEIGHT."""
import sys, os, runpy
H = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(H, '..', 'boards')
d = runpy.run_path(sys.argv[1]); out = sys.argv[2]
t = open(os.path.join(B, 'OpdModule.dc.html')).read()
def rep(a, b):
    global t
    assert a in t, a[:80]; t = t.replace(a, b, 1)
rep('<title>OPD module overview</title>', '<title>%s</title>' % d['TITLE'])
rep('Module deep dive · 1 of 16', d['KICKER'])
rep('<h1 style="margin:8px 0 6px;font-size:38px">OPD and Appointments</h1>', '<h1 style="margin:8px 0 6px;font-size:38px">%s</h1>' % d['H1'])
rep('From the first call to the closed visit: booking, check-in, tokens, triage, consultation, orders, billing, pharmacy and follow-up. Built to match what leading hospital systems offer and to go further on India-specific needs.', d['LEAD'])
rep('<div style="font-size:30px;font-weight:700">11</div><div style="font-size:13px;color:#C9D4E3">alternate flows</div>', '<div style="font-size:30px;font-weight:700">%d</div><div style="font-size:13px;color:#C9D4E3">alternate flows</div>' % d['ALTS'])
rep('<div style="font-size:30px;font-weight:700">9</div><div style="font-size:13px;color:#C9D4E3">role flows</div>', '<div style="font-size:30px;font-weight:700">%d</div><div style="font-size:13px;color:#C9D4E3">role flows</div>' % d['ROLES'])
s = t.index('<a class="btn" href="OpdFlow.dc.html">'); e = t.index('</div>', s)
links = ''.join('<a class="%s" href="%s.dc.html">%s</a>' % ('btn' if i == 0 else 'btn2', f, l) for i, (f, l) in enumerate(d['LINKS'])) + '\n' + ''.join('<a class="btn2" href="%s.dc.html">%s</a>' % (f, l) for f, l in d['ROLE_LINKS']) + '\n'
t = t[:s] + links + t[e:]
rep('<th>Indian HMS vendors (MocDoc, Codingclave)</th><th>KareXpert</th><th>Epic Cadence (enterprise)</th><th>Bahmni (open source)</th>', ''.join('<th>%s</th>' % c for c in d['COMPETITORS']))
s = t.index('Sources: mocdoc.com'); e = t.index('</div>', s)
t = t[:s] + d['SOURCES'] + t[e:]
s = t.index('<div><strong>One visit, one bill'); e = t.index('</div>\n</section>', s)
t = t[:s] + '\n'.join('<div><strong>%s</strong> %s</div>' % x for x in d['DIFF']) + t[e:]
s = t.index('    var G = ['); e = t.index('    var caps = 0;')
t = t[:s] + d['DATA_JS'] + t[e:]
rep('<sc-for list="{{groups}}" as="g" hint-placeholder-count="9">', '<sc-for list="{{groups}}" as="g" hint-placeholder-count="%d">' % d.get('GROUPS', 7))
rep('<sc-for list="{{bench}}" as="b" hint-placeholder-count="14">', '<sc-for list="{{bench}}" as="b" hint-placeholder-count="%d">' % d.get('BENCH', 16))
t = t.replace('"height":2600}', '"height":%d}' % d['HEIGHT']).replace('min-height:2600px', 'min-height:%dpx' % d['HEIGHT'])
open(os.path.join(B, out + '.dc.html'), 'w').write(t)
print('built', out)
