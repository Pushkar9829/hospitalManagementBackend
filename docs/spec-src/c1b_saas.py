from kit import *
from reportlab.platypus import PageBreak


def story():
    s = []
    s += H1("SaaS Platform: Tenants, Subscriptions and Operations")
    s.append(P("The Hospital Management System is a <b>multi-tenant SaaS</b> product. You, the platform "
               "owner, run one cloud deployment. Every hospital that signs up becomes a "
               "<b>tenant</b> on it. Hospitals never install anything. They open a browser, "
               "pay a subscription, and get updates automatically. This section covers "
               "everything on the platform-owner side: how hospitals sign up, how they are "
               "provisioned, how they are billed, and how the platform is operated."))

    s += H2("Who uses what")
    s += table([
        ["Party", "Application", "URL", "Hosting"],
        ["Prospects", "Marketing site, pricing, signup", "www.example.com",
         "S3 + CloudFront"],
        ["Platform owner staff", "Platform Console", "console.example.com",
         "S3 + CloudFront, IP-restricted"],
        ["Hospital staff", "Hospital app (all modules)", "{hospital}.example.com or "
                                                         "custom domain", "S3 + CloudFront"],
        ["Patients", "Booking page, report and receipt links", "{hospital}.example.com/book",
         "S3 + CloudFront"],
        ["Integrations", "Public REST API with API keys", "api.example.com/v1",
         "ECS behind ALB"],
    ], widths=[0.18, 0.3, 0.3, 0.22], first_col_bold=True)
    s += callout("All hospitals run the same version of the same code. A hospital's "
                 "subscription only changes which modules, limits and features are switched "
                 "on for it. There are no per-hospital code branches.", "note",
                 "One codebase.")

    s += H2("Platform roles")
    s += table([
        ["Role", "Can do", "Cannot do"],
        ["Platform Super Admin", "Everything on the console, manage platform staff, "
                                 "plans and prices", "Read patient data without a "
                                                     "consented support session"],
        ["Sales", "Create leads and trial tenants, send quotes, apply approved discounts",
         "Change prices, see platform finance"],
        ["Implementation Consultant", "Run setup wizard and data imports for assigned "
                                      "tenants during onboarding", "Access tenants after "
                                                                   "go-live without consent"],
        ["Support (L1 / L2)", "View tenant health, usage, errors; open consented support "
                              "sessions", "Change subscriptions or billing"],
        ["Platform Finance", "Invoices, payments, credit notes, refunds, revenue reports",
         "Change modules or tenant settings"],
        ["Platform Ops / DevOps", "Feature flags, releases, maintenance windows, tenant "
                                  "migrations", "Change billing"],
    ], widths=[0.24, 0.46, 0.3], first_col_bold=True)

    s.append(CondPageBreak(240))
    s += H2("Self-service signup and trial")
    s += flow([
        ("Prospect", "Visits pricing page, picks a plan or modules"),
        ("Prospect", "Enters name, e-mail, mobile; verifies OTP"),
        ("Prospect", "Enters hospital name, city, beds; picks sub-domain"),
        ("System", "Checks sub-domain is free and not reserved"),
        ("Provisioning job", "Creates tenant in under 60 s (see next section)"),
        ("System", "E-mails login link; starts 14-day trial"),
        ("Hospital Super Admin", "Logs in; setup wizard opens"),
        ("Setup wizard", "Branches, departments, wards, beds, users, imports"),
        ("Hospital", "Optional: load demo data to explore"),
        ("Sales / CS", "Gets lead alert; books an onboarding call"),
        ("Hospital", "Adds payment method; trial converts to paid"),
        ("System", "Demo data wiped on request; hospital goes live"),
    ], box_h=46)
    s += bullets([
        "<b>Sales-assisted path.</b> Enterprise and multi-branch groups are created by Sales "
        "from the console with a custom quote, longer trial and an assigned consultant.",
        "<b>Abuse protection.</b> OTP on mobile and e-mail, CAPTCHA, one trial per "
        "mobile number and domain, and manual review for unusual signups.",
        "<b>Reserved sub-domains.</b> www, api, console, admin, app, status, mail, and "
        "names of existing tenants cannot be taken.",
    ])

    s += H2("Tenant provisioning")
    s.append(P("Provisioning is a background job. Every step is idempotent, so a failed "
               "job can be retried safely without creating duplicates."))
    s += table([
        ["Step", "What it creates"],
        ["1. Tenant record", "Tenant in platform database with status PROVISIONING, plan, "
                             "modules, limits, sub-domain"],
        ["2. Data location", "Shared cluster by default; dedicated database for Enterprise"],
        ["3. System roles", f"All standard roles and permissions from Section {sec('roles')}"],
        ["4. Default masters", "Departments template, bed categories, tax codes, payment "
                               "modes, ICD-10, units, leave types, shift templates"],
        ["5. Finance seed", "Hospital chart of accounts and number series for the current "
                            "financial year"],
        ["6. Templates", "Print layouts, SMS, e-mail and WhatsApp templates"],
        ["7. First user", "Hospital Super Admin with forced password set and 2FA"],
        ["8. Storage", "S3 prefix tenants/{tenantId}/ and storage quota counter"],
        ["9. Subscription", "Trial subscription, trial end date, metering baseline"],
        ["10. Activate", "Status TRIAL, tenant cache warmed, welcome e-mail sent"],
    ], widths=[0.22, 0.78], first_col_bold=True)

    s += H2("Subscription billing engine")
    s.append(P("The platform bills hospitals itself. No separate billing tool is needed. "
               "Plans, modules and prices are data in the platform database, so Sales can "
               "launch a new plan or price without a code release."))
    s += table([
        ["Concept", "Description"],
        ["Catalogue", "Modules, plans (bundles of modules and limits) and add-ons (extra "
                      "users, beds, storage, SMS packs). Prices are versioned; existing "
                      "customers keep their price until renewal"],
        ["Subscription", "One per tenant: plan, add-on modules, quantities, billing cycle "
                         "(monthly or annual), currency, renewal date, payment method"],
        ["Fixed charges", "Plan and module prices, billed in advance each cycle"],
        ["Metered charges", "Extra users, beds, employees, payslips, storage, SMS and "
                            "WhatsApp messages, billed in arrears from daily usage snapshots"],
        ["Prepaid credits", "SMS and WhatsApp credit packs bought in advance; low-balance "
                            "alert at 10%; sending pauses at zero except OTPs"],
        ["Proration", "Upgrades and module additions charge the unused part of the cycle "
                      "immediately. Removals take effect at renewal; no refunds for the "
                      "current cycle"],
        ["Coupons and discounts", "Percentage or fixed, for N cycles; Sales discounts above "
                                  "a limit need Platform Super Admin approval"],
        ["Invoices", "GST invoice with 18% GST and the platform's GSTIN, hospital GSTIN for "
                     "input credit, PDF on S3, e-mailed; e-invoice IRN where applicable"],
        ["Payments", "Razorpay Subscriptions with e-mandate (UPI AutoPay, card, NACH) in "
                     "India; Stripe Billing abroad; bank transfer recorded manually"],
        ["Dunning", "Retry failed charges on day 1, 3 and 6 with e-mail, SMS and in-app "
                    f"banner; then status moves per the lifecycle in Section {sec('product')}"],
        ["Credit notes", "For billing errors and goodwill credits, adjusted on the next "
                         "invoice"],
    ], widths=[0.2, 0.8], first_col_bold=True)
    s += H3("Proration example")
    s += code("""
Hospital on monthly billing, cycle 1 Oct - 30 Oct (30 days). On 11 Oct it adds Laboratory
(INR 2,500 / month). Days remaining including today = 20.

  Prorated charge = 2,500 x 20 / 30            = INR 1,666.67
  GST 18%                                      = INR   300.00
  Invoice now                                  = INR 1,966.67

From the 31 Oct renewal invoice, Laboratory is billed in full at INR 2,500 + GST.
""")

    s += H2("Adding or removing a module (hospital side)")
    s += flow([
        ("Hospital Super Admin", "Opens Settings > Subscription, picks a module"),
        ("System", "Checks dependencies; shows prorated price"),
        ("Hospital Super Admin", "Confirms; mandate charged or invoice raised"),
        ("Billing engine", "Payment success webhook received"),
        ("System", "Module ACTIVE; tenant cache refreshed"),
        ("All users", "Menus update live via socket, no re-login"),
        ("System", "Module masters seeded (e.g. lab test catalogue)"),
        ("Audit", "Change logged on tenant and platform side"),
    ])
    s += bullets([
        "Removing a module is scheduled for the renewal date. Until then it stays usable. "
        "Afterwards it is hidden and its data is kept for re-activation.",
        "Downgrading below current usage is blocked with a list of what to reduce, e.g. "
        "'deactivate 12 users to move to 100 users'.",
    ])

    s += H2("Limits and metering")
    s += table([
        ["Metric", "How it is counted", "When the limit is hit"],
        ["Named users", "Active user accounts, daily snapshot", "Cannot create new users; "
                                                                "add-on offered"],
        ["Licensed beds", "Active beds in bed master", "Cannot activate more beds"],
        ["Branches", "Active branches", "Cannot add a branch"],
        ["Employees (HRM)", "Active employees in the month", "Billed as metered overage"],
        ["Payslips (PAY)", "Payslips generated in the month", "Billed as metered overage"],
        ["Storage", "Bytes in tenant S3 prefix, nightly", "Uploads blocked at 110%; "
                                                          "generated documents still saved"],
        ["SMS / WhatsApp", "Messages sent, real time", "Non-critical messages pause at zero "
                                                       "credit"],
        ["API calls", "Per API key per minute", "HTTP 429 with retry time"],
    ], widths=[0.18, 0.37, 0.45], first_col_bold=True)
    s += callout("A limit never blocks patient care. Admissions, orders, results and "
                 "medication charting always work even when a user or storage limit is "
                 "exceeded; only administrative growth is blocked.", "warn",
                 "Clinical safety rule.")

    s += H2("Tenant isolation and fair use")
    s += bullets([
        "<b>Data.</b> Every query is scoped by tenant through the Mongoose plugin "
        f"(Section {sec('code')}). Automated tests try to read other tenants' data on every endpoint.",
        "<b>Noisy neighbours.</b> Per-tenant API rate limits, per-tenant job queues so one "
        "hospital's payroll run cannot delay another's SMS, and 30-second query timeouts.",
        "<b>Large tenants.</b> A tenant can be moved to a dedicated database or cluster "
        "with a scripted, near-zero-downtime migration. Code does not change.",
        "<b>Per-tenant backup and restore.</b> A single tenant can be restored to a point in "
        "time into a side database, without affecting others.",
    ])

    s += H2("Custom domains and white-label")
    s += table([
        ["Feature", "Clinic", "Hospital", "Enterprise"],
        ["Sub-domain (name.example.com)", tick(), tick(), tick()],
        ["Logo, colours, print letterhead", tick(), tick(), tick()],
        ["Custom domain (his.cityhospital.com)", tick(False), tick(), tick()],
        ["Own e-mail sender domain and SMS sender ID", tick(False), tick(), tick()],
        ["Remove platform 'Powered by' branding", tick(False), tick(False), tick()],
        ["Own mobile-friendly booking page domain", tick(False), tick(), tick()],
    ], widths=[0.46, 0.18, 0.18, 0.18], first_col_bold=True)
    s.append(P("Custom domains: the hospital adds a CNAME record pointing to the platform. "
               "The platform requests an ACM certificate, validates it by DNS, and attaches "
               "the domain to CloudFront. With many custom domains, CloudFront SaaS Manager "
               "(multi-tenant distributions) is used so each tenant domain gets its own "
               "certificate without hitting per-distribution limits."))

    s += H2("Platform Console")
    s += table([
        ["Area", "Screens and functions"],
        ["Dashboard", "MRR, ARR, active tenants, trials, churn, failed payments, system "
                      "health"],
        ["Tenants", "List and search; tenant profile with plan, modules, usage, invoices, "
                    "health score, activity, notes; suspend or reactivate"],
        ["Leads and trials", "Signups, trial progress (setup steps done), conversion "
                             "follow-ups"],
        ["Catalogue", "Modules, plans, add-ons, price versions, coupons"],
        ["Subscriptions", "Change plan, add or remove modules, extend trial, apply credit"],
        ["Billing", "Invoices, payments, refunds, credit notes, dunning queue, GST reports "
                    "for the platform company"],
        ["Usage", "Per-tenant usage trends and limit warnings"],
        ["Support", "Consented support sessions, tenant error logs, job failures, "
                    "announcements to tenants"],
        ["Releases", "Feature flags per tenant or plan, rollout stages, maintenance "
                     "windows, in-app changelog"],
        ["Platform users", "Platform staff, roles, 2FA, access log"],
    ], widths=[0.2, 0.8], first_col_bold=True)

    s += H2("SaaS business metrics")
    s += table([
        ["Metric", "Definition", "Why it matters"],
        ["MRR / ARR", "Recurring revenue per month / year, excluding one-time fees",
         "Core growth measure"],
        ["Trial conversion", "Trials that become paid within 30 days", "Onboarding quality"],
        ["Logo churn", "Tenants cancelled in the month / tenants at start", "Retention"],
        ["Net revenue retention", "Revenue this year from last year's tenants / their revenue "
                                  "last year", "Upsell of modules"],
        ["Module attach rate", "Share of tenants using each add-on module", "Product and "
                                                                           "pricing decisions"],
        ["ARPA", "Average revenue per tenant account", "Pricing health"],
        ["Tenant health score", "Logins, daily bills, admissions, open tickets, failed "
                                "payments combined", "Early churn warning"],
    ], widths=[0.22, 0.48, 0.3], first_col_bold=True)

    s += H2("Releases, support and service levels")
    s += bullets([
        "<b>Release stages.</b> Internal tenant, then pilot hospitals, then 10% of tenants, "
        "then everyone, controlled by feature flags. Hospitals see an in-app changelog.",
        "<b>Support access.</b> Platform staff can enter a tenant only through a support "
        "session that the Hospital Super Admin approves, limited to 2 hours and fully "
        "audited on both sides.",
        "<b>Customer communication.</b> Status page, scheduled-maintenance banner 72 hours "
        "ahead, incident e-mails to Super Admins.",
    ])
    s += table([
        ["Service level", "Clinic", "Hospital", "Enterprise"],
        ["Uptime commitment", "99.5%", "99.9%", "99.9% with service credits"],
        ["Support hours", "Business hours", "12 x 6", "24 x 7"],
        ["Severity 1 response", "4 hours", "1 hour", "30 minutes"],
        ["Onboarding", "Self-service + videos", "Remote consultant", "On-site consultant"],
        ["Data export", "Self-service", "Self-service", "Self-service + scheduled to own S3"],
    ], widths=[0.28, 0.24, 0.24, 0.24], first_col_bold=True)

    s += H2("Data ownership and offboarding")
    s += bullets([
        "The hospital owns its data. The platform is a data processor under a Data "
        "Processing Agreement signed at subscription.",
        "Self-service export at any time: full JSON per collection, CSV for masters and "
        "transactions, and all documents as a ZIP from S3.",
        "On cancellation, data is kept for 90 days, then deleted from the live database, "
        "search indexes and S3. Backups age out within 35 days. A deletion certificate is "
        "issued.",
        "Legal documents on signup: Terms of Service, Privacy Policy, Data Processing "
        "Agreement and SLA, accepted with timestamp and IP.",
    ])

    s += H2("Platform data model")
    s.append(P("Platform data lives in a separate <font name='Mono' size='8.5'>platform"
               "</font> database. Hospital data lives in tenant-scoped collections. Hospital "
               "users can never query the platform database."))
    s += table([
        ["Collection", "Key fields"],
        ["tenants", "name, subdomain, customDomains[], status, dataLocation, branding, "
                    "createdBy, trialEndsAt"],
        ["catalogModules", "code, name, dependsOn[], seedJob, active"],
        ["plans, planPrices", "code, modules[], limits{}; price per currency, cycle, "
                              "validFrom, version"],
        ["subscriptions", "tenantId, plan, items[{module or addon, qty, priceVersion}], "
                          "cycle, status, currentPeriod{start, end}, gatewaySubscriptionId"],
        ["usageSnapshots", "tenantId, date, users, beds, employees, payslips, storageBytes, "
                           "sms, whatsapp"],
        ["platformInvoices, platformPayments", "number, tenantId, lines[], gst, total, status, "
                                              "gateway refs"],
        ["coupons, creditNotes", "discount rules; adjustments"],
        ["featureFlags", "key, rules (tenantIds, plans, percentage), default"],
        ["supportSessions", "tenantId, agentId, approvedBy, startsAt, endsAt, actions[]"],
        ["platformUsers", "name, e-mail, roles, mfa, lastLoginAt"],
    ], widths=[0.3, 0.7], mono_cols=(0,))

    s += H2("Platform APIs")
    s += table([
        ["Method", "Path", "Who", "Description"],
        ["GET", "/public/plans", "anyone", "Plans and prices for pricing page"],
        ["GET", "/public/subdomains/{name}", "anyone", "Availability check"],
        ["POST", "/public/signup", "anyone (OTP)", "Create trial tenant"],
        ["GET", "/api/v1/subscription", "Hospital Super Admin", "Plan, modules, usage"],
        ["POST", "/api/v1/subscription/preview", "Hospital Super Admin", "Price a change"],
        ["POST", "/api/v1/subscription/changes", "Hospital Super Admin", "Apply a change"],
        ["GET", "/api/v1/subscription/invoices", "Hospital Super Admin", "Platform invoices"],
        ["POST", "/api/v1/support-sessions/{id}/approve", "Hospital Super Admin",
         "Allow support access"],
        ["CRUD", "/platform/tenants", "Platform staff", "Manage tenants"],
        ["CRUD", "/platform/plans", "Platform Super Admin", "Catalogue and prices"],
        ["POST", "/platform/tenants/{id}/subscription", "Sales / Finance", "Change on "
                                                                          "behalf of tenant"],
        ["GET", "/platform/metrics?from=&amp;to=", "Platform Super Admin", "MRR, churn, "
                                                                           "conversion"],
        ["POST", "/webhooks/razorpay", "Razorpay (signed)", "Payment and mandate events"],
        ["POST", "/webhooks/stripe", "Stripe (signed)", "Payment events"],
    ], widths=[0.08, 0.38, 0.22, 0.32], mono_cols=(0, 1))
    s += code("""
POST https://www.example.com/public/signup
{ "contact": { "name": "Dr. Arjun Rao", "email": "arjun@cityhospital.in",
               "mobile": "9876543210", "otpToken": "otp_8f2..." },
  "hospital": { "name": "City Hospital", "city": "Nagpur", "beds": 60 },
  "subdomain": "cityhospital", "plan": "HOSPITAL", "acceptTermsVersion": "2026-08" }

202 Accepted
{ "tenantId": "6701ab...", "status": "PROVISIONING",
  "loginUrl": "https://cityhospital.example.com/welcome?token=...",
  "trialEndsAt": "2026-10-23T23:59:59+05:30" }

POST /api/v1/subscription/preview
{ "add": [ { "module": "LAB" } ], "remove": [ { "module": "RAD" } ] }

200 OK
{ "effective": { "add": "IMMEDIATE", "remove": "2026-10-31" },
  "chargeNow": { "subtotal": 166667, "gst": 30000, "total": 196667, "currency": "INR" },
  "nextInvoiceEstimate": { "total": 4366000 },
  "blockedBy": [] }
""", "Signup and module change preview (amounts in paise)")

    s += H2("Platform reference code")
    s += code("""
/** Applies a subscription change. Additions start now (prorated); removals at renewal. */
export async function changeSubscription(tenantId: string, change: SubscriptionChange) {
  const sub = await Subscription.findOne({ tenantId, status: { $ne: 'CANCELLED' } });
  if (!sub) throw new AppError(404, 'NO_SUBSCRIPTION', 'Subscription not found');

  const target = applyChange(sub.items, change);
  const missing = unmetDependencies(target);                 // e.g. PAY needs HRM
  if (missing.length) {
    throw new AppError(422, 'DEPENDENCY_MISSING', 'Required modules missing', { missing });
  }
  await assertUsageFits(tenantId, target);                    // blocks unsafe downgrades

  const now = new Date();
  const ratio = remainingRatio(now, sub.currentPeriod);       // e.g. 20 / 30
  const chargeLines = change.add.map((item) => ({
    item, amount: Math.round(priceOf(item, sub.priceBook) * ratio),
  }));

  return withPlatformTransaction(async (session) => {
    sub.items = mergeAdds(sub.items, change.add);
    sub.pendingRemovals.push(...change.remove.map((r) => ({ ...r, at: sub.currentPeriod.end })));
    await sub.save({ session });
    if (chargeLines.length) {
      await createProrationInvoice(tenantId, chargeLines, session);   // GST added inside
    }
    await syncTenantModules(tenantId, sub, session);         // tenants.modules[] updated
    outbox.add('tenant.modulesChanged', { tenantId });       // cache bust + socket refresh
    return sub;
  });
}
""", "apps/api/src/platform/billing/subscription.service.ts")
    s += code("""
import crypto from 'node:crypto';

/** Razorpay webhook: verify signature, store event once, then process asynchronously. */
export const razorpayWebhook: RequestHandler = async (req, res) => {
  const signature = req.header('x-razorpay-signature') ?? '';
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body as Buffer).digest('hex');                  // raw body middleware
  const ok = signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok) return res.status(400).end();

  const event = JSON.parse(String(req.body));
  const inserted = await WebhookEvent.updateOne(
    { provider: 'razorpay', eventId: req.header('x-razorpay-event-id') },
    { $setOnInsert: { type: event.event, payload: event, receivedAt: new Date() } },
    { upsert: true });
  if (inserted.upsertedCount) {
    await queues.billing.add(event.event, { eventId: req.header('x-razorpay-event-id') });
  }
  res.status(200).end();                                        // ack fast, process in worker
};

// Worker handlers (excerpt)
billingWorker.on('subscription.charged', markInvoicePaidAndActivate);
billingWorker.on('payment.failed', startDunning);               // day 1, 3, 6 retries
billingWorker.on('subscription.halted', moveTenantToPastDue);
""", "apps/api/src/platform/billing/razorpay.webhook.ts")
    s += code("""
/** Nightly 01:00 IST: one usage snapshot per tenant, used for metering and limits. */
export async function snapshotUsage(tenantId: string, day: Date) {
  return runAs({ tenantId }, async () => {
    const [users, beds, employees, payslips, storageBytes, msgs] = await Promise.all([
      User.countDocuments({ status: 'ACTIVE' }),
      Bed.countDocuments({ status: { $ne: 'INACTIVE' } }),
      Employee.countDocuments({ status: 'ACTIVE' }),
      Payslip.countDocuments({ month: monthOf(day) }),
      storage.bytesForTenant(tenantId),                       // S3 inventory report
      MessageLog.aggregate(countByChannel(day)),
    ]);
    await UsageSnapshot.updateOne({ tenantId, date: day },
      { $set: { users, beds, employees, payslips, storageBytes, ...msgs } }, { upsert: true });
  });
}
""", "apps/api/src/platform/metering/snapshot.job.ts")
    return s
