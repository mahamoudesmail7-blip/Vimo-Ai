// The ad script: N scenes (one per clip). Each scene has an English first-frame
// description (`visual`, turned into a realistic photo with the exact product),
// what moves during the clip (`motion`), and a short Egyptian-Arabic line
// spoken in it. Scene 1 is the hook, the last scene is the offer + call to action.
//
// The script is written by a vision LLM that first studies the product photo
// (what it is, how it is held and used, its exact look): OpenAI when
// OPENAI_API_KEY is set, otherwise an LLM on fal with the same FAL_KEY. If that
// fails a template script is used, so a video can always be made.
import { env } from '../config.js';
import * as fal from './fal.js';

const STYLE_DIRECTION = {
  AUTO: 'High-converting Egyptian social ad: a real Egyptian person using the product in a real home, mixed with sharp close-ups of the product details, natural light, filmed on a smartphone.',
  UGC: 'Authentic user-generated-content look: filmed on a smartphone, handheld, natural home lighting, a real Egyptian person talking to the camera like a TikTok review.',
  CINEMATIC: 'Premium cinematic product commercial: smooth slow camera moves, soft natural light, shallow depth of field, an elegant real Egyptian home or street setting.',
  SHOWCASE: 'Clean product showcase: the product on a tidy real surface, close-up details, slow push-in shots, bright even lighting, a person only as hands or in the background.',
};

const NEGATIVE = 'product changes shape, product morphing, melting, warped or extra parts, different colors, changed or misspelled logo, distorted hands, extra fingers, cartoon, 3D render, CGI, plastic skin, on-screen text, subtitles, captions, watermark';
export const MAX_VOICE_WORDS = 27; // ~8 seconds of fast, energetic Egyptian speech
/** How many spoken words fit a scene: ~3.4 words/s fast, ~2.4 normal. */
export const wordsFor = (seconds, pace = 'fast') => Math.max(8, Math.round(seconds * (pace === 'normal' ? 2.4 : 3.4)));
const limitsOf = (clipCount, sceneSeconds, pace) => Array.from({ length: clipCount }, (_, i) => wordsFor(sceneSeconds?.[i] || env.clipSeconds(), pace));

let fetchImpl = (...args) => fetch(...args);
export function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

function trimWords(s, max) {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ');
}

export function templateScript({ productName, description, offer, clipCount, sceneSeconds, pace }) {
  const clean = (t) => String(t || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  const name = clean(productName);
  const benefit = trimWords(clean(String(description || '').split(/[.\n،,]/)[0]) || `${name} هيفرق معاك`, 9);
  const say = (t) => trimWords(t, MAX_VOICE_WORDS);
  const lines = [
    { camera: 'close-up, handheld', visual: 'A person in a real Egyptian living room holds the product up next to their face toward the phone camera, looking surprised and excited.', motion: 'The person talks to the camera with natural small head movements; the camera is handheld with slight sway.', voiceover: say(`بجد مش مصدق إن ${name} بالشكل ده! أول ما جربته فهمت الناس بتتكلم عنه ليه.`) },
    { camera: 'medium shot, slow push-in', visual: 'Medium shot: the person uses the product the way it is meant to be used, the product clearly visible in their hands.', motion: 'The person uses the product slowly and naturally while talking; slow push-in.', voiceover: say(`${benefit}، وكمان سهل في الاستخدام وشكله حلو، وده اللي خلاني أحبه.`) },
    { camera: 'close-up on product, then person smiling', visual: 'Close-up: the person holds the product toward the camera and smiles, warm natural light.', motion: 'The person nods and smiles while talking to the camera; the product stays still in frame.', voiceover: offer ? say(`${trimWords(clean(offer), 6)} ، والتوصيل لحد باب البيت والدفع عند الاستلام، اطلبه دلوقتي قبل ما الكمية تخلص!`) : 'اطلبه دلوقتي والتوصيل لحد باب البيت والدفع عند الاستلام، الحق قبل ما الكمية تخلص!' },
  ];
  const scenes = clipCount === 1 ? [lines[0]] : clipCount === 2 ? [lines[0], lines[2]] : lines.slice(0, 2).concat(Array(Math.max(0, clipCount - 3)).fill(lines[1]), [lines[2]]);
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  const fitted = scenes.map((sc, i) => ({ ...sc, voiceover: trimWords(sc.voiceover, limits[i]) }));
  return { hook: fitted[0].voiceover, cta: fitted[fitted.length - 1].voiceover, scenes: fitted, source: 'TEMPLATE' };
}

function normalize(data, clipCount, limits) {
  const scenes = Array.isArray(data?.scenes) ? data.scenes : [];
  if (scenes.length < clipCount) return null;
  const out = scenes.slice(0, clipCount).map((s, i) => ({
    camera: String(s.camera || '').slice(0, 160),
    visual: String(s.visual || '').slice(0, 900),
    motion: String(s.motion || '').slice(0, 500),
    voiceover: trimWords(s.voiceover, limits[i]),
  }));
  if (out.some((s) => !s.visual || !s.voiceover)) return null;
  return {
    product: readProduct(data.product),
    hook: String(data.hook || out[0].voiceover),
    cta: String(data.cta || out[out.length - 1].voiceover),
    scenes: out,
    source: 'AI',
  };
}

function readProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const pick = (k) => String(p[k] || '').slice(0, 600);
  return { what: pick('what'), usage: pick('usage'), details: pick('details') };
}

const GENERIC_VISUAL = [
  'A person in a real Egyptian living room holds the product up next to their face toward the phone camera, looking surprised and excited.',
  'Medium shot: the person uses the product the way it is meant to be used, the product clearly visible in their hands.',
  'Close-up: the person holds the product toward the camera and smiles, warm natural light.',
];

/**
 * A script the customer previewed and edited. Their spoken lines win; the
 * visual directions and product notes from the preview are kept when they
 * were sent back.
 * Returns { script } or { error } (Arabic, shown to the customer).
 */
export function userScript(input, clipCount, { sceneSeconds, pace } = {}) {
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  const scenes = Array.isArray(input?.scenes) ? input.scenes : [];
  if (scenes.length !== clipCount) return { error: `السكريبت لازم يكون ${clipCount} مشاهد.` };
  const out = [];
  for (const [i, s] of scenes.entries()) {
    const voiceover = String(s?.voiceover || '').trim().replace(/\s+/g, ' ');
    if (!voiceover) return { error: `اكتب كلام المشهد ${i + 1}.` };
    if (voiceover.split(' ').length > limits[i] + 5) return { error: `كلام المشهد ${i + 1} طويل على ${sceneSeconds?.[i] || env.clipSeconds()} ثواني، خليه أقصر.` };
    const last = i === scenes.length - 1 && i > 0;
    out.push({
      camera: String(s?.camera || '').slice(0, 160) || 'medium shot',
      visual: String(s?.visual || '').slice(0, 900) || GENERIC_VISUAL[last ? 2 : Math.min(i, 1)],
      motion: String(s?.motion || '').slice(0, 500),
      voiceover,
    });
  }
  return { script: { product: readProduct(input.product), hook: out[0].voiceover, cta: out[out.length - 1].voiceover, scenes: out, source: 'USER_EDITED' } };
}

const SYSTEM = [
  'You are the best direct-response creative director in Egypt. You make UGC video ads for TikTok, Reels and Facebook that stop the scroll and sell, and you direct realistic, believable footage.',
  'You write spoken lines the way real Egyptians talk (عامية مصرية), never formal Arabic and never translated-sounding.',
  'You reply with one JSON object only, no markdown.',
].join(' ');

function scriptRequest({ productName, description, offer, style, voiceGender, clipCount, sceneSeconds, pace, mode = 'speech' }) {
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  const secs = Array.from({ length: clipCount }, (_, i) => sceneSeconds?.[i] || env.clipSeconds());
  const voiceover = mode === 'voiceover' || mode === 'hybrid';
  const speaker = voiceGender === 'FEMALE' ? 'a young Egyptian woman (around 25-35)' : 'a young Egyptian man (around 25-35)';
  return [
    `Product name: ${productName}`,
    description ? `Seller's description: ${description}` : '',
    offer ? `Offer / price (must be said in the last scene): ${offer}` : '',
    `Ad style: ${STYLE_DIRECTION[style] || STYLE_DIRECTION.UGC}`,
    voiceover ? `Voice: ${speaker} reads the lines as a voiceover over the footage; nobody talks on camera, people only react naturally.` : `Speaker: ${speaker}.`,
    '',
    'STEP 1. Study the attached product photo closely before writing anything:',
    '- what the product really is and what problem it solves;',
    '- exactly how it is physically held and used (which hand, which part touches the body or the object, its size compared to a hand);',
    '- its exact look: shape, proportions, colors, materials, every visible part, logo and label text.',
    '',
    `STEP 2. Write a ${clipCount}-scene ad. Each scene is ONE clip; the scene lengths in seconds are: ${secs.join(', ')}.`,
    '- Scene 1 is the hook: in the first 2 seconds hit a real pain, fear or desire of the buyer, or say something surprising. It must make an Egyptian stop scrolling. A direct question to the viewer works best (e.g. "مين قالك إنك لازم...؟", "البرد موقف شغلك؟").',
    '- It is ONE person in ONE place for the whole ad, talking straight to the camera like a real review, holding the product near their face or using it. Every scene\'s "visual" keeps the same person, outfit and place; only the framing changes (medium shot, close-up on the product in hand).',
    '- The lines flow as one continuous talk across the scenes, like the person never stopped talking.',
    '- Middle scene(s): show the product being used correctly and give ONE concrete benefit with a feeling or a quick proof (a before/after moment, a reaction).',
    '- Last scene: the offer, urgency and a clear call to order now (delivery to the door / cash on delivery are normal in Egypt).',
    '',
    voiceover ? 'Rules for "voiceover" (the narration for that scene):' : 'Rules for "voiceover" (the line the speaker says on camera):',
    pace === 'normal'
      ? `- Egyptian colloquial, warm and natural, like a friend recommending it, at a calm clear pace. Word count per scene: ${limits.map((l, i) => `scene ${i + 1}: ${l - 5}-${l}`).join(', ')}.`
      : `- Egyptian colloquial, warm and natural, like a friend excitedly recommending it. Fast-paced TikTok energy, short punchy phrases, said quickly with no dead air. Word count per scene: ${limits.map((l, i) => `scene ${i + 1}: ${l - 6}-${l}`).join(', ')}.`,
    '- Specific to THIS product (use what you saw in the photo), no generic filler, do not repeat the product name in every line.',
    '- No emoji, no hashtags, no English words unless the product name is English, no guaranteed medical or exaggerated claims.',
    '- Facts must be TRUE: only say features, numbers, brand names, materials or specs that are in the seller\'s description or clearly visible in the photo. Never invent power, sizes, guarantees, prices or delivery times. If unsure, describe the benefit in general words instead.',
    '- Correct Egyptian spelling as people really write it (e.g. دلوقتي، عشان، إزاي، أوي، حواليك), and the line must make sense when read aloud.',
    '',
    'Rules for "visual" (the first frame, in English, max 90 words). It becomes a real photo made from the product photo, so:',
    '- describe ONE photorealistic smartphone-camera frame: a real Egyptian setting, the speaker, framing, light;',
    '- the product appears exactly as in the photo, fully visible, at real-world size, held or used correctly as found in STEP 1;',
    '- no text, no logos other than the product\'s own, no other products.',
    '',
    'Rules for "motion" (in English, max 50 words): what moves during the clip. Keep it simple and physically plausible: the speaker talks to the camera with natural gestures, small hand moves, a slow camera push or handheld sway. The product stays rigid and identical; it never transforms, opens or changes unless that is how it is really used.',
    '',
    'Return exactly this JSON shape:',
    '{"product": {"what": string, "usage": string, "details": string}, "hook": string, "cta": string, "scenes": [{"camera": string, "visual": string, "motion": string, "voiceover": string}]}',
    '"product" is in English: "usage" = how it is held and used, "details" = its exact look.',
  ].filter((l) => l !== null).join('\n');
}

function parseJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the model reply');
  return JSON.parse(raw.slice(start, end + 1));
}

async function askOpenAi(key, user, imageDataUrl) {
  const content = [{ type: 'text', text: user }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.openAiModel(),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function askFal(user, imageDataUrl) {
  const out = await fal.run('openrouter/router/vision', {
    model: env.scriptModel(),
    system_prompt: SYSTEM,
    prompt: user,
    image_urls: imageDataUrl ? [imageDataUrl] : [],
    temperature: 0.8,
    max_tokens: 2500,
  });
  return out?.output;
}

export async function writeScript({ productName, description, offer, style, voiceGender, clipCount, imageDataUrl, sceneSeconds, pace, mode }) {
  const openAiKey = env.openAiKey();
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  if (!openAiKey && !env.falKey()) return templateScript({ productName, description, offer, clipCount, sceneSeconds, pace });
  const user = scriptRequest({ productName, description, offer, style, voiceGender, clipCount, sceneSeconds, pace, mode });
  try {
    const reply = openAiKey ? await askOpenAi(openAiKey, user, imageDataUrl) : await askFal(user, imageDataUrl);
    const parsed = normalize(parseJsonObject(reply), clipCount, limits);
    if (parsed) return parsed;
    throw new Error('script JSON missing scenes');
  } catch (err) {
    console.warn('[script] AI script failed, using template:', err.message);
    return templateScript({ productName, description, offer, clipCount, sceneSeconds, pace });
  }
}

const SPEAKER = { FEMALE: 'a young Egyptian woman', MALE: 'a young Egyptian man' };

/** The image-edit prompt that turns the product photo into a scene's first frame. */
export function keyframePrompt(scene, { product, style, voiceGender, aspectRatio }) {
  return [
    'Create one photorealistic photo that looks like a real frame from a smartphone video, not an advert render.',
    `Scene: ${scene.visual}`,
    style !== 'SHOWCASE' ? `The person is ${SPEAKER[voiceGender] || SPEAKER.MALE}, with natural skin texture and real proportions.` : '',
    'The product in the reference image must appear in the scene EXACTLY as it is: same shape, proportions, colors, materials, every part, logo and label text. Do not redesign, simplify, recolor or add anything to it.',
    product?.details ? `Product look: ${product.details}` : '',
    product?.usage ? `It is held and used like this: ${product.usage}` : '',
    'Show it at real-world size, fully visible, in correct use.',
    `${aspectRatio === '16:9' ? 'Horizontal 16:9' : 'Vertical 9:16'} frame, natural light, sharp focus on the product. No text, captions or watermarks.`,
  ].filter(Boolean).join(' ');
}

/**
 * The prompt sent to the video model for one scene. It starts from the first
 * frame, or with `withScene` (Ingredients mode) it builds the scene from the
 * reference images, so the scene is described too.
 */
export function scenePrompt(scene, { style, voiceGender, aspectRatio, product, withScene = false, mode = 'speech', music = 'none', pace = 'fast' }) {
  const speech = pace === 'normal'
    ? 'in Egyptian Arabic dialect, warm and clear at a natural pace, with matching lip movement, finishing the line before the clip ends'
    : 'in Egyptian Arabic dialect, speaking quickly (a brisk, rapid delivery, never slow or drawn out) and energetic like a fast-paced TikTok ad, clearly, with no pauses and matching lip movement, finishing the line before the clip ends';
  return [
    STYLE_DIRECTION[style] || STYLE_DIRECTION.UGC,
    `Camera: ${scene.camera || 'medium shot'}.`,
    withScene ? `Scene: ${scene.visual}` : '',
    scene.motion || scene.visual,
    mode === 'voiceover'
      ? 'Nobody speaks in this clip: no dialogue and no lip movement; people only react naturally. Silent footage.'
      : `${SPEAKER[voiceGender] || SPEAKER.MALE} looks at the camera and says ${speech}: "${scene.voiceover}"`,
    mode === 'speech' ? (music === 'light' ? 'Light upbeat background music, quiet under the voice.' : 'No background music, only the voice and natural room sound.') : '',
    'The product must look exactly like the reference image for the whole clip: same shape, colors, logo, label and packaging. It does not morph, bend, melt or change; do not add or remove any part of the product.',
    product?.usage ? `It is used like this: ${product.usage}` : '',
    `Photorealistic real footage, ${aspectRatio === '9:16' ? 'vertical 9:16 frame' : 'horizontal 16:9 frame'}. No on-screen text, captions, subtitles or watermarks.`,
  ].filter(Boolean).join(' ');
}

export const NEGATIVE_PROMPT = NEGATIVE;
