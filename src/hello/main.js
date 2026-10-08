import './hello.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { sequence, accumulate, holdAt } from './schedule.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
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
const staged = root.classList.contains('stage');

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
// The camera fades between stops instead of moving, and content fades in where it's read.
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
    note.textContent = "Got it. I'll reply from jatintaadiyal@gmail.com.";
    form.classList.add('is-sent');
  } catch {
    note.classList.add('is-error');
    note.textContent = "That didn't send. Try again, or email jatintaadiyal@gmail.com directly.";
  } finally {
    sendBtn.disabled = false;
  }
});
// the message drops off the screen and back into the laptop
function sendBack() {
  if (!world || calm) return Promise.resolve();
  const o = { v: 0 };
  return new Promise((resolve) =>
    gsap.to(o, { v: 1, duration: 1.8, ease: 'power2.inOut', onUpdate: () => world.setSendBack(o.v), onComplete: () => (world.setSendBack(null), resolve()) }),
  );
}

/* ---------------------------------------------------------------- the 3D world */
const canvas = $('[data-world]');
const stops = $$('[data-stop]').map((sec) => ({
  sec,
  k: +sec.dataset.stop,
  items: $$('.item', sec).map((el) => ({ el, src: el.dataset.src, x: +el.dataset.x, y: +el.dataset.y, fit: el.dataset.fit, w: 0, h: 0, shown: null })),
}));
const modeOf = (stop) => (stop.sec.dataset.mode === 'accumulate' && isDesk() ? 'accumulate' : 'sequence');

function loadWorld() {
  import('./world.js')
    .then(({ createWorld }) => {
      world = createWorld(canvas, { mobile: !isDesk(), still: calm, workN: stops[2].items.length, expN: stops[3].items.length });
      world.setTheme(sceneColours(), root.dataset.theme === 'dark', 0);
      if (location.search.includes('debug')) window.__world = world;
      onScroll();
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
document.addEventListener('visibilitychange', () => world?.setRunning(!document.hidden));

/* ---------------------------------------------------------------- scroll → where we are */
// Arriving at stop k takes one screen of scroll (the camera travels, nothing to read); the rest of
// the stop's length is its own progress L, during which its items come out one after another.
const geo = { tops: [], vh: 1, max: 1 };
function measure() {
  geo.vh = innerHeight;
  geo.tops = stops.map((s) => s.sec.getBoundingClientRect().top + scrollY);
  geo.max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  stops.forEach((s) => s.items.forEach((it) => ((it.w = it.el.offsetWidth), (it.h = it.el.offsetHeight))));
}
const target = { T: 0, L: [0, 0, 0, 0, 0, 0] };
function onScroll(y = scrollY) {
  const { tops, vh } = geo;
  if (!tops.length) return;
  let T = 0;
  if (y < tops[0]) T = sineInOut(clamp01(y / tops[0]));
  else {
    T = 5;
    for (let k = 1; k < 5; k++) {
      const seamStart = tops[k] - vh;
      if (y < seamStart) {
        T = k;
        break;
      }
      if (y < tops[k]) {
        T = k + sineInOut((y - seamStart) / vh);
        break;
      }
    }
  }
  target.T = T;
  for (let k = 1; k <= 5; k++) {
    const a = tops[k - 1];
    const b = k < 5 ? tops[k] - vh : geo.max;
    target.L[k] = clamp01((y - a) / Math.max(1, b - a));
  }
  if (world) {
    target.L.forEach((v, k) => world.setLocal(k, v));
    world.setT(T);
  }
}

/* ---------------------------------------------------------------- laying content over the scene */
const els = {
  heroCopy: $('.hero__copy'),
  cue: $('.hero__cue'),
  fill: $('[data-rail-fill]'),
  spark: $('[data-rail-spark]'),
  rail: $$('[data-to]'),
  tethers: $('[data-tethers]'),
};
const SVGNS = 'http://www.w3.org/2000/svg';
const lines = stops.flatMap((s) =>
  s.items.map((it) => {
    const l = document.createElementNS(SVGNS, 'line');
    els.tethers.appendChild(l);
    it.line = l;
    return l;
  }),
);

// where a line from the source meets the card's edge
function edgePoint(ax, ay, cx, cy, w, h) {
  const dx = ax - cx;
  const dy = ay - cy;
  const s = Math.min(Math.abs(w / 2 / (dx || 1e-6)), Math.abs(h / 2 / (dy || 1e-6)), 1);
  return [cx + dx * s, cy + dy * s];
}

function layout() {
  const st = world ? world.state() : { T: target.T, L: target.L };
  const T = st.T;
  const desk = isDesk();
  const vw = innerWidth;
  const vh = innerHeight;

  // hero name gives way as we dive into the chip
  const out = sstep(0.15, 0.4, T);
  els.heroCopy.style.opacity = (1 - out).toFixed(3);
  els.heroCopy.style.transform = `translate3d(0, ${(-out * 30).toFixed(1)}px, 0)`;
  els.cue.style.opacity = (1 - sstep(0.02, 0.1, T)).toFixed(3);

  // rail
  const f = clamp01((T - 1) / 4);
  els.fill.style.transform = `scaleX(${f.toFixed(4)})`;
  els.spark.style.left = `${(f * 100).toFixed(2)}%`;
  els.spark.style.opacity = sstep(0.3, 0.9, T).toFixed(3);
  const here = T < 0.6 ? 0 : Math.round(T);
  els.rail.forEach((a) => {
    const k = +a.dataset.to;
    a.classList.toggle('is-on', k === here);
    a.classList.toggle('is-past', k < here);
    if (k === here) a.setAttribute('aria-current', 'step');
    else a.removeAttribute('aria-current');
  });

  const levels = {};
  stops.forEach((stop) => {
    const L = st.L[stop.k];
    const n = stop.items.length;
    const mode = modeOf(stop);
    // a stop's content only shows while the camera is at that stop
    const atStop = 1 - sstep(0.25, 0.45, Math.abs(T - stop.k));
    stop.items.forEach((it, i) => {
      const { appear, exit: ex } = (mode === 'accumulate' ? accumulate : sequence)(L, n, i);
      const exit = stop.k === 5 ? 0 : ex; // the last card stays
      const out_ = appear * (1 - exit) * atStop;
      levels[it.src] = Math.max(levels[it.src] || 0, out_);
      const el = it.el;
      if (out_ < 0.002) {
        if (it.shown !== false) {
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
          it.line.style.opacity = 0;
          it.shown = false;
        }
        return;
      }
      // where it will be read
      let fit = 1;
      let rx = desk ? it.x * vw : vw / 2;
      let ry = desk ? it.y * vh : vh * 0.66;
      if (it.fit === 'screen' && world && desk) {
        const r = world.screenRect();
        rx = r.x + r.w / 2;
        ry = r.y + r.h / 2;
        fit = Math.min(1, (r.w * 0.94) / it.w, (r.h * 0.94) / it.h);
      }
      const top = desk ? 92 : 104;
      const hh = (it.h * fit) / 2;
      ry = it.h * fit > vh - top - 16 ? top + hh : clamp(ry, top + hh, vh - 16 - hh);
      rx = clamp(rx, (it.w * fit) / 2 + 12, vw - (it.w * fit) / 2 - 12);
      // where it comes from
      const a = world ? world.project(it.src) : null;
      const fly = a && a.visible && !calm;
      const e = easeOut(appear);
      const px = fly ? lerp(a.x, rx, e) : rx;
      const py = (fly ? lerp(a.y, ry, e) : ry + (1 - e) * 24) - exit * 70;
      const s = (fly ? lerp(0.04, 1, e) : 1) * fit;
      const op = sstep(0, 0.35, appear) * (1 - exit) * atStop;
      el.style.visibility = 'visible';
      el.style.opacity = op.toFixed(3);
      el.style.transform = `translate3d(${(px - it.w / 2).toFixed(1)}px, ${(py - it.h / 2).toFixed(1)}px, 0) scale(${s.toFixed(4)})`;
      el.style.pointerEvents = op > 0.6 ? 'auto' : 'none';
      it.shown = true;
      // a faint thread back to where it came from
      if (a && a.visible && it.fit !== 'screen') {
        const [ex, ey] = edgePoint(a.x, a.y, px, py, it.w * s, it.h * s);
        const ln = it.line;
        ln.setAttribute('x1', a.x.toFixed(1));
        ln.setAttribute('y1', a.y.toFixed(1));
        ln.setAttribute('x2', ex.toFixed(1));
        ln.setAttribute('y2', ey.toFixed(1));
        ln.style.opacity = (op * 0.7).toFixed(3);
      } else it.line.style.opacity = 0;
    });
  });
  if (world) Object.entries(levels).forEach(([src, v]) => world.setLevel(src, v));
}

/* ---------------------------------------------------------------- motion */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', () => onScroll());
  gsap.ticker.lagSmoothing(0);
} else addEventListener('scroll', () => onScroll(), { passive: true });

let lastLayout = '';
gsap.ticker.add((t) => {
  lenis?.raf(t * 1000);
  const drew = world?.tick(performance.now());
  if (!staged) return;
  // lay out again whenever the scene was redrawn or the scroll moved
  const key = `${scrollY}|${innerWidth}|${innerHeight}`;
  if (drew || key !== lastLayout || !world) {
    lastLayout = key;
    layout();
  }
});

// in-page links: a short glide to the next stop; further than that, straight there
// (the scene fades across instead of flying past everything in between)
function scrollToY(y, far) {
  if (lenis) lenis.scrollTo(y, { duration: 1.2, immediate: far });
  else scrollTo(0, y);
}
$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id === '#top' || id === '#') {
      e.preventDefault();
      scrollToY(0, target.T > 1.2);
      return;
    }
    const sec = $(id);
    const stop = stops.find((s) => s.sec === sec);
    if (!stop) return;
    e.preventDefault();
    // land where the stop's first item is out and readable
    const k = stop.k;
    const y = staged ? geo.tops[k - 1] + holdAt(stop.items.length, 0, modeOf(stop)) * ((k < 5 ? geo.tops[k] - geo.vh : geo.max) - geo.tops[k - 1]) : sec.offsetTop - 80;
    scrollToY(y, Math.abs(k - target.T) > 1.2);
  }),
);
// keyboard: tabbing into a card scrolls to where that card is out
if (staged)
  stops.forEach((stop) =>
    stop.items.forEach((it, i) =>
      it.el.addEventListener('focusin', () => {
        const k = stop.k;
        const a = geo.tops[k - 1];
        const b = k < 5 ? geo.tops[k] - geo.vh : geo.max;
        const y = a + holdAt(stop.items.length, i, modeOf(stop)) * (b - a);
        if (Math.abs(scrollY - y) > 4) scrollToY(y, true);
      }),
    ),
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
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.1 });
  $$('[data-chars]').forEach((l, i) => intro.from(splitChars(l), { yPercent: 110, duration: 1.2, stagger: 0.035 }, i * 0.14));
  intro.from('.hero__pitch, .hero__hook', { opacity: 0, y: 12, duration: 0.9, stagger: 0.08 }, 0.45).from('.hero__cue', { opacity: 0, duration: 0.6 }, 1.2);
}

/* ---------------------------------------------------------------- layout changes */
let resizeTimer = 0;
let wasDesk = isDesk();
function refresh() {
  measure();
  onScroll();
  lastLayout = '';
}
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (isDesk() !== wasDesk) {
      wasDesk = isDesk();
      world?.setMobile(!wasDesk);
    }
    world?.resize();
    refresh();
  }, 120);
});
refresh();
document.fonts?.ready.then(refresh);
addEventListener('load', refresh, { once: true });

if (finePointer && !reduceMotion) {
  addEventListener('pointermove', (e) => world?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
}
