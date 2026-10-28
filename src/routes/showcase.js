// Public gallery for the landing page: only finished videos an admin picked.
// Nothing about the customer who made them is exposed.
import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError, asyncRoute } from '../errors.js';
import { getBlob, sendBlob } from '../services/storage.js';

const router = Router();

router.get('/', asyncRoute(async (req, res) => {
  const rows = await prisma.videoJob.findMany({
    where: { showcase: true, status: 'COMPLETED' }, orderBy: { finished_at: 'desc' }, take: 24,
    select: { id: true, product_name: true, aspect_ratio: true, style: true },
  });
  res.json({ videos: rows.map((r) => ({ id: r.id, productName: r.product_name, aspectRatio: r.aspect_ratio, style: r.style === 'CINEMATIC' ? 'SHOWCASE' : r.style, videoUrl: `/api/showcase/${r.id}/video`, imageUrl: `/api/showcase/${r.id}/image` })) });
}));

async function shown(id) {
  const n = Number(id);
  const job = Number.isInteger(n) ? await prisma.videoJob.findUnique({ where: { id: n } }) : null;
  if (!job || !job.showcase || job.status !== 'COMPLETED') throw new AppError('مش موجود.', 404, 'NOT_FOUND');
  return job;
}

router.get('/:id/video', asyncRoute(async (req, res) => {
  const blob = await getBlob((await shown(req.params.id)).video_key);
  if (!blob) throw new AppError('مش موجود.', 404, 'NOT_FOUND');
  sendBlob(req, res, blob, { cacheSeconds: 3600 });
}));

router.get('/:id/image', asyncRoute(async (req, res) => {
  const blob = await getBlob((await shown(req.params.id)).image_key);
  if (!blob) throw new AppError('مش موجود.', 404, 'NOT_FOUND');
  sendBlob(req, res, blob, { cacheSeconds: 3600 });
}));

export default router;
