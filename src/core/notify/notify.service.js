import { env } from '../../config/env.js';
import { logger } from '../observability/logger.js';
import { SMS_TEMPLATES, renderTemplate } from './templates.js';

/** Providers implement send({ to, text, dltId }). Real providers are added at go-live. */
const providers = {
  // No gateway connected yet (an early deployment): the message is dropped, never shown.
  none: {
    async send() {
      return { id: null, skipped: true };
    },
  },
  console: {
    async send({ to, text }) {
      // Development only: shows the message instead of sending it. Never enabled in production.
      logger.info({ to: `******${String(to).slice(-4)}`, text }, 'SMS (console provider)');
      return { id: `console-${Date.now()}` };
    },
  },
};

/** Test hook: lets tests read messages the console provider "sent". */
export const outbox = [];

/**
 * A hospital may reword its messages (Settings, message templates). Setup registers the lookup
 * so the notifier does not depend on a module; it returns { en, hi, dltId, enabled } or null.
 */
let overrideOf = async () => null;
export function registerTemplateOverrides(fn) {
  overrideOf = fn;
}

export async function sendSms({ to, template, vars, lang = 'en' }) {
  const base = SMS_TEMPLATES[template];
  if (!base) throw new Error(`Unknown SMS template ${template}`);
  const o = await overrideOf(template);
  if (o?.enabled === false) return { skipped: true };
  const t = o
    ? {
        dltId: o.dltId || base.dltId,
        text: { en: o.en || base.text.en, hi: o.hi || base.text.hi },
      }
    : base;
  const provider = providers[env.SMS_PROVIDER];
  if (!provider) throw new Error(`SMS provider ${env.SMS_PROVIDER} is not configured`);
  if (env.isProd && env.SMS_PROVIDER === 'console')
    throw new Error('Console SMS provider is not allowed in production');
  const text = renderTemplate(t, lang, vars);
  if (env.isTest) outbox.push({ to, template, text, vars });
  return provider.send({ to, text, dltId: t.dltId });
}
