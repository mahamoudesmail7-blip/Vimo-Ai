import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateScript, scenePrompt, writeScript, userScript } from '../src/services/script.js';
import { clipInput, videoUrlOf } from '../src/services/fal.js';

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
  const input = clipInput('fal-ai/veo3/fast/image-to-video', { prompt: 'x', imageUrl: 'data:image/png;base64,AA', aspectRatio: '9:16', seconds: 8 });
  assert.deepEqual({ d: input.duration, a: input.generate_audio, r: input.aspect_ratio }, { d: '8s', a: true, r: '9:16' });
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
