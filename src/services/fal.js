// fal.ai queue client. Video models take minutes, so we never hold a request
// open: submit() returns a request id + the status/response URLs fal gives
// back, and the worker polls those URLs on later ticks. The URLs are stored
// as returned (a model id with a sub-path, like fal-ai/veo3/fast/…, is polled
// under a different base path, so building them ourselves would be wrong).
import { env } from '../config.js';

const QUEUE_BASE = 'https://queue.fal.run';
const RUN_BASE = 'https://fal.run';
const TIMEOUT_MS = 60000;

export class FalError extends Error {
  constructor(message, code = 'FAL_ERROR', httpStatus = null) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// Tests swap this for a fake.
let fetchImpl = (...args) => fetch(...args);
export function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

async function call(method, url, body, timeoutMs = TIMEOUT_MS) {
  const key = env.falKey();
  if (!key) throw new FalError('مفتاح fal.ai مش متظبط (FAL_KEY).', 'NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Key ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new FalError(err.name === 'AbortError' ? 'fal.ai اتأخر في الرد.' : `تعذر الاتصال بـ fal.ai: ${err.message}`, 'UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  if (!res.ok) {
    const detail = data?.detail;
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ') : text.slice(0, 300);
    throw new FalError(`fal.ai رجّع خطأ ${res.status}: ${msg}`, 'HTTP_ERROR', res.status);
  }
  return data;
}

export async function submit(modelId, input) {
  const data = await call('POST', `${QUEUE_BASE}/${modelId}`, input);
  if (!data?.request_id) throw new FalError('fal.ai ما رجّعش request_id.', 'BAD_RESPONSE');
  return {
    requestId: data.request_id,
    statusUrl: data.status_url || `${QUEUE_BASE}/${modelId}/requests/${data.request_id}/status`,
    responseUrl: data.response_url || `${QUEUE_BASE}/${modelId}/requests/${data.request_id}`,
  };
}

/** Run a fast model (an LLM) and wait for its output in the same request. */
export async function run(modelId, input, timeoutMs = 120000) {
  return call('POST', `${RUN_BASE}/${modelId}`, input, timeoutMs);
}

/** 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' */
export async function status(statusUrl) {
  const data = await call('GET', statusUrl);
  return data?.status || 'UNKNOWN';
}

/** The model's output. A failed run surfaces here as an HTTP error from fal. */
export async function result(responseUrl) {
  return call('GET', responseUrl);
}

/** Pull the video URL out of a model output ({ video: { url } } on every model we use). */
export function videoUrlOf(output) {
  return output?.video?.url || output?.videos?.[0]?.url || output?.output?.video?.url || null;
}

/** Pull the first image URL out of an image model output ({ images: [{ url }] }). */
export function imageUrlOf(output) {
  return output?.images?.[0]?.url || output?.image?.url || null;
}

export async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new FalError(`تعذر تحميل الفيديو (${res.status}).`, 'DOWNLOAD_FAILED', res.status);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Input body for one scene's first frame: an image-edit model places the
 * product photo into a realistic scene, so the video starts from a real-looking
 * shot that already contains the exact product.
 */
export function keyframeInput({ prompt, imageUrl, aspectRatio }) {
  return { prompt, image_urls: [imageUrl], aspect_ratio: aspectRatio, resolution: '2K', output_format: 'jpeg', num_images: 1 };
}

/**
 * Input body for one clip. Veo models take `duration: "8s"` and make sound;
 * Kling-style models take a bare number of seconds. Anything else gets the
 * common fields only.
 */
export function clipInput(modelId, { prompt, imageUrl, aspectRatio, seconds, negativePrompt }) {
  if (/veo/i.test(modelId)) {
    return {
      prompt,
      image_url: imageUrl,
      aspect_ratio: aspectRatio,
      duration: `${seconds}s`,
      generate_audio: true,
      resolution: env.videoResolution(),
      ...(negativePrompt && /veo3\.1/i.test(modelId) ? { negative_prompt: negativePrompt } : {}),
    };
  }
  if (/kling/i.test(modelId)) {
    return { prompt, image_url: imageUrl, aspect_ratio: aspectRatio, duration: String(seconds >= 10 ? 10 : 5) };
  }
  return { prompt, image_url: imageUrl, aspect_ratio: aspectRatio };
}
