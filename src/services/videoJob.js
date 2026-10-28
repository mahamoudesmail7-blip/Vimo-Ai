// The video pipeline. createVideo() plans the video (engine/planner.js),
// checks the spending limits and the provider balance, stores the photos,
// charges one credit and returns at once; the worker tick then moves the job:
//
//   QUEUED -> SCRIPTING -> GENERATING (per scene, in parallel: a realistic
//          first frame with the exact product, then the clip from that frame;
//          plus the voiceover in voiceover mode)
//          -> MERGING (join the clips) | COMPOSING (hybrid: AI clip + photo
//          scenes joined on our server) -> MIXING (voiceover mode: lay the
//          voice over the video) -> STORING (copy to our storage) -> COMPLETED
//
// The plan (provider, models, scene lengths) is fixed at order time. Each tick
// does one short step per job and saves, so nothing waits on a minutes-long
// HTTP call and a restart picks up where it left off. Any failure ends in
// FAILED with the credit refunded.
import { prisma } from '../db.js';
import { env } from '../config.js';
import { AppError } from '../errors.js';
import { applyCredits, refundVideo } from './credits.js';
import { parseDataUrl, putBuffer, getDataUrl, IMAGE_MIMES } from './storage.js';
import { writeScript, scenePrompt, keyframePrompt, userScript, wordsFor, GOALS, NEGATIVE_PROMPT } from './script.js';
import { planVideo, checkBudget, loadSettings, submitStep, pollStep } from '../engine/index.js';
import { modelByEndpoint } from '../engine/catalog.js';
import { recordEvent } from '../engine/budget.js';
import { EngineError, isTransient } from '../engine/errors.js';
import { toBuffer } from '../engine/media.js';
import { composeHybrid, ffmpegPath } from '../engine/compose.js';
import { captionCues, toAss, burnCaptions } from '../engine/captions.js';
import { speakNumbers } from './numbers.js';
import { checkClip, passes, STT_MODEL, STT_USD } from '../engine/speechCheck.js';

export const TERMINAL = ['COMPLETED', 'FAILED'];
const MAX_CLIP_ATTEMPTS = 2;
const MAX_IMAGES = 4;
const SERVICE_PAUSED = 'الخدمة متوقفة مؤقتًا من عندنا، والرصيد رجعلك. جرب تاني كمان شوية.';
const UNAVAILABLE = 'إنشاء الفيديو مش متاح دلوقتي. جرب تاني كمان شوية أو كلم الدعم.';
const STYLES = ['AUTO', 'UGC', 'STUDIO', 'SHOWCASE', 'CINEMATIC'];
const RATIOS = ['9:16', '16:9'];

const running = new Set();

function readInputs(body) {
  const description = String(body.description || '').trim().slice(0, 1500) || null;
  // The product name is optional now: the first words of the description stand in.
  let productName = String(body.productName || '').trim();
  if (!productName && description) productName = description.split(/[.\n،,!؟?]/)[0].split(/\s+/).slice(0, 5).join(' ');
  if (productName.length < 2) throw new AppError('اكتب وصف قصير للمنتج.');
  if (productName.length > 120) throw new AppError('اسم المنتج طويل جدًا.');
  return {
    productName,
    description,
    offer: String(body.offer || '').trim().slice(0, 200) || null,
    style: STYLES.includes(body.style) ? body.style : 'AUTO',
    aspectRatio: RATIOS.includes(body.aspectRatio) ? body.aspectRatio : '9:16',
    voiceGender: body.voiceGender === 'FEMALE' ? 'FEMALE' : 'MALE',
    options: { music: body.music === 'light' ? 'light' : 'none', pace: body.pace === 'fast' ? 'fast' : 'normal', goal: GOALS.includes(body.goal) ? body.goal : 'SALES' },
  };
}

function readImage(dataUrl) {
  const { mime, buffer } = parseDataUrl(dataUrl);
  if (!IMAGE_MIMES.includes(mime)) throw new AppError('الصورة لازم تكون JPG أو PNG أو WEBP.');
  if (buffer.length > env.maxImageBytes()) throw new AppError('الصورة كبيرة جدًا، صغّرها وجرب تاني.');
  return { mime, buffer, dataUrl };
}

/** `images: [dataUrl, ...]` (the first is the main photo), or the older single `image`. */
function readImages(body) {
  const list = Array.isArray(body.images) && body.images.length ? body.images : body.image ? [body.image] : [];
  if (!list.length) throw new AppError('ارفع صورة المنتج.');
  if (list.length > MAX_IMAGES) throw new AppError(`أقصى عدد ${MAX_IMAGES} صور.`);
  return list.map(readImage);
}

// The customer sees one generic message; the admin sees the reason on the AI Engines page.
async function planOrRefuse(inputs) {
  const settings = await loadSettings();
  const { plan, error } = planVideo({ style: inputs.style, pace: inputs.options.pace, settings });
  if (!plan) {
    await recordEvent({ provider: 'engine', kind: 'REFUSED', message: error });
    throw new AppError(UNAVAILABLE, 503, 'VIDEO_NOT_CONFIGURED');
  }
  return { plan, settings };
}

/** What the customer sees before ordering: the credit price and whether it can run now. */
export async function quote() {
  const settings = await loadSettings();
  const { plan } = planVideo({ style: 'AUTO', settings });
  return { credits: 1, seconds: plan?.seconds || env.clipSeconds() * env.defaultClipCount(), available: Boolean(plan) };
}

/**
 * «تلقائي» picks the cheapest production, except a customer's first video:
 * that one is made in the studio look, so the first result is the best one.
 */
async function resolveStyle(userId, inputs) {
  if (inputs.style !== 'AUTO' || !userId) return inputs;
  const made = await prisma.videoJob.count({ where: { user_id: userId, status: 'COMPLETED' } });
  return made ? inputs : { ...inputs, style: 'STUDIO' };
}

/** Write the script for the customer to read and edit before paying a credit. */
export async function previewScript(body, userId = null) {
  const inputs = await resolveStyle(userId, readInputs(body));
  const images = readImages(body);
  const settings = await loadSettings();
  const { plan } = planVideo({ style: inputs.style, pace: inputs.options.pace, settings });
  const sceneSeconds = plan?.sceneSeconds || Array(env.defaultClipCount()).fill(env.clipSeconds());
  const script = await writeScript({ ...inputs, clipCount: sceneSeconds.length, sceneSeconds, pace: inputs.options.pace, goal: inputs.options.goal, mode: plan?.mode, imageDataUrl: images.map((i) => i.dataUrl) });
  return { ...script, maxWords: wordsFor(Math.max(...sceneSeconds), inputs.options.pace), sceneSeconds, clipSeconds: sceneSeconds[0] };
}

async function insertJob(userId, inputs, { imageKey, imageMime, extraImageKeys = [], script = null, plan, settings, clientRef = null }) {
  const job = await prisma.$transaction(async (tx) => {
    // One order at a time passes the budget check, so two clicks can't both spend the last dollars.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(7710301)');
    const budget = await checkBudget(plan, settings);
    if (!budget.ok) {
      await recordEvent({ provider: budget.provider || 'engine', kind: 'REFUSED', usd: plan.estimate.totalUsd, message: budget.reason });
      throw new AppError(UNAVAILABLE, 503, 'ENGINE_BUDGET');
    }
    const created = await tx.videoJob.create({
      data: {
        user_id: userId, product_name: inputs.productName, description: inputs.description, offer: inputs.offer,
        style: inputs.style, aspect_ratio: inputs.aspectRatio, voice_gender: inputs.voiceGender,
        clip_count: plan.sceneSeconds.length, clip_seconds: plan.sceneSeconds[0],
        image_key: imageKey, image_mime: imageMime, extra_image_keys: extraImageKeys.length ? JSON.stringify(extraImageKeys) : null,
        model: plan.models.video, provider: plan.provider, plan_json: JSON.stringify(plan), options_json: JSON.stringify(inputs.options),
        cost_estimate_usd: plan.estimate.totalUsd, client_ref: clientRef, charged: true,
        script_json: script ? JSON.stringify(script) : null,
      },
    });
    await applyCredits(tx, userId, -1, 'VIDEO', { ref: `video:${created.id}` });
    return created;
  }, { timeout: 20000 });
  kick();
  return serialize(job);
}

function readClientRef(v) {
  const ref = String(v || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(ref) ? ref : null;
}

export async function createVideo(userId, body) {
  // The same click sent twice (double tap, retry after a timeout) returns the first order.
  const ref = readClientRef(body.clientRef);
  const clientRef = ref ? `u${userId}:${ref}` : null;
  if (clientRef) {
    const existing = await prisma.videoJob.findUnique({ where: { client_ref: clientRef } });
    if (existing) return serialize(existing);
  }
  const inputs = await resolveStyle(userId, readInputs(body));
  const { plan, settings } = await planOrRefuse(inputs);
  let script = null;
  if (body.script) {
    const checked = userScript(body.script, plan.sceneSeconds.length, { sceneSeconds: plan.sceneSeconds, pace: inputs.options.pace });
    if (checked.error) throw new AppError(checked.error);
    script = checked.script;
  }
  const images = readImages(body);
  const stored = [];
  for (const img of images) stored.push(await putBuffer(img.buffer, img.mime, 'products'));
  try {
    return await insertJob(userId, inputs, { imageKey: stored[0].key, imageMime: images[0].mime, extraImageKeys: stored.slice(1).map((s) => s.key), script, plan, settings, clientRef });
  } catch (err) {
    if (err?.code === 'P2002' && clientRef) {
      const existing = await prisma.videoJob.findUnique({ where: { client_ref: clientRef } });
      if (existing) return serialize(existing);
    }
    throw err;
  }
}

/** Same photos and inputs, a new render. `sameScript` keeps the spoken lines. */
export async function remakeVideo(userId, sourceId, { sameScript = true } = {}) {
  const src = await prisma.videoJob.findUnique({ where: { id: sourceId } });
  if (!src || src.user_id !== userId) throw new AppError('الفيديو مش موجود.', 404, 'NOT_FOUND');
  const options = parse(src.options_json) || { music: 'none', pace: 'fast' };
  const inputs = { productName: src.product_name, description: src.description, offer: src.offer, style: src.style, aspectRatio: src.aspect_ratio, voiceGender: src.voice_gender, options };
  const { plan, settings } = await planOrRefuse(inputs);
  const script = sameScript ? parse(src.script_json) : null;
  return insertJob(userId, inputs, {
    imageKey: src.image_key, imageMime: src.image_mime, extraImageKeys: parse(src.extra_image_keys) || [], plan, settings,
    script: script?.scenes?.length === plan.sceneSeconds.length ? script : null,
  });
}

export function serialize(job, { admin = false } = {}) {
  const script = parse(job.script_json);
  const plan = parse(job.plan_json);
  return {
    id: job.id,
    uuid: job.uuid,
    productName: job.product_name,
    description: job.description,
    offer: job.offer,
    style: job.style,
    aspectRatio: job.aspect_ratio,
    voiceGender: job.voice_gender,
    seconds: plan?.seconds || job.clip_count * job.clip_seconds,
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
    ...(admin ? {
      userId: job.user_id, model: job.model, provider: job.provider, plan, costEstimateUsd: job.cost_estimate_usd, costActualUsd: job.cost_actual_usd,
      clips: parse(job.clips_json), merge: parse(job.merge_json), audio: parse(job.audio_json),
    } : {}),
  };
}

function parse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/** Jobs created before the engine stored a bare fal endpoint; give them the plan they ran with. */
function planOf(job) {
  const plan = parse(job.plan_json);
  if (plan) return plan;
  const video = modelByEndpoint(job.model || env.videoModel())?.id || 'fal:veo31-fast';
  return {
    tier: 'standard', mode: 'speech', provider: 'fal', pace: 'fast', sceneSeconds: Array(job.clip_count).fill(job.clip_seconds), seconds: job.clip_count * job.clip_seconds,
    models: { video, image: env.keyframeModel() ? 'fal:nano-banana-pro' : null, tts: null, merge: job.clip_count > 1 ? 'fal:merge-videos' : null, mux: null },
    estimate: { totalUsd: 0, byProvider: {}, lines: [] },
  };
}

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

// Network blips and provider 5xx/429 are retried on the next tick; anything
// else (bad input, missing key, no balance) ends the job.
async function handleError(job, err) {
  if (isTransient(err)) {
    console.warn(`[worker] job ${job.id}: transient error, retrying next tick:`, err.message);
    return;
  }
  console.error(`[worker] job ${job.id} failed:`, err.message);
  await recordEvent({ jobId: job.id, provider: err.provider || job.provider || 'engine', model: job.model, kind: 'ERROR', message: err.message });
  // The customer never sees provider billing details; the admin gets a banner.
  if (err instanceof EngineError && err.code === 'NO_BALANCE') return fail(job, SERVICE_PAUSED);
  await fail(job, err instanceof EngineError || err instanceof AppError ? err.message : 'حصل خطأ أثناء إنشاء الفيديو.');
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
    case 'MIXING': return pollMix(job);
    case 'COMPOSING': return composeJob(job);
    case 'STORING': return storeVideo(job);
    default: return undefined;
  }
}

async function productImages(job) {
  const keys = [job.image_key, ...(parse(job.extra_image_keys) || [])];
  const urls = [];
  for (const k of keys) { const u = await getDataUrl(k); if (u) urls.push(u); }
  return urls;
}

async function startJob(job) {
  job = await save(job, { status: 'SCRIPTING', progress: 5, started_at: job.started_at || new Date() });
  const images = await productImages(job);
  if (!images.length) return fail(job, 'صورة المنتج مش موجودة.');
  const plan = planOf(job);
  const options = parse(job.options_json) || { music: 'none', pace: 'fast' };

  let script = parse(job.script_json);
  if (!script) {
    script = await writeScript({
      productName: job.product_name, description: job.description, offer: job.offer, style: job.style,
      voiceGender: job.voice_gender, clipCount: plan.sceneSeconds.length, sceneSeconds: plan.sceneSeconds, pace: options.pace, goal: options.goal, mode: plan.mode, imageDataUrl: images, // every photo: colors and variants show up in the script
    });
    const scriptLine = plan.estimate.lines.find((l) => l.step === 'script');
    if (script.source === 'AI' && scriptLine) {
      await recordEvent({ jobId: job.id, provider: scriptLine.provider, model: scriptLine.model, kind: 'CHARGE', usd: scriptLine.usd });
      await prisma.videoJob.update({ where: { id: job.id }, data: { cost_actual_usd: { increment: scriptLine.usd } } });
    }
  }
  const videoModel = plan.models.video;
  const withScene = /ref/.test(videoModel);
  const hybrid = plan.mode === 'hybrid';
  const opts = { style: job.style, voiceGender: job.voice_gender, aspectRatio: job.aspect_ratio, product: script.product, withScene, mode: hybrid ? 'voiceover' : plan.mode, music: options.music, pace: options.pace };
  const withFrames = Boolean(plan.models.image);
  // Hybrid: only the first scene is an AI clip; the others are photo scenes rendered at the end.
  const clips = script.scenes.map((scene, index) => (hybrid && index > 0 ? { key: `photo${index}`, index, kind: 'photo', seconds: plan.sceneSeconds[index], status: 'COMPLETED' } : {
    key: `clip${index}`,
    index,
    seconds: plan.sceneSeconds[index] || plan.sceneSeconds[0],
    prompt: scenePrompt(scene, opts),
    ...(withFrames ? { frame: { key: `frame${index}`, prompt: keyframePrompt(scene, opts), status: 'PENDING', attempts: 0 } } : {}),
    status: withFrames ? 'WAITING_FRAME' : 'PENDING',
    attempts: 0,
  }));
  const audio = plan.mode !== 'speech'
    ? { tts: { key: 'tts', text: speakNumbers(script.scenes.map(spokenLine).join(' ... ')), status: 'PENDING', attempts: 0 } }
    : null;
  job = await save(job, { script_json: JSON.stringify(script), clips_json: JSON.stringify(clips), audio_json: audio ? JSON.stringify(audio) : null, status: 'GENERATING', progress: 10 });
  return pollClips(job, images);
}

// Steps saved before the engine existed were all on fal and kept `videoUrl`.
function legacyStep(step, modelId) {
  if (step && !step.model && step.statusUrl) Object.assign(step, { provider: 'fal', model: modelId, url: step.url || step.videoUrl, usd: 0, charged: true });
  return step;
}

// Poll one submitted step. A provider-reported failure is retried once (the
// provider does not bill a failed request); then the step has FAILED.
async function settle(job, step, label) {
  try {
    return await pollStep(job, step);
  } catch (err) {
    if (!(err instanceof EngineError) || isTransient(err)) throw err;
    step.error = err.message;
    await recordEvent({ jobId: job.id, provider: step.provider, model: step.model, kind: 'ERROR', message: `${label}: ${err.message}` });
    if (step.attempts >= MAX_CLIP_ATTEMPTS) { step.status = 'FAILED'; return 'FAILED'; }
    step.status = 'RETRY';
    return 'RETRY';
  }
}

const CONTINUITY = 'The LAST reference image is the first frame of this same video: keep the very same person (face, hair, age, outfit) and the very same place and lighting, only the shot changes. The other reference images show the product.';

async function submitClip(job, plan, clip, images) {
  const refs = [clip.frame?.url, ...images].filter(Boolean);
  await submitStep(job, clip, plan.models.video, 'video', {
    prompt: clip.prompt, imageUrl: clip.frame?.url || images[0], referenceUrls: refs,
    aspectRatio: job.aspect_ratio, seconds: clip.seconds, negativePrompt: NEGATIVE_PROMPT, audio: plan.mode === 'speech',
  }, { seconds: clip.seconds, audio: plan.mode === 'speech' });
}

// The first frame of a scene. If the image model fails twice, the clip starts
// from the plain product photo instead of failing the whole video.
// Scenes after the first wait for scene 1's frame and use it as a reference,
// so the whole ad keeps one person, one outfit and one place.
async function advanceFrame(job, plan, clip, images, clips = []) {
  const frame = clip.frame;
  if (frame.status === 'PENDING' || frame.status === 'RETRY') {
    const first = clip.index > 0 ? clips.find((c) => c.index === 0)?.frame : null;
    if (first && !['COMPLETED', 'SKIPPED', 'FAILED'].includes(first.status)) return;
    const anchor = first?.status === 'COMPLETED' && first.url ? first.url : null;
    const prompt = anchor ? `${frame.prompt} ${CONTINUITY}` : frame.prompt;
    await submitStep(job, frame, plan.models.image, 'image', { prompt, imageUrls: anchor ? [...images, anchor] : images, aspectRatio: job.aspect_ratio });
    return;
  }
  const st = await settle(job, frame, `أول فريم للمشهد ${clip.index + 1}`);
  if (st === 'COMPLETED') clip.status = 'PENDING';
  if (st === 'FAILED') {
    console.warn(`[worker] job ${job.id} scene ${clip.index + 1}: first frame failed, using the product photo:`, frame.error);
    frame.status = 'SKIPPED';
    clip.status = 'PENDING';
  }
}

// The words a talking clip should say (with pronunciation marks when the proofread added them).
const spokenLine = (scene) => scene?.spoken || scene?.voiceover || '';

/**
 * Listens to a finished talking clip. A garbled or cut-off take is made again
 * once (same first frame, so the same person); then the better take is kept.
 */
async function listenToClip(job, clip, scene) {
  const r = await checkClip(clip.url, scene.voiceover);
  if (!r) { clip.speech = { checked: false }; return; }
  await recordEvent({ jobId: job.id, provider: 'fal', model: STT_MODEL, kind: 'CHARGE', usd: STT_USD });
  await prisma.videoJob.update({ where: { id: job.id }, data: { cost_actual_usd: { increment: STT_USD } } });
  clip.takes = [...(clip.takes || []), { url: clip.url, score: r.score, ending: r.ending, heard: r.heard }];
  if (!passes(r) && clip.takes.length < 2) {
    await recordEvent({ jobId: job.id, provider: 'engine', kind: 'ERROR', message: `المشهد ${clip.index + 1}: الكلام مش مظبوط (${Math.round(r.score * 100)}%)، بنعيده مرة. اتسمع: ${r.heard}` });
    if (!/Say every word slowly/.test(clip.prompt)) clip.prompt += ' Say every word slowly and clearly, exactly as written.';
    clip.status = 'PENDING';
    return;
  }
  keepBestTake(clip);
}

function keepBestTake(clip) {
  const rank = (t) => t.score + (t.ending ? 0.2 : 0);
  const best = clip.takes.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  Object.assign(clip, { url: best.url, status: 'COMPLETED', speech: { checked: true, score: best.score, ending: best.ending, takes: clip.takes.length } });
}

async function pollClips(job, images = null) {
  const plan = planOf(job);
  const script = parse(job.script_json);
  const listen = plan.mode === 'speech' && Boolean(env.falKey()) && (await loadSettings()).speechCheck !== false;
  const clips = parse(job.clips_json) || [];
  const audio = parse(job.audio_json);
  const loadImages = async () => (images = images || await productImages(job));
  let failed = null;
  try {
    for (const clip of clips) {
      legacyStep(clip, plan.models.video);
      legacyStep(clip.frame, plan.models.image);
      if (clip.status === 'COMPLETED') continue;
      if (clip.status === 'WAITING_FRAME') {
        await advanceFrame(job, plan, clip, await loadImages(), clips);
        if (clip.status !== 'PENDING') continue;
      }
      if (clip.status === 'PENDING' || clip.status === 'RETRY') {
        await submitClip(job, plan, clip, await loadImages());
        continue;
      }
      const st = await settle(job, clip, `المشهد ${clip.index + 1}`);
      if (st === 'FAILED' && clip.takes?.length) { keepBestTake(clip); continue; } // the re-take failed: keep the first one
      if (st === 'FAILED') { failed = `فشل إنشاء المشهد ${clip.index + 1}: ${clip.error}`; break; }
      if (st === 'COMPLETED' && listen && clip.provider === 'fal' && !clip.speech && script?.scenes?.[clip.index]) await listenToClip(job, clip, script.scenes[clip.index]);
    }
    const tts = audio?.tts;
    if (!failed && tts && tts.status !== 'COMPLETED') {
      if (tts.status === 'PENDING' || tts.status === 'RETRY') {
        await submitStep(job, tts, plan.models.tts, 'tts', { text: tts.text, voiceGender: job.voice_gender }, { chars: tts.text.length });
      } else if (await settle(job, tts, 'التعليق الصوتي') === 'FAILED') failed = `فشل التعليق الصوتي: ${tts.error}`;
    }
  } finally {
    // keep whatever was submitted/finished, even if a later step threw.
    // Progress: a first frame counts as a quarter of its scene.
    const done = clips.reduce((n, c) => n + (c.status === 'COMPLETED' ? 1 : c.frame && c.status !== 'WAITING_FRAME' ? 0.25 : 0), 0);
    job = await save(job, { clips_json: JSON.stringify(clips), ...(audio ? { audio_json: JSON.stringify(audio) } : {}), progress: 10 + Math.round((70 * done) / Math.max(1, clips.length)) });
  }
  if (failed) return fail(job, failed);

  if (!clips.length || !clips.every((c) => c.status === 'COMPLETED')) return undefined;
  if (audio?.tts && audio.tts.status !== 'COMPLETED') return undefined;
  if (plan.mode === 'hybrid') {
    job = await save(job, { status: 'COMPOSING', progress: 85 });
    return composeJob(job);
  }
  if (clips.length === 1) return afterMerge(job, plan, clips[0].url);

  const merge = { key: 'merge' };
  await submitStep(job, merge, plan.models.merge, 'merge', { videoUrls: clips.map((c) => c.url) }, { seconds: plan.seconds });
  return save(job, { status: 'MERGING', progress: 82, merge_json: JSON.stringify(merge) });
}

async function pollMerge(job) {
  const plan = planOf(job);
  const merge = legacyStep(parse(job.merge_json), plan.models.merge);
  if (!merge?.status) return fail(job, 'بيانات دمج المقاطع ناقصة.');
  if (merge.status === 'RETRY') {
    const clips = parse(job.clips_json) || [];
    await submitStep(job, merge, plan.models.merge, 'merge', { videoUrls: clips.map((c) => c.url) }, { seconds: plan.seconds });
    return save(job, { merge_json: JSON.stringify(merge) });
  }
  const st = await settle(job, merge, 'دمج المقاطع');
  await save(job, { merge_json: JSON.stringify(merge) });
  if (st === 'FAILED') return fail(job, `فشل دمج المقاطع: ${merge.error}`);
  if (st !== 'COMPLETED') return undefined;
  return afterMerge(job, plan, merge.url);
}

async function afterMerge(job, plan, videoUrl) {
  const audio = parse(job.audio_json);
  if (plan.mode !== 'voiceover' || !audio?.tts?.url) return save(job, { status: 'STORING', progress: 90, provider_video_url: videoUrl });
  audio.mux = { key: 'mux', videoUrl };
  await submitStep(job, audio.mux, plan.models.mux, 'mux', { videoUrl, audioUrl: audio.tts.url }, { seconds: plan.seconds });
  return save(job, { status: 'MIXING', progress: 86, audio_json: JSON.stringify(audio) });
}

async function pollMix(job) {
  const plan = planOf(job);
  const audio = parse(job.audio_json);
  const mux = audio?.mux;
  if (!mux) return fail(job, 'بيانات تركيب الصوت ناقصة.');
  if (mux.status === 'RETRY') {
    await submitStep(job, mux, plan.models.mux, 'mux', { videoUrl: mux.videoUrl, audioUrl: audio.tts.url }, { seconds: plan.seconds });
    return save(job, { audio_json: JSON.stringify(audio) });
  }
  const st = await settle(job, mux, 'تركيب الصوت');
  await save(job, { audio_json: JSON.stringify(audio) });
  if (st === 'FAILED') return fail(job, `فشل تركيب الصوت: ${mux.error}`);
  if (st !== 'COMPLETED') return undefined;
  return save(job, { status: 'STORING', progress: 92, provider_video_url: mux.url });
}

async function storeVideo(job) {
  const ref = job.provider_video_url;
  // A video already in our storage (Google returns bytes) is kept as is.
  if (ref.startsWith('blob:videos/')) {
    const blob = await prisma.blob.findUnique({ where: { key: ref.slice(5) }, select: { bytes: true } });
    return save(job, { status: 'COMPLETED', progress: 100, video_key: ref.slice(5), video_bytes: blob?.bytes || null, finished_at: new Date(), error: null });
  }
  const stored = await putBuffer(await withCaptions(job, await toBuffer(ref)), 'video/mp4', 'videos');
  return save(job, { status: 'COMPLETED', progress: 100, video_key: stored.key, video_bytes: stored.bytes, finished_at: new Date(), error: null });
}

// The spoken line on screen (and the offer badge). Free, done here; if it
// fails the video is kept without captions rather than failing the order.
async function withCaptions(job, buffer) {
  try {
    if ((await loadSettings()).captions === false || !ffmpegPath()) return buffer;
    const plan = planOf(job);
    const scenes = parse(job.script_json)?.scenes;
    if (!scenes?.length) return buffer;
    const cues = captionCues({ scenes, sceneSeconds: plan.sceneSeconds, mode: plan.mode, offer: job.offer });
    return await burnCaptions(buffer, toAss(cues, job.aspect_ratio), { punches: cues.punches, aspectRatio: job.aspect_ratio });
  } catch (err) {
    console.warn(`[worker] job ${job.id}: captions skipped:`, err.message);
    return buffer;
  }
}

// Hybrid: the AI clip, then the real product photos (and the AI first frame)
// with camera moves, under the voiceover. Rendered here, so it costs nothing.
async function composeJob(job) {
  const clips = parse(job.clips_json) || [];
  const audio = parse(job.audio_json);
  const ai = clips.find((c) => c.kind !== 'photo');
  if (!ai?.url) return fail(job, 'المشهد الأساسي ناقص.');
  const photos = [...await productImages(job), ...(ai.frame?.status === 'COMPLETED' && ai.frame.url ? [ai.frame.url] : [])];
  const buffer = await composeHybrid({
    clipUrl: ai.url, clipSeconds: ai.seconds, photos,
    photoSeconds: clips.filter((c) => c.kind === 'photo').map((c) => c.seconds),
    audioUrl: audio?.tts?.url || null, aspectRatio: job.aspect_ratio,
  });
  const stored = await putBuffer(await withCaptions(job, buffer), 'video/mp4', 'videos');
  return save(job, { status: 'COMPLETED', progress: 100, video_key: stored.key, video_bytes: stored.bytes, finished_at: new Date(), error: null });
}
