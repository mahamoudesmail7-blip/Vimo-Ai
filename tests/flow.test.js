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
const fake = { submitted: [], polls: {}, failClips: false, mergeInputs: [] };
async function fakeFetch(url, opts = {}) {
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    return json(200, { video: { url: `https://cdn.fake/${rs[1]}.mp4` } });
  }
  if (url.startsWith('https://cdn.fake/')) return new Response(Buffer.from('FAKE-MP4-BYTES-0123456789'), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
}

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
  ({ processDueJobs } = await import('../src/services/videoJob.js'));
  for (const t of ['credit_transactions', 'topup_requests', 'video_jobs', 'blobs', 'users']) await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  const { createApp } = await import('../src/server.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
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
  const clipSubs = fake.submitted.filter((s) => !s.body.video_urls);
  assert.equal(clipSubs.length, 3, 'three clips');
  assert.ok(clipSubs.every((s) => s.body.image_url.startsWith('data:image/png') && s.body.duration === '8s'));
  assert.equal(fake.mergeInputs.at(-1).length, 3, 'merged three clips');

  r = await user('GET', `/api/videos/${ok.id}/video`, null, { Range: 'bytes=0-3' });
  assert.equal(r.status, 206);
  assert.equal(r.data.toString(), 'FAKE');
  r = await user('GET', `/api/videos/${ok.id}`);
  assert.equal(r.data.seconds, 24);
  assert.equal(r.data.script.scenes.length, 3);

  // another user cannot see it
  const stranger = client();
  await stranger('POST', '/api/auth/signup', { name: 'Xavier', email: 'x@test.dev', password: 'secret123' });
  r = await stranger('GET', `/api/videos/${ok.id}/video`);
  assert.equal(r.status, 404);

  // failure path: every clip is rejected -> each is retried once, then FAILED + refund
  fake.failClips = true;
  r = await user('POST', '/api/videos', { productName: 'ساعة', image: PNG });
  const bad = await settle(r.data.id);
  fake.failClips = false;
  assert.equal(bad.status, 'FAILED');
  assert.match(bad.error, /content policy/);
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

  r = await user('POST', '/api/videos', { productName: 'ساعة', image: PNG, script: { scenes: [{ voiceover: 'سطر واحد' }] } });
  assert.equal(r.status, 400, 'wrong scene count refused');
  r = await user('GET', '/api/auth/me');
  assert.equal(r.data.user.credits, 2, 'refused request charges nothing');

  const edited = [{ voiceover: 'الساعة دي فخامة بجد!' }, { voiceover: 'ستانلس ومقاومة للمية.' }, { voiceover: 'بـ 300 جنيه بس، اطلبها!' }];
  const before = fake.submitted.length;
  r = await user('POST', '/api/videos', { productName: 'ساعة', image: PNG, script: { scenes: edited } });
  assert.equal(r.status, 201);
  const mine = await settle(r.data.id);
  assert.equal(mine.status, 'COMPLETED');
  const prompts = fake.submitted.slice(before).filter((x) => !x.body.video_urls).map((x) => x.body.prompt);
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
});
