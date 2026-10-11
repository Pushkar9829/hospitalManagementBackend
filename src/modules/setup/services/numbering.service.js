import { NUMBER_SERIES } from '@hms/shared/schemas';
import { nextInSeries } from '../../../core/sequences/sequence.service.js';
import { errors } from '../../../core/errors/index.js';
import { NumberSeries } from '../models/settings.model.js';

/** The hospital's format for a series, falling back to the product default. */
export async function seriesConfig(series) {
  const base = NUMBER_SERIES[series];
  if (!base) throw new Error(`Unknown number series ${series}`);
  const own = await NumberSeries.findOne({ series }).lean();
  return {
    series,
    label: base.label,
    perBranch: base.perBranch,
    prefix: own?.prefix ?? base.prefix,
    reset: own?.reset ?? base.reset,
    width: own?.width ?? base.width,
    version: own?.version,
  };
}

export const listSeries = () => Promise.all(Object.keys(NUMBER_SERIES).map(seriesConfig));

/** Next document number, e.g. next('OP_BILL') -> "OP/26-27/000154". Call inside the write's transaction. */
export async function next(series, opts) {
  return nextInSeries(series, await seriesConfig(series), opts);
}

export async function updateSeries(series, { prefix, reset, width }) {
  if (!NUMBER_SERIES[series]) throw errors.notFound('Number series');
  if (series === 'UHID' && reset !== 'NEVER') {
    throw errors.validation([{ path: 'reset', message: 'A UHID is permanent: it never resets' }]);
  }
  const doc =
    (await NumberSeries.findOne({ series })) ??
    new NumberSeries({ series, perBranch: NUMBER_SERIES[series].perBranch });
  doc.set({ prefix, reset, width });
  await doc.save();
  return seriesConfig(series);
}
