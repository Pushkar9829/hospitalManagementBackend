import { randomUUID } from 'node:crypto';
import { AppError } from '../../../core/errors/index.js';
import { encrypt } from './jwe.js';

/**
 * Sends a request to the National Health Claims Exchange.
 *   MOCK     nothing leaves the server; the desk (or a test) plays the payer with
 *            POST /pmjay/cases/:id/nhcx/mock-response, which goes through the same callback path.
 *   SANDBOX  https://staging-hcx.swasth.app style gateway, credentials from the environment.
 *   LIVE     the production exchange.
 * Environment (never stored in the database):
 *   NHCX_BASE_URL, NHCX_AUTH_URL, NHCX_USERNAME, NHCX_SECRET  gateway and its token endpoint
 *   NHCX_PAYER_PUBLIC_KEY   PEM of the payer's encryption certificate (from the NHCX registry)
 *   NHCX_PRIVATE_KEY        our PEM private key, to open on_* callbacks
 */
export const ACTIONS = Object.freeze({
  preauth: '/preauth/submit',
  claim: '/claim/submit',
  communication: '/communication/on_request',
});

export function hcxHeaders({ action, settings, correlationId, apiCallId }) {
  return {
    'x-hcx-api_call_id': apiCallId,
    'x-hcx-correlation_id': correlationId,
    'x-hcx-workflow_id': correlationId,
    'x-hcx-timestamp': new Date().toISOString(),
    'x-hcx-sender_code': settings.nhcx?.participantCode ?? 'hms-mock@hcx',
    'x-hcx-recipient_code': settings.nhcx?.payerCode ?? 'pmjay-mock@hcx',
    'x-hcx-request_type': action,
  };
}

async function token(env) {
  const res = await fetch(env.NHCX_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'registry-frontend',
      grant_type: 'password',
      username: env.NHCX_USERNAME,
      password: env.NHCX_SECRET,
    }),
  });
  if (!res.ok) throw new AppError(502, 'NHCX_AUTH', `NHCX sign-in failed (${res.status})`);
  return (await res.json()).access_token;
}

/** Returns `{ apiCallId, correlationId, status, jwe? }`. */
export async function send({ action, bundle, settings, correlationId }, env = process.env) {
  const apiCallId = randomUUID();
  const headers = hcxHeaders({ action, settings, correlationId, apiCallId });
  const mode = settings.nhcx?.mode ?? 'MOCK';
  if (mode === 'MOCK') return { apiCallId, correlationId, status: 'ACCEPTED', headers };
  for (const k of [
    'NHCX_BASE_URL',
    'NHCX_AUTH_URL',
    'NHCX_USERNAME',
    'NHCX_SECRET',
    'NHCX_PAYER_PUBLIC_KEY',
  ])
    if (!env[k])
      throw new AppError(
        409,
        'NHCX_NOT_CONFIGURED',
        `NHCX ${mode.toLowerCase()} needs ${k} on the server`,
      );
  const jwe = encrypt(bundle, env.NHCX_PAYER_PUBLIC_KEY.replace(/\\n/g, '\n'), headers);
  const res = await fetch(`${env.NHCX_BASE_URL}${ACTIONS[action]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await token(env)}` },
    body: JSON.stringify({ payload: jwe }),
  });
  if (res.status !== 202 && !res.ok)
    throw new AppError(502, 'NHCX_REJECTED', `NHCX did not accept the request (${res.status})`);
  return { apiCallId, correlationId, status: 'ACCEPTED' };
}
