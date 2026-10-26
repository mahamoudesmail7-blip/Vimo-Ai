import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateScript, scenePrompt, keyframePrompt, writeScript, userScript } from '../src/services/script.js';
import { clipInput, videoUrlOf, imageUrlOf, setFetch } from '../src/services/fal.js';

test('template script has one scene per clip, hook first and offer last', () => {
  for (const clipCount of [1, 2, 3, 4]) {
    const s = templateScript({ productName: 'شنطة جلد', description: 'جلد طبيعي ومقاومة للمياه', offer: 'بـ 450 جنيه بس', clipCount });
    assert.equal(s.scenes.length, clipCount);
    assert.equal(s.source, 'TEMPLATE');
    assert.match(s.scenes[0].voiceover, /شنطة جلد/);
    if (clipCount > 1) assert.match(s.scenes[clipCount - 1].voiceover, /450/);
  }
});

test('writeScript falls back to the template without an OpenAI key', async () => {
  process.env.OPENAI_API_KEY = '';
  const s = await writeScript({ productName: 'ساعة', clipCount: 3, style: 'UGC', voiceGender: 'MALE' });
  assert.equal(s.source, 'TEMPLATE');
  assert.equal(s.scenes.length, 3);
});

test('scene prompt carries the Egyptian line, the speaker and the product lock', () => {
  const p = scenePrompt({ camera: 'close-up', visual: 'She opens the box.', voiceover: 'بجد تحفة!' }, { style: 'UGC', voiceGender: 'FEMALE', aspectRatio: '9:16' });
  assert.match(p, /بجد تحفة!/);
  assert.match(p, /Egyptian woman/);
  assert.match(p, /exactly like the reference image/);
  assert.match(p, /vertical 9:16/);
  assert.match(p, /No on-screen text/);
});

test('Veo clip input asks for an 8s clip with sound', () => {
  const input = clipInput('fal-ai/veo3/fast/image-to-video', { prompt: 'x', imageUrl: 'data:image/png;base64,AA', aspectRatio: '9:16', seconds: 8, negativePrompt: 'n' });
  assert.deepEqual({ d: input.duration, a: input.generate_audio, r: input.aspect_ratio }, { d: '8s', a: true, r: '9:16' });
  assert.equal(input.negative_prompt, undefined, 'Veo 3 has no negative prompt');
  assert.equal(clipInput('fal-ai/veo3.1/fast/image-to-video', { prompt: 'x', imageUrl: 'u', aspectRatio: '9:16', seconds: 8, negativePrompt: 'n' }).negative_prompt, 'n');
});

test('video url is read from the usual fal output shapes', () => {
  assert.equal(videoUrlOf({ video: { url: 'u1' } }), 'u1');
  assert.equal(videoUrlOf({ videos: [{ url: 'u2' }] }), 'u2');
  assert.equal(videoUrlOf({}), null);
});

test('an edited script keeps the customer lines and rejects bad ones', () => {
  const ok = userScript({ scenes: [{ voiceover: ' أهلا   بيكم ' }, { voiceover: 'تاني', visual: 'custom shot' }, { voiceover: 'اطلب' }] }, 3);
  assert.equal(ok.script.source, 'USER_EDITED');
  assert.equal(ok.script.scenes[0].voiceover, 'أهلا بيكم');
  assert.equal(ok.script.scenes[1].visual, 'custom shot');
  assert.ok(ok.script.scenes[2].visual.length > 10, 'missing visual gets a default');
  assert.match(userScript({ scenes: [{ voiceover: 'x' }] }, 3).error, /3 مشاهد/);
  assert.match(userScript({ scenes: [{ voiceover: 'x' }, { voiceover: '' }, { voiceover: 'y' }] }, 3).error, /المشهد 2/);
  assert.match(userScript({ scenes: [{ voiceover: 'كلمة '.repeat(40) }, { voiceover: 'y' }, { voiceover: 'z' }] }, 3).error, /طويل/);
});

test('template lines are long enough for an 8s clip and drop emoji', () => {
  const s = templateScript({ productName: 'جهاز مضاد للاختناق', description: '🌬️ جهاز استنشاق محمول', offer: '1199', clipCount: 3 });
  for (const scene of s.scenes) {
    const words = scene.voiceover.split(/\s+/).length;
    assert.ok(words >= 12 && words <= 20, `${words} words: ${scene.voiceover}`);
    assert.doesNotMatch(scene.voiceover, /\p{Extended_Pictographic}/u);
  }
});

test('the script is written by a vision LLM on fal when there is no OpenAI key', async () => {
  process.env.OPENAI_API_KEY = '';
  process.env.FAL_KEY = 'k';
  let sent;
  setFetch(async (url, opts) => {
    sent = { url, body: JSON.parse(opts.body) };
    const reply = '```json\n' + JSON.stringify({
      product: { what: 'anti-choking device', usage: 'mask pressed over mouth and nose, plunger pulled', details: 'grey cylinder, orange handles, clear mask' },
      hook: 'h', cta: 'c',
      scenes: [1, 2, 3].map((i) => ({ camera: 'cu', visual: `frame ${i}`, motion: `move ${i}`, voiceover: `سطر ${i}` })),
    }) + '\n```';
    return new Response(JSON.stringify({ output: reply }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const s = await writeScript({ productName: 'جهاز', clipCount: 3, style: 'UGC', voiceGender: 'MALE', imageDataUrl: 'data:image/png;base64,AA' });
    assert.equal(sent.url, 'https://fal.run/openrouter/router/vision');
    assert.deepEqual(sent.body.image_urls, ['data:image/png;base64,AA']);
    assert.match(sent.body.prompt, /how it is physically held and used/);
    assert.equal(s.source, 'AI');
    assert.equal(s.product.usage, 'mask pressed over mouth and nose, plunger pulled');
    assert.deepEqual(s.scenes.map((x) => x.motion), ['move 1', 'move 2', 'move 3']);
  } finally {
    setFetch(null);
    process.env.FAL_KEY = '';
  }
});

test('first-frame prompt locks the product and says how it is used', () => {
  const p = keyframePrompt({ visual: 'A man in a kitchen.' }, { product: { usage: 'held in the right hand', details: 'grey cylinder' }, style: 'UGC', voiceGender: 'MALE', aspectRatio: '9:16' });
  assert.match(p, /A man in a kitchen\./);
  assert.match(p, /EXACTLY as it is/);
  assert.match(p, /held in the right hand/);
  assert.match(p, /grey cylinder/);
  assert.match(p, /Vertical 9:16/);
  assert.equal(imageUrlOf({ images: [{ url: 'i1' }] }), 'i1');
});

test('an edited script keeps the motion and product notes from the preview', () => {
  const { script } = userScript({ product: { usage: 'u', details: 'd' }, scenes: [1, 2, 3].map((i) => ({ voiceover: `سطر ${i}`, visual: `v${i}`, motion: `m${i}` })) }, 3);
  assert.deepEqual(script.scenes.map((s) => s.motion), ['m1', 'm2', 'm3']);
  assert.equal(script.product.usage, 'u');
});

test('an empty fal balance is reported as NO_BALANCE, and cleared by the next accepted request', async () => {
  process.env.FAL_KEY = 'k';
  const { submit, falBalanceOut, FalError } = await import('../src/services/fal.js');
  setFetch(async () => new Response(JSON.stringify({ detail: 'User is locked. Reason: Exhausted balance.' }), { status: 403 }));
  try {
    await assert.rejects(submit('m', {}), (e) => e instanceof FalError && e.code === 'NO_BALANCE');
    assert.ok(falBalanceOut());
    setFetch(async () => new Response(JSON.stringify({ request_id: 'r' }), { status: 200 }));
    await submit('m', {});
    assert.equal(falBalanceOut(), null);
  } finally {
    setFetch(null);
    process.env.FAL_KEY = '';
  }
});
