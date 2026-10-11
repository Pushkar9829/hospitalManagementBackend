"""Regenerate the panel map data, panels.md and screens.md from panels.json and the Handoff screen inventory."""
import json, re, subprocess, os
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, '..')
p = json.load(open(os.path.join(H, 'parts/panels.json')))
f = os.path.join(R, 'boards/PanelMap.dc.html'); t = open(f).read()
m = re.search(r'    var P = (\[.*?\]);\n', t)
new = [{'k': k, 'name': v['name'], 'roles': v['roles'], 'scope': v['scope'], 'home': v['home'], 'menu': v['menu']} for k, v in p.items()]
t = t.replace(m.group(0), '    var P = ' + json.dumps(new, ensure_ascii=False) + ';\n')
t = re.sub(r'<sc-for list="\{\{panels\}\}" as="p" hint-placeholder-count="\d+">', '<sc-for list="{{panels}}" as="p" hint-placeholder-count="%d">' % len(new), t)
open(f, 'w').write(t)
md = os.path.join(R, 'panels.md'); old = open(md).read()
head = old[:old.index('## Super Admin')]; tail = old[old.index('## Platform owner'):]
out = [head.rstrip('\n'), '']
for k, v in p.items():
    out += ['## ' + v['name'], '', '- Roles: ' + v['roles'], '- Home: boards/%s.dc.html' % v['home'], '- Data scope: ' + v['scope'], '- Menu:']
    out += ['  - **%s:** %s' % (g[0], ', '.join(i[0] for i in g[1])) for g in v['menu']]
    out.append('')
open(md, 'w').write('\n'.join(out) + '\n' + tail)
t = open(os.path.join(R, 'boards/Handoff.dc.html')).read()
S = json.loads(subprocess.run(['node', '-e', 'console.log(JSON.stringify(' + re.search(r"    var S = (\[.*?\]\]);\n", t, re.S).group(1) + '))'], capture_output=True, text=True, check=True).stdout)
sm = os.path.join(R, 'screens.md'); lines = open(sm).read().split('\n')
first = next(i for i, l in enumerate(lines) if l.startswith('| ') and 'boards/' in l)
last = max(i for i, l in enumerate(lines) if l.startswith('| ') and 'boards/' in l)
lines = lines[:first] + ['| %s | boards/%s.dc.html | %s | %s | %s | %s | %s |' % tuple([s[0], s[1]] + s[2:7]) for s in S] + lines[last + 1:]
open(sm, 'w').write('\n'.join(lines))
print('synced', len(new), 'panels,', len(S), 'screens')
