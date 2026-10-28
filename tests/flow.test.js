// End-to-end: signup -> Vodafone Cash top-up -> admin approval -> video
// render through a fake fal.ai -> download. Needs a throwaway Postgres in
// TEST_DATABASE_URL (migrated); skipped without one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const DB = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB || process.env.DATABASE_URL;
process.env.FAL_KEY = 'test-key';
process.env.OPENAI_API_KEY = '';
process.env.VIMO_DISABLE_AUTOKICK = '1';
process.env.ADMIN_EMAILS = 'boss@test.dev';

const skip = !DB && 'TEST_DATABASE_URL not set';
let server, base, prisma, fal, processDueJobs;

// --- fake fal queue: each request is IN_PROGRESS on its first poll, then COMPLETED
const fake = { submitted: [], polls: {}, failClips: false, mergeInputs: [], balance: 100, billingStatus: 200 };
async function fakeFetch(url, opts = {}) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://fal.run/')) return json(500, { detail: 'no LLM in tests' }); // script falls back to the template
  if (url.startsWith('https://api.fal.ai/v1/account/billing')) return fake.billingStatus === 200 ? json(200, { credits: { current_balance: fake.balance } }) : json(fake.billingStatus, { detail: 'missing scope' });
  if (opts.method === 'POST' && url.startsWith('https://queue.fal.run/')) {
    const id = `req${fake.submitted.length + 1}`;
    const body = JSON.parse(opts.body);
    fake.submitted.push({ id, model: url.slice('https://queue.fal.run/'.length), body });
    if (body.video_urls) fake.mergeInputs.push(body.video_urls);
    return json(200, { request_id: id, status_url: `https://queue.fal.run/x/requests/${id}/status`, response_url: `https://queue.fal.run/x/requests/${id}` });
  }
  const st = /requests\/(req\d+)\/status$/.exec(url);
  if (st) { fake.polls[st[1]] = (fake.polls[st[1]] || 0) + 1; return json(200, { status: fake.polls[st[1]] > 1 ? 'COMPLETED' : 'IN_PROGRESS' }); }
  const rs = /requests\/(req\d+)$/.exec(url);
  if (rs) {
    const sub = fake.submitted.find((s) => s.id === rs[1]);
    if (!sub.body.video_urls && fake.failClips) return json(422, { detail: 'content policy' });
    if (sub.model.includes('nano-banana')) return json(200, { images: [{ url: `https://cdn.fake/${rs[1]}.jpg` }] });
    if (sub.model.includes('elevenlabs')) return json(200, { audio: { url: `https://cdn.fake/${rs[1]}.mp3` } });
    return json(200, { video: { url: `https://cdn.fake/${rs[1]}.mp4` } });
  }
  if (url.startsWith('https://cdn.fake/')) {
    if (fake.realMedia) return new Response(url.endsWith('.jpg') ? Buffer.from(PNG_REAL.split(',')[1], 'base64') : (await import('../src/engine/media.js')).mockVideo(), { status: 200 });
    return new Response(Buffer.from('FAKE-MP4-BYTES-0123456789'), { status: 200 });
  }
  throw new Error(`unexpected fetch ${url}`);
}

// A real image for the hybrid render (ffmpeg needs to decode it)
const PNG_REAL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAeUlEQVR4nO3PwQkAIBDAsBvCSV3er0P4CEKhA6Rz9vq64YIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALHrsMNtFaUQqPygAAAABJRU5ErkJggg==';
const PNG = 'data:image/png;base64,' + Buffer.from('\x89PNG\r\n\x1a\nfake').toString('base64');

function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
}

async function settle(id, tries = 20) {
  for (let i = 0; i < tries; i++) {
    await processDueJobs();
    const j = await prisma.videoJob.findUnique({ where: { id } });
    if (['COMPLETED', 'FAILED'].includes(j.status)) return j;
  }
  throw new Error('job did not settle');
}

before(async () => {
  if (skip) return;
  ({ prisma } = await import('../src/db.js'));
  fal = await import('../src/services/fal.js');
  fal.setFetch(fakeFetch);
  (await import('../src/engine/media.js')).setFetch(fakeFetch);
  ({ processDueJobs } = await import('../src/services/videoJob.js'));
  for (const t of ['engine_events', 'settings', 'credit_transactions', 'topup_requests', 'video_jobs', 'blobs', 'users']) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  const { createApp } = await import('../src/server.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  // The real-provider path: the free mock engine is off, fal is the engine.
  await (await import('../src/engine/settings.js')).saveSettings({ tier: 'standard', perVideoMaxUsd: 5, perDayMaxUsd: 50, hybrid: false, providers: { mock: { enabled: false } } });
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

test('full flow: top-up, approve, render, download, refund on failure', { skip }, async () => {
  const user = client();
  const admin = client();

  let r = await user('POST', '/api/auth/signup', { name: 'Mona', email: 'mona@test.dev', password: 'secret123' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.credits, 0);

  r = await user('POST', '/api/videos', { productName: 'شنطة', image: PNG });
  assert.equal(r.status, 402, 'no credits -> refused');

  r = await user('POST', '/api/wallet/topups', { packageKey: 'popular3', senderPhone: '01012345678', reference: 'TX1' });
  assert.equal(r.status, 201);
  const topupId = r.data.id;
  assert.equal(r.data.amountEgp, 800);

  r = await user('POST', `/api/admin/topups/${topupId}/approve`, {});
  assert.equal(r.status, 403, 'a user cannot approve their own top-up');

  r = await admin('POST', '/api/auth/signup', { name: 'Boss', email: 'Boss@Test.dev', password: 'secret123' });
  assert.equal(r.data.user.role, 'ADMIN', 'an ADMIN_EMAILS signup is an admin');
  r = await admin('POST', `/api/admin/topups/${topupId}/approve`, {});
  assert.equal(r.status, 200);
  r = await admin('POST', `/api/admin/topups/${topupId}/approve`, {});
  assert.equal(r.status, 409, 'cannot approve twice');

  r = await user('GET', '/api/auth/me');
  assert.equal(r.data.user.credits, 3);

  // happy path
  r = await user('POST', '/api/videos', { productName: 'شنطة جلد', description: 'جلد طبيعي', offer: 'بـ 450 جنيه', image: PNG, style: 'UGC', voiceGender: 'FEMALE' });
  assert.equal(r.status, 201);
  const ok = await settle(r.data.id);
  assert.equal(ok.status, 'COMPLETED', ok.error);
  const frameSubs = fake.submitted.filter((s) => s.model.includes('nano-banana'));
  assert.equal(frameSubs.length, 3, 'a first frame per scene');
  assert.ok(frameSubs.every((s) => s.model === 'fal-ai/nano-banana-pro/edit' && s.body.image_urls[0].startsWith('data:image/png') && s.body.aspect_ratio === '9:16'));
  const clipSubs = fake.submitted.filter((s) => s.body.image_url);
  assert.equal(clipSubs.length, 3, 'three clips');
  assert.ok(clipSubs.every((s) => /^https:\/\/cdn\.fake\/req\d+\.jpg$/.test(s.body.image_url) && ['8s', '6s', '6s'].includes(s.body.duration)), 'each clip starts from its first frame');
  assert.ok(clipSubs.every((s) => s.model === 'fal-ai/veo3.1/fast/image-to-video' && s.body.negative_prompt));
  assert.equal(fake.mergeInputs.at(-1).length, 3, 'merged three clips');

  r = await user('GET', `/api/videos/${ok.id}/video`, null, { Range: 'bytes=0-3' });
  assert.equal(r.status, 206);
  assert.equal(r.data.toString(), 'FAKE');
  r = await user('GET', `/api/videos/${ok.id}`);
  assert.equal(r.data.seconds, 20);
  assert.equal(r.data.script.scenes.length, 3);

  // another user cannot see it
  const stranger = client();
  await stranger('POST', '/api/auth/signup', { name: 'Xavier', email: 'x@test.dev', password: 'secret123' });
  r = await stranger('GET', `/api/videos/${ok.id}/video`);
  assert.equal(r.status, 404);

  // failure path: every frame and clip is rejected -> frames fall back to the
  // product photo, each clip is retried once, then FAILED + refund
  fake.failClips = true;
  r = await user('POST', '/api/videos', { productName: 'ساعة', image: PNG, style: 'UGC' });
  const bad = await settle(r.data.id);
  fake.failClips = false;
  assert.equal(bad.status, 'FAILED');
  assert.match(bad.error, /content policy/);
  assert.ok(JSON.parse(bad.clips_json).every((c) => c.frame.status === 'SKIPPED'), 'a failed first frame does not fail the video by itself');
  assert.ok(bad.refunded);
  r = await user('GET', '/api/auth/me');
  assert.equal(r.data.user.credits, 2, '3 - 1 used - 1 spent then refunded');

  const ledger = await prisma.creditTransaction.findMany({ where: { user: { email: 'mona@test.dev' } }, orderBy: { id: 'asc' } });
  assert.deepEqual(ledger.map((t) => t.reason), ['TOPUP', 'VIDEO', 'VIDEO', 'REFUND']);
  assert.equal(ledger.at(-1).balance, 2);

  // script preview is free, and an edited script is what the clips say
  r = await user('POST', '/api/videos/script-preview', { productName: 'ساعة', image: PNG, offer: 'بـ 300 جنيه' });
  assert.equal(r.status, 200);
  assert.equal(r.data.scenes.length, 3);
  r = await user('GET', '/api/auth/me');
  assert.equal(r.data.user.credits, 2, 'preview costs nothing');

  r = await user('POST', '/api/videos', { productName: 'ساعة', image: PNG, style: 'UGC', script: { scenes: [{ voiceover: 'سطر واحد' }] } });
  assert.equal(r.status, 400, 'wrong scene count refused');
  r = await user('GET', '/api/auth/me');
  assert.equal(r.data.user.credits, 2, 'refused request charges nothing');

  const edited = [{ voiceover: 'الساعة دي فخامة بجد!' }, { voiceover: 'ستانلس ومقاومة للمية.' }, { voiceover: 'بـ 300 جنيه بس، اطلبها!' }];
  const before = fake.submitted.length;
  r = await user('POST', '/api/videos', { productName: 'ساعة', image: PNG, style: 'UGC', script: { scenes: edited } });
  assert.equal(r.status, 201);
  const mine = await settle(r.data.id);
  assert.equal(mine.status, 'COMPLETED');
  const prompts = fake.submitted.slice(before).filter((x) => x.body.image_url).map((x) => x.body.prompt);
  assert.ok(edited.every((e, i) => prompts[i].includes(e.voiceover)), 'each clip speaks the edited line');
  assert.equal(JSON.parse(mine.script_json).source, 'USER_EDITED');

  // remake: same photo and script, a new charged render; not someone else's video
  r = await stranger('POST', `/api/videos/${mine.id}/remake`, {});
  assert.equal(r.status, 404);
  r = await user('POST', `/api/videos/${mine.id}/remake`, {});
  assert.equal(r.status, 201);
  const again = await settle(r.data.id);
  assert.equal(again.status, 'COMPLETED');
  assert.equal(again.image_key, mine.image_key);
  assert.deepEqual(JSON.parse(again.script_json).scenes.map((x) => x.voiceover), edited.map((x) => x.voiceover));
  r = await user('GET', '/api/auth/me');
  assert.equal(r.data.user.credits, 0);
  r = await user('POST', `/api/videos/${mine.id}/remake`, {});
  assert.equal(r.status, 402, 'no credits left');

  // showcase: only an admin picks, only picked finished videos are public
  const anon = client();
  r = await anon('GET', `/api/showcase/${ok.id}/video`);
  assert.equal(r.status, 404);
  r = await user('POST', `/api/admin/videos/${ok.id}/showcase`, { on: true });
  assert.equal(r.status, 403);
  r = await admin('POST', `/api/admin/videos/${bad.id}/showcase`, { on: true });
  assert.equal(r.status, 400, 'a failed video cannot be shown');
  r = await admin('POST', `/api/admin/videos/${ok.id}/showcase`, { on: true });
  assert.equal(r.data.showcase, true);
  r = await anon('GET', '/api/showcase');
  assert.deepEqual(r.data.videos.map((v) => v.id), [ok.id]);
  assert.equal(JSON.stringify(r.data).includes('mona'), false, 'no customer data in the public list');
  r = await anon('GET', `/api/showcase/${ok.id}/video`);
  assert.equal(r.status, 200);

  // Ingredients mode (like Google Flow): each clip is made from the first frame + the product photo as references
  process.env.VIMO_VIDEO_MODE = 'ingredients';
  const { saveSettings: save } = await import('../src/engine/settings.js');
  await save({ targetSeconds: 24 }); // the reference model only makes 8s clips
  try {
    await admin('POST', `/api/admin/users/${(await user('GET', '/api/auth/me')).data.user.id}/credits`, { delta: 1, note: 'test' });
    const start = fake.submitted.length;
    r = await user('POST', '/api/videos', { productName: 'جهاز', image: PNG, style: 'UGC' });
    assert.equal(r.status, 201);
    const ing = await settle(r.data.id);
    assert.equal(ing.status, 'COMPLETED', ing.error);
    const refSubs = fake.submitted.slice(start).filter((x) => x.model === 'fal-ai/veo3.1/fast/reference-to-video');
    assert.equal(refSubs.length, 3);
    assert.ok(refSubs.every((x) => x.body.image_urls.length === 2 && x.body.image_urls[0].endsWith('.jpg') && x.body.image_urls[1].startsWith('data:image/png')));
    assert.ok(refSubs.every((x) => x.body.prompt.includes('Scene: ')), 'the scene is described when there is no first frame to animate');
  } finally {
    delete process.env.VIMO_VIDEO_MODE;
    await save({ targetSeconds: 20 });
  }
});

test('engine: voiceover mode, idempotent orders, spending limits, balance gate, mock engine, admin page', { skip }, async () => {
  const { saveSettings } = await import('../src/engine/settings.js');
  const { clearBalanceCache } = await import('../src/engine/budget.js');
  const user = client();
  const admin = client();
  await admin('POST', '/api/auth/login', { email: 'boss@test.dev', password: 'secret123' });
  let r = await user('POST', '/api/auth/signup', { name: 'Omar', email: 'omar@test.dev', password: 'secret123' });
  const uid = r.data.user.id;
  await admin('POST', `/api/admin/users/${uid}/credits`, { delta: 10 });
  const credits = async () => (await user('GET', '/api/auth/me')).data.user.credits;

  r = await user('GET', '/api/admin/engines');
  assert.equal(r.status, 403);
  r = await admin('GET', '/api/admin/engines');
  assert.equal(r.status, 200);
  assert.equal(r.data.plans.UGC.mode, 'speech');
  assert.equal(r.data.plans.AUTO.mode, 'voiceover', 'AUTO picks the cheaper silent clips + voiceover');
  assert.ok(r.data.plans.AUTO.estimate.totalUsd < r.data.plans.UGC.estimate.totalUsd);
  assert.equal(JSON.stringify(r.data).includes('test-key'), false, 'no key reaches the browser');

  r = await user('GET', '/api/videos/quote');
  assert.deepEqual({ c: r.data.credits, s: r.data.seconds, a: r.data.available }, { c: 1, s: 20, a: true });
  assert.equal(JSON.stringify(r.data).match(/fal|veo|usd/i), null, 'the customer sees no provider or dollar');

  // AUTO = silent clips + one Egyptian voiceover laid over the joined video, two product photos as references
  const start = fake.submitted.length;
  r = await user('POST', '/api/videos', { description: 'سماعة بلوتوث بعزل ضوضاء', images: [PNG, PNG], clientRef: 'order-0001-abc' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.productName, 'سماعة بلوتوث بعزل ضوضاء');
  const again = await user('POST', '/api/videos', { description: 'سماعة بلوتوث بعزل ضوضاء', images: [PNG, PNG], clientRef: 'order-0001-abc' });
  assert.equal(again.data.id, r.data.id, 'the same click twice is one order');
  assert.equal(await credits(), 9, 'charged once');
  const vo = await settle(r.data.id);
  assert.equal(vo.status, 'COMPLETED', vo.error);
  const subs = fake.submitted.slice(start);
  const clips = subs.filter((x) => x.model === 'fal-ai/veo3.1/fast/image-to-video');
  assert.equal(clips.length, 3);
  assert.ok(clips.every((x) => x.body.generate_audio === false && /Nobody speaks/.test(x.body.prompt)));
  assert.ok(subs.filter((x) => x.model.includes('nano-banana')).every((x) => x.body.image_urls.length === 2), 'every photo is a reference for the first frame');
  const tts = subs.find((x) => x.model === 'fal-ai/elevenlabs/tts/eleven-v3');
  assert.ok(tts && tts.body.language_code === 'ar' && tts.body.text.length > 20);
  const mux = subs.find((x) => x.model === 'fal-ai/ffmpeg-api/merge-audio-video');
  assert.ok(mux && mux.body.audio_url.endsWith('.mp3') && mux.body.video_url.startsWith('https://cdn.fake/'));
  assert.ok(vo.cost_actual_usd > 2.4 && Math.abs(vo.cost_actual_usd - vo.cost_estimate_usd) < 0.05, `actual ${vo.cost_actual_usd} vs estimate ${vo.cost_estimate_usd}`);
  assert.equal(vo.provider, 'fal');

  // per-video limit: refused before any charge
  await saveSettings({ perVideoMaxUsd: 0.5 });
  r = await user('POST', '/api/videos', { description: 'ساعة ذكية', image: PNG });
  assert.equal(r.status, 503);
  assert.match(r.data.message, /مش متاح دلوقتي/);
  assert.equal(r.data.message.includes('$'), false, 'the customer gets no cost details');
  assert.equal(await credits(), 9);
  await saveSettings({ perVideoMaxUsd: 5 });

  // not enough live balance at fal
  fake.balance = 1; clearBalanceCache();
  r = await user('POST', '/api/videos', { description: 'ساعة ذكية', image: PNG });
  assert.equal(r.status, 503);
  fake.balance = 100; clearBalanceCache();

  // a key that may not read its balance: blocked until the admin confirms one
  fake.billingStatus = 403; clearBalanceCache();
  r = await user('POST', '/api/videos', { description: 'ساعة ذكية', image: PNG });
  assert.equal(r.status, 503);
  r = await admin('PUT', '/api/admin/engines', { providers: { fal: { confirmedBalanceUsd: 10 } } });
  assert.equal(r.data.providers.find((p) => p.id === 'fal').balance.source, 'confirmed');
  r = await user('POST', '/api/videos', { description: 'ساعة ذكية', image: PNG, style: 'SHOWCASE' });
  assert.equal(r.status, 201);
  const sc = await settle(r.data.id);
  assert.equal(sc.status, 'COMPLETED', sc.error);
  r = await admin('GET', '/api/admin/engines');
  const falRow = r.data.providers.find((p) => p.id === 'fal');
  assert.ok(falRow.balance.usd < 10 && falRow.balance.usd > 6, 'the confirmed budget goes down with each charge');
  assert.ok(r.data.errors.some((e) => e.kind === 'REFUSED'), 'refusals are logged for the admin');
  fake.billingStatus = 200; clearBalanceCache();

  // the daily limit counts spend and money held by videos still rendering
  await saveSettings({ perDayMaxUsd: 1 });
  r = await user('POST', '/api/videos', { description: 'ساعة ذكية', image: PNG });
  assert.equal(r.status, 503);
  await saveSettings({ perDayMaxUsd: 50 });

  // a model switched off is never picked
  await saveSettings({ models: { 'fal:veo31-fast': { enabled: false }, 'fal:veo31-fast-ref': { enabled: false } } });
  r = await admin('GET', '/api/admin/engines');
  assert.ok(r.data.plans.UGC.error, 'no standard model left -> no plan, no fallback to premium');
  r = await user('POST', '/api/videos', { description: 'ساعة ذكية', image: PNG });
  assert.equal(r.status, 503);
  await saveSettings({ models: { 'fal:veo31-fast': { enabled: true }, 'fal:veo31-fast-ref': { enabled: true } } });

  // the free mock engine: no fal call at all, zero cost
  await saveSettings({ providers: { mock: { enabled: true } } });
  const before = fake.submitted.length;
  r = await user('POST', '/api/videos', { description: 'كوباية حرارية', image: PNG, style: 'UGC' });
  assert.equal(r.status, 201);
  const m = await settle(r.data.id);
  await saveSettings({ providers: { mock: { enabled: false } } });
  assert.equal(m.status, 'COMPLETED', m.error);
  assert.equal(m.provider, 'mock');
  assert.equal(m.cost_actual_usd, 0);
  assert.equal(fake.submitted.length, before, 'nothing paid was called');
  r = await user('GET', `/api/videos/${m.id}/video`);
  assert.equal(r.status, 200);
  assert.ok(r.data.length > 1000, 'a real (tiny) mp4 to play in the browser');
  assert.equal(await credits(), 7);
});

test('hybrid: one AI clip + the real product photos under the voiceover, ~$0.21 a video', { skip }, async () => {
  const { saveSettings } = await import('../src/engine/settings.js');
  await saveSettings({ tier: 'economy', perVideoMaxUsd: 0.5, hybrid: true });
  fake.realMedia = true;
  try {
    const user = client();
    const admin = client();
    await admin('POST', '/api/auth/login', { email: 'boss@test.dev', password: 'secret123' });
    let r = await user('POST', '/api/auth/signup', { name: 'Salma', email: 'salma@test.dev', password: 'secret123' });
    await admin('POST', `/api/admin/users/${r.data.user.id}/credits`, { delta: 1 });
    r = await admin('GET', '/api/admin/engines');
    assert.equal(r.data.plans.AUTO.mode, 'hybrid');
    assert.ok(r.data.plans.AUTO.estimate.totalUsd <= 0.5, `$${r.data.plans.AUTO.estimate.totalUsd}`);

    const start = fake.submitted.length;
    r = await user('POST', '/api/videos', { description: 'زجاجة مياه حرارية ستانلس', images: [PNG_REAL, PNG_REAL] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const job = await settle(r.data.id, 30);
    assert.equal(job.status, 'COMPLETED', job.error);
    const subs = fake.submitted.slice(start);
    const clips = subs.filter((x) => x.model.startsWith('fal-ai/veo3.1/lite'));
    assert.equal(clips.length, 1, 'only one paid AI clip');
    assert.equal(clips[0].body.generate_audio, false);
    assert.equal(subs.filter((x) => x.model === 'fal-ai/nano-banana/edit').length, 1, 'one cheap first frame');
    assert.equal(subs.filter((x) => x.model.includes('merge')).length, 0, 'joined on our server, not on fal');
    assert.ok(subs.some((x) => x.model.includes('elevenlabs')));
    assert.ok(job.cost_actual_usd <= 0.25 && job.cost_actual_usd > 0.15, `actual $${job.cost_actual_usd}`);
    r = await user('GET', `/api/videos/${job.id}/video`);
    assert.equal(r.status, 200);
    assert.ok(r.data.length > 20000, 'a real 24s mp4');
  } finally {
    fake.realMedia = false;
    await saveSettings({ tier: 'standard', perVideoMaxUsd: 5, hybrid: false });
  }
});
