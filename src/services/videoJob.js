// The video pipeline. createVideo() stores the photo, charges one credit and
// returns at once; the worker tick then moves the job along:
//
//   QUEUED -> SCRIPTING -> GENERATING (N clips on fal, in parallel)
//          -> MERGING (fal joins the clips) -> STORING (copy to our storage)
//          -> COMPLETED
//
// Each tick does one short step per job and saves, so nothing waits on a
// minutes-long HTTP call and a restart picks up where it left off. Any
// failure ends in FAILED with the credit refunded.
import { prisma } from '../db.js';
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { applyCredits, refundVideo } from './credits.js';
import { parseDataUrl, putBuffer, getDataUrl, IMAGE_MIMES } from './storage.js';
import * as fal from './fal.js';
import { writeScript, scenePrompt, userScript, MAX_VOICE_WORDS } from './script.js';

export const TERMINAL = ['COMPLETED', 'FAILED'];
const MAX_CLIP_ATTEMPTS = 2;
const STYLES = ['UGC', 'CINEMATIC', 'SHOWCASE'];
const RATIOS = ['9:16', '16:9'];

const running = new Set();

function readInputs(body) {
  const productName = String(body.productName || '').trim();
  if (productName.length < 2) throw new AppError('اكتب اسم المنتج.');
  if (productName.length > 120) throw new AppError('اسم المنتج طويل جدًا.');
  return {
    productName,
    description: String(body.description || '').trim().slice(0, 1500) || null,
    offer: String(body.offer || '').trim().slice(0, 200) || null,
    style: STYLES.includes(body.style) ? body.style : 'UGC',
    aspectRatio: RATIOS.includes(body.aspectRatio) ? body.aspectRatio : '9:16',
    voiceGender: body.voiceGender === 'FEMALE' ? 'FEMALE' : 'MALE',
  };
}

function readImage(dataUrl) {
  const { mime, buffer } = parseDataUrl(dataUrl);
  if (!IMAGE_MIMES.includes(mime)) throw new AppError('الصورة لازم تكون JPG أو PNG أو WEBP.');
  if (buffer.length > env.maxImageBytes()) throw new AppError('الصورة كبيرة جدًا، صغّرها وجرب تاني.');
  return { mime, buffer, dataUrl };
}

/** Write the script for the customer to read and edit before paying a credit. */
export async function previewScript(body) {
  const inputs = readInputs(body);
  const image = readImage(body.image);
  const script = await writeScript({ ...inputs, clipCount: env.defaultClipCount(), imageDataUrl: image.dataUrl });
  return { ...script, maxWords: MAX_VOICE_WORDS, clipSeconds: env.clipSeconds() };
}

async function insertJob(userId, inputs, { imageKey, imageMime, script = null }) {
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.videoJob.create({
      data: {
        user_id: userId, product_name: inputs.productName, description: inputs.description, offer: inputs.offer,
        style: inputs.style, aspect_ratio: inputs.aspectRatio, voice_gender: inputs.voiceGender,
        clip_count: env.defaultClipCount(), clip_seconds: env.clipSeconds(),
        image_key: imageKey, image_mime: imageMime, model: env.videoModel(), charged: true,
        script_json: script ? JSON.stringify(script) : null,
      },
    });
    await applyCredits(tx, userId, -1, 'VIDEO', { ref: `video:${created.id}` });
    return created;
  });
  kick();
  return serialize(job);
}

export async function createVideo(userId, body) {
  if (!env.falKey()) throw new AppError('توليد الفيديو مش متاح دلوقتي. كلم الدعم.', 503, 'VIDEO_NOT_CONFIGURED');
  const inputs = readInputs(body);
  let script = null;
  if (body.script) {
    const checked = userScript(body.script, env.defaultClipCount());
    if (checked.error) throw new AppError(checked.error);
    script = checked.script;
  }
  const image = readImage(body.image);
  const stored = await putBuffer(image.buffer, image.mime, 'products');
  return insertJob(userId, inputs, { imageKey: stored.key, imageMime: image.mime, script });
}

/** Same photo and inputs, a new render. `sameScript` keeps the spoken lines. */
export async function remakeVideo(userId, sourceId, { sameScript = true } = {}) {
  if (!env.falKey()) throw new AppError('توليد الفيديو مش متاح دلوقتي. كلم الدعم.', 503, 'VIDEO_NOT_CONFIGURED');
  const src = await prisma.videoJob.findUnique({ where: { id: sourceId } });
  if (!src || src.user_id !== userId) throw new AppError('الفيديو مش موجود.', 404, 'NOT_FOUND');
  const inputs = { productName: src.product_name, description: src.description, offer: src.offer, style: src.style, aspectRatio: src.aspect_ratio, voiceGender: src.voice_gender };
  const script = sameScript ? parse(src.script_json) : null;
  return insertJob(userId, inputs, { imageKey: src.image_key, imageMime: src.image_mime, script: script?.scenes?.length === env.defaultClipCount() ? script : null });
}

export function serialize(job, { admin = false } = {}) {
  const script = parse(job.script_json);
  return {
    id: job.id,
    uuid: job.uuid,
    productName: job.product_name,
    description: job.description,
    offer: job.offer,
    style: job.style,
    aspectRatio: job.aspect_ratio,
    voiceGender: job.voice_gender,
    seconds: job.clip_count * job.clip_seconds,
    status: job.status,
    progress: job.progress,
    error: job.error,
    script: script ? { hook: script.hook, cta: script.cta, scenes: script.scenes.map((s) => ({ voiceover: s.voiceover })), source: script.source } : null,
    imageUrl: `/api/videos/${job.id}/image`,
    videoUrl: job.status === 'COMPLETED' ? `/api/videos/${job.id}/video` : null,
    refunded: job.refunded,
    showcase: job.showcase,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
    ...(admin ? { userId: job.user_id, model: job.model, clips: parse(job.clips_json), merge: parse(job.merge_json) } : {}),
  };
}

function parse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
let kicking = false;
export function kick() {
  if (process.env.VIMO_DISABLE_AUTOKICK === '1' || kicking) return;
  kicking = true;
  setImmediate(() => processDueJobs().catch((e) => console.error('[worker]', e)).finally(() => { kicking = false; }));
}

let timer = null;
export function startWorker() {
  if (timer) return;
  timer = setInterval(() => processDueJobs().catch((e) => console.error('[worker]', e)), env.workerTickMs());
  console.log(`[worker] video worker started (${env.workerTickMs()}ms tick)`);
}

export async function processDueJobs() {
  const jobs = await prisma.videoJob.findMany({ where: { status: { notIn: TERMINAL } }, orderBy: { created_at: 'asc' }, take: 20 });
  await Promise.all(jobs.map(async (job) => {
    if (running.has(job.id)) return;
    running.add(job.id);
    try { await advance(job); }
    catch (err) { await handleError(job, err); }
    finally { running.delete(job.id); }
  }));
}

async function save(job, data) {
  return prisma.videoJob.update({ where: { id: job.id }, data: { ...data, heartbeat_at: new Date() } });
}

async function fail(job, message) {
  await save(job, { status: 'FAILED', error: message, finished_at: new Date() });
  await refundVideo(job);
}

// Network blips and fal 5xx/429 are retried on the next tick; anything else
// (bad input, missing key) ends the job.
async function handleError(job, err) {
  const transient = err instanceof fal.FalError && (err.code === 'UNREACHABLE' || err.httpStatus === 429 || (err.httpStatus || 0) >= 500);
  if (transient) {
    console.warn(`[worker] job ${job.id}: transient error, retrying next tick:`, err.message);
    return;
  }
  console.error(`[worker] job ${job.id} failed:`, err.message);
  await fail(job, err instanceof fal.FalError || err instanceof AppError ? err.message : 'حصل خطأ أثناء إنشاء الفيديو.');
}

async function advance(job) {
  if (job.started_at && Date.now() - job.started_at.getTime() > env.jobTimeoutMin() * 60000) {
    return fail(job, `الفيديو أخد أكتر من ${env.jobTimeoutMin()} دقيقة واتلغى. الرصيد رجعلك.`);
  }
  switch (job.status) {
    case 'QUEUED':
    case 'SCRIPTING': return startJob(job);
    case 'GENERATING': return pollClips(job);
    case 'MERGING': return pollMerge(job);
    case 'STORING': return storeVideo(job);
    default: return undefined;
  }
}

async function startJob(job) {
  job = await save(job, { status: 'SCRIPTING', progress: 5, started_at: job.started_at || new Date() });
  const imageDataUrl = await getDataUrl(job.image_key);
  if (!imageDataUrl) return fail(job, 'صورة المنتج مش موجودة.');

  let script = parse(job.script_json);
  if (!script) {
    script = await writeScript({
      productName: job.product_name, description: job.description, offer: job.offer, style: job.style,
      voiceGender: job.voice_gender, clipCount: job.clip_count, imageDataUrl,
    });
  }
  const opts = { style: job.style, voiceGender: job.voice_gender, aspectRatio: job.aspect_ratio };
  const clips = script.scenes.map((scene, index) => ({ index, prompt: scenePrompt(scene, opts), status: 'PENDING', attempts: 0 }));
  job = await save(job, { script_json: JSON.stringify(script), clips_json: JSON.stringify(clips), status: 'GENERATING', progress: 10 });
  return pollClips(job, imageDataUrl);
}

async function submitClip(job, clip, imageDataUrl) {
  const input = fal.clipInput(job.model || env.videoModel(), {
    prompt: clip.prompt, imageUrl: imageDataUrl, aspectRatio: job.aspect_ratio, seconds: job.clip_seconds,
  });
  const sub = await fal.submit(job.model || env.videoModel(), input);
  Object.assign(clip, sub, { status: 'SUBMITTED', attempts: clip.attempts + 1, error: null });
}

async function pollClips(job, imageDataUrl = null) {
  const clips = parse(job.clips_json) || [];
  try {
    for (const clip of clips) {
      if (clip.status === 'COMPLETED') continue;
      if (clip.status === 'PENDING' || clip.status === 'RETRY') {
        imageDataUrl = imageDataUrl || await getDataUrl(job.image_key);
        await submitClip(job, clip, imageDataUrl);
        continue;
      }
      const st = await fal.status(clip.statusUrl);
      if (st !== 'COMPLETED') continue;
      try {
        const url = fal.videoUrlOf(await fal.result(clip.responseUrl));
        if (!url) throw new fal.FalError('fal.ai خلّص من غير ما يرجّع فيديو.', 'NO_VIDEO');
        Object.assign(clip, { status: 'COMPLETED', videoUrl: url });
      } catch (err) {
        if (!(err instanceof fal.FalError) || err.code === 'UNREACHABLE') throw err;
        clip.error = err.message;
        if (clip.attempts >= MAX_CLIP_ATTEMPTS) {
          await save(job, { clips_json: JSON.stringify(clips) });
          return fail(job, `فشل إنشاء المشهد ${clip.index + 1}: ${err.message}`);
        }
        clip.status = 'RETRY';
      }
    }
  } finally {
    // keep whatever was submitted/finished, even if a later clip threw
    const done = clips.filter((c) => c.status === 'COMPLETED').length;
    await save(job, { clips_json: JSON.stringify(clips), progress: 10 + Math.round((70 * done) / Math.max(1, clips.length)) });
  }

  if (!clips.length || !clips.every((c) => c.status === 'COMPLETED')) return undefined;
  if (clips.length === 1) return save(job, { status: 'STORING', progress: 90, provider_video_url: clips[0].videoUrl });

  const merge = await fal.submit(env.mergeModel(), { video_urls: clips.map((c) => c.videoUrl) });
  return save(job, { status: 'MERGING', progress: 82, merge_json: JSON.stringify({ ...merge, status: 'SUBMITTED', attempts: 1 }) });
}

async function pollMerge(job) {
  const merge = parse(job.merge_json);
  if (!merge?.statusUrl) return fail(job, 'بيانات دمج المقاطع ناقصة.');
  const st = await fal.status(merge.statusUrl);
  if (st !== 'COMPLETED') return undefined;
  try {
    const url = fal.videoUrlOf(await fal.result(merge.responseUrl));
    if (!url) throw new fal.FalError('الدمج خلص من غير فيديو.', 'NO_VIDEO');
    return save(job, { status: 'STORING', progress: 90, provider_video_url: url, merge_json: JSON.stringify({ ...merge, status: 'COMPLETED', videoUrl: url }) });
  } catch (err) {
    if (!(err instanceof fal.FalError) || err.code === 'UNREACHABLE') throw err;
    if ((merge.attempts || 1) >= MAX_CLIP_ATTEMPTS) return fail(job, `فشل دمج المقاطع: ${err.message}`);
    const clips = parse(job.clips_json) || [];
    const again = await fal.submit(env.mergeModel(), { video_urls: clips.map((c) => c.videoUrl) });
    return save(job, { merge_json: JSON.stringify({ ...again, status: 'SUBMITTED', attempts: (merge.attempts || 1) + 1, error: err.message }) });
  }
}

async function storeVideo(job) {
  const buffer = await fal.download(job.provider_video_url);
  const stored = await putBuffer(buffer, 'video/mp4', 'videos');
  return save(job, { status: 'COMPLETED', progress: 100, video_key: stored.key, video_bytes: stored.bytes, finished_at: new Date(), error: null });
}
