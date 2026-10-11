    var S = [
      ['Business rules', 'Enforced by the API; the UI only explains them. Values in brackets are defaults on the Billing Settings screen.', ['No.', 'Rule', 'Detail'], [
        ['R1', 'Price by payer', 'Every line is priced from the payer’s price list (general, staff, senior citizen, member, corporate, insurer, scheme); missing items fall back to the general list.'],
        ['R2', 'Pay before service in OPD', 'OPD consultations and tests are paid before service, except credit, corporate, scheme and emergency patients.'],
        ['R3', 'Every charge has a source', 'Charges come from orders, the midnight census, charts or the pharmacy. Manual lines need a reason and are reported daily.'],
        ['R4', 'Nothing is deleted', 'A wrong bill is cancelled with a credit note and a reason after approval. Numbers are never reused; the series has no gaps.'],
        ['R5', 'Discounts', 'Cashiers cannot give discounts. Billing Manager approves up to [10% or ₹10,000]; Super Admin above that. Concession policies apply automatically.'],
        ['R6', 'Refunds', 'Go back to the original payment mode. Billing Manager approves up to [₹25,000]; Finance Controller above that.'],
        ['R7', 'Cash limit', 'No cash receipt of ₹2,00,000 or more from one person in a day, for one transaction or one event (Income-tax Act, section 269ST). The counter blocks it and suggests UPI, card or transfer.'],
        ['R8', 'GST on health care', 'Health care services by a clinical establishment are exempt. Non-ICU rooms above [₹5,000] a day carry 5% GST without input credit. OPD pharmacy sales and other taxable items carry GST by HSN or SAC. Rates are settings; confirm with the hospital’s CA.'],
        ['R9', 'e-Invoice', 'Taxable B2B invoices (for example to corporates) get an IRN and QR when the hospital is above the e-invoicing turnover threshold [₹5 crore].'],
        ['R10', 'Open shift', 'A cashier cannot bill without an open shift. Shift opens with opening cash and one counter per cashier.'],
        ['R11', 'Close shift', 'Cash is counted note by note; card and UPI totals are matched with the devices. A variance above [₹100] needs a reason and Billing Manager verification.'],
        ['R12', 'Day lock', 'The day locks after all shifts are verified [by 23:00]. Changes after lock need Finance Controller to reopen.'],
        ['R13', 'Deposits', 'Deposits are adjusted on the final bill; any excess is refunded the same day to the original mode.'],
        ['R14', 'Dues', 'Leaving with dues needs approval (Medical Superintendent for in-patients). Dues follow the patient and show at the next visit.'],
        ['R15', 'Corporate credit', 'Within the credit limit and period only. Over-limit visits need Billing Manager approval. Invoices go out by the [5th] of the month.'],
        ['R16', 'Insurance share', 'The approved amount is the insurer share; non-payable items and co-pay are the patient share; deductions are booked with a reason.'],
        ['R17', 'Payment pending', 'If UPI or card confirms late, the bill shows Payment pending. The gateway webhook or next-day settlement confirms it; a second charge is blocked.'],
        ['R18', 'Duplicate prints', 'Reprints carry a DUPLICATE watermark and are logged with user and reason.'],
        ['R19', 'Write-off', 'Write-offs need Finance Controller and Super Admin approval and post to a separate ledger.'],
        ['R20', 'Ledger posting', 'Every bill, receipt, refund and credit note posts to the ledger automatically by department, payer and tax head.']]],
      ['Settings (Billing Settings screen)', 'Per branch unless noted', ['Setting', 'Level', 'Default'], [
        ['Bill series and numbering', 'Branch', 'OP/, IP/, PH/, MS/ per financial year'], ['Payment modes and devices', 'Counter', 'UPI, card, cash, cheque, bank transfer, wallet'], ['Price lists and payer mapping', 'Branch', 'General, staff, senior, member, corporate, insurer, scheme'],
        ['Discount and concession rules', 'Branch', '10% or ₹10,000 for Billing Manager'], ['GST rates, HSN and SAC', 'Tenant', 'Health care exempt; non-ICU room above ₹5,000 at 5%'], ['e-Invoice', 'Tenant', 'On for taxable B2B'],
        ['Refund and deposit rules', 'Branch', 'Original mode; same-day excess refund'], ['Cash rules', 'Branch', '₹2,00,000 limit; ₹100 variance'], ['Receipt and bill templates', 'Branch', 'A4 bill, 80 mm receipt, English and Hindi'], ['Day lock time', 'Branch', '23:00']]],
      ['Notifications', 'SMS uses DLT-approved templates; WhatsApp needs patient consent', ['Event', 'To', 'Channel', 'Message'], [
        ['Payment received', 'Patient', 'WhatsApp, SMS', 'Receipt link'], ['Bill changed after payment', 'Patient', 'WhatsApp, SMS', 'Credit note and reason'], ['Discount request', 'Billing Manager', 'In-app', 'Patient, amount, reason'],
        ['Refund paid', 'Patient', 'SMS', 'Amount and mode'], ['Payment pending over 15 min', 'Cashier', 'In-app', 'Bill and reference'], ['Shift variance', 'Billing Manager', 'In-app', 'Cashier, amount, reason'],
        ['Day not locked by 23:00', 'Billing Manager, Accounts', 'In-app, e-mail', 'Shifts not verified'], ['Corporate limit 90% used', 'Corporate desk', 'In-app, e-mail', 'Company, balance'], ['Dues reminder', 'Patient', 'SMS, WhatsApp', 'Amount and pay link'],
        ['Daily revenue summary', 'Management', 'E-mail', '21:00 each day']]],
      ['Reports', 'All export to Excel and PDF; schedulable', ['Report', 'For', 'Key columns'], [
        ['Daily collection by cashier and mode', 'Billing Manager', 'Shift, UPI, card, cash, cheque, variance'], ['Revenue by service group and department', 'Management', 'Gross, discount, net'], ['Revenue by payer', 'Management, Accounts', 'Cash, corporate, insurer, scheme'],
        ['Doctor-wise revenue', 'Management', 'OPD, IPD, procedures'], ['Discounts and concessions', 'Billing Manager, Auditor', 'Approver, reason, amount'], ['Cancellations and refunds', 'Auditor', 'Bill, reason, approver'],
        ['Unbilled and manual charges', 'Billing Manager', 'Source, user, reason'], ['Receivables ageing', 'Accounts', '0-30, 31-60, 61-90, over 90 days'], ['Deposits held', 'Accounts', 'Patient, deposit, used, balance'],
        ['GST summary', 'Accounts', 'Taxable value, GST by rate, exempt value'], ['Reprinted bills', 'Auditor', 'User, reason, count'], ['Package variance', 'Admin', 'Package, price, actual cost']]],
      ['Measures and formulas', 'Used on the Billing analytics screen', ['Measure', 'Formula', 'Notes'], [
        ['Collection efficiency', 'Amount collected × 100 ÷ amount billed (same period)', 'Excludes insurer and corporate credit until due'], ['Days to collect (DSO)', 'Receivables ÷ average daily billing', 'By payer type'], ['Discount rate', 'Discounts × 100 ÷ gross billing', 'Target under 2%'],
        ['Refund and cancellation rate', 'Refunds and credit notes × 100 ÷ gross billing', 'By reason'], ['Manual charge share', 'Manual lines × 100 ÷ all lines', 'Leakage and fraud signal'], ['Unbilled at discharge', 'Charges posted after final bill', 'Should be zero'],
        ['Digital payment share', 'UPI, card and transfer × 100 ÷ all receipts', 'Rising is better'], ['Cash variance', 'Counted cash − expected cash', 'Per shift'], ['Claim deduction rate', 'Deductions × 100 ÷ claimed amount', 'By insurer']]],
      ['Edge cases', 'How the system behaves', ['Case', 'Behaviour'], [
        ['UPI paid but app timed out', 'Bill shows Payment pending; webhook confirms; no second charge allowed'], ['Patient pays for two family members', 'One receipt, split across both bills'], ['Price changes mid-stay', 'Charges keep the price on the date of service'],
        ['Corporate letter expires mid-stay', 'Later charges move to patient share unless renewed; desk alerted'], ['Insurer approves less than billed', 'Difference to patient share; deposit asked'], ['Cheque bounces after discharge', 'Receipt reversed, dues reopened, patient informed'],
        ['Refund to a closed card', 'Bank transfer with patient consent and ID'], ['Network down at counter', 'Offline receipts from a reserved series; synced and checked when back'], ['Two cashiers on one counter', 'Blocked; each cashier has own shift and drawer'],
        ['Cash of ₹2 lakh or more offered', 'Blocked at the counter; other modes suggested; attempt logged'], ['Bill needed in patient’s company name', 'Corporate details and GSTIN on the invoice; e-invoice if taxable']]],
      ['Acceptance tests (sample)', 'Run on staging with pilot hospital masters', ['Test', 'Steps', 'Pass when'], [
        ['Payer pricing', 'Bill the same test for cash and corporate patients', 'Prices match each price list'], ['Discount approval', 'Cashier asks 15%', 'Billing Manager then Super Admin approve; bill updates'], ['Cancel after payment', 'Cancel a paid bill', 'Credit note issued; number kept; refund approval created'],
        ['Cash limit', 'Try ₹2,10,000 cash for one patient in a day', 'Blocked with message'], ['Room GST', 'Admit to a ₹6,500 private room', '5% GST on room rent only'], ['Shift close', 'Close with ₹300 short', 'Reason required; Billing Manager must verify'],
        ['Payment pending', 'Simulate UPI timeout', 'Bill pending; webhook confirms; no double charge'], ['Day lock', 'Edit a bill after lock', 'Blocked; reopen request to Finance Controller'], ['Ledger posting', 'Run a day of 100 bills', 'Revenue, receivables and GST ledgers match the bills']]]
    ];
