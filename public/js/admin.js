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
  ({ overview: renderOverview, topups: renderTopups, users: renderUsers, videos: renderVideos }[tab] || renderOverview)(view)
    .catch((err) => { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

async function renderOverview(view) {
  const o = await api('GET', '/api/admin/overview');
  setPending(o.pendingTopups);
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  view.innerHTML = `
    <h1>نظرة عامة</h1>
    <p class="sub">حالة Vimo AI النهارده.</p>
    ${o.falConfigured ? '' : '<div class="banner">⚠️ <b>FAL_KEY</b> مش متظبط، فالعملاء مش هيقدروا يعملوا فيديوهات. ضيفه في متغيرات البيئة.</div>'}
    ${o.scriptAi ? '' : '<div class="banner">ℹ️ <b>OPENAI_API_KEY</b> مش متظبط، فالسكريبت بيتكتب من قالب ثابت بدل الذكاء الاصطناعي.</div>'}
    <div class="stats">
      ${stat('طلبات شحن مستنية', `<a href="#topups">${fmt(o.pendingTopups)}</a>`)}
      ${stat('إيراد الشحن المؤكد', `${fmt(o.revenueEgp)} ج.م`)}
      ${stat('العملاء', fmt(o.users))}
      ${stat('فيديوهات النهارده', fmt(o.videosToday))}
      ${stat('بيتعمل دلوقتي', fmt(o.active))}
      ${stat('فيديوهات جاهزة', fmt(o.completed))}
      ${stat('فيديوهات فشلت', fmt(o.failed))}
      ${stat('تكلفة تقديرية للفيديو', `$${o.estCostPerVideoUsd}`)}
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
      <p class="sub">آخر ${fmt(videos.length)} فيديو على المنصة.</p>
      ${videos.length ? `<div class="card table-wrap"><table>
        <tr><th>المنتج</th><th>العميل</th><th>الشكل</th><th>الحالة</th><th>التاريخ</th><th></th></tr>
        ${videos.map((v) => { const [l, c] = STATUS[v.status] || [v.status, '']; return `<tr>
          <td><b>${esc(v.productName)}</b>${v.error ? `<div class="muted" style="font-size:12px;max-width:320px">${esc(v.error)}</div>` : ''}</td>
          <td>${esc(v.user.name)}<div class="muted" style="font-size:12px">${esc(v.user.email)}</div></td>
          <td>${esc(v.style)} · ${esc(v.aspectRatio)}</td>
          <td><span class="badge ${c}">${l}</span>${['COMPLETED', 'FAILED'].includes(v.status) ? '' : ` <span class="muted">${v.progress}%</span>`}${v.refunded ? ' <span class="badge">اترد</span>' : ''}</td>
          <td class="muted">${fmtDate(v.createdAt)}</td>
          <td>${v.videoUrl ? `<a class="btn small" href="${v.videoUrl}" target="_blank">مشاهدة</a>` : ''}</td>
        </tr>`; }).join('')}
      </table></div>` : '<div class="empty">مفيش فيديوهات لسه.</div>'}`;
  };
  await load();
  state.poll = setInterval(() => load().catch(() => {}), 8000);
}

init();
