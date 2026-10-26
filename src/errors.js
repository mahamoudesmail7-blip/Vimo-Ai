// One error type for everything the API reports on purpose. `message` is
// shown to the user as-is, so it is always Arabic and never holds a secret.
export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err?.name === 'ZodError') {
    return res.status(400).json({ error: 'VALIDATION', message: err.issues?.[0]?.message || 'البيانات غير صحيحة.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'TOO_LARGE', message: 'الملف كبير جدًا.' });
  }
  const status = err?.status || 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err);
  res.status(status).json({ error: err?.code || 'SERVER_ERROR', message: status >= 500 ? 'حصل خطأ في السيرفر، جرّب تاني.' : err.message });
}
