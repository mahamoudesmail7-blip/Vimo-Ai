// The customer dashboard: create a video, watch the library fill, top up.
import { api, esc, $, $$, fmt, fmtDate, toast, shrinkImage, LOGO, STATUS } from '/js/common.js';

const state = { me: null, cfg: null, poll: null, form: { image: null, style: 'UGC', aspectRatio: '9:16', voiceGender: 'MALE' } };

async function init() {
  try { state.me = (await api('GET', '/api/auth/me')).user; }
  catch { location.href = '/auth'; return; }
  state.cfg = await api('GET', '/api/config');
  $$('.logo-slot').forEach((el) => { el.innerHTML = LOGO; });
  $('#who').textContent = state.me.email;
  $('#adminLink').classList.toggle('hidden', state.me.role !== 'ADMIN');
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout'); location.href = '/'; };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
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
  setCredits(user.credits);
}

function route() {
  clearInterval(state.poll);
  $('#side').classList.remove('open');
  const tab = (location.hash || '#create').slice(1);
  $$('.side .nav[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const view = $('#view');
  ({ create: renderCreate, videos: renderVideos, wallet: renderWallet }[tab] || renderCreate)(view)
    .catch((err) => { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

// ---------------------------------------------------------------------------
// فيديو جديد
// ---------------------------------------------------------------------------
async function renderCreate(view) {
  const f = state.form;
  const choice = (name, value, label) => `<button type="button" class="choice ${f[name] === value ? 'active' : ''}" data-name="${name}" data-value="${value}">${label}</button>`;
  view.innerHTML = `
    <h1>فيديو إعلاني جديد</h1>
    <p class="sub">ارفع صورة المنتج واكتب عنه كلمتين، وسيب الباقي علينا. الفيديو ${fmt(state.cfg.videoSeconds)} ثانية بيستهلك فيديو واحد من رصيدك.</p>
    ${state.cfg.videoReady ? '' : '<div class="banner">توليد الفيديو متوقف مؤقتًا. جرّب كمان شوية أو كلم الدعم.</div>'}
    <div class="grid-2">
      <form class="card" id="createForm" novalidate>
        <div class="field">
          <label>صورة المنتج</label>
          <div class="drop" id="drop">${f.image ? `<img src="${f.image}" alt="" />` : '<div style="font-size:34px">📷</div><div><b>اضغط أو اسحب الصورة هنا</b></div><div class="hint">صورة واضحة للمنتج لوحده، بخلفية بسيطة لو أمكن</div>'}</div>
          <input type="file" id="file" accept="image/png,image/jpeg,image/webp" hidden />
        </div>
        <div class="field"><label for="productName">اسم المنتج</label><input id="productName" type="text" maxlength="120" placeholder="مثلًا: شنطة جلد طبيعي حريمي" /></div>
        <div class="field"><label for="description">وصف قصير</label><textarea id="description" maxlength="1500" placeholder="أهم مميزات المنتج ومين اللي هيستخدمه"></textarea></div>
        <div class="field"><label for="offer">العرض أو السعر (اختياري)</label><input id="offer" type="text" maxlength="200" placeholder="مثلًا: بـ 450 جنيه بدل 600 والشحن مجاني" /></div>
        <div class="field"><label>شكل الفيديو</label><div class="choices">${choice('style', 'UGC', 'شخص بيتكلم (UGC)')}${choice('style', 'CINEMATIC', 'سينمائي')}${choice('style', 'SHOWCASE', 'عرض المنتج')}</div></div>
        <div class="field"><label>الصوت</label><div class="choices">${choice('voiceGender', 'MALE', 'صوت راجل')}${choice('voiceGender', 'FEMALE', 'صوت ست')}</div></div>
        <div class="field"><label>المقاس</label><div class="choices">${choice('aspectRatio', '9:16', 'طولي 9:16 (ريلز وتيك توك)')}${choice('aspectRatio', '16:9', 'عرضي 16:9')}</div></div>
        <div class="err" id="err"></div>
        <button class="btn primary" style="width:100%" id="go" ${state.cfg.videoReady ? '' : 'disabled'}>🎬 اعمل الفيديو (رصيدك: ${fmt(state.me.credits)})</button>
      </form>
      <div class="card">
        <h3>نصايح لأحسن نتيجة</h3>
        <ul class="script-lines">
          <li>صورة المنتج تكون واضحة ومنورة، والمنتج واخد معظم الصورة.</li>
          <li>اكتب الميزة الأهم في أول سطر في الوصف، دي اللي هتتقال في الفيديو.</li>
          <li>اكتب العرض والسعر بالظبط زي ما عايزه يتقال.</li>
          <li>الفيديو بياخد من 3 لـ 10 دقايق. تقدر تقفل الصفحة وترجع لقيته في «فيديوهاتي».</li>
        </ul>
      </div>
    </div>`;

  const drop = $('#drop');
  const file = $('#file');
  const setImage = async (fileObj) => {
    try {
      f.image = await shrinkImage(fileObj);
      drop.innerHTML = `<img src="${f.image}" alt="" />`;
    } catch (err) { toast(err.message); }
  };
  drop.onclick = () => file.click();
  file.onchange = () => file.files[0] && setImage(file.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) setImage(e.dataTransfer.files[0]); };
  $$('.choice', view).forEach((b) => { b.onclick = () => { f[b.dataset.name] = b.dataset.value; $$(`.choice[data-name="${b.dataset.name}"]`, view).forEach((x) => x.classList.toggle('active', x === b)); }; });

  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err');
    err.textContent = '';
    if (!f.image) { err.textContent = 'ارفع صورة المنتج الأول.'; return; }
    if (state.me.credits < 1) { err.innerHTML = 'رصيدك خلص. <a href="#wallet">اشحن باقة</a> وكمّل.'; return; }
    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = 'بنبدأ…';
    try {
      await api('POST', '/api/videos', {
        image: f.image, productName: $('#productName').value, description: $('#description').value, offer: $('#offer').value,
        style: f.style, voiceGender: f.voiceGender, aspectRatio: f.aspectRatio,
      });
      state.form = { image: null, style: f.style, aspectRatio: f.aspectRatio, voiceGender: f.voiceGender };
      await refreshMe();
      toast('بدأنا نعمل الفيديو 🎬');
      location.hash = 'videos';
    } catch (e2) {
      err.textContent = e2.message;
      btn.disabled = false;
      btn.textContent = '🎬 اعمل الفيديو';
    }
  };
}

// ---------------------------------------------------------------------------
// فيديوهاتي
// ---------------------------------------------------------------------------
function videoCard(v) {
  const [label, tone] = STATUS[v.status] || [v.status, ''];
  const wide = v.aspectRatio === '16:9' ? 'wide' : '';
  let media;
  if (v.videoUrl) media = `<video src="${v.videoUrl}" controls playsinline preload="metadata" poster="${v.imageUrl}"></video>`;
  else media = `<img src="${v.imageUrl}" alt="" /><div class="overlay">${v.status === 'FAILED' ? '⚠️ ' + esc(label) : '⏳ ' + esc(label) + '…'}</div>`;
  return `
    <div class="vcard">
      <div class="media ${wide}">${media}</div>
      <div class="body">
        <div class="title">${esc(v.productName)}</div>
        <div><span class="badge ${tone}">${esc(label)}</span> <span class="muted" style="font-size:13px">${fmtDate(v.createdAt)}</span></div>
        ${['COMPLETED', 'FAILED'].includes(v.status) ? '' : `<div class="bar"><i style="width:${v.progress}%"></i></div>`}
        ${v.status === 'FAILED' ? `<div class="muted" style="font-size:13px">${esc(v.error || '')}${v.refunded ? ' — الرصيد رجعلك.' : ''}</div>` : ''}
        ${v.script ? `<details><summary class="muted" style="font-size:14px">السكريبت</summary><ol class="script-lines">${v.script.scenes.map((s) => `<li>${esc(s.voiceover)}</li>`).join('')}</ol></details>` : ''}
        ${v.videoUrl ? `<a class="btn small primary" href="${v.videoUrl}?download=1">⬇️ تحميل الفيديو</a>` : ''}
      </div>
    </div>`;
}

async function renderVideos(view) {
  const load = async () => {
    const { videos } = await api('GET', '/api/videos');
    view.innerHTML = `
      <h1>فيديوهاتي</h1>
      <p class="sub">كل الفيديوهات اللي عملتها. اللي لسه بيتعمل بيتحدث لوحده.</p>
      ${videos.length ? `<div class="videos">${videos.map(videoCard).join('')}</div>` : '<div class="empty">لسه معملتش أي فيديو. <a href="#create">اعمل أول فيديو</a></div>'}`;
    const busy = videos.some((v) => !['COMPLETED', 'FAILED'].includes(v.status));
    if (!busy) { clearInterval(state.poll); state.poll = null; refreshMe().catch(() => {}); }
    return busy;
  };
  if (await load()) state.poll = setInterval(() => load().catch(() => {}), 5000);
}

// ---------------------------------------------------------------------------
// الرصيد والشحن
// ---------------------------------------------------------------------------
const TOPUP_STATUS = { PENDING: ['بيتراجع', 'warn'], APPROVED: ['اتأكد', 'ok'], REJECTED: ['مرفوض', 'bad'] };
const REASON = { TOPUP: 'شحن رصيد', VIDEO: 'فيديو', REFUND: 'رجوع رصيد', ADMIN_ADJUST: 'تعديل من الإدارة', SIGNUP_BONUS: 'هدية التسجيل' };

async function renderWallet(view) {
  const w = await api('GET', '/api/wallet');
  setCredits(w.credits);
  const cfg = state.cfg;
  let selected = cfg.packages[1]?.key || cfg.packages[0]?.key;
  view.innerHTML = `
    <h1>الرصيد والشحن</h1>
    <p class="sub">رصيدك دلوقتي <b>${fmt(w.credits)}</b> فيديو.</p>
    <div class="grid-2">
      <form class="card" id="topupForm" novalidate>
        <h3>1. اختار الباقة</h3>
        <div class="plans" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:18px">
          ${cfg.packages.map((p) => `<button type="button" class="plan choice-plan ${p.key === selected ? 'featured' : ''}" data-key="${p.key}" style="text-align:start;cursor:pointer">
            <div class="muted">${p.videos === 1 ? 'فيديو واحد' : `${fmt(p.videos)} فيديوهات`}</div>
            <div class="price" style="font-size:24px">${fmt(p.priceEgp)} <small>ج.م</small></div>
            <div class="per">${fmt(p.perVideoEgp)} ج.م للفيديو</div></button>`).join('')}
        </div>
        <h3>2. حوّل المبلغ فودافون كاش</h3>
        <p class="muted" style="margin-top:0">${cfg.vodafoneCashNumber ? `حوّل المبلغ على الرقم <b dir="ltr" style="color:var(--text)">${esc(cfg.vodafoneCashNumber)}</b>` : 'رقم التحويل هيتبعتلك من الدعم.'}</p>
        <h3>3. ابعتلنا بيانات التحويل</h3>
        <div class="field"><label for="senderPhone">الرقم اللي حوّلت منه</label><input id="senderPhone" type="tel" dir="ltr" placeholder="01xxxxxxxxx" /></div>
        <div class="field"><label for="reference">رقم العملية (اختياري)</label><input id="reference" type="text" dir="ltr" /></div>
        <div class="field"><label for="receipt">صورة التحويل (اختياري)</label><input id="receipt" type="file" accept="image/png,image/jpeg,image/webp" /></div>
        <div class="err" id="err"></div>
        <button class="btn primary" style="width:100%" id="send">ابعت طلب الشحن</button>
      </form>
      <div class="card">
        <h3>طلبات الشحن</h3>
        ${w.topups.length ? `<div class="table-wrap"><table><tr><th>الباقة</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr>
          ${w.topups.map((t) => { const [l, c] = TOPUP_STATUS[t.status] || [t.status, '']; return `<tr><td>${fmt(t.videos)} فيديو</td><td>${fmt(t.amountEgp)} ج.م</td><td><span class="badge ${c}">${l}</span>${t.adminNote ? `<div class="muted" style="font-size:12px">${esc(t.adminNote)}</div>` : ''}</td><td class="muted">${fmtDate(t.createdAt)}</td></tr>`; }).join('')}
        </table></div>` : '<div class="empty">مفيش طلبات لسه.</div>'}
        <h3 style="margin-top:22px">حركة الرصيد</h3>
        ${w.transactions.length ? `<div class="table-wrap"><table><tr><th>العملية</th><th>التغيير</th><th>الرصيد</th><th>التاريخ</th></tr>
          ${w.transactions.map((t) => `<tr><td>${esc(REASON[t.reason] || t.reason)}</td><td style="color:${t.delta > 0 ? 'var(--ok)' : 'var(--bad)'}" dir="ltr">${t.delta > 0 ? '+' : ''}${t.delta}</td><td>${fmt(t.balance)}</td><td class="muted">${fmtDate(t.createdAt)}</td></tr>`).join('')}
        </table></div>` : '<div class="empty">مفيش حركة لسه.</div>'}
      </div>
    </div>`;

  $$('.choice-plan', view).forEach((b) => { b.onclick = () => { selected = b.dataset.key; $$('.choice-plan', view).forEach((x) => x.classList.toggle('featured', x === b)); }; });
  $('#topupForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#send');
    $('#err').textContent = '';
    btn.disabled = true;
    try {
      const file = $('#receipt').files[0];
      const receipt = file ? await shrinkImage(file, 1600, 0.85) : undefined;
      await api('POST', '/api/wallet/topups', { packageKey: selected, senderPhone: $('#senderPhone').value.trim(), reference: $('#reference').value.trim(), receipt });
      toast('طلبك وصل، هنأكده ونضيف الرصيد في أقرب وقت ✅');
      renderWallet(view);
    } catch (err) {
      $('#err').textContent = err.message;
      btn.disabled = false;
    }
  };
}

init();
