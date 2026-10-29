// Motion for every page: things fade in as they scroll into view, sliders that
// move on their own, and the "AI at work" steps shown while we wait for the
// server. Everything calms down for people who asked for less motion.

export const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fades in every `.reveal` inside `root` when it enters the screen (once). */
export function reveal(root = document) {
  const items = [...root.querySelectorAll('.reveal:not(.in)')];
  if (calm() || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  items.forEach((el, i) => { el.style.setProperty('--d', `${(i % 6) * 70}ms`); io.observe(el); });
}

/**
 * A swipeable slider: `track` holds the slides side by side (scroll-snap), the
 * dots and arrows follow it, and it moves to the next slide every `every` ms
 * until the visitor touches it. Videos play (muted) only on the visible slide.
 */
export function slider(box, { every = 4500, playVideos = true } = {}) {
  const track = box.querySelector('.slides');
  const slides = [...track.children];
  if (!slides.length) return;
  const dots = box.querySelector('.dots');
  if (dots) {
    dots.innerHTML = slides.map((_, i) => `<button type="button" aria-label="${i + 1}"></button>`).join('');
    [...dots.children].forEach((d, i) => { d.onclick = () => { stop(); go(i); }; });
  }
  let index = 0;
  let timer = 0;
  const visible = () => {
    // RTL scrolls with negative scrollLeft in most browsers: compare by position instead
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let best = 0; let dist = Infinity;
    slides.forEach((s, i) => { const r = s.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const mark = () => {
    index = visible();
    slides.forEach((s, i) => {
      s.classList.toggle('active', i === index);
      const v = s.querySelector('video');
      if (v && playVideos) { if (i === index && !calm()) { v.muted = true; v.play().catch(() => {}); } else v.pause(); }
    });
    if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('on', i === index));
  };
  const go = (i) => {
    const s = slides[(i + slides.length) % slides.length];
    track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: calm() ? 'auto' : 'smooth' });
  };
  const stop = () => { clearInterval(timer); timer = 0; };
  box.querySelector('.prev')?.addEventListener('click', () => { stop(); go(index - 1); });
  box.querySelector('.next')?.addEventListener('click', () => { stop(); go(index + 1); });
  let raf = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
  ['pointerdown', 'touchstart', 'wheel', 'play'].forEach((ev) => track.addEventListener(ev, stop, { passive: true, capture: true }));
  if (!calm() && slides.length > 1) timer = setInterval(() => { if (!document.hidden) go(index + 1); }, every);
  mark();
}

/**
 * The steps the AI goes through, ticked one by one while a request runs.
 * Returns `done()`; the last step waits until the answer is really back.
 */
export function aiSteps(el, steps, { every = 1800 } = {}) {
  el.innerHTML = `<div class="ai-work"><div class="ai-orb"><i></i><i></i><i></i></div><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`;
  const items = [...el.querySelectorAll('li')];
  let i = 0;
  const tick = () => items.forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'now' : ''; });
  tick();
  const timer = setInterval(() => { if (i < items.length - 1) { i++; tick(); } }, every);
  return () => { clearInterval(timer); i = items.length; tick(); };
}

/** Writes `text` into `el` a few letters at a time (instantly for calm motion). */
export function typeIn(el, text, { speed = 18 } = {}) {
  if (calm()) { el.textContent = text; return Promise.resolve(); }
  el.textContent = '';
  return new Promise((done) => {
    let n = 0;
    const t = setInterval(() => { n += 2; el.textContent = text.slice(0, n); if (n >= text.length) { clearInterval(t); done(); } }, speed);
  });
}
