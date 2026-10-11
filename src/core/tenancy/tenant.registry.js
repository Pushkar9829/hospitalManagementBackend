import { Tenant } from './tenant.model.js';
import { redis } from '../cache/redis.js';
import { env } from '../../config/env.js';

const TTL_SEC = 60;
const key = (host) => `tenant:host:${host}`;

/** Sub-domain of ROOT_DOMAIN, or null for a custom domain. */
export function subdomainOf(host, root = env.ROOT_DOMAIN) {
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, -(root.length + 1));
  return sub && !sub.includes('.') ? sub : null;
}

/** Host -> tenant snapshot, cached in Redis for 60 s (spec "Tenant resolution"). */
export const tenantRegistry = {
  async byHost(host) {
    const h = host.toLowerCase().replace(/:\d+$/, '');
    const cached = await redis().get(key(h));
    if (cached) return cached === 'null' ? null : JSON.parse(cached);
    const sub = subdomainOf(h);
    const doc = await Tenant.findOne(sub ? { subdomain: sub } : { domains: h }).lean(false);
    const snap = doc ? snapshot(doc) : null;
    await redis().set(key(h), JSON.stringify(snap), 'EX', snap ? TTL_SEC : 10);
    return snap;
  },
  /**
   * The hospital for a request. Behind a proxy that rewrites Host (a Vercel rewrite to Render),
   * the web app sends its own address in X-Hms-Host; it selects a hospital exactly like Host does
   * (tokens are bound to their hospital, so naming another one gains nothing). DEFAULT_TENANT
   * serves one hospital on an address that matches none (a demo on a vercel.app address).
   */
  async resolve(headers = {}, hostname = '') {
    const hinted = String(headers['x-hms-host'] ?? '').trim();
    const host = hinted || hostname || String(headers.host ?? '');
    const found = host ? await this.byHost(host) : null;
    if (found || !env.DEFAULT_TENANT) return found;
    return this.byHost(`${env.DEFAULT_TENANT}.${env.ROOT_DOMAIN}`);
  },
  /** Call after changing a tenant's status, modules or domains. */
  async invalidate(tenant) {
    const hosts = [`${tenant.subdomain}.${env.ROOT_DOMAIN}`, ...(tenant.domains ?? [])];
    if (hosts.length) await redis().del(...hosts.map(key));
  },
};

function snapshot(t) {
  return {
    id: String(t._id),
    name: t.name,
    subdomain: t.subdomain,
    status: t.status,
    modules: t.activeModules(),
    settings: {
      timezone: t.settings?.timezone,
      uhidPrefix: t.settings?.uhidPrefix,
      idleTimeoutMin: t.settings?.idleTimeoutMin,
      twoFactorRoles: t.settings?.twoFactorRoles ?? [],
    },
  };
}
