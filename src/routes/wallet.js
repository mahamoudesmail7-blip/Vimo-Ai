import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { findPackage } from '../config.js';
import { AppError, asyncRoute } from '../errors.js';
import { requireAuth } from '../auth.js';
import { parseDataUrl, putBuffer, IMAGE_MIMES } from '../services/storage.js';

const router = Router();
router.use(requireAuth);

export function serializeTopup(t) {
  return {
    id: t.id, packageKey: t.package_key, videos: t.videos, amountEgp: t.amount_egp, senderPhone: t.sender_phone,
    reference: t.reference, hasReceipt: !!t.receipt_key, status: t.status, adminNote: t.admin_note,
    createdAt: t.created_at, reviewedAt: t.reviewed_at,
  };
}

router.get('/', asyncRoute(async (req, res) => {
  const [topups, transactions] = await Promise.all([
    prisma.topupRequest.findMany({ where: { user_id: req.user.id }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.creditTransaction.findMany({ where: { user_id: req.user.id }, orderBy: { created_at: 'desc' }, take: 50 }),
  ]);
  res.json({
    credits: req.user.credits,
    topups: topups.map(serializeTopup),
    transactions: transactions.map((t) => ({ id: t.id, delta: t.delta, balance: t.balance, reason: t.reason, note: t.note, createdAt: t.created_at })),
  });
}));

const topupSchema = z.object({
  packageKey: z.string(),
  senderPhone: z.string().trim().regex(/^01[0-9]{9}$/, 'اكتب رقم فودافون كاش اللي حوّلت منه (11 رقم يبدأ بـ 01).'),
  reference: z.string().trim().max(60).optional().or(z.literal('')),
  receipt: z.string().optional(),
});

router.post('/topups', asyncRoute(async (req, res) => {
  const body = topupSchema.parse(req.body || {});
  const pkg = findPackage(body.packageKey);
  if (!pkg) throw new AppError('الباقة مش موجودة.');
  const pending = await prisma.topupRequest.count({ where: { user_id: req.user.id, status: 'PENDING' } });
  if (pending >= 3) throw new AppError('عندك طلبات شحن لسه بتتراجع. استنى لما نأكدها.', 429, 'TOO_MANY_PENDING');

  let receiptKey = null;
  if (body.receipt) {
    const { mime, buffer } = parseDataUrl(body.receipt);
    if (!IMAGE_MIMES.includes(mime)) throw new AppError('صورة التحويل لازم تكون JPG أو PNG.');
    if (buffer.length > 5 * 1024 * 1024) throw new AppError('صورة التحويل كبيرة جدًا.');
    receiptKey = (await putBuffer(buffer, mime, 'receipts')).key;
  }
  const t = await prisma.topupRequest.create({
    data: {
      user_id: req.user.id, package_key: pkg.key, videos: pkg.videos, amount_egp: pkg.priceEgp,
      sender_phone: body.senderPhone, reference: body.reference || null, receipt_key: receiptKey,
    },
  });
  res.status(201).json(serializeTopup(t));
}));

export default router;
