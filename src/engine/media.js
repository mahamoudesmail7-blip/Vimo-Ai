// Media references passed between steps:
//   data:...       an inline image (product photos)
//   https://...    a provider CDN file (fal, Higgsfield)
//   blob:<key>     a file in our own storage (Google returns video bytes)
//   mock:<name>    the free mock engine's bundled sample
// Providers that need a public URL get blob: files through a short-lived
// signed link served by /media (see routes/media.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config.js';
import { getBlob, putBuffer } from '../services/storage.js';
import { EngineError } from './errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let mockMp4 = null;
export const mockVideo = () => (mockMp4 = mockMp4 || fs.readFileSync(path.join(here, 'assets', 'mock.mp4')));
// 1x1 PNG
export const MOCK_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let fetchImpl = (...args) => fetch(...args);
export function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }
export const httpFetch = (...args) => fetchImpl(...args);

export async function toBuffer(ref) {
  if (ref.startsWith('data:')) return Buffer.from(ref.slice(ref.indexOf(',') + 1), 'base64');
  if (ref.startsWith('mock:')) return mockVideo();
  if (ref.startsWith('blob:')) {
    const b = await getBlob(ref.slice(5));
    if (!b) throw new EngineError('ملف وسيط مش موجود.', 'MEDIA_MISSING');
    return b.buffer;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetchImpl(ref, { signal: controller.signal });
    if (!res.ok) throw new EngineError(`تعذر تحميل الملف (${res.status}).`, 'DOWNLOAD_FAILED', res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new EngineError(`تعذر تحميل الملف: ${err.message}`, 'UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

export function mimeOf(ref) {
  const m = /^data:([^;,]+)/.exec(ref);
  if (m) return m[1];
  return /\.mp4($|\?)|^mock:|^blob:videos\//.test(ref) ? 'video/mp4' : /\.png($|\?)/.test(ref) ? 'image/png' : /\.(mp3|mpeg)($|\?)/.test(ref) ? 'audio/mpeg' : 'image/jpeg';
}

export async function storeBuffer(buffer, mime) {
  const stored = await putBuffer(buffer, mime, mime.startsWith('video') ? 'videos' : 'media');
  return `blob:${stored.key}`;
}

export function publicBaseUrl() {
  const explicit = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const railway = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  return railway ? `https://${railway}` : '';
}

const sign = (key, exp) => crypto.createHmac('sha256', env.jwtSecret()).update(`${key}.${exp}`).digest('base64url');

/** A link a provider can download a blob: file from, valid for `hours`. */
export function signedUrl(key, hours = 6) {
  const base = publicBaseUrl();
  if (!base) throw new EngineError('PUBLIC_BASE_URL مش متظبط، ومزوّد الخدمة محتاج رابط عام للملف.', 'NO_PUBLIC_URL');
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return `${base}/media/${encodeURIComponent(key)}?exp=${exp}&sig=${sign(key, exp)}`;
}

export function verifySigned(key, exp, sig) {
  if (!key || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(key, Number(exp)));
  const got = Buffer.from(String(sig));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** A URL any provider can fetch: data: and https: pass through, blob: is signed. */
export function toFetchable(ref) {
  return ref.startsWith('blob:') ? signedUrl(ref.slice(5)) : ref;
}
