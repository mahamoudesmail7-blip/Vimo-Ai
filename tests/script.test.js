import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateScript, scenePrompt, writeScript } from '../src/services/script.js';
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
