// Vimo AI — every setting comes from an environment variable with a safe
// default. Secrets are read here and nowhere is one ever sent to the browser:
// publicConfig() reports booleans and non-secret values only.

function clean(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).split('\n')[0].trim();
}
function num(raw, dflt) {
  const c = clean(raw);
  if (c === '') return dflt;
  const v = Number(c);
  return Number.isFinite(v) ? v : dflt;
}

export const env = {
  port: () => num(process.env.PORT, 3000),
  isProd: () => clean(process.env.NODE_ENV) === 'production',
  jwtSecret: () => clean(process.env.JWT_SECRET) || (clean(process.env.NODE_ENV) === 'production' ? '' : 'dev-only-secret-change-me'),
  falKey: () => clean(process.env.FAL_KEY),
  openAiKey: () => clean(process.env.OPENAI_API_KEY),
  openAiModel: () => clean(process.env.OPENAI_MODEL) || 'gpt-4o-mini',
  // fal model ids. Each scene: an image-edit model puts the exact product into a
  // realistic first frame, then Veo 3.1 Fast animates it into an 8-second clip
  // WITH sound and speech (3 clips = a 24s ad). The merge endpoint joins them.
  // VIMO_KEYFRAME_MODEL=off animates the raw product photo instead.
  keyframeModel: () => { const v = clean(process.env.VIMO_KEYFRAME_MODEL); return v === 'off' ? '' : v || 'fal-ai/nano-banana-pro/edit'; },
  // VIMO_VIDEO_MODE=ingredients works like Google Flow's "Ingredients": the clip
  // is made from reference images (the scene's first frame + the product photo)
  // instead of being animated from one frame.
  videoMode: () => (clean(process.env.VIMO_VIDEO_MODE).toLowerCase() === 'ingredients' ? 'ingredients' : 'frame'),
  videoModel: () => clean(process.env.VIMO_VIDEO_MODEL) || (env.videoMode() === 'ingredients' ? 'fal-ai/veo3.1/fast/reference-to-video' : 'fal-ai/veo3.1/fast/image-to-video'),
  // The script writer: a vision LLM on fal (same FAL_KEY), unless OPENAI_API_KEY is set.
  scriptModel: () => clean(process.env.VIMO_SCRIPT_MODEL) || 'anthropic/claude-sonnet-4.5',
  mergeModel: () => clean(process.env.VIMO_MERGE_MODEL) || 'fal-ai/ffmpeg-api/merge-videos',
  videoResolution: () => clean(process.env.VIMO_VIDEO_RESOLUTION) || '720p',
  clipSeconds: () => num(process.env.VIMO_CLIP_SECONDS, 8),
  defaultClipCount: () => num(process.env.VIMO_CLIP_COUNT, 3),
  // Rough provider cost per generated second, only for the admin's margin view.
  costPerSecondUsd: () => num(process.env.VIMO_COST_PER_SECOND_USD, 0.15),
  jobTimeoutMin: () => num(process.env.VIMO_JOB_TIMEOUT_MIN, 30),
  workerTickMs: () => num(process.env.VIMO_WORKER_TICK_MS, 6000),
  maxImageBytes: () => num(process.env.VIMO_MAX_IMAGE_MB, 8) * 1024 * 1024,
  signupBonusCredits: () => num(process.env.VIMO_SIGNUP_BONUS, 0),
  vodafoneCashNumber: () => clean(process.env.VODAFONE_CASH_NUMBER) || '01113878767',
  supportWhatsapp: () => clean(process.env.SUPPORT_WHATSAPP),
  // Accounts with these emails are admins (on signup, and promoted at boot).
  adminEmails: () => clean(process.env.ADMIN_EMAILS).toLowerCase().split(/[,\s]+/).filter(Boolean),
};

// Packages = the EasyVideos price list. Override with VIMO_PACKAGES as JSON:
// [{"key":"starter","videos":1,"priceEgp":350,"label":"تجربة"}, ...]
const DEFAULT_PACKAGES = [
  { key: 'starter', videos: 1, priceEgp: 350, label: 'تجربة', note: 'مثالي لأول فيديو ليك' },
  { key: 'popular3', videos: 3, priceEgp: 800, label: 'الأكثر طلبًا', note: '' },
  { key: 'popular5', videos: 5, priceEgp: 1200, label: 'الأكثر طلبًا', note: '' },
  { key: 'best10', videos: 10, priceEgp: 2000, label: 'وفّر أكتر', note: '' },
];

export function packages() {
  const raw = clean(process.env.VIMO_PACKAGES);
  if (raw) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.every((p) => p.key && p.videos > 0 && p.priceEgp > 0)) return list;
    } catch { /* fall back to defaults */ }
  }
  return DEFAULT_PACKAGES;
}

export function findPackage(key) {
  return packages().find((p) => p.key === key) || null;
}

export function publicConfig() {
  return {
    packages: packages().map((p) => ({ ...p, perVideoEgp: Math.round(p.priceEgp / p.videos) })),
    videoSeconds: env.clipSeconds() * env.defaultClipCount(),
    vodafoneCashNumber: env.vodafoneCashNumber() || null,
    supportWhatsapp: env.supportWhatsapp() || null,
    videoReady: !!env.falKey(),
  };
}
