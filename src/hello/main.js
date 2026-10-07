import './hello.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const sineInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const DESK = '(min-width: 1024px)';
const isDesk = () => matchMedia(DESK).matches;
const lowTier = (() => {
  try {
    if ((navigator.deviceMemory || 8) <= 2) return true;
    return !document.createElement('canvas').getContext('webgl2');
  } catch {
    return true;
  }
})();

/* ---------------------------------------------------------------- theme */
const SCENE_KEYS = ['bg', 'board', 'pcb', 'body', 'slot', 'metal', 'gold', 'trace', 'hot', 'accent', 'silk', 'edge', 'die'];
function sceneColours() {
  const cs = getComputedStyle(root);
  const out = Object.fromEntries(SCENE_KEYS.map((k) => [k, cs.getPropertyValue(`--s-${k}`).trim()]));
  out.edgeAmt = parseFloat(cs.getPropertyValue('--s-edge-amt')) || 0.3;
  out.glowRest = parseFloat(cs.getPropertyValue('--s-glow-rest')) || 0.55;
  out.fogK = parseFloat(cs.getPropertyValue('--s-fog')) || 1;
  return out;
}
let world = null;
function applyTheme(theme, animate = true) {
  root.dataset.theme = theme;
  $('.theme__label').textContent = theme === 'dark' ? 'Dark' : 'Light';
  $('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#050505' : '#f2f0eb');
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  world?.setTheme(sceneColours(), theme === 'dark', animate ? 0.4 : 0);
}
applyTheme(root.dataset.theme || 'dark', false);
$('[data-theme-toggle]').addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

/* ---------------------------------------------------------------- calm view */
// Fades between stops instead of moving the camera. On for reduced motion and low-end devices.
const calmBtn = $('[data-calm]');
let calm = reduceMotion || lowTier || root.dataset.calm === '1';
function setCalm(on) {
  calm = on;
  calmBtn.setAttribute('aria-pressed', String(on));
  world?.setCalm(on);
}
setCalm(calm);
calmBtn.addEventListener('click', () => {
  setCalm(!calm);
  try {
    localStorage.setItem('calm', calm ? '1' : '0');
  } catch {}
});

/* ---------------------------------------------------------------- contact form */
const form = $('[data-form]');
const note = $('.form__note', form);
const sendBtn = $('button', form);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  sendBtn.disabled = true;
  note.classList.remove('is-error');
  form.classList.remove('is-sent');
  note.textContent = 'Sending…';
  try {
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    await sendBack();
    note.textContent = "Got it in Auckland. I'll reply from jatintaadiyal@gmail.com.";
    form.classList.add('is-sent');
  } catch {
    note.classList.add('is-error');
    note.textContent = "That didn't send. Try again, or email jatintaadiyal@gmail.com directly.";
  } finally {
    sendBtn.disabled = false;
  }
});
// The reply rides the same arc back across the globe to Auckland.
function sendBack() {
  if (!world || calm) return Promise.resolve();
  note.textContent = 'On its way to Auckland…';
  const o = { v: 0 };
  return new Promise((resolve) =>
    gsap.to(o, {
      v: 1,
      duration: 2.4,
      ease: 'power2.inOut',
      onUpdate: () => world.setOverride(o.v),
      onComplete: () => gsap.delayedCall(0.6, () => (world.setOverride(null), resolve())),
    }),
  );
}

/* ---------------------------------------------------------------- the 3D world */
const canvas = $('[data-world]');
function loadWorld() {
  import('./world.js')
    .then(({ createWorld }) => {
      world = createWorld(canvas, {
        mobile: !isDesk(),
        still: calm,
        tagLayer: $('[data-tags]'),
        projects: $$('[data-win]').map((w) => w.dataset.name),
        stops: $$('[data-job]').map((j) => j.dataset.label),
      });
      world.setTheme(sceneColours(), root.dataset.theme === 'dark', 0);
      if (location.search.includes('debug')) window.__world = world;
      update();
      world.settle();
      world.renderNow();
      canvas.classList.add('is-on');
      requestIdle(() => world.compileAll());
    })
    .catch((err) => console.warn('3D scene unavailable', err));
}
const requestIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 200));
const afterLoad = () => !location.search.includes('noworld') && (document.fonts?.ready ?? Promise.resolve()).then(() => requestIdle(loadWorld));
if (document.readyState === 'complete') afterLoad();
else addEventListener('load', afterLoad, { once: true });

let resizeTimer = 0;
let wasDesk = isDesk();
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (isDesk() !== wasDesk) {
      wasDesk = isDesk();
      world?.setMobile(!wasDesk);
    }
    world?.resize();
  }, 120);
});
document.addEventListener('visibilitychange', () => world?.setRunning(!document.hidden));

/* ---------------------------------------------------------------- scroll → where the hello is */
// T: 0 hero … 5 contact. Seam k is the stretch of scroll that leads into stop k+1; in between,
// each stop's own progress L moves the camera only a little (or from project to project).
const M = { seams: [], ready: false };
const els = {
  heroCopy: $('.hero__copy'),
  cue: $('.hero__cue'),
  fill: $('[data-route-fill]'),
  spark: $('[data-route-spark]'),
  stops: $$('[data-stop]'),
  wins: $$('[data-win]'),
  jobs: $$('[data-job]'),
};
let curT = 0;

function computeT(y) {
  let T = 0;
  for (let k = 0; k < M.seams.length; k++) {
    const s = M.seams[k];
    if (y < s.start) return k;
    if (y <= s.end) return k + sineInOut((y - s.start) / Math.max(1, s.end - s.start));
    T = k + 1;
  }
  return T;
}
const span = (y, a, b) => clamp01((y - a) / Math.max(1, b - a));

// Which card is in the middle of the screen, as a continuous index (0 … n-1).
function itemProgress(items) {
  const mid = innerHeight * 0.5;
  const c = items.map((el) => {
    const r = el.getBoundingClientRect();
    return r.top + Math.min(r.height, innerHeight * 0.6) / 2;
  });
  if (mid <= c[0]) return 0;
  for (let i = 0; i < c.length - 1; i++) if (mid <= c[i + 1]) return i + (mid - c[i]) / Math.max(1, c[i + 1] - c[i]);
  return c.length - 1;
}

function update(y = window.scrollY) {
  if (!M.ready) return;
  const T = computeT(y);
  curT = T;
  const desk = isDesk();

  // hero: the name gives way as the camera pulls out of the laptop
  if (!reduceMotion) {
    const out = desk ? sstep(0.18, 0.4, T) : 0;
    els.heroCopy.style.opacity = (1 - out).toFixed(3);
    els.heroCopy.style.transform = `translate3d(0, ${(-out * 30).toFixed(1)}px, 0)`;
    els.cue.style.opacity = (1 - sstep(0.02, 0.1, T)).toFixed(3);
  }

  // route: a dot rides the line from Auckland to You
  const f = clamp01((T - 1) / 4);
  els.fill.style.transform = `scaleX(${f.toFixed(4)})`;
  els.spark.style.left = `${(f * 100).toFixed(2)}%`;
  els.spark.style.opacity = sstep(0.3, 0.9, T).toFixed(3);
  const here = T < 0.6 ? 0 : Math.round(T);
  els.stops.forEach((a) => {
    const k = +a.dataset.stop;
    a.classList.toggle('is-on', k === here);
    a.classList.toggle('is-past', k < here);
    if (k === here) a.setAttribute('aria-current', 'step');
    else a.removeAttribute('aria-current');
  });

  // local progress at each stop
  const s = M.seams;
  const L = [0, span(y, s[0].end, s[1].start), span(y, s[1].end, s[2].start), 0, 0, span(y, s[4].end, ScrollTrigger.maxScroll(window))];
  const pw = itemProgress(els.wins);
  const pj = itemProgress(els.jobs);
  L[3] = pw / (els.wins.length - 1);
  L[4] = pj / (els.jobs.length - 1);
  els.wins.forEach((w, i) => w.classList.toggle('is-on', T > 2.5 && T < 3.5 && Math.round(pw) === i));
  els.jobs.forEach((j, i) => j.classList.toggle('is-on', T > 3.5 && i <= Math.round(pj)));

  if (world) {
    L.forEach((v, k) => world.setLocal(k, v));
    world.setT(T);
  }
}

/* ---------------------------------------------------------------- motion */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.lagSmoothing(0);
}
gsap.ticker.add((t) => {
  lenis?.raf(t * 1000);
  world?.tick(performance.now());
});
// in-page links: a short glide to the next stop; further than that, straight there
// (the scene fades across instead of flying past everything in between)
$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    const target = id === '#top' || id === '#' ? 0 : $(id);
    if (target === null) return;
    e.preventDefault();
    const stop = +(a.dataset.stop ?? (target === 0 ? 0 : target.dataset.stopSection ?? 0));
    const far = Math.abs(stop - curT) > 1.2;
    if (lenis) lenis.scrollTo(target, { duration: 1.2, immediate: far, offset: target === 0 ? 0 : -90 });
    else (target === 0 ? scrollTo(0, 0) : target.scrollIntoView());
    if (target !== 0) target.focus?.({ preventScroll: true });
  }),
);

if (!reduceMotion) {
  const splitChars = (el) => {
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    el.innerHTML = text
      .split(' ')
      .map((w) => `<span class="wd" aria-hidden="true">${[...w].map((c) => `<span class="ch">${c}</span>`).join('')}</span>`)
      .join(' ');
    return $$('.ch', el);
  };
  const lines = $$('[data-chars]');
  const chars = lines.map(splitChars);
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.1 });
  chars.forEach((c, i) => intro.from(c, { yPercent: 110, duration: 1.2, stagger: 0.035 }, i * 0.14));
  intro.from('.hero__pitch, .hero__hook', { opacity: 0, y: 12, duration: 0.9, stagger: 0.08 }, 0.45).from('.hero__cue', { opacity: 0, duration: 0.6 }, 1.2);

  // headings rise once as they arrive; nothing else moves with the scroll
  $$('[data-split]').forEach((el) => {
    el.setAttribute('aria-label', el.textContent.trim());
    gsap.from(splitChars(el), { yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.02, scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
  });
}

/* ---------------------------------------------------------------- seams (layout dependent) */
const mm = gsap.matchMedia();
mm.add({ desk: DESK, mob: '(max-width: 1023.98px)' }, (ctx) => {
  const { desk } = ctx.conditions;
  const seam = (trigger, start, end) => ScrollTrigger.create({ trigger, start, end });
  M.seams = [
    ScrollTrigger.create({ trigger: '#about', start: 0, end: desk ? 'top 40%' : 'top 55%' }),
    seam('#skills', 'top 100%', desk ? 'top 25%' : 'top 35%'),
    seam('#work', 'top 100%', desk ? 'top 25%' : 'top 35%'),
    seam('#experience', 'top 100%', desk ? 'top 25%' : 'top 35%'),
    seam('#contact', 'top 100%', desk ? 'top 25%' : 'top 35%'),
  ];
  const master = ScrollTrigger.create({
    start: 0,
    end: 'max',
    refreshPriority: -100,
    onUpdate: (self) => update(self.scroll()),
    onRefresh: (self) => {
      M.ready = true;
      update(self.scroll());
    },
  });
  M.ready = true;
  ctx.add(() => () => {
    M.ready = false;
    master.kill();
  });
});

/* ---------------------------------------------------------------- pointer drift */
if (finePointer && !reduceMotion) {
  addEventListener('pointermove', (e) => world?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
}

document.fonts?.ready.then(() => ScrollTrigger.refresh());
