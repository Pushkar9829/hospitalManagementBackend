"""Assemble a hospital-app artboard: python3 build.py Name "Title" "Crumb" "H1" "User" "Role" "Init" panelKey"""
import sys, os, json
S = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('OUT_DIR', os.path.join(S, '..', 'boards'))
name, title, crumb, h1, user, role, init, pk = sys.argv[1:9]
rd = lambda p: open(os.path.join(S, p)).read()
panels = json.load(open(os.path.join(S, 'parts/panels.json')))
pan = panels[pk]
screens = [i[1] for g in pan['menu'] for i in g[1]]
assert name in screens or name.startswith('Home'), '%s is not in the %s panel menu' % (name, pk)
switch = ['<details style="position:relative">',
          '<summary class="btn2" style="list-style:none">View as: %s ▾</summary>' % pan['name'],
          '<div style="position:absolute;right:0;top:50px;z-index:20;background:#fff;border:1px solid #DDE2E8;border-radius:10px;box-shadow:0 12px 32px rgba(20,33,48,.16);padding:6px;width:270px;max-height:460px;overflow:auto;display:flex;flex-direction:column">',
          '<div class="cap" style="padding:6px 10px">Prototype: switch role panel. Real users see only the roles they hold.</div>']
for k, p in panels.items():
    cls = 'nvlA' if k == pk else 'nvl'
    switch.append('<a class="%s" href="%s.dc.html">%s</a>' % (cls, p['home'], p['name']))
switch.append('<a class="nvl" href="Console.dc.html">Platform owner (console)</a>')
switch.append('<a class="nvl" href="Portal.dc.html">Patient (portal)</a>')
switch.append('</div></details>')
appr = '<a class="btn2" href="Approvals.dc.html">Approvals <span class="b bo">5</span></a>' if 'Approvals' in screens else ''
head = rd('parts/head.html').replace('__TITLE__', title)
shell = rd('parts/shell_open.html')
for k, v in [('__CRUMB__', crumb), ('__H1__', h1), ('__USER__', user), ('__ROLE__', role), ('__INIT__', init), ('__PANEL__', pan['name']), ('__SWITCH__', '\n'.join(switch)), ('__APPROVALS__', appr)]:
    shell = shell.replace(k, v)
body = rd('body/%s.html' % name)
body = body.replace('@@TABS@@', rd('parts/tabs.html').strip()).replace('@@PANEL@@', rd('parts/panel.html').strip())
js = rd('js/%s.js' % name)
tabs_js = os.path.join(S, 'js/%s.tabs.js' % name)
if os.path.exists(tabs_js):
    js = js.replace('  renderVals() {', '  baseVals() {', 1) + open(tabs_js).read() + rd('parts/tabbed_render.js')
tail = rd('parts/tail_open.html').replace('__PANELS_JSON__', json.dumps({pk: pan['menu']}, ensure_ascii=False)).replace('__PANELKEY__', pk)
out = head + shell + body + tail + js + rd('parts/tail_close.html')
# Screens taller than the default 1320 px board
TALL = {'IpdAnalytics': 1640, 'IpdBill': 1420, 'Roles': 1960, 'Approvals': 1640, 'BillAnalytics': 1740, 'LabAnalytics': 1820}
if name in TALL:
    out = out.replace('"height":1320}', '"height":%d}' % TALL[name]).replace('min-height:1320px', 'min-height:%dpx' % TALL[name])
open(os.path.join(OUT, '%s.dc.html' % name), 'w').write(out)
print('built', name, '[' + pk + ']')
