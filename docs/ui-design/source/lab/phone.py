"""Home-collection phlebotomist phone screens (four frames)."""
import os, re
H = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(H, '..', '..', 'boards')
src = open(os.path.join(B, 'PortalBooking.dc.html')).read()
head = re.sub(r'<title>[^<]*</title>', '<title>Phlebotomist phone screens</title>', src[:src.index('</helmet>') + len('</helmet>')])
tail = src[src.index('</x-dc>'):]
PH = '<div style="width:390px;height:844px;background:#F4F6F8;border-radius:28px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 32px rgba(20,33,48,.18)">'
def phone(step, title, body):
    return PH + '\n<div style="background:#13263F;color:#fff;padding:20px"><div class="cap" style="color:#C9D4E3">%s</div><div style="font-size:20px;font-weight:700">%s</div></div>\n<div style="padding:16px;display:flex;flex-direction:column;gap:12px">\n%s\n</div></div>' % (step, title, body)
row = lambda a, b, c='': '<div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;padding:8px 0;border-bottom:1px solid #EEF1F4"><span>%s</span><span style="font-weight:600%s">%s</span></div>' % (a, c, b)
card = lambda inner: '<div style="background:#fff;border:1px solid #DDE2E8;border-radius:12px;padding:12px 14px">%s</div>' % inner
chip = lambda t, c: '<span class="b %s">%s</span>' % (c, t)
visit = lambda t, n, a, tests, s, c: card('<div style="display:flex;justify-content:space-between"><strong>%s · %s</strong>%s</div><div class="cap">%s · %s</div>' % (t, n, chip(s, c), a, tests))
p1 = phone('Kiran More · Thu 9 Oct', 'Today’s route', '\n'.join([
 card(row('Visits', '9') + row('Done', '3') + row('Cool box', '6 °C', ';color:#1A6B44')),
 visit('08:00', 'Shobha Kale', 'Kothrud', 'Fasting sugar, lipid', 'Done', 'bg'), visit('09:00', 'Vinod Rao', 'Kothrud', 'CBC, KFT', 'Done', 'bg'), visit('09:45', 'Anita Joshi', 'Kothrud', 'HbA1c', 'Done', 'bg'),
 visit('10:30', 'Rahul Shah', 'Baner · 4 km', 'Thyroid profile · fasting', 'Next', 'bb'), visit('11:15', 'Meera Pai', 'Baner', 'Vitamin D, B12', 'Planned', 'bn'),
 '<a class="btn" href="#start" style="width:100%">Start visit: Rahul Shah</a>']))
p2 = phone('10:34 · at the address', 'Rahul Shah', '\n'.join([
 card(row('Check ID', 'Aadhaar seen') + row('Fasting since', '22:00 (12 h)') + row('Tests', 'Thyroid profile') + row('Containers', '1 gold top')),
 card('<div style="font-weight:600;margin-bottom:6px">Labels</div><div style="font-size:14px">Scan the label after sticking it on the tube.</div><div class="mono" style="font-size:18px;margin-top:8px;letter-spacing:2px">HC-26-000412</div>'),
 card('<label style="display:flex;gap:8px;align-items:center;font-size:14px;min-height:40px"><input type="checkbox" checked="checked"> Collected at 10:36</label><label style="display:flex;gap:8px;align-items:center;font-size:14px;min-height:40px"><input type="checkbox" checked="checked"> Label scanned</label>'),
 '<a class="btn" href="#pay" style="width:100%">Next: payment</a>']))
p3 = phone('Payment', 'Collect ₹550', '\n'.join([
 card(row('Thyroid profile', '₹450') + row('Home visit', '₹100') + row('Total', '₹550')),
 card('<div style="font-weight:600;margin-bottom:8px">Pay by</div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px"><span class="btn" style="min-height:44px">UPI QR</span><span class="btn2" style="min-height:44px">Cash</span></div><div class="cap" style="margin-top:8px">Receipt goes to the patient on WhatsApp at once.</div>'),
 card(row('Cool box now', '6 °C', ';color:#1A6B44') + row('Samples in bag', '8 tubes')),
 '<div class="cap">If the patient was not fasting or refused, mark the visit and the call centre rebooks it.</div>']))
p4 = phone('12:40 · Main lab', 'Hand over', '\n'.join([
 card(row('Bag', 'HC-BAG-0909') + row('Tubes', '12') + row('Cash collected', '₹1,650') + row('UPI collected', '₹3,200')),
 card(row('Collected first', '08:00') + row('Time to lab', '4 h 40 min', ';color:#A3201A') + '<div class="cap" style="margin-top:6px">Over the 4 h target for the 08:00 sample. Reception will check stability before accepting.</div>'),
 card('<div style="font-weight:600">Received by</div><div style="font-size:14px;margin-top:4px">Priya Sawant, lab reception · 12:41</div>'),
 '<a class="btn" href="#done" style="width:100%">Confirm hand-over</a>']))
body = ('<div style="width:1832px;height:1040px;box-sizing:border-box;padding:40px 64px;background:#E9EDF2;display:flex;flex-direction:column;gap:24px">\n'
 '<div><div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9A4413">Laboratory · Home collection panel</div><h1 style="margin:4px 0 0;font-size:28px">Home collection on the phlebotomist’s phone in four screens</h1></div>\n'
 '<div style="display:flex;gap:48px">\n' + '\n'.join([p1, p2, p3, p4]) + '\n</div>\n</div>\n')
open(os.path.join(B, 'PhleboPhone.dc.html'), 'w').write(head + '\n' + body + tail)
print('built PhleboPhone')
