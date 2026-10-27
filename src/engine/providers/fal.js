// fal.ai adapter over the existing queue client (services/fal.js).
import { env } from '../../config.js';
import * as fal from '../../services/fal.js';
import { toBuffer, toFetchable, mimeOf } from '../media.js';
import { EngineError } from '../errors.js';

const VOICES = { FEMALE: () => process.env.VIMO_TTS_VOICE_FEMALE || 'Rachel', MALE: () => process.env.VIMO_TTS_VOICE_MALE || 'Adam' };

// fal takes images inline as data URIs; videos and audio need a URL.
async function image(ref) {
  if (ref.startsWith('blob:')) return `data:${mimeOf(ref)};base64,${(await toBuffer(ref)).toString('base64')}`;
  if (ref.startsWith('mock:')) throw new EngineError('ملف تجريبي مينفعش يتبعت لـ fal.', 'BAD_INPUT');
  return ref;
}

export async function buildInput(model, kind, p) {
  if (kind === 'image') {
    return { ...fal.keyframeInput({ prompt: p.prompt, imageUrl: '', aspectRatio: p.aspectRatio }), image_urls: await Promise.all(p.imageUrls.map(image)) };
  }
  if (kind === 'video') {
    const base = { prompt: p.prompt, aspect_ratio: p.aspectRatio, duration: `${p.seconds}s`, generate_audio: Boolean(p.audio), resolution: env.videoResolution() };
    if (model.input === 'references') return { ...base, image_urls: await Promise.all(p.referenceUrls.slice(0, model.maxRefs || 3).map(image)) };
    return { ...base, image_url: await image(p.imageUrl), ...(model.negativePrompt && p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}) };
  }
  if (kind === 'tts') return { text: p.text, voice: (VOICES[p.voiceGender] || VOICES.MALE)(), stability: 0.5, language_code: 'ar' };
  if (kind === 'merge') return { video_urls: p.videoUrls.map(toFetchable) };
  if (kind === 'mux') return { video_url: toFetchable(p.videoUrl), audio_url: toFetchable(p.audioUrl) };
  throw new EngineError(`نوع خطوة غير معروف: ${kind}`, 'BAD_INPUT');
}

export default {
  id: 'fal',
  configured: () => Boolean(env.falKey()),
  missing: () => (env.falKey() ? [] : ['FAL_KEY']),
  balance: () => fal.accountBalance(),
  balanceOutSince: () => fal.falBalanceOut(),
  async submit(model, kind, params) {
    return fal.submit(model.endpoint, await buildInput(model, kind, params));
  },
  async poll(model, step) {
    if (await fal.status(step.statusUrl) !== 'COMPLETED') return { state: 'RUNNING' };
    const out = await fal.result(step.responseUrl);
    const url = model.kind === 'image' ? fal.imageUrlOf(out) : model.kind === 'tts' ? (out?.audio?.url || out?.audio_url || null) : fal.videoUrlOf(out);
    if (!url) throw new fal.FalError('fal.ai خلّص من غير ما يرجّع ملف.', 'NO_OUTPUT');
    return { state: 'COMPLETED', url };
  },
};
