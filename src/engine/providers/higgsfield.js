// Higgsfield official API (docs.higgsfield.ai). Auth: "Authorization: Key
// KEY_ID:KEY_SECRET". Every create call carries an Idempotency-Key, so a retry
// after a network blip can never start (and bill) a second generation.
// Inputs must be public URLs: our inline photos are uploaded first through
// POST /files/generate-upload-url. Failed and nsfw requests are not billed.
import { EngineError } from '../errors.js';
import { httpFetch, toBuffer, mimeOf, toFetchable } from '../media.js';

const BASE = 'https://api.higgsfield.ai';

function credentials() {
  const id = String(process.env.HIGGSFIELD_API_KEY || '').trim();
  const secret = String(process.env.HIGGSFIELD_API_SECRET || '').trim();
  return id && secret ? `${id}:${secret}` : '';
}

let noBalanceSince = null;

async function call(method, path, body, { idempotencyKey, timeoutMs = 60000 } = {}) {
  const key = credentials();
  if (!key) throw new EngineError('مفاتيح Higgsfield مش متظبطة.', 'NOT_CONFIGURED', null, 'higgsfield');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await httpFetch(path.startsWith('http') ? path : BASE + path, {
      method,
      headers: { Authorization: `Key ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new EngineError(err.name === 'AbortError' ? 'Higgsfield اتأخر في الرد.' : `تعذر الاتصال بـ Higgsfield: ${err.message}`, 'UNREACHABLE', null, 'higgsfield');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* raw */ }
  if (!res.ok) {
    const msg = typeof data?.detail === 'string' ? data.detail : data?.message || text.slice(0, 300);
    if (res.status === 403 || res.status === 402) {
      noBalanceSince = noBalanceSince || new Date();
      throw new EngineError(`رصيد Higgsfield مش كفاية: ${msg}`, 'NO_BALANCE', res.status, 'higgsfield');
    }
    throw new EngineError(`Higgsfield رجّع خطأ ${res.status}: ${msg}`, 'HTTP_ERROR', res.status, 'higgsfield');
  }
  if (method === 'POST') noBalanceSince = null;
  return data;
}

/** Make any media ref a public URL Higgsfield can read. */
export async function publicUrl(ref) {
  if (/^https?:/.test(ref)) return ref;
  if (ref.startsWith('blob:') && /^videos\//.test(ref.slice(5))) return toFetchable(ref);
  const contentType = mimeOf(ref);
  const up = await call('POST', '/files/generate-upload-url', { content_type: contentType });
  if (!up?.upload_url || !up?.public_url) throw new EngineError('Higgsfield ما رجّعش رابط رفع.', 'BAD_RESPONSE', null, 'higgsfield');
  const res = await httpFetch(up.upload_url, { method: 'PUT', headers: { 'Content-Type': contentType, ...(up.upload_headers || {}) }, body: await toBuffer(ref) });
  if (!res.ok) throw new EngineError(`رفع الصورة لـ Higgsfield فشل (${res.status}).`, 'UPLOAD_FAILED', res.status >= 500 ? res.status : null, 'higgsfield');
  return up.public_url;
}

export function buildInput(model, p, imageUrl) {
  const duration = model.durations.includes(p.seconds) ? p.seconds : model.durations[0];
  const body = { prompt: p.prompt.slice(0, 2500), image_url: imageUrl, duration };
  if (/kling/.test(model.endpoint)) Object.assign(body, { cfg_scale: 0.5, ...(p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}) });
  return body;
}

export default {
  id: 'higgsfield',
  configured: () => Boolean(credentials()),
  missing: () => (credentials() ? [] : ['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET']),
  balance: async () => null, // no balance endpoint: the admin confirms a budget by hand
  balanceOutSince: () => noBalanceSince,
  async submit(model, kind, params, { idempotencyKey } = {}) {
    if (kind !== 'video') throw new EngineError('Higgsfield هنا للفيديو بس.', 'BAD_INPUT', null, 'higgsfield');
    const body = buildInput(model, params, await publicUrl(params.imageUrl));
    const data = await call('POST', model.endpoint, body, { idempotencyKey });
    const requestId = data?.request_id || data?.id;
    if (!requestId) throw new EngineError('Higgsfield ما رجّعش request_id.', 'BAD_RESPONSE', null, 'higgsfield');
    return { requestId, statusUrl: data.status_url || `${BASE}/requests/${requestId}/status` };
  },
  async poll(model, step) {
    const data = await call('GET', step.statusUrl);
    const st = String(data?.status || '').toLowerCase();
    if (st === 'queued' || st === 'in_progress' || !st) return { state: 'RUNNING' };
    if (st === 'completed') {
      const url = data.video?.url || data.images?.[0]?.url || data.audio?.url;
      if (!url) throw new EngineError('Higgsfield خلّص من غير ملف.', 'NO_OUTPUT', null, 'higgsfield');
      return { state: 'COMPLETED', url };
    }
    // failed | nsfw | canceled: not billed by Higgsfield
    throw new EngineError(st === 'nsfw' ? 'المحتوى اترفض من فلتر الأمان.' : `المشهد فشل عند Higgsfield (${st}).`, 'FAILED', null, 'higgsfield');
  },
};
