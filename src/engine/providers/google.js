// Google Veo through the official Vertex AI API (predictLongRunning +
// fetchPredictOperation). Auth is a service account: we sign a JWT with its
// private key and trade it for an OAuth token, so no Google SDK is needed.
// The Gemini Developer API Veo previews were retired, and Google Flow has no
// API, so Vertex AI is the supported route. Videos come back as bytes and are
// kept in our storage (blob: refs).
import crypto from 'node:crypto';
import { EngineError } from '../errors.js';
import { httpFetch, toBuffer, mimeOf } from '../media.js';

function account() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return json.client_email && json.private_key ? json : null;
  } catch { return null; }
}
const project = () => String(process.env.GOOGLE_CLOUD_PROJECT || account()?.project_id || '').trim();
const location = () => String(process.env.GOOGLE_CLOUD_LOCATION || 'us-central1').trim();

let token = null;
async function accessToken() {
  if (token && token.exp - 60 > Date.now() / 1000) return token.value;
  const sa = account();
  if (!sa) throw new EngineError('حساب خدمة جوجل مش متظبط.', 'NOT_CONFIGURED', null, 'google');
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')}`;
  const res = await httpFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
  }).catch((err) => { throw new EngineError(`تعذر الاتصال بجوجل: ${err.message}`, 'UNREACHABLE', null, 'google'); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new EngineError(`تسجيل الدخول لجوجل فشل (${res.status}).`, 'AUTH_FAILED', res.status >= 500 ? res.status : null, 'google');
  token = { value: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return token.value;
}

async function call(url, body) {
  const auth = await accessToken();
  let res;
  try {
    res = await httpFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    throw new EngineError(`تعذر الاتصال بجوجل: ${err.message}`, 'UNREACHABLE', null, 'google');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /billing|quota/i.test(msg)) throw new EngineError(`حساب جوجل مش متاح للدفع: ${msg}`, 'NO_BALANCE', res.status, 'google');
    throw new EngineError(`جوجل رجّع خطأ ${res.status}: ${msg}`, 'HTTP_ERROR', res.status, 'google');
  }
  return data;
}

const modelUrl = (model) => `https://${location()}-aiplatform.googleapis.com/v1/projects/${project()}/locations/${location()}/publishers/google/models/${model.endpoint}`;

const inline = async (ref) => ({ bytesBase64Encoded: (await toBuffer(ref)).toString('base64'), mimeType: mimeOf(ref) });

export async function buildRequest(model, p) {
  const instance = { prompt: p.prompt, image: await inline(p.imageUrl) };
  return {
    instances: [instance],
    parameters: {
      aspectRatio: p.aspectRatio,
      durationSeconds: p.seconds,
      generateAudio: Boolean(p.audio),
      resolution: '720p',
      personGeneration: 'allow_adult',
      sampleCount: 1,
      ...(p.negativePrompt ? { negativePrompt: p.negativePrompt } : {}),
    },
  };
}

export default {
  id: 'google',
  configured: () => Boolean(account() && project()),
  missing: () => [...(account() ? [] : ['GOOGLE_SERVICE_ACCOUNT_JSON']), ...(project() || !account() ? [] : ['GOOGLE_CLOUD_PROJECT'])],
  balance: async () => null, // Cloud billing is postpaid: the admin sets a budget by hand
  balanceOutSince: () => null,
  async submit(model, kind, params) {
    if (kind !== 'video') throw new EngineError('جوجل هنا للفيديو بس.', 'BAD_INPUT', null, 'google');
    const data = await call(`${modelUrl(model)}:predictLongRunning`, await buildRequest(model, params));
    if (!data?.name) throw new EngineError('جوجل ما رجّعش رقم العملية.', 'BAD_RESPONSE', null, 'google');
    return { requestId: data.name };
  },
  async poll(model, step) {
    const op = await call(`${modelUrl(model)}:fetchPredictOperation`, { operationName: step.requestId });
    if (!op?.done) return { state: 'RUNNING' };
    if (op.error) throw new EngineError(`المشهد فشل عند جوجل: ${op.error.message || op.error.code}`, 'FAILED', null, 'google');
    const video = op.response?.videos?.[0];
    if (video?.bytesBase64Encoded) return { state: 'COMPLETED', buffer: Buffer.from(video.bytesBase64Encoded, 'base64'), mime: video.mimeType || 'video/mp4' };
    if (video?.gcsUri || video?.uri) return { state: 'COMPLETED', url: video.uri || video.gcsUri };
    throw new EngineError(op.response?.raiMediaFilteredCount ? 'المحتوى اترفض من فلتر الأمان عند جوجل.' : 'جوجل خلّص من غير فيديو.', 'FAILED', null, 'google');
  },
};
