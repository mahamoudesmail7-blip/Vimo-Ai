// Admin panel: approve Vodafone Cash top-ups, manage customers, watch renders.
import { api, esc, $, $$, fmt, fmtDate, toast, LOGO, STATUS } from '/js/common.js';

const state = { me: null, poll: null };

async function init() {
  try { state.me = (await api('GET', '/api/auth/me')).user; }
  catch { location.href = '/auth'; return; }
  if (state.me.role !== 'ADMIN') { location.href = '/app'; return; }
  $$('.logo-slot').forEach((el) => { el.innerHTML = LOGO; });
  $('#who').textContent = state.me.email;
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout'); location.href = '/'; };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  window.addEventListener('hashchange', route);
  route();
}

function setPending(n) {
  const b = $('#pendingBadge');
  b.textContent = fmt(n);
  b.classList.toggle('hidden', !n);
}

function route() {
  clearInterval(state.poll);
  $('#side').classList.remove('open');
  const tab = (location.hash || '#overview').slice(1);
  $$('.side .nav[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const view = $('#view');
  ({ overview: renderOverview, topups: renderTopups, users: renderUsers, videos: renderVideos, gallery: renderGallery, engines: renderEngines }[tab] || renderOverview)(view)
    .catch((err) => { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

async function renderOverview(view) {
  const o = await api('GET', '/api/admin/overview');
  setPending(o.pendingTopups);
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  view.innerHTML = `
    <h1>نظرة عامة</h1>
    <p class="sub">حالة Vimo AI النهارده.</p>
    ${o.engineReady ? '' : '<div class="banner">⚠️ مفيش محرك فيديو جاهز دلوقتي، فالعملاء مش هيقدروا يعملوا فيديوهات. افتح <a href="#engines">محركات الذكاء الاصطناعي</a>.</div>'}
    ${o.falBalanceOut ? `<div class="banner">⚠️ <b>رصيد fal.ai خلص</b> من ${fmtDate(o.falBalanceOut)}، والفيديوهات بتفشل وبترجع للعملاء. <a href="https://fal.ai/dashboard/billing" target="_blank">اشحن من هنا</a>.</div>` : ''}
    ${o.scriptAi ? '' : '<div class="banner">ℹ️ السكريبت بيتكتب من قالب ثابت بدل الذكاء الاصطناعي.</div>'}
    <div class="stats">
      ${stat('طلبات شحن مستنية', `<a href="#topups">${fmt(o.pendingTopups)}</a>`)}
      ${stat('إيراد الشحن المؤكد', `${fmt(o.revenueEgp)} ج.م`)}
      ${stat('العملاء', fmt(o.users))}
      ${stat('فيديوهات النهارده', fmt(o.videosToday))}
      ${stat('بيتعمل دلوقتي', fmt(o.active))}
      ${stat('فيديوهات جاهزة', fmt(o.completed))}
      ${stat('فيديوهات فشلت', fmt(o.failed))}
      ${stat('تكلفة تقديرية للفيديو', o.estCostPerVideoUsd === null ? '—' : `$${o.estCostPerVideoUsd}`)}
    </div>`;
}

const TOPUP_STATUS = { PENDING: ['مستني', 'warn'], APPROVED: ['اتأكد', 'ok'], REJECTED: ['مرفوض', 'bad'] };

async function renderTopups(view) {
  const filter = sessionStorage.getItem('topupFilter') || 'PENDING';
  const { topups } = await api('GET', `/api/admin/topups?status=${filter}`);
  if (filter === 'PENDING') setPending(topups.length);
  const tab = (k, l) => `<button class="choice ${filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`;
  view.innerHTML = `
    <h1>طلبات الشحن</h1>
    <p class="sub">راجع التحويل على فودافون كاش، وبعدين أكّد الطلب عشان الرصيد يتضاف للعميل.</p>
    <div class="choices" style="margin-bottom:16px">${tab('PENDING', 'مستنية')}${tab('APPROVED', 'متأكدة')}${tab('REJECTED', 'مرفوضة')}${tab('', 'الكل')}</div>
    ${topups.length ? `<div class="card table-wrap"><table>
      <tr><th>العميل</th><th>الباقة</th><th>المبلغ</th><th>حوّل من</th><th>رقم العملية</th><th>التاريخ</th><th>الحالة</th><th></th></tr>
      ${topups.map((t) => { const [l, c] = TOPUP_STATUS[t.status]; return `<tr>
        <td><b>${esc(t.user.name)}</b><div class="muted" style="font-size:12px">${esc(t.user.email)}</div></td>
        <td>${fmt(t.videos)} فيديو</td><td><b>${fmt(t.amountEgp)} ج.م</b></td>
        <td dir="ltr">${esc(t.senderPhone)}</td><td dir="ltr">${esc(t.reference || '—')}</td>
        <td class="muted">${fmtDate(t.createdAt)}</td>
        <td><span class="badge ${c}">${l}</span></td>
        <td style="white-space:nowrap">
          ${t.hasReceipt ? `<a class="btn small" href="/api/admin/topups/${t.id}/receipt" target="_blank">الإيصال</a>` : ''}
          ${t.status === 'PENDING' ? `<button class="btn small ok" data-approve="${t.id}">تأكيد</button> <button class="btn small bad" data-reject="${t.id}">رفض</button>` : ''}
        </td></tr>`; }).join('')}
    </table></div>` : '<div class="empty">مفيش طلبات هنا.</div>'}`;

  $$('[data-f]', view).forEach((b) => { b.onclick = () => { sessionStorage.setItem('topupFilter', b.dataset.f); renderTopups(view); }; });
  $$('[data-approve]', view).forEach((b) => { b.onclick = () => decide(b.dataset.approve, 'approve', view); });
  $$('[data-reject]', view).forEach((b) => { b.onclick = () => decide(b.dataset.reject, 'reject', view); });
}

async function decide(id, decision, view) {
  let note = '';
  if (decision === 'reject') {
    note = prompt('سبب الرفض (هيظهر للعميل):') ?? null;
    if (note === null) return;
  } else if (!confirm('متأكد إنك استلمت التحويل؟ الرصيد هيتضاف للعميل.')) return;
  try {
    await api('POST', `/api/admin/topups/${id}/${decision}`, { note });
    toast(decision === 'approve' ? 'اتأكد الطلب واتضاف الرصيد ✅' : 'اترفض الطلب');
  } catch (err) { toast(err.message); }
  renderTopups(view);
}

async function renderUsers(view) {
  const q = sessionStorage.getItem('userQ') || '';
  const { users } = await api('GET', `/api/admin/users?q=${encodeURIComponent(q)}`);
  view.innerHTML = `
    <h1>العملاء</h1>
    <p class="sub">${fmt(users.length)} عميل.</p>
    <input type="text" id="q" placeholder="دوّر بالاسم أو الإيميل أو الموبايل" value="${esc(q)}" style="max-width:380px;margin-bottom:16px" />
    <div class="card table-wrap"><table>
      <tr><th>العميل</th><th>الموبايل</th><th>الرصيد</th><th>فيديوهات</th><th>اتسجل</th><th>الحالة</th><th></th></tr>
      ${users.map((u) => `<tr>
        <td><b>${esc(u.name)}</b> ${u.role === 'ADMIN' ? '<span class="badge run">أدمن</span>' : ''}<div class="muted" style="font-size:12px">${esc(u.email)}</div></td>
        <td dir="ltr">${esc(u.phone || '—')}</td><td><b>${fmt(u.credits)}</b></td><td>${fmt(u.videos)}</td>
        <td class="muted">${fmtDate(u.createdAt)}</td>
        <td><span class="badge ${u.status === 'ACTIVE' ? 'ok' : 'bad'}">${u.status === 'ACTIVE' ? 'نشط' : 'موقوف'}</span></td>
        <td style="white-space:nowrap"><button class="btn small" data-credit="${u.id}">± رصيد</button>
          ${u.id === state.me.id ? '' : `<button class="btn small ${u.status === 'ACTIVE' ? 'bad' : ''}" data-status="${u.id}" data-to="${u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}">${u.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}</button>`}</td>
      </tr>`).join('')}
    </table></div>`;

  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { sessionStorage.setItem('userQ', e.target.value); renderUsers(view).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
  $$('[data-credit]', view).forEach((b) => { b.onclick = async () => {
    const raw = prompt('عدد الفيديوهات (مثلًا 2 للإضافة أو -1 للخصم):');
    if (!raw) return;
    try { await api('POST', `/api/admin/users/${b.dataset.credit}/credits`, { delta: Number(raw), note: 'تعديل يدوي' }); toast('اتعدل الرصيد'); }
    catch (err) { toast(err.message); }
    renderUsers(view);
  }; });
  $$('[data-status]', view).forEach((b) => { b.onclick = async () => {
    try { await api('POST', `/api/admin/users/${b.dataset.status}/status`, { status: b.dataset.to }); } catch (err) { toast(err.message); }
    renderUsers(view);
  }; });
}

async function renderVideos(view) {
  const load = async () => {
    const { videos } = await api('GET', '/api/admin/videos');
    view.innerHTML = `
      <h1>كل الفيديوهات</h1>
      <p class="sub">آخر ${fmt(videos.length)} فيديو على المنصة. «اعرضه» بيحط الفيديو في معرض الصفحة الرئيسية، فاختار بس اللي صاحبه موافق.</p>
      ${videos.length ? `<div class="card table-wrap"><table>
        <tr><th>المنتج</th><th>العميل</th><th>الشكل</th><th>المحرك</th><th>التكلفة</th><th>الحالة</th><th>التاريخ</th><th></th></tr>
        ${videos.map((v) => { const [l, c] = STATUS[v.status] || [v.status, '']; return `<tr>
          <td><b>${esc(v.productName)}</b>${v.error ? `<div class="muted" style="font-size:12px;max-width:320px">${esc(v.error)}</div>` : ''}</td>
          <td>${esc(v.user.name)}<div class="muted" style="font-size:12px">${esc(v.user.email)}</div></td>
          <td>${esc(v.style)} · ${esc(v.aspectRatio)}</td>
          <td style="font-size:12px">${esc(v.provider || 'fal')}<div class="muted">${esc(v.plan?.models?.video || v.model || '')}${v.plan?.mode === 'voiceover' ? ' + تعليق صوتي' : ''}</div></td>
          <td style="font-size:12px" dir="ltr">${v.costEstimateUsd != null ? `~$${v.costEstimateUsd}` : '—'}<div class="muted">$${Number(v.costActualUsd || 0).toFixed(2)}</div></td>
          <td><span class="badge ${c}">${l}</span>${['COMPLETED', 'FAILED'].includes(v.status) ? '' : ` <span class="muted">${v.progress}%</span>`}${v.refunded ? ' <span class="badge">اترد</span>' : ''}</td>
          <td class="muted">${fmtDate(v.createdAt)}</td>
          <td style="white-space:nowrap">${v.videoUrl ? `<a class="btn small" href="${v.videoUrl}" target="_blank">مشاهدة</a> <button class="btn small ${v.showcase ? 'ok' : ''}" data-showcase="${v.id}" data-on="${v.showcase ? '0' : '1'}">${v.showcase ? '★ في المعرض' : '☆ اعرضه'}</button>` : ''}</td>
        </tr>`; }).join('')}
      </table></div>` : '<div class="empty">مفيش فيديوهات لسه.</div>'}`;
    $$('[data-showcase]', view).forEach((b) => { b.onclick = async () => {
      try { await api('POST', `/api/admin/videos/${b.dataset.showcase}/showcase`, { on: b.dataset.on === '1' }); toast(b.dataset.on === '1' ? 'اتضاف لمعرض الصفحة الرئيسية' : 'اتشال من المعرض'); }
      catch (err) { toast(err.message); }
      load();
    }; });
  };
  await load();
  state.poll = setInterval(() => load().catch(() => {}), 8000);
}

// ---------------------------------------------------------------------------
// معرض «شوف شغلنا»: videos uploaded straight to the landing page
// ---------------------------------------------------------------------------
const ratioOf = (file) => new Promise((done) => {
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => { done(v.videoWidth > v.videoHeight ? '16:9' : '9:16'); URL.revokeObjectURL(v.src); };
  v.onerror = () => done('9:16');
  v.src = URL.createObjectURL(file);
});

const SAMPLE_FOR = [['', 'مش مثال لشكل معيّن'], ['AUTO', 'مثال لـ «تلقائي»'], ['UGC', 'مثال لـ «شخص بيتكلم»'], ['STUDIO', 'مثال لـ «استوديو»'], ['SHOWCASE', 'مثال لـ «عرض المنتج»']];
const styleSelect = (id, value = '') => `<select ${id}>${SAMPLE_FOR.map(([v, l]) => `<option value="${v}" ${v === (value || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

async function renderGallery(view) {
  const { videos } = await api('GET', '/api/admin/showcase-videos');
  const { videos: all } = await api('GET', '/api/showcase');
  const starred = all.filter((v) => typeof v.id === 'number').length;
  view.innerHTML = `
    <h1>معرض «شوف شغلنا»</h1>
    <p class="sub">الفيديوهات دي بتظهر في الصفحة الرئيسية للزوار، وتقدر تخلّي أي واحد منهم مثال لشكل إعلان في صفحة «إنشاء فيديو». ارفع فيديوهات إنت عاملها أو معاك إذن صاحبها. ${starred ? `ومعاهم ${fmt(starred)} فيديو من فيديوهات العملاء متعلّم عليهم ☆.` : ''}</p>
    <form class="card" id="up" style="margin-bottom:20px">
      <h3>ارفع فيديو</h3>
      <div class="field"><label for="gfile">الفيديو (MP4 أو MOV، لحد 60 ميجا)</label><input type="file" id="gfile" accept="video/mp4,video/quicktime,video/webm" required /></div>
      <div class="field"><label for="gtitle">اسم المنتج</label><input type="text" id="gtitle" maxlength="80" placeholder="مثلًا: كريم ترطيب" required /></div>
      <div class="field"><label for="gstyle">مثال لشكل إعلان؟</label>${styleSelect('id="gstyle"')}<div class="hint">لو اخترت شكل، الفيديو ده هيظهر جنب الكارت بتاعه في صفحة «إنشاء فيديو» عشان العميل يشوف هيطلعله إيه.</div></div>
      <label class="choice" style="display:inline-flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="ggallery" checked /> اعرضه كمان في «شوف شغلنا» في الصفحة الرئيسية</label>
      <div class="bar hidden" id="gbar"><i style="width:0"></i></div>
      <div class="err" id="gerr"></div>
      <button class="btn primary" id="gbtn">ارفع على المعرض</button>
    </form>
    ${videos.length ? `<div class="videos">${videos.map((v) => `
      <div class="vcard"><div class="media ${v.aspectRatio === '16:9' ? 'wide' : ''}"><video src="${v.videoUrl}#t=0.6" controls playsinline preload="metadata"></video></div>
      <div class="body"><div class="title">${esc(v.title)}</div><div class="muted" style="font-size:13px">${fmtDate(v.createdAt)}</div>
      ${styleSelect(`data-style="${v.id}"`, v.style)}
      <label class="muted" style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-gal="${v.id}" ${v.inGallery ? 'checked' : ''} /> في «شوف شغلنا»</label>
      <button class="btn small bad" data-del="${v.id}">شيله من المعرض</button></div></div>`).join('')}</div>` : '<div class="empty">لسه مرفعتش فيديوهات.</div>'}`;
  $('#gfile').onchange = () => {
    const f = $('#gfile').files[0];
    if (f && !$('#gtitle').value) $('#gtitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 80);
  };
  $('#up').onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#gfile').files[0];
    const title = $('#gtitle').value.trim();
    const err = $('#gerr');
    err.textContent = '';
    if (!file) { err.textContent = 'اختار فيديو.'; return; }
    if (file.size > 60 * 1024 * 1024) { err.textContent = 'الفيديو أكبر من 60 ميجا، صغّره وجرب تاني.'; return; }
    if (!title) { err.textContent = 'اكتب اسم المنتج.'; return; }
    const btn = $('#gbtn');
    btn.disabled = true;
    const bar = $('#gbar');
    bar.classList.remove('hidden');
    // XHR (not fetch) so the upload progress shows
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/admin/showcase-videos?title=${encodeURIComponent(title)}&ratio=${await ratioOf(file)}&style=${$('#gstyle').value}&gallery=${$('#ggallery').checked ? 1 : 0}`);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.firstChild.style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`; };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status === 201) { toast('اترفع وظهر في الصفحة الرئيسية'); renderGallery(view); return; }
      err.textContent = data?.message || 'مقدرناش نرفع الفيديو، جرب تاني.';
      btn.disabled = false; bar.classList.add('hidden');
    };
    xhr.onerror = () => { err.textContent = 'النت فصل، جرب تاني.'; btn.disabled = false; bar.classList.add('hidden'); };
    xhr.send(file);
  };
  $$('[data-style]', view).forEach((sel) => { sel.onchange = async () => {
    try { await api('PATCH', `/api/admin/showcase-videos/${sel.dataset.style}`, { style: sel.value || null }); toast(sel.value ? 'بقى المثال بتاع الشكل ده' : 'اتشال من الأمثلة'); } catch (e2) { toast(e2.message); }
  }; });
  $$('[data-gal]', view).forEach((cb) => { cb.onchange = async () => {
    try { await api('PATCH', `/api/admin/showcase-videos/${cb.dataset.gal}`, { inGallery: cb.checked }); toast(cb.checked ? 'ظهر في شوف شغلنا' : 'اتشال من شوف شغلنا'); } catch (e2) { toast(e2.message); }
  }; });
  $$('[data-del]', view).forEach((b) => { b.onclick = async () => {
    if (!confirm('تشيل الفيديو ده من المعرض؟')) return;
    try { await api('DELETE', `/api/admin/showcase-videos/${b.dataset.del}`); toast('اتشال'); renderGallery(view); } catch (e2) { toast(e2.message); }
  }; });
}

// ---------------------------------------------------------------------------
// محركات الذكاء الاصطناعي
// ---------------------------------------------------------------------------
const TIER = { economy: 'اقتصادي', standard: 'قياسي', premium: 'ممتاز' };
const KIND = { video: 'فيديو', image: 'أول فريم', tts: 'تعليق صوتي', merge: 'دمج', mux: 'تركيب صوت' };
const MODE = { speech: 'الكلام جوه الفيديو', voiceover: 'فيديو صامت + تعليق صوتي', hybrid: 'مختلط: مشهد AI + صور المنتج + تعليق صوتي' };
const STYLE = { AUTO: 'تلقائي', UGC: 'شخص بيتكلم', STUDIO: 'استوديو', SHOWCASE: 'عرض المنتج' };
const BAL_SRC = { live: 'مباشر من المزود', confirmed: 'متأكد يدويًا', unconfirmed: 'مش متأكد', 'provider-refused': 'المزود رفض: الرصيد خلص' };
const usd = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(n < 1 ? 3 : 2)}`);

async function renderEngines(view, data = null) {
  const e = data || await api('GET', '/api/admin/engines');
  const modelLabel = Object.fromEntries(e.models.map((m) => [m.id, m.label]));
  const providers = e.providers.filter((p) => !p.hidden);
  const num = (attrs, value, step = '0.01') => `<input type="number" min="0" step="${step}" ${attrs} value="${value ?? ''}" style="width:96px" dir="ltr" />`;
  view.innerHTML = `
    <h1>محركات الذكاء الاصطناعي</h1>
    <p class="sub">مين بيعمل الفيديوهات، بكام، وحدود الصرف. العميل مش بيشوف أي حاجة من دي.</p>
    ${providers.filter((p) => p.balanceOutSince).map((p) => `<div class="banner">⚠️ رصيد <b>${esc(p.label)}</b> خلص من ${fmtDate(p.balanceOutSince)}.</div>`).join('')}

    <div class="card" style="margin-bottom:16px">
      <h3>الخطة اللي هتتنفذ دلوقتي</h3>
      <div class="table-wrap"><table><tr><th>الأسلوب</th><th>طريقة الإنتاج</th><th>موديل الفيديو</th><th>المشاهد</th><th>تكلفة متوقعة</th></tr>
      ${Object.entries(e.plans).map(([style, p]) => (p.error
        ? `<tr><td>${STYLE[style]}</td><td colspan="4" style="color:var(--bad)">${esc(p.error)}</td></tr>`
        : `<tr><td>${STYLE[style]}</td><td>${MODE[p.mode]}</td><td>${esc(modelLabel[p.video] || p.video)} <span class="muted">(${esc(p.provider)})</span></td><td dir="ltr">${p.sceneSeconds.join(' + ')} s</td><td dir="ltr" title="${esc(p.estimate.lines.map((l) => `${l.step}: $${l.usd}`).join(' · '))}"><b>${usd(p.estimate.totalUsd)}</b></td></tr>`)).join('')}
      </table></div>
      <p class="muted" style="font-size:13px;margin:10px 0 0">بنختار أرخص موديل مناسب جوه الفئة. لو المحرك المختار مش متاح (رصيد أو حد صرف)، الطلب بيترفض من غير خصم من العميل، ومش بنحوّل لمزود أغلى لوحدنا.</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3>الجودة وحدود الصرف</h3>
      <div class="choices" style="align-items:end;gap:18px">
        <div class="field" style="margin:0"><label>فئة الجودة</label><select id="tier" style="width:150px">${Object.entries(TIER).map(([k, l]) => `<option value="${k}" ${e.settings.tier === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label>أقصى تكلفة للفيديو ($)</label>${num('id="perVideo"', e.settings.perVideoMaxUsd)}</div>
        <div class="field" style="margin:0"><label>أقصى صرف في اليوم ($)</label>${num('id="perDay"', e.settings.perDayMaxUsd)}</div>
        <div class="field" style="margin:0"><label>مدة الفيديو</label><select id="targetSeconds" style="width:130px">${[16, 20, 24, 26].map((v) => `<option value="${v}" ${(e.settings.targetSeconds || 20) === v ? 'selected' : ''}>${v} ثانية</option>`).join('')}</select></div>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="captions" ${e.settings.captions !== false ? 'checked' : ''} /> الكلام مكتوب على الشاشة</label>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="speechCheck" ${e.settings.speechCheck !== false ? 'checked' : ''} /> فحص الكلام تلقائيًا وإعادة المشهد الغلط مرة (~$0.30 لما يحصل)</label>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="hybrid" ${e.settings.hybrid !== false ? 'checked' : ''} /> الفيديو المختلط (الأرخص)</label>
        <div class="stat" style="padding:10px 14px"><div class="k">اتصرف النهارده</div><div class="v" style="font-size:20px" dir="ltr">${usd(e.spentTodayUsd)}</div></div>
      </div>
    </div>

    <div class="card table-wrap" style="margin-bottom:16px">
      <h3>المزودين</h3>
      <table><tr><th>المزود</th><th>الحالة</th><th>شغال</th><th>الأولوية</th><th>حد يومي ($)</th><th>الرصيد المتاح</th><th>تأكيد رصيد ($)</th><th>النهارده</th></tr>
      ${providers.map((p) => `<tr>
        <td><b>${esc(p.label)}</b></td>
        <td>${p.configured ? '<span class="badge ok">متوصل</span>' : `<span class="badge bad">ناقص</span><div class="muted" style="font-size:11px" dir="ltr">${p.missing.map(esc).join(', ')}</div>`}</td>
        <td><input type="checkbox" data-p-enabled="${p.id}" ${p.enabled ? 'checked' : ''} /></td>
        <td>${num(`data-p-priority="${p.id}"`, p.priority, '1')}</td>
        <td>${p.id === 'mock' ? '—' : num(`data-p-daily="${p.id}"`, p.dailyMaxUsd)}</td>
        <td>${p.id === 'mock' ? 'مجاني' : p.balance ? `<b dir="ltr">${usd(p.balance.usd)}</b><div class="muted" style="font-size:11px">${BAL_SRC[p.balance.source] || ''}${p.balance.confirmedAt ? ` · ${fmtDate(p.balance.confirmedAt)}` : ''}</div>` : '—'}</td>
        <td>${p.id === 'mock' ? '—' : num(`data-p-confirm="${p.id}" placeholder="مثلًا 25"`, '')}</td>
        <td dir="ltr" style="font-size:13px">${usd(p.spentTodayUsd)}${p.reservedUsd ? `<div class="muted">محجوز ${usd(p.reservedUsd)}</div>` : ''}</td>
      </tr>`).join('')}
      </table>
      <p class="muted" style="font-size:13px;margin:10px 0 0">مفيش توليد مدفوع بيبدأ من غير رصيد مؤكد. fal بيقرا رصيده لوحده لو المفتاح يسمح؛ غير كده اكتب الرصيد اللي شحنته في «تأكيد رصيد» وهينقص مع كل فيديو. المفاتيح بتتحط في متغيرات البيئة على Railway بس.</p>
    </div>

    <div class="card table-wrap" style="margin-bottom:16px">
      <h3>الموديلات</h3>
      <table><tr><th>الموديل</th><th>النوع</th><th>الفئة</th><th>شغال</th><th>السعر ($)</th><th></th></tr>
      ${e.models.map((m) => `<tr>
        <td><b>${esc(m.label)}</b><div class="muted" style="font-size:11px" dir="ltr">${esc(m.id)}${m.durations ? ` · ${m.durations.join('/')}s` : ''}${m.kind === 'video' ? (m.audio ? ' · صوت' : ' · صامت') : ''}</div></td>
        <td>${KIND[m.kind]}</td>
        <td>${m.kind === 'video' ? `<select data-m-tier="${m.id}" style="width:110px">${Object.entries(TIER).map(([k, l]) => `<option value="${k}" ${m.tier === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '—'}</td>
        <td><input type="checkbox" data-m-enabled="${m.id}" ${m.enabled ? 'checked' : ''} /></td>
        <td style="font-size:12px;white-space:nowrap">${m.usdPerSecond
          ? `${m.audio ? `بصوت/ث ${num(`data-m-audio="${m.id}"`, m.usdPerSecond.audio, '0.001')}<br />` : ''}${m.kind === 'video' ? 'صامت/ث ' : 'لكل ثانية '}${num(`data-m-silent="${m.id}"`, m.usdPerSecond.silent, '0.0001')}`
          : m.usdPerUnit !== null ? `للصورة ${num(`data-m-unit="${m.id}"`, m.usdPerUnit, '0.001')}` : `لكل 1000 حرف ${num(`data-m-chars="${m.id}"`, m.usdPer1kChars, '0.001')}`}</td>
        <td style="font-size:12px">${m.usable ? '<span class="badge ok">متاح</span>' : '<span class="badge">مش متاح</span>'}${m.priceVerified || m.priceOverridden ? '' : '<div class="muted" style="color:var(--warn)">السعر محتاج تأكيد</div>'}</td>
      </tr>`).join('')}
      </table>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:22px">
      <button class="btn primary" id="saveEngines">حفظ التغييرات</button>
      <button class="btn" id="refreshEngines">تحديث الأرصدة</button>
    </div>

    <div class="card table-wrap">
      <h3>أخطاء التوليد والطلبات المرفوضة</h3>
      ${e.errors.length ? `<table><tr><th>الوقت</th><th>المزود</th><th>النوع</th><th>التفاصيل</th></tr>
        ${e.errors.map((x) => `<tr><td class="muted" style="white-space:nowrap">${fmtDate(x.at)}</td><td>${esc(x.provider)}<div class="muted" style="font-size:11px" dir="ltr">${esc(x.model || '')}</div></td><td><span class="badge ${x.kind === 'ERROR' ? 'bad' : 'warn'}">${x.kind === 'ERROR' ? 'خطأ' : 'اترفض'}</span>${x.jobId ? ` <span class="muted">#${x.jobId}</span>` : ''}</td><td style="font-size:13px">${esc(x.message || '')}</td></tr>`).join('')}
      </table>` : '<div class="empty">مفيش أخطاء.</div>'}
    </div>`;

  const n = (el) => (el && el.value !== '' ? Number(el.value) : undefined);
  $('#saveEngines').onclick = async () => {
    const patch = { tier: $('#tier').value, hybrid: $('#hybrid').checked, captions: $('#captions').checked, speechCheck: $('#speechCheck').checked, targetSeconds: Number($('#targetSeconds').value), perVideoMaxUsd: n($('#perVideo')), perDayMaxUsd: n($('#perDay')), providers: {}, models: {} };
    for (const p of providers) {
      const c = $(`[data-p-confirm="${p.id}"]`);
      patch.providers[p.id] = {
        enabled: $(`[data-p-enabled="${p.id}"]`).checked,
        priority: n($(`[data-p-priority="${p.id}"]`)),
        dailyMaxUsd: n($(`[data-p-daily="${p.id}"]`)),
        ...(c && c.value !== '' ? { confirmedBalanceUsd: Number(c.value) } : {}),
      };
    }
    for (const m of e.models) {
      patch.models[m.id] = {
        enabled: $(`[data-m-enabled="${m.id}"]`).checked,
        tier: $(`[data-m-tier="${m.id}"]`)?.value,
        usdPerSecond: m.usdPerSecond ? { audio: n($(`[data-m-audio="${m.id}"]`)), silent: n($(`[data-m-silent="${m.id}"]`)) } : undefined,
        usdPerUnit: n($(`[data-m-unit="${m.id}"]`)),
        usdPer1kChars: n($(`[data-m-chars="${m.id}"]`)),
      };
    }
    try { renderEngines(view, await api('PUT', '/api/admin/engines', patch)); toast('اتحفظ ✅'); }
    catch (err) { toast(err.message); }
  };
  $('#refreshEngines').onclick = async () => { try { renderEngines(view, await api('POST', '/api/admin/engines/refresh')); } catch (err) { toast(err.message); } };
}

init();
