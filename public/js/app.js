// The customer app: four pages only. إنشاء فيديو، فيديوهاتي، الرصيد، حسابي.
// Nothing here names an AI provider or a model; the server picks the engine.
import { api, esc, $, $$, fmt, fmtDate, toast, shrinkImage, STATUS } from '/js/common.js';

const MAX_PHOTOS = 4;
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
const blankForm = (keep = {}) => ({
  images: [], description: '', style: 'AUTO', aspectRatio: '9:16', voiceGender: 'MALE', pace: 'fast', music: 'none', offer: '', script: null,
  ...keep, clientRef: newRef(),
});
const state = { me: null, cfg: null, quote: null, poll: null, form: blankForm() };

async function init() {
  try { state.me = (await api('GET', '/api/auth/me')).user; }
  catch { location.href = '/auth'; return; }
  state.cfg = await api('GET', '/api/config');
  window.addEventListener('hashchange', route);
  setCredits(state.me.credits);
  route();
}

function setCredits(n) {
  state.me.credits = n;
  $('#credits').textContent = fmt(n);
}

async function refreshMe() {
  const { user } = await api('GET', '/api/auth/me');
  state.me = user;
  setCredits(user.credits);
}

function route() {
  clearInterval(state.poll);
  state.poll = null;
  const tab = (location.hash || '#create').slice(1);
  $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const view = $('#view');
  view.classList.toggle('wide', tab === 'videos');
  window.scrollTo(0, 0);
  ({ create: renderCreate, videos: renderVideos, wallet: renderWallet, account: renderAccount }[tab] || renderCreate)(view)
    .catch((err) => { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

// ---------------------------------------------------------------------------
// إنشاء فيديو
// ---------------------------------------------------------------------------
const STYLE_OPTS = [
  ['AUTO', 'تلقائي', 'إحنا نختار أنسب شكل لمنتجك'],
  ['UGC', 'شخص بيتكلم', 'زي ريفيو حقيقي على تيك توك'],
  ['STUDIO', 'استوديو', 'شخص قاعد في استوديو شيك وبيكلم الكاميرا'],
  ['SHOWCASE', 'عرض المنتج', 'لقطات قريبة للمنتج بتعليق صوتي'],
];

async function renderCreate(view) {
  const f = state.form;
  state.quote = await api('GET', '/api/videos/quote').catch(() => ({ credits: 1, seconds: 24, available: true }));
  const q = state.quote;
  const seg = (name, items) => `<div class="seg" role="radiogroup">${items.map(([v, l]) => `<button type="button" data-seg="${name}" data-value="${v}" class="${f[name] === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;

  view.innerHTML = `
    <h1 class="hero-title">إعلان فيديو لمنتجك.</h1>
    <p class="hero-sub">ارفع صورة، اكتب سطر عن المنتج، والباقي علينا.</p>
    ${q.available ? '' : '<div class="notice">إنشاء الفيديوهات متوقف مؤقتًا. جرّب تاني كمان شوية.</div>'}
    <form class="card" id="createForm" novalidate>
      <div class="field">
        <span class="label">صور المنتج</span>
        <div class="photos" id="photos"></div>
        <input type="file" id="file" accept="image/png,image/jpeg,image/webp" multiple hidden />
        <div class="hint">صورة واضحة للمنتج. تقدر تضيف لحد ${fmt(MAX_PHOTOS)} صور من زوايا مختلفة عشان يطلع زي ما هو بالظبط.</div>
      </div>
      <div class="field">
        <label class="label" for="description">وصف المنتج</label>
        <textarea id="description" maxlength="1500" rows="3" placeholder="مثلًا: سماعة بلوتوث بعزل ضوضاء وبطارية 30 ساعة"></textarea>
      </div>
      <div class="field">
        <span class="label">شكل الإعلان</span>
        <div class="styles">${STYLE_OPTS.map(([v, t, d]) => `<button type="button" class="style-opt ${f.style === v ? 'active' : ''}" data-style="${v}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
      </div>
      <details class="advanced" id="advanced">
        <summary>إعدادات متقدمة</summary>
        <div class="adv-body">
          <div class="adv-row"><span class="label">المقاس</span>${seg('aspectRatio', [['9:16', 'طولي 9:16'], ['16:9', 'عرضي 16:9']])}</div>
          <div class="adv-row"><span class="label">الصوت</span>${seg('voiceGender', [['MALE', 'راجل'], ['FEMALE', 'ست']])}</div>
          <div class="adv-row"><span class="label">سرعة الكلام</span>${seg('pace', [['fast', 'سريع وحماسي'], ['normal', 'عادي']])}</div>
          <div class="adv-row"><span class="label">موسيقى في الخلفية</span>${seg('music', [['none', 'بدون'], ['light', 'خفيفة']])}</div>
          <div><label class="label" for="offer">السعر أو العرض</label><input id="offer" type="text" maxlength="200" placeholder="مثلًا: بـ 450 جنيه والشحن مجاني" /><div class="hint">بيتقال في آخر الإعلان.</div></div>
          <div id="scriptBox"></div>
        </div>
      </details>
      <div class="summary">
        <span class="muted">${fmt(q.seconds)} ثانية · <span id="ratioLabel">${f.aspectRatio}</span></span>
        <span class="cost">التكلفة: ${q.credits === 1 ? 'فيديو واحد' : `${fmt(q.credits)} فيديو`} من رصيدك <span class="muted">(معاك ${fmt(state.me.credits)})</span></span>
      </div>
      <div class="err" id="err"></div>
      <button class="btn primary block" id="go" ${q.available ? '' : 'disabled'}>إنشاء الفيديو</button>
    </form>`;

  // photos
  const photos = $('#photos');
  const file = $('#file');
  const drawPhotos = () => {
    photos.classList.toggle('empty', !f.images.length);
    photos.innerHTML = f.images.map((src, i) => `<div class="photo"><img src="${src}" alt="" />${i === 0 && f.images.length > 1 ? '<span class="main-tag">الأساسية</span>' : ''}<button type="button" class="x" data-rm="${i}" aria-label="شيل الصورة">×</button></div>`).join('')
      + (f.images.length < MAX_PHOTOS ? `<div class="add-photo" id="add" role="button" tabindex="0"><div><div class="plus">+</div>${f.images.length ? 'صورة تانية' : 'اضغط أو اسحب صورة المنتج هنا'}</div></div>` : '');
    $$('[data-rm]', photos).forEach((b) => { b.onclick = () => { f.images.splice(Number(b.dataset.rm), 1); f.script = null; drawPhotos(); drawScript(); }; });
    const add = $('#add');
    if (add) {
      add.onclick = () => file.click();
      add.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
      add.ondragover = (e) => { e.preventDefault(); add.classList.add('over'); };
      add.ondragleave = () => add.classList.remove('over');
      add.ondrop = (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); };
    }
  };
  const addFiles = async (list) => {
    for (const fl of [...list].slice(0, MAX_PHOTOS - f.images.length)) {
      try { f.images.push(await shrinkImage(fl)); } catch (err) { toast(err.message); }
    }
    drawPhotos();
  };
  file.onchange = () => { addFiles(file.files); file.value = ''; };
  drawPhotos();

  // choices
  $$('.style-opt', view).forEach((b) => { b.onclick = () => { f.style = b.dataset.style; f.script = null; $$('.style-opt', view).forEach((x) => x.classList.toggle('active', x === b)); drawScript(); }; });
  $$('[data-seg]', view).forEach((b) => {
    b.onclick = () => {
      f[b.dataset.seg] = b.dataset.value;
      $$(`[data-seg="${b.dataset.seg}"]`, view).forEach((x) => x.classList.toggle('active', x === b));
      if (b.dataset.seg === 'aspectRatio') $('#ratioLabel').textContent = f.aspectRatio;
      if (b.dataset.seg === 'pace') { f.script = null; drawScript(); }
    };
  });
  for (const id of ['description', 'offer']) { const el = $(`#${id}`); el.value = f[id] || ''; el.oninput = () => { f[id] = el.value; }; }
  if (f.offer || f.script || f.aspectRatio !== '9:16' || f.pace !== 'fast' || f.music !== 'none' || f.voiceGender !== 'MALE') $('#advanced').open = true;

  const inputs = () => ({
    images: f.images, description: f.description, offer: f.offer, style: f.style,
    aspectRatio: f.aspectRatio, voiceGender: f.voiceGender, pace: f.pace, music: f.music,
  });

  // optional: read and edit the script before ordering (free)
  function drawScript() {
    const box = $('#scriptBox');
    if (!box) return;
    if (!f.script) {
      box.innerHTML = '<span class="label">السكريبت</span><button type="button" class="btn small" id="preview">اكتبلي السكريبت أشوفه الأول (مجانًا)</button><div class="hint">اختياري. لو سبته، هنكتبه إحنا وقت الإنشاء.</div>';
      $('#preview').onclick = preview;
      return;
    }
    const labels = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? 'البداية' : i === n - 1 ? 'العرض والطلب' : 'المميزات'));
    const names = labels(f.script.scenes.length);
    box.innerHTML = `<span class="label">السكريبت <span class="muted" style="font-weight:400">(تقدر تعدّل الكلام)</span></span>
      ${f.script.scenes.map((sc, i) => `<div class="script-scene"><div class="hint">${names[i]} · ${fmt(f.script.sceneSeconds?.[i] || f.script.clipSeconds)} ثواني · <span data-count="${i}"></span></div><textarea data-scene="${i}" rows="2" style="min-height:64px">${esc(sc.voiceover)}</textarea></div>`).join('')}
      <button type="button" class="btn link" id="preview">اكتب سكريبت تاني</button>`;
    const limit = (i) => Math.round((f.script.sceneSeconds?.[i] || f.script.clipSeconds) * (f.pace === 'normal' ? 2.4 : 3.4));
    const count = (ta) => { const i = Number(ta.dataset.scene); const n = ta.value.trim().split(/\s+/).filter(Boolean).length; const el = $(`[data-count="${i}"]`, box); el.textContent = `${fmt(n)} كلمة`; el.style.color = n > limit(i) ? 'var(--warn)' : ''; };
    $$('textarea[data-scene]', box).forEach((ta) => { count(ta); ta.oninput = () => { f.script.scenes[Number(ta.dataset.scene)].voiceover = ta.value; count(ta); }; });
    $('#preview').onclick = preview;
  }
  async function preview() {
    const err = $('#err');
    err.textContent = '';
    if (!f.images.length) { err.textContent = 'ارفع صورة المنتج الأول.'; return; }
    if (!f.description.trim()) { err.textContent = 'اكتب وصف قصير للمنتج.'; return; }
    const btn = $('#preview');
    btn.disabled = true;
    btn.textContent = 'بنفهم المنتج ونكتب…';
    try {
      f.script = await api('POST', '/api/videos/script-preview', inputs());
      drawScript();
    } catch (e2) { err.textContent = e2.message; btn.disabled = false; btn.textContent = 'جرّب تاني'; }
  }
  drawScript();

  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err');
    err.textContent = '';
    if (!f.images.length) { err.textContent = 'ارفع صورة المنتج الأول.'; return; }
    if (!f.description.trim()) { err.textContent = 'اكتب وصف قصير للمنتج.'; $('#description').focus(); return; }
    if (state.me.credits < q.credits) { err.innerHTML = 'رصيدك خلص. <a href="#wallet">اشحن باقة</a> وكمّل.'; return; }
    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = 'بنبدأ…';
    try {
      // clientRef: pressing twice (or a retry after a slow network) is still one video and one charge.
      await api('POST', '/api/videos', { ...inputs(), clientRef: f.clientRef, script: f.script ? { product: f.script.product, scenes: f.script.scenes } : undefined });
      state.form = blankForm({ style: f.style, aspectRatio: f.aspectRatio, voiceGender: f.voiceGender, pace: f.pace, music: f.music });
      await refreshMe();
      toast('بدأنا نعمل الفيديو');
      location.hash = 'videos';
    } catch (e2) {
      err.textContent = e2.message;
      btn.disabled = false;
      btn.textContent = 'إنشاء الفيديو';
    }
  };
}

// ---------------------------------------------------------------------------
// فيديوهاتي
// ---------------------------------------------------------------------------
function videoCard(v) {
  const [label, tone] = STATUS[v.status] || [v.status, ''];
  const done = ['COMPLETED', 'FAILED'].includes(v.status);
  const media = v.videoUrl
    ? `<video src="${v.videoUrl}" controls playsinline preload="metadata" poster="${v.imageUrl}"></video>`
    : `<img src="${v.imageUrl}" alt="" /><div class="overlay">${esc(label)}${done ? '' : '…'}</div>`;
  return `
    <div class="vcard">
      <div class="media ${v.aspectRatio === '16:9' ? 'wide' : ''}">${media}</div>
      <div class="body">
        <div class="title">${esc(v.productName)}</div>
        <div class="meta"><span class="pill ${tone}">${esc(label)}</span> · ${fmtDate(v.createdAt)}</div>
        ${done ? '' : `<div class="bar"><i style="width:${v.progress}%"></i></div><div class="meta">ممكن تقفل الصفحة، هيكمل لوحده.</div>`}
        ${v.status === 'FAILED' ? `<div class="meta">${esc(v.error || '')}${v.refunded ? ' الرصيد رجعلك.' : ''}</div>` : ''}
        ${v.script ? `<details><summary class="meta" style="cursor:pointer">السكريبت</summary><ol class="meta" style="padding-inline-start:18px;margin:6px 0 0">${v.script.scenes.map((s) => `<li>${esc(s.voiceover)}</li>`).join('')}</ol></details>` : ''}
        <div class="actions">
          ${v.videoUrl ? `<a class="btn primary small" href="${v.videoUrl}?download=1">تحميل</a>` : ''}
          ${done ? `<button class="btn small" data-remake="${v.id}">اعمله تاني</button>` : ''}
        </div>
      </div>
    </div>`;
}

async function renderVideos(view) {
  const load = async () => {
    const { videos } = await api('GET', '/api/videos');
    view.innerHTML = `
      <h1 class="hero-title">فيديوهاتي</h1>
      <p class="hero-sub">كل إعلاناتك في مكان واحد.</p>
      ${videos.length ? `<div class="vgrid">${videos.map(videoCard).join('')}</div>` : '<div class="card empty">لسه معملتش أي فيديو.<br /><br /><a class="btn primary" href="#create">اعمل أول فيديو</a></div>'}`;
    $$('[data-remake]', view).forEach((b) => { b.onclick = () => remake(b.dataset.remake); });
    const busy = videos.some((v) => !['COMPLETED', 'FAILED'].includes(v.status));
    if (!busy) { clearInterval(state.poll); state.poll = null; refreshMe().catch(() => {}); }
    return busy;
  };
  if (await load() && !state.poll) state.poll = setInterval(() => load().catch(() => {}), 5000);
}

async function remake(id) {
  if (state.me.credits < 1) { toast('رصيدك خلص، اشحن باقة الأول.'); location.hash = 'wallet'; return; }
  if (!confirm('هنعمل فيديو جديد بنفس الصور والسكريبت، وهيتخصم فيديو من رصيدك. نكمّل؟')) return;
  try {
    await api('POST', `/api/videos/${id}/remake`, { sameScript: true });
    await refreshMe();
    toast('بدأنا نعمله تاني');
    route();
  } catch (err) { toast(err.message); }
}

// ---------------------------------------------------------------------------
// الرصيد
// ---------------------------------------------------------------------------
const TOPUP_STATUS = { PENDING: ['بيتراجع', 'warn'], APPROVED: ['اتأكد', 'ok'], REJECTED: ['مرفوض', 'bad'] };
const REASON = { TOPUP: 'شحن رصيد', VIDEO: 'فيديو', REFUND: 'رجوع رصيد', ADMIN_ADJUST: 'تعديل من الإدارة', SIGNUP_BONUS: 'هدية التسجيل' };

async function renderWallet(view) {
  const w = await api('GET', '/api/wallet');
  setCredits(w.credits);
  const cfg = state.cfg;
  let selected = cfg.packages[1]?.key || cfg.packages[0]?.key;
  view.innerHTML = `
    <h1 class="hero-title">الرصيد</h1>
    <div class="card"><div class="balance"><span class="n">${fmt(w.credits)}</span><span class="muted">فيديو متاح</span></div></div>
    <form class="card" id="topupForm" novalidate>
      <h2>اشحن باقة</h2>
      <div class="packs">${cfg.packages.map((p) => `<button type="button" class="pack ${p.key === selected ? 'active' : ''}" data-key="${p.key}">
        <div class="v">${p.videos === 1 ? 'فيديو واحد' : `${fmt(p.videos)} فيديوهات`}</div>
        <div class="p">${fmt(p.priceEgp)} <small class="muted" style="font-size:14px;font-weight:500">ج.م</small></div>
        <div class="per">${fmt(p.perVideoEgp)} ج.م للفيديو</div></button>`).join('')}</div>
      <p class="muted" style="margin:22px 0 18px">${cfg.vodafoneCashNumber ? `حوّل المبلغ فودافون كاش على <b dir="ltr" style="color:var(--text)">${esc(cfg.vodafoneCashNumber)}</b> وابعتلنا البيانات.` : 'رقم التحويل هيتبعتلك من الدعم.'}</p>
      <div class="field"><label class="label" for="senderPhone">الرقم اللي حوّلت منه</label><input id="senderPhone" type="tel" dir="ltr" placeholder="01xxxxxxxxx" /></div>
      <div class="field"><label class="label" for="reference">رقم العملية <span class="muted" style="font-weight:400">(اختياري)</span></label><input id="reference" type="text" dir="ltr" /></div>
      <div class="field"><label class="label" for="receipt">صورة التحويل <span class="muted" style="font-weight:400">(اختياري)</span></label><input id="receipt" type="file" accept="image/png,image/jpeg,image/webp" /></div>
      <div class="err" id="err"></div>
      <button class="btn primary block" id="send">ابعت طلب الشحن</button>
    </form>
    ${w.topups.length ? `<div class="card"><h2>طلبات الشحن</h2><div class="list">${w.topups.map((t) => { const [l, c] = TOPUP_STATUS[t.status] || [t.status, '']; return `<div class="row"><span>${fmt(t.videos)} فيديو · ${fmt(t.amountEgp)} ج.م<br /><span class="muted" style="font-size:13px">${fmtDate(t.createdAt)}${t.adminNote ? ` · ${esc(t.adminNote)}` : ''}</span></span><span class="pill ${c}">${l}</span></div>`; }).join('')}</div></div>` : ''}
    ${w.transactions.length ? `<div class="card"><h2>حركة الرصيد</h2><div class="list">${w.transactions.map((t) => `<div class="row"><span>${esc(REASON[t.reason] || t.reason)}<br /><span class="muted" style="font-size:13px">${fmtDate(t.createdAt)}</span></span><span dir="ltr" style="color:${t.delta > 0 ? 'var(--ok)' : 'var(--text)'};font-weight:600">${t.delta > 0 ? '+' : ''}${t.delta}</span></div>`).join('')}</div></div>` : ''}`;

  $$('.pack', view).forEach((b) => { b.onclick = () => { selected = b.dataset.key; $$('.pack', view).forEach((x) => x.classList.toggle('active', x === b)); }; });
  $('#topupForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#send');
    $('#err').textContent = '';
    btn.disabled = true;
    try {
      const fl = $('#receipt').files[0];
      const receipt = fl ? await shrinkImage(fl, 1600, 0.85) : undefined;
      await api('POST', '/api/wallet/topups', { packageKey: selected, senderPhone: $('#senderPhone').value.trim(), reference: $('#reference').value.trim(), receipt });
      toast('طلبك وصل، هنضيف الرصيد بعد التأكيد');
      renderWallet(view);
    } catch (err) {
      $('#err').textContent = err.message;
      btn.disabled = false;
    }
  };
}

// ---------------------------------------------------------------------------
// حسابي
// ---------------------------------------------------------------------------
async function renderAccount(view) {
  const me = state.me;
  view.innerHTML = `
    <h1 class="hero-title">حسابي</h1>
    <p class="hero-sub">${esc(me.email)}</p>
    <form class="card" id="profileForm" novalidate>
      <h2>بياناتك</h2>
      <div class="field"><label class="label" for="name">الاسم</label><input id="name" type="text" maxlength="80" value="${esc(me.name)}" /></div>
      <div class="field"><label class="label" for="phone">رقم الموبايل</label><input id="phone" type="tel" dir="ltr" maxlength="20" value="${esc(me.phone || '')}" /></div>
      <div class="err" id="perr"></div>
      <button class="btn primary">حفظ</button>
    </form>
    <form class="card" id="pwForm" novalidate>
      <h2>كلمة المرور</h2>
      <div class="field"><label class="label" for="cur">كلمة المرور الحالية</label><input id="cur" type="password" autocomplete="current-password" /></div>
      <div class="field"><label class="label" for="nw">كلمة المرور الجديدة</label><input id="nw" type="password" autocomplete="new-password" minlength="8" /></div>
      <div class="err" id="pwerr"></div>
      <button class="btn">غيّر كلمة المرور</button>
    </form>
    <div class="card tight" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      ${me.role === 'ADMIN' ? '<a class="btn small" href="/admin">لوحة الإدارة</a>' : '<span></span>'}
      <button class="btn small" id="logout" style="color:var(--bad)">تسجيل خروج</button>
    </div>`;

  $('#profileForm').onsubmit = async (e) => {
    e.preventDefault();
    $('#perr').textContent = '';
    try {
      const { user } = await api('PATCH', '/api/auth/me', { name: $('#name').value, phone: $('#phone').value });
      state.me = user;
      toast('اتحفظ');
    } catch (err) { $('#perr').textContent = err.message; }
  };
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    $('#pwerr').textContent = '';
    try {
      await api('POST', '/api/auth/password', { currentPassword: $('#cur').value, newPassword: $('#nw').value });
      $('#cur').value = ''; $('#nw').value = '';
      toast('كلمة المرور اتغيرت');
    } catch (err) { $('#pwerr').textContent = err.message; }
  };
  $('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); location.href = '/'; };
}

init();
