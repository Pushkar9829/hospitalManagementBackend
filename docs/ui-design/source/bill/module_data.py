TITLE = "Billing module overview"
KICKER = "Module deep dive · 3 of 16"
H1 = "Billing, Payments and Insurance"
LEAD = "From the first charge to the ledger: payer-based pricing, OPD and IPD bills, deposits, every payment mode, discounts and refunds with approval, insurance and corporate shares, cashier shifts, day-end close, GST and revenue analytics. Built for Indian hospitals, where cash, UPI, insurers, TPAs, corporates and government schemes all meet at one counter."
ALTS = 14
ROLES = 9
LINKS = [("BillFlow", "1 · End-to-end flow"), ("BillAltFlows", "2 · Alternate flows"), ("BillStates", "3 · Status lifecycles"), ("BillRules", "4 · Rules, messages, reports"), ("BillConfig", "5 · Billing settings screen"), ("BillAnalytics", "6 · Billing analytics")]
ROLE_LINKS = [("BillRolePatient", "Patient and payer"), ("BillRoleCashier", "Cashier"), ("BillRoleManager", "Billing manager"), ("BillRoleCorporate", "Corporate desk"), ("BillRoleInsurance", "Insurance desk"), ("BillRolePharmacy", "Pharmacy counter"), ("BillRoleAccounts", "Accounts"), ("BillRoleAuditor", "Auditor"), ("BillRoleManagement", "Management")]
COMPETITORS = ["Indian HMS vendors (MocDoc and others)", "KareXpert Smart Hospital", "Epic Resolute Hospital Billing (enterprise)", "Bahmni (open source, with Odoo)"]
SOURCES = 'Sources: MocDoc HMS listings and reviews on G2, Capterra, AlternativeTo and SaaSHub; KareXpert listings on G2 and Capterra; Epic Resolute Hospital Billing training pages from University of Iowa Epic support (charge capture, HB follow-up); Bahmni wiki (earlier OPD research) and Odoo invoicing documentation. GST and cash rules are from the GST exemption notification for health care services, the 2022 GST Council decision on room rent, Income-tax Act section 269ST and the e-invoicing notifications; confirm with the hospital\'s chartered accountant. Reviewed October 2026.'
DIFF = [("One price engine.", "The payer decides the price list, packages decide what is included, and tax rules decide GST. Cashiers never type a price."),
        ("Nothing is deleted.", "Cancellations, refunds and write-offs are reversals with a reason and an approval, so the audit trail always adds up."),
        ("Every counter closes clean.", "Shifts open with cash, close with a note-by-note count and device totals, and the billing manager locks the day."),
        ("India-ready money rules.", "UPI devices, cheque and bank transfer, GST by HSN and SAC, 5% GST on non-ICU rooms above ₹5,000 a day, e-invoices for corporates, and the ₹2 lakh cash limit."),
        ("One bill, many payers.", "Patient, corporate, insurer and scheme shares sit on the same bill and flow to the right receivable."),
        ("Leakage shows up.", "Unbilled charges, manual lines, package variance, discounts and reprints are measured every day.")]
HEIGHT = 2720
GROUPS = 7
BENCH = 16
DATA_JS = r"""    var G = [
      ['Charge capture', [['Charges from orders, census and charts', 'a'], ['Payer-based price lists', 's'], ['Packages with included and extra items', 's'], ['Manual charges only with reason', 'a'], ['Unbilled charge alerts before discharge', 'o'], ['Miscellaneous bills (certificates, copies, meals)', 's']]],
      ['Bills and payments', [['OPD, IPD, pharmacy and walk-in bills', 's'], ['UPI, card, cash, cheque, bank transfer, wallet', 's'], ['Split payment across modes', 'a'], ['UPI and card devices matched to the bill', 'o'], ['Payment pending state for timeouts', 'o'], ['E-receipts on WhatsApp and SMS', 'a']]],
      ['Deposits, discounts and refunds', [['Deposits and top-ups', 's'], ['Discounts with two-level approval', 'a'], ['Concession policies (staff, free care)', 'a'], ['Cancellation by credit note, never delete', 'a'], ['Refund to original mode', 'a'], ['Dues with approval, shown at next visit', 'a']]],
      ['Payers', [['Insurer, TPA and scheme shares on one bill', 'a'], ['Corporate credit limits and periods', 's'], ['Monthly corporate invoices', 's'], ['e-Invoice (IRN) for taxable B2B lines', 'o'], ['Memberships and wallet', 'a'], ['Receivables ageing by payer', 's']]],
      ['Counter control', [['Shift open with opening cash', 'a'], ['Note-by-note cash count', 'a'], ['Shift handover between cashiers', 'a'], ['Day-end verification and lock', 'o'], ['Duplicate prints watermarked and logged', 'a'], ['Cash limit of ₹2 lakh enforced', 'o']]],
      ['Tax and accounts', [['GST by HSN and SAC on taxable items', 's'], ['Room-rent GST rule for non-ICU rooms', 'o'], ['Auto-posting to ledger', 'a'], ['Bank and settlement reconciliation', 'a'], ['GST return data', 's'], ['Tally export', 's']]],
      ['Analytics and audit', [['Revenue by service, payer, doctor', 's'], ['Collection efficiency and days to collect', 'a'], ['Discount, refund and cancellation trends', 'a'], ['Revenue leakage measures', 'o'], ['Auditor exception list', 'o']]]
    ];
    var Y = ['Yes', 'bg'], N = ['Not found', 'bn'], P = ['Partly', 'ba'], O = ['Yes', 'bo'], X = ['Other Epic modules', 'bn'];
    var B = [
      ['OPD and IPD billing', Y, Y, Y, ['Via Odoo', 'ba'], O], ['Pharmacy billing', Y, N, X, ['Via Odoo', 'ba'], O], ['Insurance management', Y, N, Y, N, O], ['Charge capture from clinical documentation', N, N, Y, N, O],
      ['Claim follow-up work queues', N, N, Y, N, O], ['Denial workflow and appeals', N, N, Y, N, O], ['Revenue reports', Y, N, Y, ['Via Odoo', 'ba'], O], ['Discounts on invoices', N, N, N, ['Via Odoo', 'ba'], O],
      ['Discount approval (maker-checker)', N, N, N, N, O], ['Cashier shift and day-end close', N, N, N, N, O], ['UPI device matching', N, N, N, N, O], ['GST and e-invoice for hospitals', ['Vendor claims GST', 'ba'], N, N, N, O],
      ['Corporate credit limits', N, N, N, N, O], ['Patient payment portal', ['Some vendors', 'ba'], N, N, N, O], ['Cash limit (section 269ST)', N, N, N, N, O], ['Revenue leakage measures', N, N, N, N, O]];
"""
