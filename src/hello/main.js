import './hello.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { sequence, accumulate, holdAt, PLACE_CHANGES } from './schedule.js';
import { createPlayer } from './player.js';

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

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
// Desktop layout or not: read every frame, so cached and updated when the media query flips.
const deskMQ = matchMedia('(min-width: 1024px)');
let desk = deskMQ.matches;
deskMQ.addEventListener('change', () => {
  desk = deskMQ.matches;
  lastLayout.valid = false;
});
const isDesk = () => desk;
// Low-end devices get the calm view. (No throwaway WebGL context to find out: creating one costs
// tens of milliseconds on the main thread before first paint, and it was never released. If the
// real one can't be created later, the page simply carries on without the 3D scene.)
const lowTier = (navigator.deviceMemory || 8) <= 2 || !('WebGL2RenderingContext' in window);
const staged = root.classList.contains('stage');
const debug = location.search.includes('debug');
// what the cards were last laid out for (see the ticker); valid = false forces a layout
const lastLayout = { valid: false, step: 0, veil: 0, w: 0, h: 0 };

/* ---------------------------------------------------------------- the player */
// One source of truth for what's on screen: the camera and the cards both read its view.
// Seconds per step: a move to the next stop (camera travel plus a card leaving and arriving),
// or from one card to the next within a stop.
const TRAVEL = [2.3, 3.3, 3.1, 3.1, 3.1];
const player = createPlayer({
  travelSeconds: (k) => TRAVEL[k],
  itemSeconds: (k) => (modeOf(stops[k - 1]) === 'accumulate' ? 0.55 : 1),
  placeChanges: PLACE_CHANGES,
});

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
  player.setCalm(on);
  world?.setCalm(on);
  lastLayout.valid = false; // cards fly out of the scene, or fade in place
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
    .then(async ({ createWorld }) => {
      const w = createWorld(canvas, { mobile: !isDesk(), still: calm, workN: stops[2].items.length, expN: stops[3].items.length, debug });
      // shaders compile in parallel (off the main thread where supported) before the first frame
      await w.prepare(idle);
      world = w;
      // (the theme or calm may have been switched while it compiled)
      world.setTheme(sceneColours(), root.dataset.theme === 'dark', 0);
      world.setCalm(calm);
      if (debug) Object.assign(window, { __world: world, __player: player });
      world.setView(player.view());
      world.renderNow();
      canvas.classList.add('is-on');
      lastLayout.valid = false;
      // then the textures for further on, one per idle moment
      world.warmTextures(idle);
    })
    .catch((err) => console.warn('3D scene unavailable', err));
}
const requestIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
const idle = () => new Promise((r) => requestIdle(r));
const afterLoad = () => !location.search.includes('noworld') && (document.fonts?.ready ?? Promise.resolve()).then(() => requestIdle(loadWorld));
if (document.readyState === 'complete') afterLoad();
else addEventListener('load', afterLoad, { once: true });
document.addEventListener('visibilitychange', () => world?.setRunning(!document.hidden));

/* ---------------------------------------------------------------- scroll → which step */
// Arriving at stop k takes one screen of scroll (the camera travels, nothing to read); the rest
// of the stop's length is shared out between its cards. Each card's "step" sits where it is
// fully out; the player walks from step to step (see player.js).
const geo = { tops: [], vh: 1, max: 1, railW: 0 };
function measure() {
  geo.vh = innerHeight;
  geo.railW = els.fill.parentElement.offsetWidth;
  geo.tops = stops.map((s) => s.sec.getBoundingClientRect().top + scrollY);
  geo.max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  stops.forEach((s) => s.items.forEach((it) => ((it.w = it.el.offsetWidth), (it.h = it.el.offsetHeight))));
}
function keyframes() {
  const K = [{ T: 0, stop: 0, item: 0, L: [0, 0, 0, 0, 0, 0], y: 0 }];
  stops.forEach((stop) => {
    const k = stop.k;
    const a = geo.tops[k - 1];
    const b = k < 5 ? geo.tops[k] - geo.vh : geo.max;
    const n = stop.items.length;
    stop.items.forEach((_, i) => {
      const L = [0, 0, 0, 0, 0, 0].map((_, j) => (j > 0 && j < k ? 1 : 0));
      L[k] = holdAt(n, i, modeOf(stop));
      K.push({ T: k, stop: k, item: i, L, y: a + L[k] * (b - a) });
    });
  });
  return K;
}
const onScroll = () => player.setScroll(scrollY);

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
stops.forEach((s) =>
  s.items.forEach((it) => {
    it.line = els.tethers.appendChild(document.createElementNS(SVGNS, 'line'));
    // last values written, so a frame only touches what changed
    Object.assign(it, { X: NaN, Y: NaN, S: NaN, O: NaN, pe: '', lx: NaN });
  }),
);

// Scratch objects reused every frame (layout runs at display rate while anything moves).
const srcAt = { x: 0, y: 0, visible: false };
const sched = { appear: 0, exit: 0 };
const levels = Object.fromEntries(stops.flatMap((s) => s.items.map((it) => [it.src, 0])));
const edge = [0, 0];
// where a line from the source meets the card's edge
function edgePoint(ax, ay, cx, cy, w, h) {
  const dx = ax - cx;
  const dy = ay - cy;
  const s = Math.min(Math.abs(w / 2 / (dx || 1e-6)), Math.abs(h / 2 / (dy || 1e-6)), 1);
  edge[0] = cx + dx * s;
  edge[1] = cy + dy * s;
  return edge;
}
const HIDDEN_AT = 'translate(-99999px, 0)'; // keep in step with .stage .item in hello.css
// the hero and the rail: written only when their (rounded) values change
const chrome = { hero: NaN, cue: NaN, fill: NaN, sparkOp: NaN, here: NaN };

function hideItem(it) {
  if (it.shown === false) return;
  // Out of sight but still in the accessibility tree and reachable with Tab (visibility: hidden
  // would remove it from both). Parked off screen with a 2D transform and no will-change, so the
  // browser doesn't keep a compositor layer for it (in place, an invisible card overlapping the
  // canvas still got one).
  it.el.style.opacity = '0';
  it.el.style.transform = HIDDEN_AT;
  it.O = 0;
  it.X = NaN;
  it.el.style.pointerEvents = it.pe = 'none';
  it.el.classList.remove('is-out');
  it.line.style.opacity = '0';
  it.lx = NaN;
  it.shown = false;
}

function layout(st) {
  const T = st.T;
  const vw = innerWidth;
  const vh = innerHeight;

  // hero name gives way as we dive into the chip
  const out = sstep(0.15, 0.4, T);
  const heroQ = Math.round(out * 1000);
  if (heroQ !== chrome.hero) {
    chrome.hero = heroQ;
    els.heroCopy.style.opacity = (1 - out).toFixed(3);
    els.heroCopy.style.transform = `translate3d(0, ${(-out * 30).toFixed(1)}px, 0)`;
  }
  const cueQ = Math.round((1 - sstep(0.02, 0.1, T)) * 1000);
  if (cueQ !== chrome.cue) els.cue.style.opacity = String((chrome.cue = cueQ) / 1000);

  // rail: the fill scales, the spark slides (a transform, not `left`, so no layout every frame)
  const f = clamp01((T - 1) / 4);
  const fillQ = Math.round(f * 10000);
  if (fillQ !== chrome.fill) {
    chrome.fill = fillQ;
    els.fill.style.transform = `scaleX(${(fillQ / 10000).toFixed(4)})`;
    els.spark.style.transform = `translate3d(${(f * geo.railW).toFixed(1)}px, 0, 0)`;
  }
  const sparkQ = Math.round(sstep(0.3, 0.9, T) * 1000);
  if (sparkQ !== chrome.sparkOp) els.spark.style.opacity = String((chrome.sparkOp = sparkQ) / 1000);
  const here = T < 0.6 ? 0 : Math.round(T);
  if (here !== chrome.here) {
    chrome.here = here;
    els.rail.forEach((a) => {
      const k = +a.dataset.to;
      a.classList.toggle('is-on', k === here);
      a.classList.toggle('is-past', k < here);
      if (k === here) a.setAttribute('aria-current', 'step');
      else a.removeAttribute('aria-current');
    });
  }

  for (const src in levels) levels[src] = 0;
  const top = desk ? 92 : 104;
  for (let si = 0; si < stops.length; si++) {
    const stop = stops[si];
    const L = st.L[stop.k];
    const n = stop.items.length;
    const plan = modeOf(stop) === 'accumulate' ? accumulate : sequence;
    // a stop's content only shows while the camera is at that stop
    const atStop = 1 - sstep(0.02, 0.2, Math.abs(T - stop.k));
    for (let i = 0; i < n; i++) {
      const it = stop.items[i];
      if (atStop <= 0) {
        hideItem(it);
        continue;
      }
      const { appear, exit: ex } = plan(L, n, i, sched);
      const exit = stop.k === 5 ? 0 : ex; // the last card stays
      const out_ = appear * (1 - exit) * atStop;
      if (out_ > levels[it.src]) levels[it.src] = out_;
      if (out_ < 0.002) {
        hideItem(it);
        continue;
      }
      const el = it.el;
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
      const hh = (it.h * fit) / 2;
      ry = it.h * fit > vh - top - 16 ? top + hh : clamp(ry, top + hh, vh - 16 - hh);
      rx = clamp(rx, (it.w * fit) / 2 + 12, vw - (it.w * fit) / 2 - 12);
      // where it comes from
      const a = world ? world.project(it.src, srcAt) : null;
      const fly = a && a.visible && !calm;
      const e = easeOut(appear);
      const px = fly ? lerp(a.x, rx, e) : rx;
      const py = (fly ? lerp(a.y, ry, e) : ry + (1 - e) * 24) - exit * 70;
      const s = (fly ? lerp(0.04, 1, e) : 1) * fit;
      const op = sstep(0, 0.35, appear) * (1 - exit) * atStop;
      // write styles only when the rounded values changed, so resting cards cost nothing
      const X = Math.round((px - it.w / 2) * 10);
      const Y = Math.round((py - it.h / 2) * 10);
      const S = Math.round(s * 1000);
      if (X !== it.X || Y !== it.Y || S !== it.S) {
        it.X = X;
        it.Y = Y;
        it.S = S;
        el.style.transform = `translate3d(${X / 10}px, ${Y / 10}px, 0) scale(${S / 1000})`;
      }
      const O = Math.round(op * 100);
      if (O !== it.O) el.style.opacity = String((it.O = O) / 100);
      if (it.shown !== true) {
        el.classList.add('is-out'); // a layer while it's on screen and moving
        el.style.visibility = 'visible';
        it.shown = true;
      }
      const pe = op > 0.6 ? 'auto' : 'none';
      if (it.pe !== pe) el.style.pointerEvents = it.pe = pe;
      // a faint thread back to where it came from
      if (a && a.visible && it.fit !== 'screen') {
        const [ex2, ey2] = edgePoint(a.x, a.y, px, py, it.w * s, it.h * s);
        // only touch the SVG when the thread actually moved (each change repaints it)
        const ax = a.x | 0;
        const ay = a.y | 0;
        const bx = ex2 | 0;
        const by = ey2 | 0;
        const lo = (op * 20) | 0;
        if (ax !== it.lx || ay !== it.ly || bx !== it.lx2 || by !== it.ly2 || lo !== it.lo) {
          it.lx = ax;
          it.ly = ay;
          it.lx2 = bx;
          it.ly2 = by;
          it.lo = lo;
          const ln = it.line;
          ln.setAttribute('x1', ax);
          ln.setAttribute('y1', ay);
          ln.setAttribute('x2', bx);
          ln.setAttribute('y2', by);
          ln.style.opacity = (op * 0.7).toFixed(2);
        }
      } else if (!Number.isNaN(it.lx)) {
        it.line.style.opacity = '0';
        it.lx = NaN;
      }
    }
  }
  if (world) for (const src in levels) world.setLevel(src, levels[src]);
}

/* ---------------------------------------------------------------- motion */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', () => onScroll());
  gsap.ticker.lagSmoothing(0);
} else addEventListener('scroll', () => onScroll(), { passive: true });

let lastTime = 0;
gsap.ticker.add(() => {
  const now = performance.now();
  const dt = lastTime ? clamp((now - lastTime) / 1000, 0, 0.1) : 0;
  lastTime = now;
  lenis?.raf(now);
  const playing = player.tick(dt);
  const view = player.view();
  world?.setView(view);
  const moved = world?.tick(now);
  if (!staged) return;
  // lay out again whenever the step moved, the camera moved (cards follow their sources) or the
  // window changed; an idle page, or the scene's ambient loops alone, cost nothing here
  const L = lastLayout;
  if (playing || moved || !L.valid || L.step !== view.step || L.veil !== view.veil || L.w !== innerWidth || L.h !== innerHeight) {
    L.valid = true;
    L.step = view.step;
    L.veil = view.veil;
    L.w = innerWidth;
    L.h = innerHeight;
    layout(view);
  }
});

// in-page links: a short glide to the next stop; further than that, straight there
// (the scene fades across instead of flying past everything in between)
function scrollToY(y, far) {
  if (lenis) lenis.scrollTo(y, { duration: 1.2, immediate: far });
  else scrollTo(0, y);
}
// The link's target takes the focus too (the default action we prevent would have done that),
// so the skip link and the rail work for keyboard and screen-reader users: the next Tab, or the
// reading cursor, carries on from there.
let navFocus = false;
function focusTarget(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  navFocus = true;
  el.focus({ preventScroll: true });
  navFocus = false;
}
$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id === '#top' || id === '#') {
      e.preventDefault();
      scrollToY(0, player.view().T > 1.2);
      focusTarget($('#top'));
      return;
    }
    const sec = $(id);
    const stop = stops.find((s) => s.sec === sec);
    if (!stop) return;
    e.preventDefault();
    // land on the stop's first card
    const k = stop.k;
    scrollToY(staged ? player.yOf(k, 0) : sec.offsetTop - 80, Math.abs(k - player.view().T) > 1.2);
    focusTarget(stop.items[0].el);
  }),
);
// keyboard: tabbing into a card scrolls to where that card is out (not for a mouse click on a
// card that's already out, nor for the focus a link above hands over)
const keyboardFocus = (el) => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};
if (staged)
  stops.forEach((stop) =>
    stop.items.forEach((it, i) =>
      it.el.addEventListener('focusin', (e) => {
        if (navFocus || !keyboardFocus(e.target)) return;
        const y = player.yOf(stop.k, i);
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
let settled = false;
function refresh() {
  measure();
  player.setKeyframes(keyframes());
  onScroll();
  // on first load, start where the page already is (a reload halfway down)
  if (!settled) {
    player.settle();
    settled = true;
  }
  lastLayout.valid = false;
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

// the page is up: the inline script in hello.html falls back to the plain stacked page otherwise
window.__helloReady = true;
