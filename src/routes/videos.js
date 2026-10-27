import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError, asyncRoute } from '../errors.js';
import { requireAuth } from '../auth.js';
import rateLimit from 'express-rate-limit';
import { createVideo, previewScript, remakeVideo, serialize, quote } from '../services/videoJob.js';
import { getBlob, sendBlob } from '../services/storage.js';

const router = Router();
router.use(requireAuth);

const idOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new AppError('رقم غير صالح.'); return n; };

// Admins can open any video; a user only their own.
async function findOwned(req) {
  const job = await prisma.videoJob.findUnique({ where: { id: idOf(req.params.id) } });
  if (!job || (job.user_id !== req.user.id && req.user.role !== 'ADMIN')) throw new AppError('الفيديو مش موجود.', 404, 'NOT_FOUND');
  return job;
}

router.get('/', asyncRoute(async (req, res) => {
  const jobs = await prisma.videoJob.findMany({ where: { user_id: req.user.id }, orderBy: { created_at: 'desc' }, take: 100 });
  res.json({ videos: jobs.map((j) => serialize(j)) });
}));

// The price in credits before ordering, and whether videos can be made right now.
router.get('/quote', asyncRoute(async (req, res) => res.json(await quote())));

router.post('/', asyncRoute(async (req, res) => {
  res.status(201).json(await createVideo(req.user.id, req.body || {}));
}));

// Free to the customer but not to us (a vision-model call), so it is capped per account.
const previewLimit = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 30, keyGenerator: (req) => `u${req.user.id}`, standardHeaders: true, legacyHeaders: false,
  message: { error: 'RATE_LIMIT', message: 'جربت سكريبتات كتير، استنى شوية وجرب تاني.' },
});
router.post('/script-preview', previewLimit, asyncRoute(async (req, res) => res.json(await previewScript(req.body || {}))));

router.post('/:id/remake', asyncRoute(async (req, res) => {
  res.status(201).json(await remakeVideo(req.user.id, idOf(req.params.id), { sameScript: req.body?.sameScript !== false }));
}));

router.get('/:id', asyncRoute(async (req, res) => res.json(serialize(await findOwned(req)))));

router.get('/:id/image', asyncRoute(async (req, res) => {
  const blob = await getBlob((await findOwned(req)).image_key);
  if (!blob) throw new AppError('الصورة مش موجودة.', 404, 'NOT_FOUND');
  sendBlob(req, res, blob);
}));

router.get('/:id/video', asyncRoute(async (req, res) => {
  const job = await findOwned(req);
  const blob = job.video_key ? await getBlob(job.video_key) : null;
  if (!blob) throw new AppError('الفيديو لسه مش جاهز.', 404, 'NOT_READY');
  const download = req.query.download === '1';
  sendBlob(req, res, blob, { filename: download ? `vimo-${job.id}.mp4` : undefined });
}));

export default router;
