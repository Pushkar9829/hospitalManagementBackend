import { errors } from '../errors/index.js';

/** Zod issues -> the API's 422 details list. */
export function toDetails(zodError) {
  return zodError.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

/** Parses body, query and params with the route's Zod schemas into `req.valid`. */
export function validate(schema = {}) {
  return (req, _res, next) => {
    const valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (!schema[part]) continue;
      const r = schema[part].safeParse(req[part] ?? {});
      if (!r.success) return next(errors.validation(toDetails(r.error)));
      valid[part] = r.data;
    }
    req.valid = valid;
    next();
  };
}
