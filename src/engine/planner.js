// Picks how a video is made, once, when it is ordered: the video model, the
// production mode and the scene lengths. The rule is the cheapest compatible
// plan inside the admin's quality tier (provider priority breaks ties). The
// plan is stored on the job and never changes, so a job can never drift to a
// pricier engine; if the chosen engine can't run, the order is refused.
//
// Modes:
//   speech     clips made WITH sound; the speaker says the line on camera (lip-sync)
//   voiceover  silent clips (cheaper) + one TTS voiceover laid over the joined video
//   hybrid     ONE silent AI clip + the product's real photos with camera moves,
//              joined on our server (free) under the voiceover: the cheapest
import { env } from '../config.js';
import { MODELS } from './catalog.js';
import { effectiveModel, mockAllowed } from './settings.js';
import { adapters } from './providers/index.js';
import { ffmpegPath } from './compose.js';

export const TARGET_SECONDS = 24;
const SCRIPT_USD = 0.01; // one vision-LLM call for the script
const CHARS_PER_WORD = 6;

export const wordsPerSecond = (pace) => (pace === 'normal' ? 2.4 : 3);

/** Models the engine may use right now: enabled by the admin, with credentials set. */
export function availableModels(settings) {
  return MODELS
    .filter((m) => settings.providers[m.provider]?.enabled && adapters[m.provider].configured() && (m.provider !== 'mock' || mockAllowed()))
    .map((m) => effectiveModel(m, settings))
    .filter((m) => m.enabled);
}

/**
 * Scene lengths for a model: as close to the target as its clip durations
 * allow, preferring 3 scenes (hook, benefit, offer). Veo: 8+8+8.
 */
export function sceneSeconds(durations, target = TARGET_SECONDS) {
  let best = null;
  const walk = (prefix, count) => {
    if (prefix.length === count) {
      const sum = prefix.reduce((a, b) => a + b, 0);
      if (sum < target - 2) return;
      const score = Math.abs(sum - target) * 10 + Math.abs(count - 3) * 3;
      if (!best || score < best.score) best = { score, list: [...prefix].sort((a, b) => b - a) };
      return;
    }
    for (const d of durations) if (!prefix.length || d <= prefix[prefix.length - 1]) walk([...prefix, d], count);
  };
  for (let count = 2; count <= 5; count++) walk([], count);
  return best ? best.list : [Math.max(...durations)];
}

const cheapest = (models, kind, costOf) => models.filter((m) => m.kind === kind).sort((a, b) => costOf(a) - costOf(b))[0] || null;

// UGC is a person talking on camera: while any model in the tier can make
// speech, a cheaper silent model must not turn it into a voiceover.
function modesFor(style, model, tierHasSpeech) {
  if (style === 'SHOWCASE') return ['voiceover', 'hybrid'];
  if (style === 'AUTO') return model.audio ? ['speech', 'voiceover', 'hybrid'] : ['voiceover', 'hybrid'];
  if (tierHasSpeech) return model.audio ? ['speech'] : []; // UGC (and older CINEMATIC jobs)
  return ['voiceover'];
}

/** Hybrid: one AI clip as close to 8s as the model allows, the rest in photo scenes. */
export function hybridSeconds(durations, target = TARGET_SECONDS) {
  const clip = [...durations].sort((a, b) => Math.abs(a - 8) - Math.abs(b - 8) || a - b)[0];
  const rest = Math.max(4, target - clip);
  const first = Math.ceil(rest / 2);
  return [clip, first, rest - first];
}

/**
 * @returns {{ plan }|{ error }} error is for the admin log; the customer gets a generic message.
 */
export function planVideo({ style = 'AUTO', pace = 'fast', settings, preferReferences = env.videoMode() === 'ingredients', target = TARGET_SECONDS }) {
  const models = availableModels(settings);
  const tier = settings.tier;
  const videos = models.filter((m) => m.kind === 'video' && m.tier === tier);
  if (!videos.length) return { error: `مفيش موديل فيديو شغال في فئة ${tier}.` };

  const image = env.keyframeModel() ? cheapest(models, 'image', (m) => m.usdPerUnit) : null;
  const tts = cheapest(models, 'tts', (m) => m.usdPer1kChars);
  const merge = cheapest(models, 'merge', (m) => m.usdPerSecond.silent);
  const mux = cheapest(models, 'mux', (m) => m.usdPerSecond.silent);

  const options = [];
  const tierHasSpeech = videos.some((v) => v.audio);
  const hybridOn = settings.hybrid !== false && Boolean(ffmpegPath());
  for (const video of videos) {
    for (const mode of modesFor(style, video, tierHasSpeech)) {
      const hybrid = mode === 'hybrid';
      if (hybrid && (!hybridOn || !tts)) continue;
      const secs = hybrid ? hybridSeconds(video.durations, target) : sceneSeconds(video.durations, target);
      const total = secs.reduce((a, b) => a + b, 0);
      const aiSeconds = hybrid ? secs[0] : total;
      if (mode === 'voiceover' && (!tts || !mux)) continue;
      if (!hybrid && secs.length > 1 && !merge) continue;
      const lines = [];
      const add = (step, m, usd) => m && lines.push({ step, provider: m.provider, model: m.id, usd: Math.round(usd * 10000) / 10000 });
      add('video', video, aiSeconds * (mode === 'speech' ? video.usdPerSecond.audio : video.usdPerSecond.silent));
      add('image', image, (hybrid ? 1 : secs.length) * (image?.usdPerUnit || 0));
      if (mode !== 'speech') add('tts', tts, (total * wordsPerSecond(pace) * CHARS_PER_WORD / 1000) * tts.usdPer1kChars);
      if (mode === 'voiceover') add('mux', mux, total * mux.usdPerSecond.silent);
      if (!hybrid && secs.length > 1) add('merge', merge, total * merge.usdPerSecond.silent);
      const scriptProvider = env.openAiKey() ? null : models.some((m) => m.provider === 'fal') ? 'fal' : null;
      if (scriptProvider) lines.push({ step: 'script', provider: 'fal', model: 'fal:llm', usd: SCRIPT_USD });
      const byProvider = {};
      for (const l of lines) byProvider[l.provider] = Math.round(((byProvider[l.provider] || 0) + l.usd) * 10000) / 10000;
      const totalUsd = Math.round(lines.reduce((a, l) => a + l.usd, 0) * 10000) / 10000;
      options.push({
        tier, mode, provider: video.provider, sceneSeconds: secs, seconds: total, pace,
        models: { video: video.id, image: image?.id || null, tts: mode !== 'speech' ? tts.id : null, merge: !hybrid && secs.length > 1 ? merge.id : null, mux: mode === 'voiceover' ? mux.id : null },
        estimate: { totalUsd, byProvider, lines },
        _rank: [totalUsd, settings.providers[video.provider].priority, (video.input === 'references') === preferReferences ? 0 : 1, mode === 'speech' ? 0 : mode === 'voiceover' ? 1 : 2, MODELS.findIndex((m) => m.id === video.id)],
      });
    }
  }
  if (!options.length) return { error: `مفيش طريقة إنتاج متاحة لأسلوب ${style} في فئة ${tier} (ناقص صوت أو دمج).` };
  options.sort((a, b) => { for (let i = 0; i < a._rank.length; i++) if (a._rank[i] !== b._rank[i]) return a._rank[i] - b._rank[i]; return 0; });
  const { _rank, ...plan } = options[0];
  return { plan };
}
