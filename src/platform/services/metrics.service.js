import { quote } from '@hms/shared';
import { book, refreshBook } from './pricebook.service.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { Subscription } from '../models/platform.models.js';

/** SaaS metrics for the console dashboard (spec 3.11), monthly-equivalent and before GST. */
export async function metrics(now = new Date()) {
  await refreshBook();
  const [byStatus, subs, closed30] = await Promise.all([
    Tenant.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Subscription.find({ converted: true }).lean(),
    Tenant.countDocuments({
      status: 'CLOSED',
      statusChangedAt: { $gte: new Date(now - 30 * 86_400_000) },
    }),
  ]);
  const paying = new Set(
    (
      await Tenant.find({ status: { $in: ['ACTIVE', 'PAST_DUE'] } })
        .select('_id')
        .lean()
    ).map((t) => String(t._id)),
  );
  let mrr = 0;
  for (const s of subs) {
    if (!paying.has(String(s.tenantId))) continue;
    mrr +=
      s.customMonthly ??
      quote({ plan: s.plan, addOns: s.addOns, cycle: 'MONTHLY', quantities: s.quantities }, book())
        .subtotal;
  }
  const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const activeAtStart = paying.size + closed30;
  return {
    mrr,
    arr: mrr * 12,
    tenants: counts,
    paying: paying.size,
    trials: counts.TRIAL ?? 0,
    churn30: activeAtStart ? Math.round((closed30 * 1000) / activeAtStart) / 10 : 0,
    arpa: paying.size ? Math.round(mrr / paying.size) : 0,
    priceVersion: book().version,
  };
}
