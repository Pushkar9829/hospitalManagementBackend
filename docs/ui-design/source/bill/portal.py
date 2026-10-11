"""Patient payment screens on the phone (four frames), built from the PortalBooking board's styles."""
import os, re
H = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(H, '..', '..', 'boards')
src = open(os.path.join(B, 'PortalBooking.dc.html')).read()
head = re.sub(r'<title>[^<]*</title>', '<title>Patient payments on the phone</title>', src[:src.index('</helmet>') + len('</helmet>')])
tail = src[src.index('</x-dc>'):]
PH = '<div style="width:390px;height:844px;background:#F4F6F8;border-radius:28px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 32px rgba(20,33,48,.18)">'
def phone(step, title, body):
    return PH + '\n<div style="background:#13263F;color:#fff;padding:20px"><div class="cap" style="color:#C9D4E3">%s</div><div style="font-size:20px;font-weight:700">%s</div></div>\n<div style="padding:16px;display:flex;flex-direction:column;gap:12px">\n%s\n</div></div>' % (step, title, body)
row = lambda a, b, c='': '<div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;padding:8px 0;border-bottom:1px solid #EEF1F4"><span>%s</span><span style="font-weight:600%s">%s</span></div>' % (a, c, b)
card = lambda inner: '<div style="background:#fff;border:1px solid #DDE2E8;border-radius:12px;padding:12px 14px">%s</div>' % inner
chip = lambda t, c: '<span class="b %s">%s</span>' % (c, t)
p1 = phone('Ravi Kumar and family', 'My bills', '\n'.join([
 card('<div class="cap">To pay now</div><div style="font-size:28px;font-weight:700">₹1,540</div><div class="cap">2 bills · oldest 12 Sep</div>'),
 card('<div style="display:flex;justify-content:space-between"><strong>Lab tests · Sunita Kumar</strong>' + chip('Due', 'br') + '</div><div class="cap">OP/26-27/000874 · 12 Sep</div>' + row('Amount', '₹980')),
 card('<div style="display:flex;justify-content:space-between"><strong>Pharmacy · Ravi Kumar</strong>' + chip('Due', 'br') + '</div><div class="cap">PH/26-27/004498 · today</div>' + row('Amount', '₹560')),
 card('<div style="display:flex;justify-content:space-between"><strong>In-patient stay · Ravi Kumar</strong>' + chip('Running', 'bb') + '</div><div class="cap">IP/26-27/000871 · W2-204-B</div>' + row('Bill so far', '₹14,860') + row('Deposit', '₹20,000') + row('Deposit left', '₹5,140', ';color:#1A6B44')),
 '<a class="btn" href="#pay" style="width:100%">Pay ₹1,540</a>']))
p2 = phone('Paying ₹1,540', 'Choose how to pay', '\n'.join([
 card('<div style="font-weight:600;margin-bottom:8px">UPI apps on this phone</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><span class="btn2" style="min-height:48px">GPay</span><span class="btn2" style="min-height:48px">PhonePe</span><span class="btn2" style="min-height:48px">Paytm</span></div>'),
 card(row('Card', 'Debit or credit') + row('Net banking', 'All major banks') + row('Wallet balance', '₹250') ),
 card('<label style="display:flex;gap:8px;align-items:center;font-size:14px;min-height:40px"><input type="checkbox" checked="checked"> Use wallet ₹250 first</label><div class="cap">Then pay ₹1,290 by UPI</div>'),
 '<div class="cap">If the payment app closes before it finishes, the bill shows "Payment pending" and you are never charged twice. You get the receipt as soon as the bank confirms.</div>']))
p3 = phone('Receipts and refunds', 'Receipts', '\n'.join([
 card('<div style="display:flex;justify-content:space-between"><strong>₹1,540 paid</strong>' + chip('Received', 'bg') + '</div><div class="cap">RC/26-27/004529 · UPI · today 11:42</div><div style="display:flex;gap:8px;margin-top:8px"><span class="btn2" style="min-height:40px">Download PDF</span><span class="btn2" style="min-height:40px">Share</span></div>'),
 card('<div style="display:flex;justify-content:space-between"><strong>₹20,000 deposit</strong>' + chip('Received', 'bg') + '</div><div class="cap">RC/26-27/004512 · card · 09 Oct</div>'),
 card('<div style="display:flex;justify-content:space-between"><strong>Refund ₹600</strong>' + chip('Paid', 'bb') + '</div><div class="cap">Cancelled test · back to UPI · 2 Oct · UTR 4471 9920 1188</div>'),
 card('<strong>Need help with a bill?</strong><div class="cap" style="margin-top:4px">Raise a question; the billing desk replies within one working day.</div>')]))
p4 = phone('Family Gold membership', 'Wallet and membership', '\n'.join([
 card('<div class="cap">Wallet balance</div><div style="font-size:28px;font-weight:700">₹250</div><div style="display:flex;gap:8px;margin-top:8px"><span class="btn" style="min-height:40px">Top up by UPI</span></div>'),
 card('<div style="font-weight:600;margin-bottom:6px">Your membership</div>' + row('Plan', 'Family Gold') + row('Members', '4') + row('Valid till', '31 Mar 2027') + row('Saved this year', '₹3,860', ';color:#1A6B44')),
 card('<div style="font-weight:600;margin-bottom:6px">Benefits</div><div style="font-size:14px;line-height:21px">5% off lab tests · free follow-up within 15 days · priority booking · 1 free health check a year</div>'),
 '<div class="cap">Wallet money can be refunded to your bank on request.</div>']))
body = ('<div style="width:1832px;height:1040px;box-sizing:border-box;padding:40px 64px;background:#E9EDF2;display:flex;flex-direction:column;gap:24px">\n'
 '<div><div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9A4413">Billing · Patient panel</div><h1 style="margin:4px 0 0;font-size:28px">Paying the hospital from the phone in four screens</h1></div>\n'
 '<div style="display:flex;gap:48px">\n' + '\n'.join([p1, p2, p3, p4]) + '\n</div>\n</div>\n')
open(os.path.join(B, 'PortalPay.dc.html'), 'w').write(head + '\n' + body + tail)
print('built PortalPay')
