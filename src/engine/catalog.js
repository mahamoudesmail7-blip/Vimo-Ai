// Every model the engine can use, with what it can do and what it costs.
// Prices are USD from each provider's public price page (checked 2026-10-27);
// `priceVerified: false` means no official price page was found and the admin
// should confirm the number on the AI Engines page, where every price can be
// overridden. Customers never see any of this.
//
// kind: video | image (a scene's first frame) | tts | merge (join clips) | mux (lay audio on video)
// input (video): 'frame' animates one start image, 'references' builds the scene from several images.
// tier: economy | standard | premium
export const TIERS = ['economy', 'standard', 'premium'];
export const PROVIDERS = ['fal', 'higgsfield', 'google', 'mock'];

export const PROVIDER_LABELS = { fal: 'fal.ai', higgsfield: 'Higgsfield', google: 'Google Vertex AI (Veo)', mock: 'تجريبي (مجاني)' };

export const MODELS = [
  // --- fal.ai: Veo 3.1 family (fal.ai/models/fal-ai/veo3.1/*, per second, 720p)
  { id: 'fal:veo31-lite', provider: 'fal', kind: 'video', label: 'Veo 3.1 Lite', endpoint: 'fal-ai/veo3.1/lite/image-to-video', tier: 'economy', input: 'frame', durations: [4, 6, 8], audio: true, negativePrompt: false, usdPerSecond: { audio: 0.05, silent: 0.03 }, priceVerified: true },
  { id: 'fal:veo31-fast', provider: 'fal', kind: 'video', label: 'Veo 3.1 Fast', endpoint: 'fal-ai/veo3.1/fast/image-to-video', tier: 'standard', input: 'frame', durations: [4, 6, 8], audio: true, negativePrompt: true, usdPerSecond: { audio: 0.15, silent: 0.10 }, priceVerified: true },
  { id: 'fal:veo31-fast-ref', provider: 'fal', kind: 'video', label: 'Veo 3.1 Fast (مكونات)', endpoint: 'fal-ai/veo3.1/fast/reference-to-video', tier: 'standard', input: 'references', maxRefs: 3, durations: [8], audio: true, negativePrompt: false, usdPerSecond: { audio: 0.15, silent: 0.10 }, priceVerified: false },
  { id: 'fal:veo31', provider: 'fal', kind: 'video', label: 'Veo 3.1', endpoint: 'fal-ai/veo3.1/image-to-video', tier: 'premium', input: 'frame', durations: [4, 6, 8], audio: true, negativePrompt: true, usdPerSecond: { audio: 0.40, silent: 0.20 }, priceVerified: true },

  // --- Higgsfield (docs.higgsfield.ai API reference): silent clips only
  { id: 'higgsfield:kling25-std', provider: 'higgsfield', kind: 'video', label: 'Kling 2.5 Turbo Standard', endpoint: '/kling-video/v2.5-turbo/standard/image-to-video', tier: 'economy', input: 'frame', durations: [5, 10], audio: false, negativePrompt: true, usdPerSecond: { silent: 0.042 }, priceVerified: false },
  { id: 'higgsfield:hailuo23-std', provider: 'higgsfield', kind: 'video', label: 'Hailuo 2.3 Standard', endpoint: '/minimax/hailuo-2.3/standard/image-to-video', tier: 'economy', input: 'frame', durations: [6, 10], audio: false, negativePrompt: false, usdPerSecond: { silent: 0.045 }, priceVerified: false },
  { id: 'higgsfield:kling25-pro', provider: 'higgsfield', kind: 'video', label: 'Kling 2.5 Turbo Pro', endpoint: '/kling-video/v2.5-turbo/pro/image-to-video', tier: 'standard', input: 'frame', durations: [5, 10], audio: false, negativePrompt: true, usdPerSecond: { silent: 0.07 }, priceVerified: false },

  // --- Google Vertex AI Veo (cloud.google.com/vertex-ai/generative-ai/pricing)
  { id: 'google:veo31-fast', provider: 'google', kind: 'video', label: 'Veo 3.1 Fast', endpoint: 'veo-3.1-fast-generate-001', tier: 'standard', input: 'frame', durations: [4, 6, 8], audio: true, negativePrompt: true, usdPerSecond: { audio: 0.15, silent: 0.10 }, priceVerified: true },
  { id: 'google:veo31', provider: 'google', kind: 'video', label: 'Veo 3.1', endpoint: 'veo-3.1-generate-001', tier: 'premium', input: 'frame', durations: [4, 6, 8], audio: true, negativePrompt: true, usdPerSecond: { audio: 0.40, silent: 0.20 }, priceVerified: true },

  // --- support steps on fal
  { id: 'fal:nano-banana-pro', provider: 'fal', kind: 'image', label: 'Nano Banana Pro (أول فريم)', endpoint: 'fal-ai/nano-banana-pro/edit', tiers: ['standard', 'premium'], usdPerUnit: 0.15, priceVerified: true },
  { id: 'fal:nano-banana', provider: 'fal', kind: 'image', label: 'Nano Banana (أول فريم، أرخص)', endpoint: 'fal-ai/nano-banana/edit', tiers: ['economy'], usdPerUnit: 0.0398, priceVerified: true },
  { id: 'fal:eleven-v3', provider: 'fal', kind: 'tts', label: 'ElevenLabs v3 (تعليق صوتي)', endpoint: 'fal-ai/elevenlabs/tts/eleven-v3', usdPer1kChars: 0.10, priceVerified: true },
  { id: 'fal:merge-videos', provider: 'fal', kind: 'merge', label: 'دمج المقاطع', endpoint: 'fal-ai/ffmpeg-api/merge-videos', usdPerSecond: { silent: 0.0002 }, priceVerified: false },
  { id: 'fal:merge-audio-video', provider: 'fal', kind: 'mux', label: 'تركيب الصوت', endpoint: 'fal-ai/ffmpeg-api/merge-audio-video', usdPerSecond: { silent: 0.0002 }, priceVerified: true },

  // --- free mock engine for development: only with VIMO_ENABLE_MOCK=1 or NODE_ENV=development/test
  ...['economy', 'standard', 'premium'].map((tier) => ({ id: `mock:video-${tier}`, provider: 'mock', kind: 'video', label: `فيديو تجريبي (${tier})`, endpoint: 'mock/video', tier, input: 'frame', durations: [8], audio: true, negativePrompt: false, usdPerSecond: { audio: 0, silent: 0 }, priceVerified: true })),
  { id: 'mock:image', provider: 'mock', kind: 'image', label: 'صورة تجريبية', endpoint: 'mock/image', usdPerUnit: 0, priceVerified: true },
  { id: 'mock:tts', provider: 'mock', kind: 'tts', label: 'صوت تجريبي', endpoint: 'mock/tts', usdPer1kChars: 0, priceVerified: true },
  { id: 'mock:merge', provider: 'mock', kind: 'merge', label: 'دمج تجريبي', endpoint: 'mock/merge', usdPerSecond: { silent: 0 }, priceVerified: true },
  { id: 'mock:mux', provider: 'mock', kind: 'mux', label: 'تركيب تجريبي', endpoint: 'mock/mux', usdPerSecond: { silent: 0 }, priceVerified: true },
];

export const findModel = (id) => MODELS.find((m) => m.id === id) || null;

/** The model behind a legacy job that stored a bare fal endpoint in `model`. */
export const modelByEndpoint = (endpoint) => MODELS.find((m) => m.endpoint === endpoint) || null;
