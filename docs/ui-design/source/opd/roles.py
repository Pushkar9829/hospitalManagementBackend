import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from diag import D, page
OUT = sys.argv[1]
R = json.load(open(os.path.join(os.path.dirname(__file__), 'roles.json')))
CW, CH, GAP = 240, 104, 56
X0, Y1 = 64, 196
W, H = 1600, 1180
for r in R:
    d = D(W, H)
    d.label(64, 40, 1100, 'OPD · %s' % r['name'], fs=30, weight=700, color='#142130')
    d.label(64, 88, 1300, r['sub'], fs=16, color='#3F4A57')
    d.raw('<a href="%s.dc.html" style="position: absolute; left: 1290px; top: 44px; width: 246px; height: 44px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: #1D3557; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600">Open %s panel</a>' % (r['home'], r['panel']))
    steps = r['steps']
    n = len(steps)
    per = 5
    pos = []
    for i, s in enumerate(steps):
        row, col = divmod(i, per)
        if row % 2 == 1: col = per - 1 - col
        x = X0 + col * (CW + GAP); y = Y1 + row * (CH + 80)
        pos.append((x, y))
        d.card(x, y, CW, CH, '<span style="display:block;font-size:11px;color:#9A4413;font-weight:700;margin-bottom:2px">%d</span>%s' % (i + 1, s), fs=13)
    for i in range(n - 1):
        (x1, y1), (x2, y2) = pos[i], pos[i + 1]
        if y1 == y2:
            if x2 > x1: d.hl(x1 + CW, y1 + CH // 2, x2 - 1)
            else: d.hl(x1, y1 + CH // 2, x2 + CW + 1)
        else:
            d.vl(x1 + CW // 2, y1 + CH, y2 - 1)
    rows_used = (n + per - 1) // per
    iy = Y1 + rows_used * (CH + 80) + 8
    cols = [('Screens they use', r['screens']), ('Can do', r['can']), ('Cannot do', r['cannot']), ('Gets notified when', r['notify'])]
    cw = 344
    for k, (title, items) in enumerate(cols):
        x = 64 + k * (cw + 20)
        if title == 'Screens they use':
            li = ''.join('<li style="margin-bottom:6px"><a href="%s.dc.html">%s</a></li>' % (s[1], s[0]) for s in items)
        else:
            li = ''.join('<li style="margin-bottom:6px">%s</li>' % s for s in items)
        d.raw('<div style="position: absolute; left: %dpx; top: %dpx; width: %dpx; box-sizing: border-box; padding: 16px; background: #F8FAFC; border: 1px solid #DDE2E8; border-radius: 10px; font-size: 14px; line-height: 20px"><div style="font-weight:700;font-size:15px;margin-bottom:8px">%s</div><ul style="margin:0;padding-left:18px">%s</ul></div>' % (x, iy, cw, title, li))
    ky = iy + 300
    kp = ''.join('<div style="flex:1 1 0;min-width:0;padding:12px 14px;border:1px solid #DDE2E8;border-radius:10px;background:#fff"><div style="font-size:12px;color:#5B6878">%s</div><div style="font-size:14px;font-weight:600;margin-top:4px">%s</div></div>' % (k[0], k[1]) for k in r['kpis'])
    d.raw('<div style="position: absolute; left: 64px; top: %dpx; width: 1472px"><div style="font-weight:700;font-size:15px;margin-bottom:8px">Measured by</div><div style="display:flex;gap:12px">%s</div></div>' % (ky, kp))
    open(os.path.join(OUT, r['file'] + '.dc.html'), 'w').write(page('OPD flow · ' + r['name'], d.render(''), W, H))
    print(r['file'])
