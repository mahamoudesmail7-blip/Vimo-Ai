// Durable storage for product photos, receipts and finished videos. The `db`
// driver keeps bytes in Postgres (table blobs), so the app works on a
// platform with an ephemeral disk (Railway, Render) with no bucket to set up.
// Swap the driver here when the library outgrows the database.
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

export function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new AppError('صيغة الصورة غير صالحة.', 400, 'BAD_IMAGE');
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

export async function putBuffer(buffer, mime, prefix) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError('الملف فاضي.', 400, 'EMPTY_FILE');
  const key = `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${EXT[mime] || 'bin'}`;
  await prisma.blob.create({ data: { key, data: buffer, mime, bytes: buffer.length } });
  return { key, bytes: buffer.length, mime };
}

export async function getBlob(key) {
  if (!key) return null;
  const row = await prisma.blob.findUnique({ where: { key } });
  return row ? { buffer: Buffer.from(row.data), mime: row.mime, bytes: row.bytes } : null;
}

export async function getDataUrl(key) {
  const b = await getBlob(key);
  return b ? `data:${b.mime};base64,${b.buffer.toString('base64')}` : null;
}

/** Send a stored blob, honouring a Range header so <video> can seek. */
export function sendBlob(req, res, blob, { filename, cacheSeconds = 600 } = {}) {
  const total = blob.buffer.length;
  res.set('Content-Type', blob.mime);
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', `private, max-age=${cacheSeconds}`);
  if (filename) res.set('Content-Disposition', `attachment; filename="${filename}"`);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range) {
    res.set('Content-Length', String(total));
    return res.end(blob.buffer);
  }
  let start = range[1] === '' ? total - Number(range[2]) : Number(range[1]);
  let end = range[1] === '' || range[2] === '' ? total - 1 : Number(range[2]);
  start = Math.max(0, start); end = Math.min(total - 1, end);
  if (start > end) { res.status(416).set('Content-Range', `bytes */${total}`); return res.end(); }
  res.status(206);
  res.set('Content-Range', `bytes ${start}-${end}/${total}`);
  res.set('Content-Length', String(end - start + 1));
  return res.end(blob.buffer.subarray(start, end + 1));
}
