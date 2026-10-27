// Short-lived signed links to our own stored files, for providers that must
// download an input by URL (e.g. fal merging clips that Google returned as bytes).
import { Router } from 'express';
import { asyncRoute } from '../errors.js';
import { verifySigned } from '../engine/media.js';
import { getBlob, sendBlob } from '../services/storage.js';

const router = Router();

router.get('/:key(*)', asyncRoute(async (req, res) => {
  const key = req.params.key;
  if (!verifySigned(key, req.query.exp, req.query.sig)) return res.status(403).json({ error: 'FORBIDDEN', message: 'الرابط مش صالح.' });
  const blob = await getBlob(key);
  if (!blob) return res.status(404).json({ error: 'NOT_FOUND', message: 'الملف مش موجود.' });
  sendBlob(req, res, blob, { cacheSeconds: 0 });
}));

export default router;
