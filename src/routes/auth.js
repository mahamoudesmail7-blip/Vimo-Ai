import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../config.js';
import { AppError, asyncRoute } from '../errors.js';
import { setSession, clearSession, requireAuth, publicUser } from '../auth.js';
import { applyCredits } from '../services/credits.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'RATE_LIMIT', message: 'محاولات كتير، استنى شوية.' } });

const signupSchema = z.object({
  name: z.string().trim().min(2, 'اكتب اسمك.').max(80),
  email: z.string().trim().toLowerCase().email('الإيميل مش صحيح.'),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  password: z.string().min(8, 'كلمة المرور لازم تكون 8 حروف على الأقل.').max(100),
});

router.post('/signup', limiter, asyncRoute(async (req, res) => {
  const body = signupSchema.parse(req.body || {});
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw new AppError('الإيميل ده عليه حساب بالفعل، سجّل دخول.', 409, 'EMAIL_TAKEN');
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { name: body.name, email: body.email, phone: body.phone || null, password_hash: await bcrypt.hash(body.password, 10) } });
    if (env.signupBonusCredits() > 0) await applyCredits(tx, u.id, env.signupBonusCredits(), 'SIGNUP_BONUS');
    return tx.user.findUnique({ where: { id: u.id } });
  });
  setSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', limiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new AppError('خطأ في البريد الإلكتروني أو كلمة المرور.', 401, 'BAD_CREDENTIALS');
  if (user.status !== 'ACTIVE') throw new AppError('الحساب ده متوقف. كلم الدعم.', 403, 'DISABLED');
  setSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;
