import { Router } from 'express';
import { prisma } from '../db.js';
import { env } from '../config.js';
import { AppError, asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin, publicUser } from '../auth.js';
import { applyCredits } from '../services/credits.js';
import { serialize } from '../services/videoJob.js';
import { getBlob, sendBlob } from '../services/storage.js';
import { serializeTopup } from './wallet.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const idOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new AppError('رقم غير صالح.'); return n; };

router.get('/overview', asyncRoute(async (req, res) => {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const [users, pendingTopups, approved, videosToday, completed, failed, active] = await Promise.all([
    prisma.user.count(),
    prisma.topupRequest.count({ where: { status: 'PENDING' } }),
    prisma.topupRequest.aggregate({ where: { status: 'APPROVED' }, _sum: { amount_egp: true } }),
    prisma.videoJob.count({ where: { created_at: { gte: dayStart } } }),
    prisma.videoJob.count({ where: { status: 'COMPLETED' } }),
    prisma.videoJob.count({ where: { status: 'FAILED' } }),
    prisma.videoJob.count({ where: { status: { notIn: ['COMPLETED', 'FAILED'] } } }),
  ]);
  const seconds = env.clipSeconds() * env.defaultClipCount();
  res.json({
    users, pendingTopups, revenueEgp: approved._sum.amount_egp || 0, videosToday, completed, failed, active,
    estCostPerVideoUsd: Math.round(seconds * env.costPerSecondUsd() * 100) / 100,
    falConfigured: !!env.falKey(), scriptAi: !!env.openAiKey(),
  });
}));

router.get('/topups', asyncRoute(async (req, res) => {
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : undefined;
  const rows = await prisma.topupRequest.findMany({ where: status ? { status } : {}, include: { user: true }, orderBy: { created_at: 'desc' }, take: 200 });
  res.json({ topups: rows.map((t) => ({ ...serializeTopup(t), user: { id: t.user.id, name: t.user.name, email: t.user.email, phone: t.user.phone } })) });
}));

router.get('/topups/:id/receipt', asyncRoute(async (req, res) => {
  const t = await prisma.topupRequest.findUnique({ where: { id: idOf(req.params.id) } });
  const blob = t?.receipt_key ? await getBlob(t.receipt_key) : null;
  if (!blob) throw new AppError('مفيش صورة تحويل.', 404, 'NOT_FOUND');
  sendBlob(req, res, blob);
}));

router.post('/topups/:id/:decision(approve|reject)', asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  const approve = req.params.decision === 'approve';
  const note = String(req.body?.note || '').trim().slice(0, 300) || null;
  const result = await prisma.$transaction(async (tx) => {
    // only a PENDING request can be decided, and only once
    const { count } = await tx.topupRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', admin_note: note, reviewed_by: req.user.id, reviewed_at: new Date() },
    });
    if (!count) throw new AppError('الطلب ده اتراجع قبل كده.', 409, 'ALREADY_DECIDED');
    const t = await tx.topupRequest.findUnique({ where: { id } });
    if (approve) await applyCredits(tx, t.user_id, t.videos, 'TOPUP', { ref: `topup:${t.id}`, note: `${t.amount_egp} ج.م فودافون كاش` });
    return t;
  });
  res.json(serializeTopup(result));
}));

router.get('/users', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {},
    orderBy: { created_at: 'desc' }, take: 200, include: { _count: { select: { videos: true } } },
  });
  res.json({ users: users.map((u) => ({ ...publicUser(u), status: u.status, videos: u._count.videos })) });
}));

router.post('/users/:id/credits', asyncRoute(async (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000) throw new AppError('اكتب عدد فيديوهات صحيح.');
  const balance = await prisma.$transaction((tx) => applyCredits(tx, idOf(req.params.id), delta, 'ADMIN_ADJUST', { note: String(req.body?.note || '').slice(0, 200) || null }));
  res.json({ credits: balance });
}));

router.post('/users/:id/status', asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (id === req.user.id) throw new AppError('مينفعش توقف حسابك.');
  const status = req.body?.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
  const u = await prisma.user.update({ where: { id }, data: { status } });
  res.json({ ...publicUser(u), status: u.status });
}));

router.get('/videos', asyncRoute(async (req, res) => {
  const status = String(req.query.status || '');
  const rows = await prisma.videoJob.findMany({ where: status ? { status } : {}, include: { user: true }, orderBy: { created_at: 'desc' }, take: 200 });
  res.json({ videos: rows.map((j) => ({ ...serialize(j, { admin: true }), user: { name: j.user.name, email: j.user.email } })) });
}));

router.post('/videos/:id/showcase', asyncRoute(async (req, res) => {
  const job = await prisma.videoJob.findUnique({ where: { id: idOf(req.params.id) } });
  if (!job || job.status !== 'COMPLETED') throw new AppError('ينفع تعرض الفيديوهات الجاهزة بس.', 400);
  const updated = await prisma.videoJob.update({ where: { id: job.id }, data: { showcase: req.body?.on !== false } });
  res.json({ id: updated.id, showcase: updated.showcase });
}));

export default router;
