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
import { speakNumbers, speakOffer } from './numbers.js';
import { checkScript, minWords } from './scriptCheck.js';

const STYLE_DIRECTION = {
  AUTO: 'High-converting Egyptian social ad: a real Egyptian person using the product in a real home, mixed with sharp close-ups of the product details, natural light, filmed on a smartphone.',
  UGC: 'Authentic user-generated-content look: filmed on a smartphone, handheld, natural home lighting, a real Egyptian person talking to the camera like a TikTok review.',
  CINEMATIC: 'Premium cinematic product commercial: smooth slow camera moves, soft natural light, shallow depth of field, an elegant real Egyptian home or street setting.',
  STUDIO: 'Polished talking-head ad in a modern content-creator studio: the speaker sits on a cream boucle armchair facing the camera, in front of a deep teal-green wall with warm glowing lamps, wooden shelves and green plants, soft warm key light on the face, shallow depth of field with creamy bokeh, shot on a cinema camera, holding or showing the product. The hook scene is seated; the middle scene may stand up in the same studio to use or wear the product.',
  SHOWCASE: 'Clean product showcase: the product on a tidy real surface, close-up details, slow push-in shots, bright even lighting, a person only as hands or in the background.',
};

// What the customer wants the words to do (one choice, before the script is written).
// EMOTIONAL and REVIEW are kept for videos ordered before the four goals.
export const GOALS = ['SALES', 'CURIOSITY', 'PROBLEM', 'OFFER', 'EMOTIONAL', 'REVIEW'];
const GOAL_DIRECTION = {
  SALES: 'Goal: direct sales. Lead with the main benefit, make the viewer picture owning it, make the offer feel like a deal and end with a confident, clear call to order now.',
  CURIOSITY: 'Goal: curiosity. Open with something surprising or a question the viewer must hear the answer to, reveal the product as the answer, then one strong reason to want it and a call to order.',
  PROBLEM: 'Goal: problem and solution. Name a real everyday problem the buyer of THIS product has, show the product solving it in use, then the call to order.',
  OFFER: 'Goal: a special offer. Lead with the deal itself (only the price/offer the seller wrote, never invented), say why it is worth it, add urgency without lying (no fake countdowns or stock numbers) and call to order now.',
  EMOTIONAL: 'Goal: emotional. Start from a feeling or a small everyday moment the buyer knows well, show how the product makes life feel better, warm and close to the heart; end with a soft, friendly call to order.',
  REVIEW: 'Goal: an honest personal review. The person tells their own experience like talking to a friend: why they got it, what they liked, one honest detail. Natural and not salesy; end by saying how to order.',
};

const NEGATIVE = 'product changes shape, product morphing, melting, warped or extra parts, different colors, changed or misspelled logo, distorted hands, extra fingers, cartoon, 3D render, CGI, plastic skin, on-screen text, subtitles, captions, watermark';
export const MAX_VOICE_WORDS = 27; // ~8 seconds of fast, energetic Egyptian speech
/** How many spoken words fit a scene: ~2.3 words/s at a natural pace (the default), ~3.4 fast. */
export const wordsFor = (seconds, pace = 'normal') => Math.max(8, Math.round(seconds * (pace === 'fast' ? 3.4 : 2.3)));
const limitsOf = (clipCount, sceneSeconds, pace) => Array.from({ length: clipCount }, (_, i) => wordsFor(sceneSeconds?.[i] || env.clipSeconds(), pace));

let fetchImpl = (...args) => fetch(...args);
export function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

function trimWords(s, max) {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ');
}

// A spoken line that is too long is cut at the last clause end that fits, so
// it never stops mid-sentence ("تاخديه معاكي في").
const DANGLING = new Set(['في', 'من', 'على', 'عن', 'و', 'أو', 'ب', 'ل', 'مع', 'لحد', 'اللي', 'بس', 'عشان', 'لما']);
function fitLine(s, max) {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  const cut = words.slice(0, max);
  for (let k = cut.length; k >= Math.ceil(max * 0.6); k--) {
    if (/[،,.!؟?]$/.test(cut[k - 1])) return cut.slice(0, k).join(' ').replace(/[،,]$/, '.');
  }
  while (cut.length > 1 && DANGLING.has(cut[cut.length - 1])) cut.pop();
  return cut.join(' ');
}

export { fitLine };

export function templateScript({ productName, description, offer, clipCount, sceneSeconds, pace }) {
  const clean = (t) => String(t || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  const name = clean(productName);
  const benefit = trimWords(clean(String(description || '').split(/[.\n،,]/)[0]) || `${name} هيفرق معاك`, 9);
  const say = (t) => trimWords(t, MAX_VOICE_WORDS);
  const lines = [
    { shotAr: 'ماسك المنتج جنب وشه وبيكلم الكاميرا', camera: 'close-up, handheld', visual: 'A person in a real Egyptian living room holds the product up next to their face toward the phone camera, looking surprised and excited.', motion: 'The person talks to the camera with natural small head movements; the camera is handheld with slight sway.', voiceover: say(`بجد مش مصدق إن ${name} بالشكل ده! أول ما جربته فهمت الناس بتتكلم عنه ليه.`) },
    { shotAr: 'بيستخدم المنتج قدام الكاميرا', camera: 'medium shot, slow push-in', visual: 'Medium shot: the person uses the product the way it is meant to be used, the product clearly visible in their hands.', motion: 'The person uses the product slowly and naturally while talking; slow push-in.', voiceover: say(`${benefit}، وكمان سهل في الاستخدام وشكله حلو، وده اللي خلاني أحبه.`) },
    { shotAr: 'لقطة قريبة للمنتج وهو بيبتسم', camera: 'close-up on product, then person smiling', visual: 'Close-up: the person holds the product toward the camera and smiles, warm natural light.', motion: 'The person nods and smiles while talking to the camera; the product stays still in frame.', voiceover: offer ? say(`${trimWords(clean(offer), 6)} ، والتوصيل لحد باب البيت والدفع عند الاستلام، اطلبه دلوقتي قبل ما الكمية تخلص!`) : 'اطلبه دلوقتي والتوصيل لحد باب البيت والدفع عند الاستلام، الحق قبل ما الكمية تخلص!' },
  ];
  const scenes = clipCount === 1 ? [lines[0]] : clipCount === 2 ? [lines[0], lines[2]] : lines.slice(0, 2).concat(Array(Math.max(0, clipCount - 3)).fill(lines[1]), [lines[2]]);
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  const fitted = scenes.map((sc, i) => ({ ...sc, voiceover: fitLine(sc.voiceover, limits[i]) }));
  return { hook: fitted[0].voiceover, cta: fitted[fitted.length - 1].voiceover, scenes: fitted, source: 'TEMPLATE' };
}

function normalize(data, clipCount, limits) {
  const scenes = Array.isArray(data?.scenes) ? data.scenes : [];
  if (scenes.length < clipCount) return null;
  const out = scenes.slice(0, clipCount).map((s, i) => ({
    shotAr: String(s.shotAr || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    camera: String(s.camera || '').slice(0, 160),
    visual: String(s.visual || '').slice(0, 900),
    motion: String(s.motion || '').slice(0, 500),
    voiceover: fitLine(s.voiceover, limits[i]),
  }));
  if (out.some((s) => !s.visual || !s.voiceover)) return null;
  const hooks = readHooks(data.hooks);
  return {
    product: readProduct(data.product),
    hooks,
    hookIndex: hooks.length ? Math.max(0, hooks.findIndex((h) => out[0].voiceover.startsWith(h.text))) : -1,
    hook: String(data.hook || out[0].voiceover),
    cta: String(data.cta || out[out.length - 1].voiceover),
    scenes: out,
    source: 'AI',
  };
}

/** Up to 5 hooks, best first, each with its score (1-10) and a short reason. */
export function readHooks(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((h) => ({ text: String(h?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120), angle: String(h?.angle || '').slice(0, 40), score: Math.min(10, Math.max(1, Math.round(Number(h?.score) || 5))), why: String(h?.why || '').slice(0, 160) }))
    .filter((h) => h.text && !seen.has(h.text) && seen.add(h.text))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
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
      shotAr: String(s?.shotAr || '').slice(0, 140),
      camera: String(s?.camera || '').slice(0, 160) || 'medium shot',
      visual: String(s?.visual || '').slice(0, 900) || GENERIC_VISUAL[last ? 2 : Math.min(i, 1)],
      motion: String(s?.motion || '').slice(0, 500),
      voiceover,
      ...withSpoken(voiceover, s?.spoken), // dropped when the customer changed the line
    });
  }
  return { script: { product: readProduct(input.product), hook: out[0].voiceover, cta: out[out.length - 1].voiceover, scenes: out, source: 'USER_EDITED' } };
}

const SYSTEM = [
  'You are the best direct-response creative director in Egypt. You make UGC video ads for TikTok, Reels and Facebook that stop the scroll and sell, and you direct realistic, believable footage.',
  'You write spoken lines the way real Egyptians talk (عامية مصرية), never formal Arabic and never translated-sounding.',
  'A video voice will SAY every line, so you only use words it cannot get wrong: short, common words Egyptians say every day, no English, no technical or formal words, no long words with many prefixes and suffixes stuck together (split them: "هتستعمله" not "وهتستخدميهولنا").',
  'The lines sound like a real person, not an ad and not an AI: simple everyday words, short sentences, nothing fancy.',
  'You reply with one JSON object only, no markdown.',
].join(' ');

/** Everything the ad may say as a fact: the seller's words and what the photos clearly show. */
export function factsOf({ productName, description, details, problem, analysis }) {
  return [productName, description, details, problem, ...(analysis?.confirmed || []), ...(analysis?.colors || [])].filter(Boolean).join(' . ');
}

function scriptRequest({ productName, description, details, problem, offer, style, goal, voiceGender, age, clipCount, sceneSeconds, pace, mode = 'speech', analysis = null }) {
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  const secs = Array.from({ length: clipCount }, (_, i) => sceneSeconds?.[i] || env.clipSeconds());
  const voiceover = mode === 'voiceover' || mode === 'hybrid';
  const speaker = speakerOf(voiceGender, age);
  return [
    `Product name: ${productName}`,
    description ? `Seller's description: ${description}` : '',
    details ? `Extra details from the seller (true facts): ${details}` : '',
    problem ? `The problem this product solves / what the buyer wants, in the seller's words (build the hook and the story on THIS, in the buyer's everyday words): ${problem}` : '',
    analysis ? `What the photos clearly show (confirmed): ${[analysis.productAr, ...analysis.confirmed].filter(Boolean).join('; ') || 'nothing more'}` : '',
    analysis?.colors?.length > 1 ? `Color variants in the photos (show and name ALL of them in one scene): ${analysis.colors.join('، ')}` : '',
    analysis?.unknown?.length ? `NOT known, never say anything about these: ${analysis.unknown.join('; ')}` : '',
    analysis?.useScenes?.length ? `Real-use shots that fit this kind of product (use one for the middle scene): ${analysis.useScenes.join(' / ')}` : '',
    offer ? `Offer / price (must be said in the last scene, with exactly these prices, spoken like this: "${speakOffer(offer)}"): ${offer}` : 'No price was given: do not say any price or discount.',
    `Ad style: ${STYLE_DIRECTION[style] || STYLE_DIRECTION.UGC}`,
    GOAL_DIRECTION[goal] || GOAL_DIRECTION.SALES,
    voiceover ? `Voice: ${speaker} reads the lines as a voiceover over the footage; nobody talks on camera, people only react naturally.` : `Speaker: ${speaker}. Every scene's "visual" shows this person at exactly this age, and the words fit how someone that age talks.`,
    '',
    'STEP 1. Study ALL the attached product photos closely before writing anything:',
    '- what the product really is, who buys it, and the everyday moments it makes better (e.g. for shoes: work, outings, long walks; for a kitchen tool: cooking for the family);',
    '- think like the buyer: who exactly they are, the pain or wish that makes them stop (use the seller\'s problem text when given), and the ONE doubt that stops them from ordering (price? does it really work? quality?). The ad speaks to that pain and answers that doubt with a true fact;',
    '- the variants the photos show: if they show the same product in several colors or models, the ad says how many and names the colors in simple Egyptian words (e.g. "متوفرة بتلات ألوان: رمادي وأسود وكحلي");',
    '- exactly how it is physically held and used (which hand, which part touches the body or the object, its size compared to a hand);',
    '- its exact look: shape, proportions, colors, materials, every visible part, logo and label text.',
    '',
    `STEP 2. Write a ${clipCount}-scene ad. Each scene is ONE clip; the scene lengths in seconds are: ${secs.join(', ')}.`,
    '- HOOKS FIRST: write 5 different hooks (each max 8 words, each a different angle: a pain question, a surprising claim the facts support, a curiosity gap, a "you vs. others" contrast, the offer). Score each 1-10 for: stops an Egyptian scrolling in 2 seconds, fits THIS product and its buyer, fits the goal, true to the facts, easy to say. Pick the best one.',
    '- Scene 1 is the hook: its line STARTS with the chosen hook word for word, then flows on. A short direct question about an everyday situation works well (e.g. "رجلك بتوجعك من الجزمة كل ما تنزل؟", "البرد موقف شغلك؟"). Hooks never use made-up numbers or times ("بعد ساعتين", "في 5 دقايق") unless the seller gave them.',
    '- It is ONE person in ONE place for the whole ad, talking straight to the camera like a real review, holding the product near their face or using it. Every scene\'s "visual" keeps the same person, outfit and place; only the framing changes (medium shot, close-up on the product in hand).',
    '- The lines flow as one continuous talk across the scenes, like the person never stopped talking.',
    ...(clipCount === 4 ? [
      '- The 4 scenes are, in this order, and each one has ONE job. Do every job as well as a top Egyptian ad copywriter would:',
      '  1) THE HOOK: stop the scroll in 2 seconds. Name the buyer\'s problem or wish from the seller\'s words as a short question or a bold true claim, so the right buyer feels "ده أنا". Then one short line that promises the answer ("الحل أهو"، "بص على ده"). No product details yet.',
      '  2) THE FEATURES (what it does FOR the buyer): turn the 1 or 2 strongest features into benefits they feel in their day: the problem gone, time or money saved, comfort, looks, confidence. Feature + "يعني" + benefit (e.g. "من غير سلك، يعني تاخده معاك في أي حتة"). Show it IN USE. Answer the one doubt that would stop them ordering with a true fact.',
      '  3) THE DETAILS (why they can trust it): the concrete true facts only: how it works or is used in simple steps, its parts, size, material, colors/variants, what comes in the box, anything that makes it easy (charging, cleaning, sizes). Close-up on the product. Never a fact the seller did not give or the photos do not show.',
      '  4) THE OFFER: the price exactly as given (and the old price if given), why now (the offer, limited stock only if the seller said so), and a clear, easy order step (اطلب دلوقتي، التوصيل لحد البيت، الدفع عند الاستلام). End on the call to order.',
      '- The 4 lines are one continuous talk: each line leads into the next, no line repeats a benefit or a word from another line.',
    ] : []),
    clipCount === 4 ? null : '- Middle scene(s): the product is IN USE, never just held: shoes are worn on the feet (the person stands or walks a few steps, feet clearly in frame), clothes are worn, a tool or gadget is doing its job. Same person and place. Give one or two concrete benefits the buyer feels in daily life, plus the colors/variants if there are several.',
    '- Make it persuasive, not plain: every line gives a reason to buy. Help the viewer picture the moment ("تخيل تلف اليوم كله ورجلك مرتاحة"), use a reaction or a feeling, no empty filler ("سهلة تلبسها" alone is weak: say what it gives them).',
    '- Last scene: the offer, urgency and a clear call to order now (delivery to the door / cash on delivery are normal in Egypt). Say the price like "سعرها دلوقتي خمس مية جنيه بس، بدل تمن مية", never "بخصم خمسمية" and never a ب stuck to the number.',
    '- Never use the same word twice close together (e.g. "دلوقتي" twice in the last scene).',
    '',
    voiceover ? 'Rules for "voiceover" (the narration for that scene):' : 'Rules for "voiceover" (the line the speaker says on camera):',
    pace !== 'fast'
      ? `- Egyptian colloquial, warm and natural, like a friend recommending it, at a normal relaxed talking pace that is easy to follow. Word count per scene: ${limits.map((l, i) => `scene ${i + 1}: ${l - 4}-${l}`).join(', ')}.`
      : `- Egyptian colloquial, warm and natural, like a friend excitedly recommending it. Fast-paced TikTok energy, short punchy phrases, said quickly with no dead air. Word count per scene: ${limits.map((l, i) => `scene ${i + 1}: ${l - 5}-${l}`).join(', ')}.`,
    '- COUNT the words of every line before you answer. A line shorter than its minimum leaves the speaker silent on camera and ruins the ad; a line longer than its maximum gets cut. Fill each scene\'s time with useful words, never filler.',
    '- Specific to THIS product (use what you saw in the photo), no generic filler, do not repeat the product name in every line.',
    '- Easy to say out loud: common everyday words only, short sentences (3 to 8 words), no rare or formal words, no long words stuck together, no tongue twisters. Every sentence is complete and grammatically right.',
    '- No emoji, no hashtags, no English words unless the product name is English, no guaranteed medical or exaggerated claims.',
    '- Facts must be TRUE: only say features, numbers, brand names, materials or specs that are in the seller\'s description or clearly visible in the photo. Never invent power, sizes, guarantees, prices or delivery times. If unsure, describe the benefit in general words instead.',
    '- Correct Egyptian spelling as people really write it (e.g. دلوقتي، عشان، إزاي، أوي، حواليك), and the line must make sense when read aloud. Write prices and numbers as Egyptian words spelled as they are said, hundreds as two words ("خمس مية", "تمن مية"), never digits, and never a ب stuck to a price: say "سعرها خمس مية جنيه بس".',
    '',
    'Rules for "visual" (the first frame, in English, max 90 words). It becomes a real photo made from the product photo, so:',
    '- describe ONE photorealistic smartphone-camera frame: a real Egyptian setting, the speaker, framing, light;',
    '- the product appears exactly as in the photo, fully visible, at real-world size, held or used correctly as found in STEP 1;',
    '- when a scene\'s line names several colors or models, its visual shows ALL of them together, each exactly as in its photo (e.g. the person holds one pair and the other pairs sit next to them);',
    '- when a scene shows the product in use (worn, used), the visual makes that use clearly visible (e.g. full-body or feet shot with the shoes on);',
    '- no text, no logos other than the product\'s own, no other products.',
    '',
    'Rules for "motion" (in English, max 50 words): what moves during the clip. Keep it simple and physically plausible: the speaker talks to the camera with natural gestures, small hand moves, a slow camera push or handheld sway. The product stays rigid and identical; it never transforms, opens or changes unless that is how it is really used.',
    '',
    'Rules for "shotAr": one short Egyptian-Arabic sentence telling the seller what this scene shows (e.g. "لابس الكوتشي وماشي ناحية الكاميرا").',
    '',
    'Return exactly this JSON shape:',
    '{"product": {"what": string, "usage": string, "details": string}, "hooks": [{"text": string, "angle": string, "score": number, "why": string}], "hookIndex": number, "hook": string, "cta": string, "scenes": [{"shotAr": string, "camera": string, "visual": string, "motion": string, "voiceover": string}]}',
    '"hooks" are in Egyptian Arabic ("why" is one short Arabic reason), "hookIndex" is the chosen one (0-4).',
    '"product" is in English: "usage" = how it is held and used, "details" = its exact look.',
  ].filter((l) => l !== null).join('\n');
}

export function parseJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the model reply');
  return JSON.parse(raw.slice(start, end + 1));
}

async function askOpenAi(key, user, imageDataUrl, system = SYSTEM, temperature = 0.4) {
  const content = [{ type: 'text', text: user }];
  for (const url of [].concat(imageDataUrl || [])) content.push({ type: 'image_url', image_url: { url } });
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.openAiModel(),
      // reasoning models (o-series, gpt-5) only take the default temperature
      ...(/^gpt-4/.test(env.openAiModel()) ? { temperature } : {}),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

/** One vision-model call (OpenAI when its key is set, else an LLM on fal); returns the raw reply text. */
export async function askVision(user, imageDataUrls, system, temperature = 0.4) {
  const key = env.openAiKey();
  return key ? askOpenAi(key, user, imageDataUrls, system, temperature) : askFal(user, imageDataUrls, system, temperature);
}

async function askFal(user, imageDataUrl, system = SYSTEM, temperature = 0.8) {
  const out = await fal.run('openrouter/router/vision', {
    model: env.scriptModel(),
    system_prompt: system,
    prompt: user,
    image_urls: [].concat(imageDataUrl || []),
    temperature,
    max_tokens: 4000,
  });
  return out?.output;
}

const PROOFREAD = [
  'You proofread Egyptian Arabic (عامية مصرية) lines that a voice will speak in a video ad.',
  'Fix every line so that: it is correct, natural Egyptian as people really say it; every sentence is complete and makes sense; it uses only common everyday words that are easy to pronounce (replace rare, formal or hard words with simple ones); it sounds like a real person, not an ad and not an AI.',
  'Pick the word an Egyptian really uses (e.g. "نعلها طري" not "نعلها ناعم", "جزمة" or "كوتشي" not "حذاء"). Never repeat the same word twice close together. A price reads like "سعرها خمس مية جنيه بس، بدل تمن مية": hundreds as two words, never a ب stuck to the number, never "بخصم خمسمية". Remove any made-up number or time that is not in the seller\'s description.',
  'Keep the meaning, the order and the facts. Never add a feature, number, brand, guarantee or price that is not already in the line. Prices and numbers stay written as Egyptian words.',
  'Pronunciation comes first: a video voice reads these lines, so swap any word it could stumble on (English, technical, formal, rare, longer than about 9 letters, or several prefixes/suffixes stuck together) for a short common Egyptian word with the same meaning.',
  'Keep each line between its minimum and maximum word count. When a line is too short, make it longer with true, useful words: say the benefit more concretely, add the feeling or the moment of use, or a natural reaction. Only use facts that are already in the lines or in the true facts given; never invent.',
  'Then, for the voice only, write each corrected line again in "spoken" with Arabic diacritics (تشكيل) on the words a voice could read wrong (e.g. "شَنطِتك", "هيِوَفّر"); leave every other word and all letters exactly the same.',
  'Reply with one JSON object only: {"lines": [string, ...], "spoken": [string, ...]} with the same number of lines in both.',
].join(' ');

const plain = (t) => String(t || '').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ').trim();
/** The marked-up line for the voice, kept only when it is the very same line plus diacritics. */
function withSpoken(voiceover, spoken) {
  const marked = String(spoken || '').replace(/\s+/g, ' ').trim();
  return marked && marked !== voiceover && plain(marked) === plain(voiceover) ? { spoken: marked } : {};
}

/**
 * A second pass over the spoken lines: fixes mistakes and hard words, and the
 * problems the automatic review found (`issues`). Falls back to the lines as they are.
 */
async function proofread(scenes, limits, offer, imageDataUrl, { issues = [], facts = '' } = {}) {
  const user = [
    offer ? `The price/offer must stay exactly as: "${speakOffer(offer)}"` : 'No price was given: the lines must not say any price.',
    facts ? `The only true facts about the product: ${facts}` : '',
    issues.length ? `An automatic review found these problems, fix every one of them:\n${issues.map((x) => `- ${x.message}`).join('\n')}` : '',
    'Lines (with word limits):',
    ...scenes.map((s, i) => `${i + 1}. (${minWords(limits[i])} to ${limits[i]} words) ${s.voiceover}`),
  ].filter(Boolean).join('\n');
  try {
    const reply = await askVision(user, imageDataUrl, PROOFREAD, 0.2);
    const { lines, spoken } = parseJsonObject(reply) || {};
    if (!Array.isArray(lines) || lines.length !== scenes.length || lines.some((l) => !String(l || '').trim())) return scenes;
    return scenes.map((s, i) => {
      const voiceover = fitLine(String(lines[i]).replace(/\s+/g, ' '), limits[i]);
      return { ...s, voiceover, ...withSpoken(voiceover, Array.isArray(spoken) ? spoken[i] : null) };
    });
  } catch (err) {
    console.warn('[script] proofread failed, keeping the lines:', err.message);
    return scenes;
  }
}

// The chosen hook follows scene 1 when the proofread reworded it.
function syncHook(script) {
  if (!script.hooks?.length) return script;
  const first = script.scenes[0].voiceover;
  let i = script.hooks.findIndex((h) => first.startsWith(h.text));
  if (i < 0) {
    i = Math.max(0, script.hookIndex);
    const opening = (first.match(/^[^.!؟?]+[.!؟?]?/) || [first])[0].trim();
    script.hooks[i] = { ...script.hooks[i], text: opening };
  }
  return { ...script, hookIndex: i };
}

/**
 * Writes the script: product study, 5 scored hooks, scenes; then a proofread
 * pass, the automatic review, and one more fixing pass if the review found
 * problems. `checks` says what was verified and what is still wrong.
 */
export async function writeScript({ productName, description, details, problem, offer, style, goal, voiceGender, age, clipCount, imageDataUrl, sceneSeconds, pace, mode, analysis = null }) {
  const limits = limitsOf(clipCount, sceneSeconds, pace);
  const facts = factsOf({ productName, description, details, problem, analysis });
  const review = (script) => ({ ...script, checks: checkScript({ scenes: script.scenes, limits, offer, facts }) });
  if (!env.openAiKey() && !env.falKey()) return review(templateScript({ productName, description, offer, clipCount, sceneSeconds, pace }));
  const user = scriptRequest({ productName, description, details, problem, offer, style, goal, voiceGender, age, clipCount, sceneSeconds, pace, mode, analysis });
  try {
    const parsed = normalize(parseJsonObject(await askVision(user, imageDataUrl, SYSTEM, 0.8)), clipCount, limits);
    if (!parsed) throw new Error('script JSON missing scenes');
    const firstImage = [].concat(imageDataUrl || [])[0];
    let script = { ...parsed, scenes: await proofread(parsed.scenes, limits, offer, firstImage, { facts }) };
    let checked = review(script);
    if (!checked.checks.ok) {
      script = { ...script, scenes: await proofread(script.scenes, limits, offer, firstImage, { facts, issues: checked.checks.issues }) };
      checked = review(script);
    }
    return syncHook({ ...checked, hook: checked.scenes[0].voiceover, cta: checked.scenes.at(-1).voiceover });
  } catch (err) {
    console.warn('[script] AI script failed, using template:', err.message);
    return review(templateScript({ productName, description, offer, clipCount, sceneSeconds, pace }));
  }
}

const REWRITE = [
  'You rewrite ONE line of an Egyptian Arabic (عامية مصرية) video ad so it is better: more natural, more persuasive, easy to say.',
  'Keep its role in the ad (hook / benefit / offer), keep it true to the facts given, keep the price exactly as given, never invent features, numbers or prices.',
  'Do not repeat words used in the lines around it. Short sentences, everyday Egyptian words, written numbers as words.',
  'Reply with one JSON object only: {"line": string}',
].join(' ');

/** A fresh version of one line; null when the model is not available or fails. */
export async function rewriteLine({ productName, description, details, problem, offer, goal, analysis, lines, index, limit, imageDataUrl }) {
  if (!env.openAiKey() && !env.falKey()) return null;
  const role = index === 0 ? 'the hook (first words must stop the scroll)' : index === lines.length - 1 ? 'the offer and the call to order' : 'the benefits, with the product in use';
  const user = [
    GOAL_DIRECTION[goal] || GOAL_DIRECTION.SALES,
    `True facts: ${factsOf({ productName, description, details, problem, analysis })}`,
    problem ? `The buyer's problem: ${problem}` : '',
    offer ? `Price/offer, said exactly as: "${speakOffer(offer)}"` : 'No price was given: never say a price.',
    'The ad:',
    ...lines.map((l, i) => `${i + 1}. ${i === index ? '>>> ' : ''}${l}`),
    `Rewrite line ${index + 1} (${role}) in at most ${limit} words.`,
  ].join('\n');
  try {
    const out = String(parseJsonObject(await askVision(user, imageDataUrl, REWRITE, 0.9))?.line || '').replace(/\s+/g, ' ').trim();
    return out ? fitLine(out, limit) : null;
  } catch (err) {
    console.warn('[script] rewrite failed:', err.message);
    return null;
  }
}

/** The person in the ad, at the age the seller chose (20-60). */
export function speakerOf(voiceGender, age) {
  const a = Number(age) || 28;
  const who = voiceGender === 'FEMALE' ? 'woman' : 'man';
  const look = a < 30 ? 'a young Egyptian' : a < 45 ? 'an Egyptian' : 'a mature Egyptian';
  const signs = a >= 50 ? ', with grey hair and the face of someone that age' : a >= 40 ? ', with a few grey hairs and the face of someone that age' : '';
  return `${look} ${who} who is about ${a} years old${signs}`;
}

/** The image-edit prompt that turns the product photo into a scene's first frame. */
export function keyframePrompt(scene, { product, style, voiceGender, age, aspectRatio }) {
  return [
    'Create one photorealistic photo that looks like a real frame from a smartphone video, not an advert render.',
    `Scene: ${scene.visual}`,
    style !== 'SHOWCASE' ? `The person is ${speakerOf(voiceGender, age)}, with natural skin texture and real proportions.` : '',
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
export function scenePrompt(scene, { style, voiceGender, age, aspectRatio, product, withScene = false, mode = 'speech', music = 'none', pace = 'normal' }) {
  const speech = pace !== 'fast'
    ? 'in Egyptian Arabic dialect, like a real person talking to a friend: relaxed, warm and clear at a normal talking speed (not rushed), pronouncing every word clearly, with matching lip movement, finishing the line before the clip ends'
    : 'in Egyptian Arabic dialect, speaking quickly (a brisk, rapid delivery, never slow or drawn out) and energetic like a fast-paced TikTok ad, clearly, with no pauses and matching lip movement, finishing the line before the clip ends';
  return [
    STYLE_DIRECTION[style] || STYLE_DIRECTION.UGC,
    `Camera: ${scene.camera || 'medium shot'}.`,
    withScene ? `Scene: ${scene.visual}` : '',
    scene.motion || scene.visual,
    mode === 'voiceover'
      ? 'Nobody speaks in this clip: no dialogue and no lip movement; people only react naturally. Silent footage.'
      : `${speakerOf(voiceGender, age)} (with a natural voice for that age) looks at the camera and says ${speech}: "${speakNumbers(scene.spoken || scene.voiceover)}"`,
    mode === 'speech' ? (music === 'light' ? 'Light upbeat background music, quiet under the voice.' : 'No background music, only the voice and natural room sound.') : '',
    'The product must look exactly like the reference image for the whole clip: same shape, colors, logo, label and packaging. It does not morph, bend, melt or change; do not add or remove any part of the product.',
    product?.usage ? `It is used like this: ${product.usage}` : '',
    `Photorealistic real footage, ${aspectRatio === '9:16' ? 'vertical 9:16 frame' : 'horizontal 16:9 frame'}. No on-screen text, captions, subtitles or watermarks.`,
  ].filter(Boolean).join(' ');
}

export const NEGATIVE_PROMPT = NEGATIVE;
