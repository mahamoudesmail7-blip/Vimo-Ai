// Session = a signed JWT in an httpOnly cookie. Nothing auth-related lives in
// the browser's JavaScript.
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';
import { env } from './config.js';
import { AppError } from './errors.js';

const COOKIE = 'vimo_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, env.jwtSecret(), { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: env.isProd(), maxAge: MAX_AGE_MS });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new AppError('سجّل دخول الأول.', 401, 'UNAUTHENTICATED');
    let payload;
    try { payload = jwt.verify(token, env.jwtSecret()); } catch { throw new AppError('انتهت الجلسة، سجّل دخول تاني.', 401, 'UNAUTHENTICATED'); }
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('الحساب مش متاح.', 401, 'UNAUTHENTICATED');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return next(new AppError('الصفحة دي للأدمن بس.', 403, 'FORBIDDEN'));
  next();
}

export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, credits: u.credits, createdAt: u.created_at };
}
