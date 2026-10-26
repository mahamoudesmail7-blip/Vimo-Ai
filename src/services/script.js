// The ad script: N scenes (one per clip), each with an English visual
// direction for the video model and a short Egyptian-Arabic line spoken in
// it. Scene 1 is the hook, the last scene is the offer + call to action.
//
// With OPENAI_API_KEY the script is written by a vision model that looks at
// the product photo. Without it (or if the call fails) a template script is
// used, so a video can always be made.
import { env } from '../config.js';

const STYLE_DIRECTION = {
  UGC: 'Authentic user-generated-content look: filmed on a smartphone, handheld, natural home lighting, a real Egyptian person talking to the camera like a TikTok review.',
  CINEMATIC: 'Premium cinematic product commercial: smooth slow camera moves, soft studio lighting, shallow depth of field, elegant setting.',
  SHOWCASE: 'Clean product showcase: the product on a tidy surface, close-up details, slow orbit and push-in shots, bright even lighting.',
};
const MAX_VOICE_WORDS = 20; // ~8 seconds of natural Egyptian speech

let fetchImpl = (...args) => fetch(...args);
export function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

function trimWords(s, max) {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ');
}

export function templateScript({ productName, description, offer, clipCount }) {
  const name = productName.trim();
  const benefit = trimWords(String(description || '').split(/[.\n،,]/)[0] || `${name} هيفرق معاك`, 10);
  const lines = [
    { camera: 'close-up, handheld', visual: `A person holds the product up to the camera with a surprised, excited face.`, voiceover: `بجد مش مصدق إن ${name} بالشكل ده!` },
    { camera: 'medium shot, slow push-in', visual: 'The person uses the product naturally and shows its details to the camera.', voiceover: `${benefit}، وده اللي خلاني أحبه.` },
    { camera: 'close-up on product, then person smiling', visual: 'The person points at the product and smiles at the camera, inviting viewers to order.', voiceover: offer ? `${trimWords(offer, 8)}، اطلبه دلوقتي قبل ما يخلص!` : 'اطلبه دلوقتي والتوصيل لحد باب البيت!' },
  ];
  const scenes = clipCount === 1 ? [lines[0]] : clipCount === 2 ? [lines[0], lines[2]] : lines.slice(0, 2).concat(Array(Math.max(0, clipCount - 3)).fill(lines[1]), [lines[2]]);
  return { hook: scenes[0].voiceover, cta: scenes[scenes.length - 1].voiceover, scenes, source: 'TEMPLATE' };
}

function normalize(data, clipCount) {
  const scenes = Array.isArray(data?.scenes) ? data.scenes : [];
  if (scenes.length < clipCount) return null;
  const out = scenes.slice(0, clipCount).map((s) => ({
    camera: String(s.camera || '').slice(0, 120),
    visual: String(s.visual || '').slice(0, 600),
    voiceover: trimWords(s.voiceover, MAX_VOICE_WORDS),
  }));
  if (out.some((s) => !s.visual || !s.voiceover)) return null;
  return { hook: String(data.hook || out[0].voiceover), cta: String(data.cta || out[out.length - 1].voiceover), scenes: out, source: 'AI' };
}

export async function writeScript({ productName, description, offer, style, voiceGender, clipCount, imageDataUrl }) {
  const key = env.openAiKey();
  if (!key) return templateScript({ productName, description, offer, clipCount });

  const speaker = voiceGender === 'FEMALE' ? 'a young Egyptian woman' : 'a young Egyptian man';
  const system = 'You write short, high-converting video ad scripts for Egyptian e-commerce on TikTok, Reels and Facebook. You reply with JSON only.';
  const user = [
    `Product: ${productName}`,
    description ? `Description from the seller: ${description}` : '',
    offer ? `Offer / price to mention in the last scene: ${offer}` : '',
    `Ad style: ${STYLE_DIRECTION[style] || STYLE_DIRECTION.UGC}`,
    `Write exactly ${clipCount} scenes. Each scene is one ${env.clipSeconds()}-second clip generated from the attached product photo.`,
    'Scene 1 must be a scroll-stopping hook. The last scene must state the offer and tell viewers to order now.',
    `The speaker is ${speaker}.`,
    'For each scene return:',
    '- "camera": shot type and movement, in English.',
    '- "visual": what happens on screen, in English, max 60 words. The product must stay exactly as in the photo (same shape, colors, logo, packaging). No on-screen text.',
    `- "voiceover": the spoken line in Egyptian Arabic colloquial dialect (عامية مصرية), max ${MAX_VOICE_WORDS} words, natural and persuasive, no exaggerated medical or guaranteed claims.`,
    'Return JSON: {"hook": string, "cta": string, "scenes": [{"camera": string, "visual": string, "voiceover": string}]}',
  ].filter(Boolean).join('\n');

  const content = [{ type: 'text', text: user }];
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });

  try {
    const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.openAiModel(),
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const parsed = normalize(JSON.parse(data.choices?.[0]?.message?.content || '{}'), clipCount);
    if (parsed) return parsed;
    throw new Error('script JSON missing scenes');
  } catch (err) {
    console.warn('[script] AI script failed, using template:', err.message);
    return templateScript({ productName, description, offer, clipCount });
  }
}

/** The prompt sent to the video model for one scene. */
export function scenePrompt(scene, { style, voiceGender, aspectRatio }) {
  const speaker = voiceGender === 'FEMALE' ? 'a young Egyptian woman' : 'a young Egyptian man';
  return [
    STYLE_DIRECTION[style] || STYLE_DIRECTION.UGC,
    `Camera: ${scene.camera || 'medium shot'}.`,
    scene.visual,
    `${speaker} says in Egyptian Arabic dialect, clearly and naturally: "${scene.voiceover}"`,
    'The product must look exactly like the reference image: same shape, colors, logo, label and packaging. Do not change, add or remove any part of the product.',
    `Realistic, ${aspectRatio === '9:16' ? 'vertical 9:16 frame' : 'horizontal 16:9 frame'}. No on-screen text, captions, subtitles or watermarks.`,
  ].join(' ');
}
