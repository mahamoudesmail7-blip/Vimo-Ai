// The customer app: four pages only. إنشاء فيديو، فيديوهاتي، الرصيد، حسابي.
// Nothing here names an AI provider or a model; the server picks the engine.
import { api, esc, $, $$, fmt, fmtDate, toast, shrinkImage, STATUS } from '/js/common.js';
import { reveal, slider, aiSteps } from '/js/motion.js';

const MAX_PHOTOS = 4;
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
const blankForm = (keep = {}) => ({
  images: [], description: '', style: 'AUTO', goal: 'SALES', aspectRatio: '9:16', voiceGender: 'MALE', music: 'none', offer: '', details: '', analysis: null, autoDesc: '', script: null,
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
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  ({ create: renderCreate, videos: renderVideos, wallet: renderWallet, account: renderAccount }[tab] || renderCreate)(view)
    .catch((err) => { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

// ---------------------------------------------------------------------------
// إنشاء فيديو
// ---------------------------------------------------------------------------
// [value, title, what the customer gets, what is in the video]
const STYLE_OPTS = [
  ['AUTO', 'تلقائي', 'مش عارف تختار؟ إحنا بنشوف منتجك ونختار الشكل اللي يناسبه.', ['أول فيديو ليك بيطلع بشكل الاستوديو', 'بعد كده بنختار الأنسب لمنتجك']],
  ['UGC', 'شخص بيتكلم', 'شخص مصري ماسك منتجك وبيتكلم عنه للكاميرا في بيت حقيقي، زي ريفيو على تيك توك.', ['تصوير موبايل طبيعي', 'نفس الشخص من أول الفيديو لآخره', 'كلام مكتوب على الشاشة']],
  ['STUDIO', 'استوديو', 'شخص قاعد في استوديو شيك بحيطة غامقة وإضاءة دافية، ماسك منتجك وبيكلم الكاميرا.', ['شكل احترافي زي إعلانات البراندات', 'كلام مكتوب أبيض وأصفر', 'السعر في بادج أصفر في الآخر']],
  ['SHOWCASE', 'عرض المنتج', 'لقطات قريبة لمنتجك بحركة كاميرا ناعمة وصوت بيشرح، من غير شخص.', ['المنتج هو البطل', 'مناسب للإكسسوارات والأجهزة']],
];
const GOAL_OPTS = [
  ['SALES', 'بيع مباشر', 'الميزة والسعر واطلب دلوقتي'],
  ['CURIOSITY', 'فضول', 'بداية تخلّي اللي بيتفرج يكمّل'],
  ['PROBLEM', 'مشكلة وحل', 'مشكلة بيقابلها والمنتج بيحلها'],
  ['OFFER', 'عرض خاص', 'السعر والعرض هما البطل'],
];
// what the AI does for the customer, on the slider at the top of the create page
const AI_SLIDES = [
  ['eye', 'أي منتج، من صورة واحدة', 'لبس، تجميل، مطبخ، إلكترونيات، أكل… بيفهم نوعه وألوانه وتفاصيله.'],
  ['spark', 'بيكتب 5 هوكات ويختار الأقوى', 'كل هوك بزاوية مختلفة وبتقييم من 10.'],
  ['walk', 'منتجك وهو بيتستخدم فعلًا', 'الكريم على البشرة، والطاسة في المطبخ، واللبس على الجسم، وكل الألوان.'],
  ['check', 'بيراجع كل كلمة قبل ما تدفع', 'السعر والتكرار والمميزات اللي محدش قالها.'],
  ['mic', 'صوت مصري طبيعي', 'وبنسمع الفيديو بعد ما يخلص عشان نتأكد إن السعر اتقال صح.'],
];
const ICONS = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l2-6 3 3v3M9 11l3-3 3 2 3 1M12 8l-1 5"/>',
  check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
};
const aiSlide = ([icon, title, text]) => `<div class="slide ai-slide"><span class="ai-ico"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span><div><b>${title}</b><span>${text}</span></div></div>`;
const CHECK_NAMES = { REPEAT: 'تكرار', INVENTED: 'ميزة مش مكتوبة', PRICE: 'السعر', LONG_SENTENCE: 'جملة طويلة', TOO_LONG: 'كلام كتير', FORMAL: 'فصحى', DIGITS: 'أرقام' };
const step = (n, title, body, hint = '') => `<section class="step"><div class="step-head"><span class="step-n">${fmt(n)}</span><span class="label">${title}</span></div>${hint ? `<div class="hint step-hint">${hint}</div>` : ''}${body}</section>`;

const styleCard = ([v, t, d, pts], f) => `
  <div class="style-opt ${f.style === v ? 'active' : ''}" data-style="${v}" role="radio" aria-checked="${f.style === v}" tabindex="0">
    <div class="style-text"><b>${t}</b><span>${d}</span><ul>${pts.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <div class="style-sample" data-sample="${v}" hidden></div>
  </div>`;

// One finished sample video per style (picked by the admin), shown inside each card.
async function drawStyleSamples(view) {
  const { videos = [] } = await api('GET', '/api/showcase').catch(() => ({}));
  const pick = { AUTO: videos[0] };
  for (const v of videos) pick[v.style] ||= v;
  for (const box of $$('[data-sample]', view)) {
    const v = pick[box.dataset.sample];
    if (!v) continue;
    box.hidden = false;
    box.innerHTML = `<video src="${v.videoUrl}" poster="${v.imageUrl}" muted loop playsinline autoplay preload="metadata"></video><button type="button" class="sample-play" aria-label="شوف المثال بالصوت">▶ شوف مثال</button>`;
    $('.sample-play', box).onclick = (e) => { e.stopPropagation(); playSample(v); };
  }
}

function playSample(v) {
  const wrap = document.createElement('div');
  wrap.className = 'sample-modal';
  wrap.innerHTML = `<div class="sample-box ${v.aspectRatio === '16:9' ? 'wide' : ''}"><video src="${v.videoUrl}" controls autoplay playsinline></video><button type="button" class="x" aria-label="اقفل">×</button></div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.onclick = (e) => { if (e.target === wrap || e.target.classList.contains('x')) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
}

async function renderCreate(view) {
  const f = state.form;
  state.quote = await api('GET', '/api/videos/quote').catch(() => ({ credits: 1, seconds: 24, available: true }));
  const q = state.quote;
  const seg = (name, items) => `<div class="seg" role="radiogroup">${items.map(([v, l]) => `<button type="button" data-seg="${name}" data-value="${v}" class="${f[name] === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;

  view.innerHTML = `
    <h1 class="hero-title reveal">إعلان فيديو لمنتجك<span class="ai-dot">.</span></h1>
    <p class="hero-sub reveal">ارفع صورة المنتج، واضغط زرار السكريبت. الباقي علينا.</p>
    <div class="slider reveal" id="aiSlider" aria-roledescription="slider"><div class="slides">${AI_SLIDES.map(aiSlide).join('')}</div><div class="dots"></div></div>
    ${q.available ? '' : '<div class="notice">إنشاء الفيديوهات متوقف مؤقتًا. جرّب تاني كمان شوية.</div>'}
    <form class="card" id="createForm" novalidate>
      ${step(1, 'صورة المنتج', `<div class="photos" id="photos"></div>
        <input type="file" id="file" accept="image/png,image/jpeg,image/webp" multiple hidden />
        <div class="hint">صورة واضحة للمنتج. تقدر تضيف لحد ${fmt(MAX_PHOTOS)} صور من زوايا مختلفة.</div>`)}
      ${step(2, 'المنتج', `<div id="analysis"></div>
        <textarea id="description" maxlength="1500" rows="2" placeholder="هنكتب وصف المنتج من الصورة، وتقدر تعدّله"></textarea>
        <div class="hint" id="descHint">بنفهم المنتج من الصور، وتقدر تعدّل الوصف أو تزوّد عليه.</div>
        <div class="two-col">
          <div><label class="label sub-label" for="offer">السعر <span class="muted" style="font-weight:400">(اختياري)</span></label>
          <input id="offer" type="text" maxlength="200" placeholder="مثلًا: 350 جنيه بدل 700" /></div>
          <div><label class="label sub-label" for="details">تفاصيل إضافية <span class="muted" style="font-weight:400">(اختياري)</span></label>
          <input id="details" type="text" maxlength="500" placeholder="مثلًا: مقاسات من 40 لـ 45، توصيل لكل المحافظات" /></div>
        </div>
        <div class="hint">مش هنقول سعر أو عرض أو ميزة إنت ما كتبتهاش.</div>`)}
      ${step(3, 'شكل الإعلان', `<div class="styles" role="radiogroup">${STYLE_OPTS.map((o) => styleCard(o, f)).join('')}</div>`)}
      ${step(4, 'الكلام', `<div class="sub-label label">عايز الكلام يكون إزاي؟</div>
        <div class="goals" role="radiogroup">${GOAL_OPTS.map(([v, t, d]) => `<button type="button" class="goal-opt ${f.goal === v ? 'active' : ''}" data-goal="${v}" role="radio" aria-checked="${f.goal === v}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
        <div class="adv-row" style="margin-top:14px"><span class="label">مين بيتكلم</span>${seg('voiceGender', [['MALE', 'راجل'], ['FEMALE', 'ست']])}</div>
        <div id="scriptBox"></div>`)}
      <details class="advanced" id="advanced">
        <summary>إعدادات إضافية</summary>
        <div class="adv-body">
          <div class="adv-row"><span class="label">المقاس</span>${seg('aspectRatio', [['9:16', 'طولي 9:16'], ['16:9', 'عرضي 16:9']])}</div>
          <div class="adv-row"><span class="label">موسيقى في الخلفية</span>${seg('music', [['none', 'بدون'], ['light', 'خفيفة']])}</div>
        </div>
      </details>
      <div class="summary">
        <span class="muted">${fmt(q.seconds)} ثانية · <span id="ratioLabel">${f.aspectRatio}</span></span>
        <span class="cost">التكلفة: ${q.credits === 1 ? 'فيديو واحد' : `${fmt(q.credits)} فيديو`} من رصيدك <span class="muted">(معاك ${fmt(state.me.credits)})</span></span>
      </div>
      <div class="err" id="err"></div>
      <button class="btn primary block" id="go" disabled>إنشاء الفيديو</button>
      <div class="hint" id="goHint" style="text-align:center"></div>
    </form>`;

  // photos
  const photos = $('#photos');
  const file = $('#file');
  const drawPhotos = () => {
    photos.classList.toggle('empty', !f.images.length);
    photos.innerHTML = f.images.map((src, i) => `<div class="photo"><img src="${src}" alt="" />${i === 0 && f.images.length > 1 ? '<span class="main-tag">الأساسية</span>' : ''}<button type="button" class="x" data-rm="${i}" aria-label="شيل الصورة">×</button></div>`).join('')
      + (f.images.length < MAX_PHOTOS ? `<div class="add-photo" id="add" role="button" tabindex="0"><div><div class="plus">+</div>${f.images.length ? 'صورة تانية' : 'اضغط أو اسحب صورة المنتج هنا'}</div></div>` : '');
    $$('[data-rm]', photos).forEach((b) => { b.onclick = () => { f.images.splice(Number(b.dataset.rm), 1); f.script = null; drawPhotos(); drawScript(); analyze(); }; });
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
    f.script = null;
    drawPhotos();
    drawScript();
    analyze();
  };

  // what the photos show: the customer doesn't have to describe the product
  let analyzing = 0;
  const drawAnalysis = (busy = false) => {
    const box = $('#analysis');
    const a = f.analysis;
    $('#photos').classList.toggle('scanning', busy);
    if (busy) { box.innerHTML = '<div class="analysis busy"></div>'; aiSteps(box.firstChild, ['بنحدد نوع المنتج', 'بنشوف الألوان والتفاصيل', 'بنفرّق بين المؤكد واللي مش باين'], { every: 1100 }); return; }
    if (!a) { box.innerHTML = ''; return; }
    let n = 0;
    const chips = (list, cls) => list.map((x) => `<span class="fact ${cls}" style="--d:${(n++) * 60}ms">${esc(x)}</span>`).join('');
    box.innerHTML = `<div class="analysis pop">
      ${a.productAr ? `<div class="an-title">${esc(a.productAr)}</div>` : ''}
      ${a.colors.length ? `<div class="an-row"><span class="an-k">الألوان</span>${chips(a.colors, 'color')}</div>` : ''}
      ${a.confirmed.length ? `<div class="an-row"><span class="an-k">باين في الصور</span>${chips(a.confirmed, 'ok')}</div>` : ''}
      ${a.likely.length ? `<div class="an-row"><span class="an-k">غالبًا</span>${chips(a.likely, 'maybe')}</div>` : ''}
      ${a.unknown.length ? `<div class="an-row"><span class="an-k">مش معروف</span>${chips(a.unknown, 'no')}</div><div class="hint">مش هنقول عنهم حاجة في الإعلان إلا لو كتبتهم.</div>` : ''}
    </div>`;
  };
  async function analyze() {
    const ticket = ++analyzing;
    f.analysis = null;
    if (!f.images.length) { drawAnalysis(); return; }
    drawAnalysis(true);
    try {
      const { analysis } = await api('POST', '/api/videos/analyze', { images: f.images });
      if (ticket !== analyzing) return;
      f.analysis = analysis;
      const desc = $('#description');
      // fill the description only if the customer hasn't written their own
      if (analysis?.description && (!f.description.trim() || f.description === f.autoDesc)) {
        f.description = f.autoDesc = desc.value = analysis.description;
      }
      $('#descHint').textContent = analysis ? 'ده الوصف اللي فهمناه من الصور، عدّل فيه براحتك.' : 'اكتب سطر عن المنتج.';
    } catch { if (ticket === analyzing) $('#descHint').textContent = 'اكتب سطر عن المنتج.'; }
    if (ticket === analyzing) drawAnalysis();
  }
  file.onchange = () => { addFiles(file.files); file.value = ''; };
  drawPhotos();
  drawAnalysis();
  reveal(view);
  slider($('#aiSlider'), { every: 3800 });

  // choices
  $$('.style-opt', view).forEach((b) => {
    b.onclick = () => {
      f.style = b.dataset.style; f.script = null;
      $$('.style-opt', view).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
      drawScript();
    };
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } };
  });
  drawStyleSamples(view);
  $$('[data-seg]', view).forEach((b) => {
    b.onclick = () => {
      f[b.dataset.seg] = b.dataset.value;
      $$(`[data-seg="${b.dataset.seg}"]`, view).forEach((x) => x.classList.toggle('active', x === b));
      if (b.dataset.seg === 'aspectRatio') $('#ratioLabel').textContent = f.aspectRatio;
      if (b.dataset.seg === 'voiceGender') { f.script = null; drawScript(); }
    };
  });
  for (const id of ['description', 'offer', 'details']) { const el = $(`#${id}`); el.value = f[id] || ''; el.oninput = () => { f[id] = el.value; }; }
  if (f.aspectRatio !== '9:16' || f.music !== 'none') $('#advanced').open = true;
  $$('.goal-opt', view).forEach((b) => {
    b.onclick = () => {
      f.goal = b.dataset.goal; f.script = null;
      $$('.goal-opt', view).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
      drawScript();
    };
  });
  for (const id of ['offer', 'details']) $(`#${id}`).addEventListener('change', () => { if (f.script) { f.script = null; drawScript(); } });

  const inputs = () => ({
    images: f.images, description: f.description, offer: f.offer, details: f.details, analysis: f.analysis || undefined,
    style: f.style, goal: f.goal, aspectRatio: f.aspectRatio, voiceGender: f.voiceGender, music: f.music,
  });
  const hasProduct = () => f.description.trim() || f.analysis?.productAr;

  // the script comes first: read it, change any line, then order (free until then)
  const goBtn = () => {
    const go = $('#go');
    go.disabled = !q.available || !f.script;
    $('#goHint').textContent = !q.available ? '' : f.script ? `الفيديو بيتعمل بالسكريبت ده بالظبط، وبيتخصم ${q.credits === 1 ? 'فيديو واحد' : `${fmt(q.credits)} فيديو`} من رصيدك.` : 'اكتب السكريبت وراجعه الأول، وبعدين اعمل الفيديو.';
  };
  const limit = (i) => f.script.limits?.[i] || Math.max(8, Math.round((f.script.sceneSeconds?.[i] || f.script.clipSeconds) * 2.3));
  const names = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? 'الهوك' : i === n - 1 ? 'العرض والطلب' : 'الاستخدام والمميزات'));
  function drawChecks() {
    const el = $('#checks');
    const c = f.script?.checks;
    if (!el || !c) return;
    el.innerHTML = `<div class="checks pop ${c.ok ? 'ok' : ''}">
      <div class="checks-title">${c.ok ? '✓ راجعنا السكريبت ومفيش مشاكل' : 'راجعنا السكريبت، وفي حاجات محتاجة نظرة:'}</div>
      ${c.issues.map((x) => `<div class="issue">⚠️ <b>${CHECK_NAMES[x.kind] || ''}</b> ${esc(x.message)}</div>`).join('')}
      <div class="passed">${c.passed.map((x) => `<span>✓ ${esc(x)}</span>`).join('')}</div>
    </div>`;
  }
  let checkTimer = 0;
  const recheck = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      if (!f.script) return;
      try {
        f.script.checks = await api('POST', '/api/videos/script-check', { ...inputs(), images: undefined, script: { scenes: f.script.scenes }, limits: f.script.scenes.map((_, i) => limit(i)) });
        drawChecks();
      } catch { /* the review is a help, not a gate */ }
    }, 500);
  };
  function useHook(k) {
    const hooks = f.script.hooks;
    const first = f.script.scenes[0];
    const old = hooks[f.script.hookIndex]?.text;
    let rest = first.voiceover.trim();
    if (old && rest.startsWith(old)) rest = rest.slice(old.length).replace(/^[\s،,.!؟?]+/, '');
    first.voiceover = rest ? `${hooks[k].text}، ${rest}` : hooks[k].text;
    f.script.hookIndex = k;
    drawScript();
    recheck();
  }
  async function rewrite(i, btn) {
    btn.disabled = true;
    btn.textContent = 'بنكتبها…';
    try {
      const out = await api('POST', '/api/videos/rewrite-line', { ...inputs(), script: { scenes: f.script.scenes }, index: i, limit: limit(i) });
      f.script.scenes[i].voiceover = out.voiceover;
      drawScript();
      recheck();
    } catch (e2) { toast(e2.message); btn.disabled = false; btn.textContent = '↻ اكتبها تاني'; }
  }
  function drawScript() {
    const box = $('#scriptBox');
    if (!box) return;
    goBtn();
    if (!f.script) {
      box.innerHTML = '<button type="button" class="btn block script-btn" id="preview">✍️ اكتبلي السكريبت أشوفه الأول (مجانًا)</button><div class="hint" style="text-align:center">بنكتب 5 بدايات ونختار أقواها، وبتشوف الكلام والمشاهد وتعدّل قبل ما تدفع.</div>';
      $('#preview').onclick = preview;
      return;
    }
    const sc = f.script;
    const n = names(sc.scenes.length);
    const hooks = sc.hooks || [];
    box.innerHTML = `
      ${hooks.length ? `<div class="hooks"><span class="label sub-label">البداية (الهوك) <span class="muted" style="font-weight:400">كتبنا ${fmt(hooks.length)} واخترنا الأقوى، اضغط على أي واحد تبدّل بيه</span></span>
        ${hooks.map((h, k) => `<button type="button" class="hook reveal ${k === sc.hookIndex ? 'active' : ''}" data-hook="${k}"><span class="score">${fmt(h.score)}/10<span class="meter"><i style="--w:${h.score * 10}%"></i></span></span><span class="h-text">${esc(h.text)}</span>${h.why ? `<span class="h-why">${esc(h.why)}</span>` : ''}</button>`).join('')}
      </div>` : ''}
      <span class="label sub-label">السكريبت <span class="muted" style="font-weight:400">(عدّل أي جملة أو خلّينا نكتبها تاني)</span></span>
      ${sc.scenes.map((s, i) => `<div class="script-scene reveal">
        <div class="scene-head"><b>${fmt(i + 1)}. ${n[i]}</b><span class="hint">${fmt(sc.sceneSeconds?.[i] || sc.clipSeconds)} ثواني · <span data-count="${i}"></span></span></div>
        ${s.shotAr ? `<div class="shot">🎬 ${esc(s.shotAr)}</div>` : ''}
        <textarea data-scene="${i}" rows="2" style="min-height:64px" aria-label="كلام المشهد ${fmt(i + 1)}">${esc(s.voiceover)}</textarea>
        <button type="button" class="btn link small" data-rewrite="${i}">↻ اكتبها تاني</button>
      </div>`).join('')}
      ${sc.price ? `<div class="price-line"><div><span class="an-k">على الشاشة</span> <b>${esc(sc.price.screen)}</b></div><div><span class="an-k">هيتقال</span> <b>${esc(sc.price.spoken)}</b></div><div class="hint">بعد ما الفيديو يتعمل بنسمعه ونتأكد إن السعر اتقال صح، ولو اتقال غلط بنعيد المشهد.</div></div>` : ''}
      <div id="checks"></div>
      <button type="button" class="btn link" id="preview">اكتب سكريبت جديد خالص</button>`;
    const count = (ta) => { const i = Number(ta.dataset.scene); const k = ta.value.trim().split(/\s+/).filter(Boolean).length; const el = $(`[data-count="${i}"]`, box); el.textContent = `${fmt(k)} من ${fmt(limit(i))} كلمة`; el.style.color = k > limit(i) ? 'var(--warn)' : ''; };
    $$('textarea[data-scene]', box).forEach((ta) => { count(ta); ta.oninput = () => { sc.scenes[Number(ta.dataset.scene)].voiceover = ta.value; count(ta); recheck(); }; });
    $$('[data-hook]', box).forEach((b) => { b.onclick = () => useHook(Number(b.dataset.hook)); });
    $$('[data-rewrite]', box).forEach((b) => { b.onclick = () => rewrite(Number(b.dataset.rewrite), b); });
    $('#preview').onclick = preview;
    drawChecks();
    reveal(box);
  }
  async function preview() {
    const err = $('#err');
    err.textContent = '';
    if (!f.images.length) { err.textContent = 'ارفع صورة المنتج الأول.'; return; }
    if (!hasProduct()) { err.textContent = 'اكتب سطر عن المنتج الأول.'; $('#description').focus(); return; }
    const box = $('#scriptBox');
    const keep = box.innerHTML;
    box.innerHTML = '<div class="ai-box"></div>';
    const done = aiSteps(box.firstChild, ['بنفهم المنتج من الصور', 'بنكتب 5 هوكات مختلفة', 'بنقيّم كل هوك ونختار الأقوى', 'بنختار مشاهد استخدام حقيقي', 'بنكتب الكلام بالمصري', 'بنراجع السعر والتكرار والمميزات']);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const script = await api('POST', '/api/videos/script-preview', inputs());
      done();
      await new Promise((ok) => setTimeout(ok, 450));
      f.script = script;
      drawScript();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e2) {
      done();
      box.innerHTML = keep;
      $('#preview').onclick = preview;
      $('#preview').textContent = 'جرّب تاني';
      err.textContent = e2.message;
    }
  }
  drawScript();

  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err');
    err.textContent = '';
    if (!f.images.length) { err.textContent = 'ارفع صورة المنتج الأول.'; return; }
    if (!f.script) { err.textContent = 'اكتب السكريبت وراجعه الأول، وبعدين اعمل الفيديو.'; return; }
    if (f.script.scenes.some((s) => !s.voiceover.trim())) { err.textContent = 'في مشهد من غير كلام، اكتبه أو خلّينا نكتبه تاني.'; return; }
    if (state.me.credits < q.credits) { err.innerHTML = 'رصيدك خلص. <a href="#wallet">اشحن باقة</a> وكمّل.'; return; }
    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = 'بنبدأ…';
    try {
      // clientRef: pressing twice (or a retry after a slow network) is still one video and one charge.
      await api('POST', '/api/videos', { ...inputs(), clientRef: f.clientRef, script: { product: f.script.product, scenes: f.script.scenes } });
      state.form = blankForm({ style: f.style, goal: f.goal, aspectRatio: f.aspectRatio, voiceGender: f.voiceGender, music: f.music });
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
const stageOf = (p = 0) => (p < 15 ? 'بنجهّز المشاهد' : p < 60 ? 'بنصوّر المشاهد' : p < 90 ? 'بنركّب الصوت والكلام' : 'لمسات أخيرة');
function videoCard(v) {
  const [label, tone] = STATUS[v.status] || [v.status, ''];
  const done = ['COMPLETED', 'FAILED'].includes(v.status);
  const media = v.videoUrl
    ? `<video src="${v.videoUrl}" controls playsinline preload="metadata" poster="${v.imageUrl}"></video>`
    : `<img src="${v.imageUrl}" alt="" /><div class="overlay ${done ? '' : 'working'}">${done ? esc(label) : `<span class="ai-orb"><i></i><i></i><i></i></span><span>${stageOf(v.progress)}</span>`}</div>`;
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
