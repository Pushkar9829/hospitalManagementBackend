/**
 * Flow seeds for the demo hospital: fills every screen with data made through the real API.
 * Usage (from api/): npm run seed:flows [-- area ...]   areas: money, clinical, people, extras, platform
 * Each section skips itself once its data exists, so it can be run again.
 */
import { boot, runSections } from './harness.js';

const AREAS = ['money', 'clinical', 'people', 'extras', 'platform'];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const areas = wanted.length ? wanted : AREAS;

const h = await boot();
const all = [];
for (const area of areas) {
  let mod;
  try {
    mod = await import(`./${area}.js`);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && !wanted.length) continue;
    throw e;
  }
  console.log(`\n== ${area}`);
  all.push(...(await runSections(h, mod.sections)));
}
await h.done();
const failed = all.filter((r) => r[1] !== 'ok');
console.log(`\n${all.length - failed.length} sections ok, ${failed.length} failed`);
for (const [name, , msg] of failed) console.log(`  ✘ ${name}: ${msg}`);
process.exit(failed.length ? 1 : 0);
