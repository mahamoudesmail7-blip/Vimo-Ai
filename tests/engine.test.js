// Engine units with no database: scene planning, model choice, and the
// Higgsfield / Google adapters against fake HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sceneSeconds, planVideo } from '../src/engine/planner.js';
import { defaults } from '../src/engine/settings.js';
import { setFetch } from '../src/engine/media.js';
import higgsfield from '../src/engine/providers/higgsfield.js';
import google from '../src/engine/providers/google.js';
import { findModel } from '../src/engine/catalog.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const only = (on) => { const s = defaults(); for (const p of Object.keys(s.providers)) s.providers[p].enabled = on.includes(p); return s; };

test('scene lengths reach ~24s with each model\'s clip durations', () => {
  assert.deepEqual(sceneSeconds([4, 6, 8]), [8, 8, 8]);
  assert.deepEqual(sceneSeconds([8]), [8, 8, 8]);
  assert.deepEqual(sceneSeconds([5, 10]), [10, 10, 5]);
  assert.deepEqual(sceneSeconds([6, 10]), [6, 6, 6, 6]);
});

test('a fresh install is on the cheapest tier with a $2 per-video cap', () => {
  process.env.FAL_KEY = 'k';
  const s = only(['fal']);
  assert.equal(s.tier, 'economy');
  const { plan } = planVideo({ style: 'UGC', settings: s });
  assert.equal(plan.models.video, 'fal:veo31-lite');
  assert.ok(plan.estimate.totalUsd <= s.perVideoMaxUsd, `$${plan.estimate.totalUsd} fits the $2 cap`);
});

test('the planner picks the cheapest compatible model in the tier, and never another tier', () => {
  process.env.FAL_KEY = 'k';
  const s = only(['fal']);
  s.tier = 'economy';
  let { plan } = planVideo({ style: 'UGC', settings: s });
  assert.equal(plan.models.video, 'fal:veo31-lite');
  assert.equal(plan.mode, 'speech');
  assert.equal(plan.estimate.byProvider.fal, plan.estimate.totalUsd);

  s.tier = 'premium';
  ({ plan } = planVideo({ style: 'SHOWCASE', settings: s }));
  assert.equal(plan.models.video, 'fal:veo31');
  assert.equal(plan.mode, 'voiceover', 'showcase = silent clips + voiceover');
  assert.ok(plan.models.tts && plan.models.mux);

  s.models['fal:veo31'] = { enabled: false };
  const none = planVideo({ style: 'UGC', settings: s });
  assert.ok(none.error, 'premium switched off -> refused, not downgraded or upgraded');
});

test('silent-only engines make UGC with a voiceover; admin price overrides change the choice', () => {
  process.env.FAL_KEY = 'k';
  process.env.HIGGSFIELD_API_KEY = 'id'; process.env.HIGGSFIELD_API_SECRET = 'sec';
  try {
    const s = only(['fal', 'higgsfield']);
    s.tier = 'economy';
    let { plan } = planVideo({ style: 'AUTO', settings: s });
    assert.equal(plan.mode, 'voiceover');
    assert.equal(plan.models.video, 'fal:veo31-lite', 'Veo Lite silent $0.03/s beats Kling $0.042/s');
    s.models['fal:veo31-lite'] = { usdPerSecond: { silent: 0.08 } };
    ({ plan } = planVideo({ style: 'AUTO', settings: s }));
    assert.equal(plan.models.video, 'higgsfield:kling25-std');
    assert.deepEqual(plan.sceneSeconds, [10, 10, 5]);
    assert.equal(plan.provider, 'higgsfield');
    assert.ok(plan.estimate.byProvider.fal > 0, 'frames, voice and merge still run on fal');
    ({ plan } = planVideo({ style: 'UGC', settings: s }));
    assert.equal(plan.mode, 'speech', 'UGC keeps the talking person while a speech model exists');
    assert.equal(plan.models.video, 'fal:veo31-lite');
    s.models['fal:veo31-lite'] = { enabled: false };
    ({ plan } = planVideo({ style: 'UGC', settings: s }));
    assert.equal(plan.mode, 'voiceover', 'only silent models left -> UGC with a voiceover');
  } finally {
    delete process.env.HIGGSFIELD_API_KEY; delete process.env.HIGGSFIELD_API_SECRET;
  }
});

test('Higgsfield: uploads the photo, sends an Idempotency-Key, polls to the video', async () => {
  process.env.HIGGSFIELD_API_KEY = 'id'; process.env.HIGGSFIELD_API_SECRET = 'sec';
  const calls = [];
  let polls = 0;
  setFetch(async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/files/generate-upload-url')) return json(200, { upload_url: 'https://up.fake/put', public_url: 'https://files.fake/p.png', upload_headers: { 'x-amz-acl': 'private' } });
    if (url === 'https://up.fake/put') return new Response('', { status: 200 });
    if (url.endsWith('/image-to-video')) return json(200, { request_id: 'hf1', status_url: 'https://api.higgsfield.ai/requests/hf1/status' });
    if (url.endsWith('/requests/hf1/status')) return json(200, ++polls < 2 ? { status: 'in_progress' } : { status: 'completed', video: { url: 'https://cdn.hf/v.mp4' } });
    throw new Error(url);
  });
  try {
    const model = findModel('higgsfield:kling25-std');
    const step = await higgsfield.submit(model, 'video', { prompt: 'p', imageUrl: 'data:image/png;base64,AAAA', seconds: 10, negativePrompt: 'n', aspectRatio: '9:16' }, { idempotencyKey: 'vimo-x-clip0-1' });
    const create = calls.find((c) => c.url.endsWith('/image-to-video'));
    assert.equal(create.opts.headers.Authorization, 'Key id:sec');
    assert.equal(create.opts.headers['Idempotency-Key'], 'vimo-x-clip0-1');
    assert.deepEqual(JSON.parse(create.opts.body), { prompt: 'p', image_url: 'https://files.fake/p.png', duration: 10, cfg_scale: 0.5, negative_prompt: 'n' });
    assert.equal((await higgsfield.poll(model, step)).state, 'RUNNING');
    assert.deepEqual(await higgsfield.poll(model, step), { state: 'COMPLETED', url: 'https://cdn.hf/v.mp4' });

    setFetch(async () => json(200, { status: 'nsfw' }));
    await assert.rejects(higgsfield.poll(model, step), (e) => e.code === 'FAILED');
    setFetch(async () => json(403, { detail: 'Not enough credits' }));
    await assert.rejects(higgsfield.submit(model, 'video', { prompt: 'p', imageUrl: 'https://x/y.png', seconds: 5 }), (e) => e.code === 'NO_BALANCE');
  } finally {
    setFetch(null);
    delete process.env.HIGGSFIELD_API_KEY; delete process.env.HIGGSFIELD_API_SECRET;
  }
});

test('Google Vertex Veo: service-account token, predictLongRunning, video bytes back', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'svc@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'proj-1' });
  const calls = [];
  setFetch(async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === 'https://oauth2.googleapis.com/token') return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.endsWith(':predictLongRunning')) return json(200, { name: 'projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001/operations/op1' });
    if (url.endsWith(':fetchPredictOperation')) return json(200, { done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from('MP4').toString('base64'), mimeType: 'video/mp4' }] } });
    throw new Error(url);
  });
  try {
    assert.equal(google.configured(), true);
    const model = findModel('google:veo31-fast');
    const step = await google.submit(model, 'video', { prompt: 'p', imageUrl: 'data:image/png;base64,AAAA', aspectRatio: '9:16', seconds: 8, audio: false, negativePrompt: 'n' });
    const sent = calls.find((c) => c.url.endsWith(':predictLongRunning'));
    assert.equal(sent.url, 'https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning');
    assert.equal(sent.opts.headers.Authorization, 'Bearer tok');
    const body = JSON.parse(sent.opts.body);
    assert.deepEqual(body.instances[0].image, { bytesBase64Encoded: 'AAAA', mimeType: 'image/png' });
    assert.deepEqual({ a: body.parameters.aspectRatio, d: body.parameters.durationSeconds, g: body.parameters.generateAudio }, { a: '9:16', d: 8, g: false });
    const jwt = new URLSearchParams(calls[0].opts.body).get('assertion');
    assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).iss, 'svc@p.iam.gserviceaccount.com');
    const done = await google.poll(model, step);
    assert.equal(done.state, 'COMPLETED');
    assert.equal(done.buffer.toString(), 'MP4');
  } finally {
    setFetch(null);
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  }
});
