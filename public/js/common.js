// Shared helpers for every page: the API client, escaping, toasts, and the
// image shrinker that keeps uploads small.

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.message || 'حصل خطأ، جرّب تاني.');
    err.status = res.status;
    err.code = data?.error;
    throw err;
  }
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const fmt = (n) => Number(n || 0).toLocaleString('ar-EG');
export const fmtDate = (d) => (d ? new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function toast(msg, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const LOGO = '<span class="logo"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span><span>Vimo <span class="ai">AI</span></span>';

/** Read an image file, scale its long side to `max` px and return a JPEG data URL. */
export function shrinkImage(file, max = 1280, quality = 0.9) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type)) return reject(new Error('اختار صورة JPG أو PNG أو WEBP.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الصورة مش سليمة.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // transparent PNGs get a white background instead of black
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export const STATUS = {
  QUEUED: ['في الانتظار', 'run'],
  SCRIPTING: ['بنكتب السكريبت', 'run'],
  GENERATING: ['بنصوّر المشاهد', 'run'],
  MERGING: ['بنجمع الفيديو', 'run'],
  MIXING: ['بنركّب الصوت', 'run'],
  STORING: ['بنجهز التحميل', 'run'],
  COMPLETED: ['جاهز', 'ok'],
  FAILED: ['فشل', 'bad'],
};
