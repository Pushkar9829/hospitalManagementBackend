"""Build a module 'Rules, messages, reports and tests' board from a data file.
python3 mkrules.py <data.js> <OutName> <MODULE label> <height>
The data file defines `var S = [[title, sub, head[], rows[][]], ...];` (see ipd/rules_data.js)."""
import sys, os
H = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(H, '..', 'boards')
data, out, mod, height = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
t = open(os.path.join(B, 'OpdRules.dc.html')).read()
s = t.index('    var S = ['); e = t.index('    return { sections:')
t = t[:s] + open(data).read() + t[e:]
for a, b in [('<title>OPD rules', '<title>%s rules' % mod), ('>OPD · board 4<', '>%s · board 4<' % mod),
             ('Everything a developer and tester needs to build OPD correctly. Values in brackets are defaults that the hospital can change on the OPD Settings screen.',
              'Everything a developer and tester needs to build %s correctly. Values in brackets are defaults that the hospital can change on the %s Settings screen.' % (mod, mod))]:
    assert a in t, a; t = t.replace(a, b)
t = t.replace('"height":3400', '"height":%d' % height).replace('min-height:3400px', 'min-height:%dpx' % height)
open(os.path.join(B, out + '.dc.html'), 'w').write(t)
print('built', out)
