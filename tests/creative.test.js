// The "creative director" before any paid step: reading the photos, the five
// scored hooks, real-use scenes, every color, and the automatic script review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis, analyzeProduct, readAnalysis, USE_SCENES } from '../src/services/analyze.js';
import { checkScript } from '../src/services/scriptCheck.js';
import { writeScript, readHooks, rewriteLine, factsOf } from '../src/services/script.js';
import { setFetch } from '../src/services/fal.js';

const IMG = 'data:image/png;base64,AA';
const reply = (output) => new Response(JSON.stringify({ output }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const withFal = async (handler, fn) => {
  process.env.OPENAI_API_KEY = '';
  process.env.FAL_KEY = 'k';
  const calls = [];
  setFetch(async (url, opts) => { const body = JSON.parse(opts.body); calls.push({ url, body }); return reply(handler(body, calls.length)); });
  try { return await fn(calls); } finally { setFetch(null); process.env.FAL_KEY = ''; }
};

const SNEAKER = {
  category: 'shoes', productAr: 'كوتشي سليب أون',
  colors: ['رمادي', 'أسود', 'كحلي', 'أسود'],
  confirmed: ['من غير رباط', 'نعل أبيض', 'مقاس 42'],
  likely: ['خفيف', 'من غير رباط'],
  unknown: ['مقاس 42', 'الخامة', 'السعر'],
  description: 'كوتشي سليب أون من غير رباط، متوفر رمادي وأسود وكحلي.',
};

// ---------------------------------------------------------------------------
// image analysis
// ---------------------------------------------------------------------------
test('analysis: confirmed, likely and unknown never overlap, colors are deduped', () => {
  const a = normalizeAnalysis(SNEAKER);
  assert.deepEqual(a.colors, ['رمادي', 'أسود', 'كحلي']);
  assert.deepEqual(a.confirmed, ['من غير رباط', 'نعل أبيض'], 'a size the photo cannot prove stays unknown');
  assert.deepEqual(a.likely, ['خفيف'], 'what is already confirmed is not "likely"');
  assert.ok(a.unknown.includes('مقاس 42'));
  assert.deepEqual(a.useScenes, USE_SCENES.shoes);
});

test('analysis: a strange reply never breaks the page', () => {
  const a = normalizeAnalysis({ category: 'spaceship', colors: 'red', confirmed: [null, '  ', 'x'.repeat(500)] });
  assert.equal(a.category, 'other');
  assert.deepEqual(a.colors, []);
  assert.equal(a.confirmed.length, 1);
  assert.ok(a.confirmed[0].length <= 120);
  assert.equal(normalizeAnalysis(null).category, 'other');
  assert.equal(readAnalysis({}), null, 'an empty analysis from the browser is ignored');
  assert.equal(readAnalysis('x'), null);
});

test('analysis: reads all the photos with the vision model, and is skipped without a key', async () => {
  process.env.OPENAI_API_KEY = ''; process.env.FAL_KEY = '';
  assert.equal(await analyzeProduct([IMG]), null);
  await withFal(() => '```json\n' + JSON.stringify(SNEAKER) + '\n```', async (calls) => {
    const a = await analyzeProduct([IMG, IMG, IMG]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.image_urls.length, 3, 'every color photo is looked at');
    assert.match(calls[0].body.prompt, /Never guess a price, size/);
    assert.equal(calls[0].body.temperature, 0.2);
    assert.equal(a.category, 'shoes');
    assert.equal(a.colors.length, 3);
  });
});

// ---------------------------------------------------------------------------
// automatic script review
// ---------------------------------------------------------------------------
const lines = (...v) => v.map((voiceover) => ({ voiceover }));
const kinds = (r) => r.issues.map((x) => x.kind);

test('review: a clean script with the right price passes everything', () => {
  const r = checkScript({ scenes: lines('رجلك بتوجعك من الجزمة كل ما تنزل؟', 'بتلبسه من غير رباط، ورمادي وأسود وكحلي', 'اطلبه دلوقتي بخمس مية جنيه بس'), limits: [18, 14, 14], offer: '500', facts: factsOf({ productName: 'كوتشي', analysis: normalizeAnalysis(SNEAKER) }) });
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assert.ok(r.passed.includes('السعر متقال صح'));
});

test('review: wrong price, a price nobody gave, and a price said in digits', () => {
  assert.ok(kinds(checkScript({ scenes: lines('حلو', 'اطلبه بسبع مية جنيه'), offer: '800 جنيه' })).includes('PRICE'), '"سبع مية" instead of "تمن مية"');
  assert.ok(kinds(checkScript({ scenes: lines('حلو', 'اطلبه بتلات مية جنيه بس') })).includes('PRICE'), 'no price was given');
  assert.ok(kinds(checkScript({ scenes: lines('حلو', 'اطلبه بـ 300 جنيه') })).includes('DIGITS'));
  assert.deepEqual(kinds(checkScript({ scenes: lines('الكوتشي ده تحفة', 'بتمن مية جنيه بدل ألف'), offer: '800 بدل 1000' })), []);
});

test('review: made-up features, repeated words, formal Arabic and long lines are caught', () => {
  const invented = checkScript({ scenes: lines('الشنطة دي عليها ضمان سنة'), facts: 'شنطة جلد' });
  assert.deepEqual(kinds(invented), ['INVENTED', 'INVENTED']);
  assert.deepEqual(kinds(checkScript({ scenes: lines('عليها ضمان سنة'), facts: 'شنطة جلد ضمان سنة' })), [], 'the seller said it, so it may be said');
  assert.ok(kinds(checkScript({ scenes: lines('مريح مريح جدا'), facts: '' })).includes('REPEAT'));
  assert.ok(kinds(checkScript({ scenes: lines('اطلبه دلوقتي', 'دلوقتي وبسرعة') })).includes('REPEAT'));
  assert.ok(kinds(checkScript({ scenes: lines('وسوف تحب هذا المنتج') })).includes('FORMAL'));
  assert.ok(kinds(checkScript({ scenes: lines('الكوتشي ده خفيف ومريح وشكله حلو ولونه جميل وبيمشي مع أي لبس عندك') })).includes('LONG_SENTENCE'));
  assert.ok(kinds(checkScript({ scenes: lines('واحد اتنين تلاتة أربعة خمسة'), limits: [3] })).includes('TOO_LONG'));
  assert.deepEqual(kinds(checkScript({ scenes: lines('هات إزازة مية معاك') })), [], '"مية" (water) is not a price');
});

// ---------------------------------------------------------------------------
// hooks, scenes and colors in the script request
// ---------------------------------------------------------------------------
test('hooks: deduped, scores clamped to 1-10, best first, five at most', () => {
  const h = readHooks([{ text: 'أ', score: 4 }, { text: 'ب', score: 99 }, { text: 'أ', score: 9 }, { text: 'ج', score: -3 }, { text: 'د' }, { text: 'ه', score: 7 }, { text: 'و', score: 6 }, { text: '' }]);
  assert.deepEqual(h.map((x) => x.text), ['ب', 'ه', 'و', 'د', 'أ']);
  assert.deepEqual(h.map((x) => x.score), [10, 7, 6, 5, 4]);
  assert.deepEqual(readHooks('x'), []);
});

test('script: five scored hooks, the best opens scene 1, real-use scenes and every color are asked for', async () => {
  const analysis = normalizeAnalysis(SNEAKER);
  const best = 'رجلك بتوجعك من الجزمة كل ما تنزل؟';
  const good = ['رجلك بتوجعك من الجزمة كل ما تنزل؟ جرّب ده', 'بتلبسه من غير رباط، ورمادي وأسود وكحلي', 'اطلبه دلوقتي بخمس مية جنيه بس'];
  await withFal((body, n) => (n === 1 ? JSON.stringify({
    product: { what: 'slip-on sneaker', usage: 'worn on the feet while walking', details: 'white sole' },
    hooks: [{ text: 'كوتشي جديد', score: 5, why: 'عادي' }, { text: best, score: 9, angle: 'pain', why: 'سؤال عن وجع يومي' }, { text: 'مش هتصدق', score: 7 }, { text: 'إنت ولا هما؟', score: 6 }, { text: 'بخمس مية بس', score: 4 }],
    scenes: good.map((voiceover, i) => ({ shotAr: `مشهد ${i + 1}`, camera: 'cu', visual: `v${i}`, motion: 'm', voiceover })),
  }) : JSON.stringify({ lines: good })), async (calls) => {
    const s = await writeScript({ productName: 'كوتشي', description: analysis.description, offer: '500', goal: 'PROBLEM', clipCount: 3, sceneSeconds: [8, 6, 6], style: 'UGC', voiceGender: 'MALE', imageDataUrl: [IMG], analysis });
    const prompt = calls[0].body.prompt;
    assert.match(prompt, /write 5 different hooks/);
    assert.match(prompt, /show and name ALL of them.*رمادي، أسود، كحلي/);
    assert.ok(prompt.includes(USE_SCENES.shoes[0]), 'the shoes are worn, not just held');
    assert.match(prompt, /NOT known, never say.*الخامة/);
    assert.equal(s.hooks.length, 5);
    assert.equal(s.hooks[0].text, best);
    assert.equal(s.hookIndex, 0);
    assert.ok(s.scenes[0].voiceover.startsWith(best));
    assert.deepEqual(s.scenes.map((x) => x.shotAr), ['مشهد 1', 'مشهد 2', 'مشهد 3']);
    assert.equal(s.checks.ok, true, JSON.stringify(s.checks.issues));
    assert.equal(calls.length, 2, 'a clean script needs no fixing round');
  });
});

test('rewrite one line: same facts, same price, and never longer than the scene', async () => {
  await withFal(() => JSON.stringify({ line: 'كلمة '.repeat(30).trim() }), async (calls) => {
    const line = await rewriteLine({ productName: 'كوتشي', offer: '500', goal: 'SALES', lines: ['أ', 'ب', 'ج'], index: 2, limit: 9, imageDataUrl: IMG });
    assert.ok(line.split(/\s+/).length <= 9);
    assert.match(calls[0].body.prompt, />>> ج/);
    assert.match(calls[0].body.prompt, /خمس مية جنيه/);
  });
  process.env.FAL_KEY = '';
  assert.equal(await rewriteLine({ productName: 'x', lines: ['a'], index: 0, limit: 8 }), null, 'no key: nothing is invented');
});

test("the customer's problem drives the script and counts as a true fact", async () => {
  const problem = 'أعواد القطن بتزق الشمع جوه الودن وبتعمل سدّ ووجع';
  await withFal(() => JSON.stringify({ scenes: [1, 2, 3].map((i) => ({ visual: `v${i}`, voiceover: `سطر ${i}` })) }), async (calls) => {
    await writeScript({ productName: 'جهاز تنظيف الودن', description: 'بينضّف الودن بالمية', problem, goal: 'PROBLEM', clipCount: 3, sceneSeconds: [8, 6, 6], style: 'UGC', voiceGender: 'MALE', imageDataUrl: [IMG] });
    assert.ok(calls[0].body.prompt.includes(`build the hook and the story on THIS, in the buyer's everyday words): ${problem}`));
  });
  assert.match(factsOf({ productName: 'x', problem }), /أعواد القطن/);
});

test('review: English, technical and very long words are flagged as hard to say', () => {
  const r = checkScript({ scenes: lines('الجهاز ده متطور وفيه تكنولوجيا AI وهتستخدميهولنا'), facts: 'جهاز' });
  const hard = r.issues.filter((x) => x.kind === 'HARD_WORD').map((x) => x.message).join(' ');
  assert.match(hard, /AI/);
  assert.match(hard, /«متطور» \(قول «حديث»\)/);
  assert.match(hard, /وهتستخدميهولنا/);
  assert.ok(!r.passed.includes('كلام سهل في النطق'));
  // an English product name the seller wrote is fine, and so is an everyday "جدا"
  assert.deepEqual(kinds(checkScript({ scenes: lines('السماعة دي Anker وحلوة جدا'), facts: 'سماعة Anker' })), []);
});

test('with an OpenAI key the script goes to ChatGPT with the photos, and its review findings are fixed', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.OPENAI_MODEL = 'gpt-4o';
  const calls = [];
  const { setFetch: setScriptFetch } = await import('../src/services/script.js');
  setScriptFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    const content = calls.length === 1
      ? JSON.stringify({ scenes: [1, 2, 3].map((i) => ({ visual: `v${i}`, voiceover: i === 2 ? 'الجهاز ده متطور جدا' : `سطر ${i}` })) })
      : JSON.stringify({ lines: ['سطر واحد', 'الجهاز ده حديث وسهل', 'سطر تلاتة'] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const s = await writeScript({ productName: 'جهاز', clipCount: 3, sceneSeconds: [8, 6, 6], style: 'UGC', voiceGender: 'MALE', imageDataUrl: [IMG] });
    assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0].body.model, 'gpt-4o');
    assert.equal(calls[0].body.messages[1].content[1].image_url.url, IMG);
    assert.match(calls[0].body.messages[0].content, /A video voice will SAY every line/);
    assert.match(calls[0].body.messages[1].content[0].text, /ONE doubt that stops them/);
    assert.equal(calls[0].body.temperature, 0.8);
    assert.match(calls[1].body.messages[0].content, /Pronunciation comes first/);
    assert.equal(s.scenes[1].voiceover, 'الجهاز ده حديث وسهل');
  } finally {
    setScriptFetch(null);
    process.env.OPENAI_API_KEY = '';
    delete process.env.OPENAI_MODEL;
  }
});

test('26 seconds: four parts, hook, features, details, offer', async () => {
  await withFal(() => JSON.stringify({ scenes: [] }), async (calls) => {
    await writeScript({ productName: 'جهاز تنظيف الأذن', offer: '500', clipCount: 4, sceneSeconds: [8, 6, 6, 6], imageDataUrl: [IMG] });
    assert.match(calls[0].body.prompt, /4-scene ad.*8, 6, 6, 6/);
    assert.match(calls[0].body.prompt, /2\) the FEATURES.*3\) the DETAILS.*4\) the offer/);
  });
});
