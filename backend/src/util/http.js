import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra;
  }
}
export const badRequest = (code, msg, extra) => new HttpError(400, code, msg, extra);
export const unauthorized = (msg = 'Please sign in') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const conflict = (code, msg) => new HttpError(409, code, msg);
export const unavailable = (code, msg) => new HttpError(503, code, msg);

/** Wrap async handlers so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse + validate with zod; throws a 400 with field details. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'validation_error', 'Invalid input', zodIssues(r.error));
  return r.data;
}
const zodIssues = (e) => e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, details: err.extra });
  if (err instanceof ZodError) return res.status(400).json({ error: 'validation_error', message: 'Invalid input', details: zodIssues(err) });
  if (err?.code === '23505') return res.status(409).json({ error: 'duplicate', message: 'This value is already in use' });
  if (err?.code === '23514' || err?.code === '23503') return res.status(400).json({ error: 'constraint', message: 'Value rejected by database constraint' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Request too large' });
  if (err?.name === 'MulterError') return res.status(400).json({ error: 'upload_error', message: err.message });
  console.error('[unhandled]', req.method, req.path, err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please retry.' });
}
