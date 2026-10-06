import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createGauge } from './gauge.js';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bump = (x, a, b, c, d) => Math.min(sstep(a, b, x), 1 - sstep(c, d, x));
const inOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)); // power1.inOut

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const DESK = '(min-width: 1024px)';
const isDesk = () => matchMedia(DESK).matches;

// Low-end devices get one still frame per station, crossfaded, instead of camera travel.
const lowTier = (() => {
  try {
    if ((navigator.deviceMemory || 8) <= 2) return true;
    return !document.createElement('canvas').getContext('webgl2');
  } catch {
    return true;
  }
})();
const stills = reduceMotion || lowTier;

/* ---------------------------------------------------------------- theme */
const themeLabel = $('.theme__label');
const SCENE_KEYS = ['bg', 'board', 'pcb', 'body', 'slot', 'metal', 'gold', 'trace', 'hot', 'accent', 'silk', 'edge', 'die'];
function sceneColours() {
  const cs = getComputedStyle(root);
  const out = Object.fromEntries(SCENE_KEYS.map((k) => [k, cs.getPropertyValue(`--s-${k}`).trim()]));
  out.edgeAmt = parseFloat(cs.getPropertyValue('--s-edge-amt')) || 0.3;
  return out;
}
let world = null;
function applyTheme(theme, animate = true) {
  root.dataset.theme = theme;
  themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
  $('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#050505' : '#f2f0eb');
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  world?.setTheme(sceneColours(), theme === 'dark', animate ? 0.4 : 0);
}
applyTheme(root.dataset.theme || 'dark', false);
$('[data-theme-toggle]').addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

/* ---------------------------------------------------------------- gauge */
const gauge = createGauge($('[data-gauge]'));
const G = { T: 0, level: 1 };

/* ---------------------------------------------------------------- text splitting */
function splitChars(el) {
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  if (!el.closest('[aria-label]')) el.setAttribute('aria-label', text);
  el.innerHTML = text
    .split(' ')
    .map((w) => `<span class="wd" aria-hidden="true">${[...w].map((c) => `<span class="ch">${c}</span>`).join('')}</span>`)
    .join(' ');
  return $$('.ch', el);
}
function splitWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.style.setProperty('--n', words.length);
  el.innerHTML = words.map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(' ');
  el.classList.add('is-words');
}

/* ---------------------------------------------------------------- contact form */
const form = $('[data-form]');
const note = $('.form__note', form);
const sendBtn = $('button', form);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  sendBtn.disabled = true;
  note.classList.remove('is-error');
  form.classList.remove('is-sent');
  note.textContent = 'On its way out…';
  try {
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    await roundTrip();
    note.textContent = "Got it. I'll reply from jatintaadiyal@gmail.com.";
    form.classList.add('is-sent');
  } catch {
    note.classList.add('is-error');
    note.textContent = "That didn't send. Try again, or email jatintaadiyal@gmail.com directly.";
  } finally {
    sendBtn.disabled = false;
  }
});

// The reply leaves the way the request came in: register → cache → RAM → PCIe → NIC → internet.
function roundTrip() {
  if (!world || stills) return Promise.resolve();
  const steps = [
    [4.5, 'register'],
    [3.5, 'cache'],
    [2.5, 'RAM'],
    [1.5, 'PCIe'],
    [0.6, 'network card'],
    [0, 'internet'],
  ];
  world.setTagText('trip', 'network card → internet');
  const st = { T: 5 };
  return new Promise((resolve) => {
    gsap.to(st, {
      T: 0,
      duration: 3.2,
      ease: 'power2.inOut',
      onUpdate: () => {
        world.setOverride(st.T);
        G.override = st.T;
        const done = steps.filter(([t]) => st.T <= t + 0.5).map(([, n]) => n);
        note.textContent = `On its way out… ${done.join(' → ')}`;
        gauge.update(st.T, G.level, !isDesk());
      },
      onComplete: () => {
        const c = $('[data-world]');
        gsap.to(c, {
          opacity: 0,
          duration: 0.35,
          onComplete: () => {
            world.setOverride(null);
            G.override = null;
            gauge.update(G.T, G.level, !isDesk());
            gsap.to(c, { opacity: 1, duration: 0.5, onComplete: resolve });
          },
        });
      },
    });
  });
}

/* ---------------------------------------------------------------- the 3D world */
const canvas = $('[data-world]');
function loadWorld() {
  import('./world.js')
    .then(({ createWorld }) => {
      world = createWorld(canvas, { mobile: !isDesk(), still: stills, tagLayer: $('[data-tags]') });
      world.setTheme(sceneColours(), root.dataset.theme === 'dark', 0);
      if (location.search.includes('debug')) window.__world = Object.assign(world, { G, M });
      pushWorld();
      world.renderNow();
      canvas.classList.add('is-on');
      world.buildAll();
      if (stills) gsap.ticker.add(() => world.tick(performance.now()));
    })
    .catch((err) => {
      console.warn('3D scene unavailable', err);
    });
}
// three.js comes in after the first paint and fonts, so text is never blocked by it.
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 200));
const afterLoad = () => !location.search.includes('noworld') && (document.fonts?.ready ?? Promise.resolve()).then(() => idle(loadWorld));
if (document.readyState === 'complete') afterLoad();
else addEventListener('load', afterLoad, { once: true });

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => world?.resize(), 120);
});
document.addEventListener('visibilitychange', () => world?.setRunning(!document.hidden));

/* ---------------------------------------------------------------- scroll → T */
// Each seam is measured by a ScrollTrigger on the section it leads into; the station local
// progress values (camera trucking, project hops) come from their sections or pins.
const M = { seams: [], local: [], commits: [], pins: {}, paragraph: null, ready: false };
let lastStation = -1;
const els = {
  heroCopy: $('.hero__copy'),
  tagline: $('[data-tagline]'),
  cue: $('.hero__cue'),
  bootLast: $('[data-boot-last]'),
  boot: $('[data-boot]'),
  scrim: $('[data-scrim]'),
  topfade: $('[data-topfade]'),
  about: $('[data-words]'),
};

function computeT(y) {
  let T = 0;
  for (let k = 0; k < M.seams.length; k++) {
    const s = M.seams[k];
    if (y < s.start) return k;
    if (y <= s.end) return k + inOut((y - s.start) / Math.max(1, s.end - s.start));
    T = k + 1;
  }
  return T;
}
const progress = (st, y) => (st ? clamp01((y - st.start) / Math.max(1, st.end - st.start)) : 0);

const skillsState = { cardW: 1, gap: 18, shift: 0, cards: [] };
const workState = { wins: [], current: -1 };
const HOLD = 0.55;
function workPlan(L) {
  // holds and transitions: [hold0][t01][hold1][t12]…[hold4]
  const n = workState.wins.length || 5;
  const total = n * HOLD + (n - 1);
  const s = L * total;
  const seg = HOLD + 1;
  const i = Math.min(n - 1, Math.floor(s / seg));
  const r = s - i * seg;
  if (r <= HOLD || i === n - 1) return { i, t: 0, pf: i };
  const t = (r - HOLD) / 1;
  return { i, t, pf: i + sstep(0.15, 0.85, t) };
}

function update(y = window.scrollY) {
  if (!M.ready) return;
  const desk = isDesk();
  const T = computeT(y);
  G.T = T;

  // ---------- hero overlays ----------
  if (!reduceMotion) {
    const nameOut = sstep(0.14, 0.3, T);
    els.heroCopy.style.opacity = (1 - nameOut).toFixed(3);
    els.heroCopy.style.transform = `translate3d(0, ${(-nameOut * 40).toFixed(1)}px, 0)`;
    const tag = bump(T, 0.28, 0.36, 0.54, 0.64);
    els.tagline.style.opacity = tag.toFixed(3);
    els.tagline.style.transform = `translate3d(-50%, -50%, 0) scale(${(0.92 + 0.08 * tag + sstep(0.54, 0.64, T) * 0.1).toFixed(3)})`;
    els.cue.style.opacity = (1 - sstep(0.01, 0.06, T)).toFixed(3);
    els.bootLast.classList.toggle('is-on', T > 0.46);
    els.boot.style.opacity = (1 - sstep(0.6, 0.7, T)).toFixed(3);
  }
  // scrim behind the text panel; the scene stays clear in the hero and the closing shot
  const scrim = T < 0.3 ? 0.65 : T < 0.62 ? 0.65 - 0.45 * sstep(0.3, 0.4, T) + 0.8 * sstep(0.5, 0.62, T) : T > 5.25 ? 1 - 0.75 * sstep(5.25, 5.7, T) : 1;
  els.scrim.style.opacity = Math.min(1, scrim).toFixed(3);
  els.topfade.style.opacity = sstep(0.5, 0.8, T);

  // ---------- about paragraph lights up by word ----------
  if (M.paragraph && els.about.classList.contains('is-words')) els.about.style.setProperty('--q', progress(M.paragraph, y).toFixed(3));

  // ---------- station local progress ----------
  const L = [0, progress(M.local[1], y), 0, 0, progress(M.local[4], y), progress(M.local[5], y)];
  if (desk && M.pins.skills) {
    const lp = progress(M.pins.skills, y);
    L[2] = lp;
    const track = skillsState.track;
    const x = -lp * skillsState.shift;
    track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    // a spark crosses its pair as the card passes the middle of the scene
    const vw = innerWidth;
    skillsState.cards.forEach((card, n) => {
      const cx = skillsState.x0 + n * (skillsState.cardW + skillsState.gap) + skillsState.cardW / 2 + x;
      const s = (cx - vw * 0.5) / -(skillsState.cardW + skillsState.gap);
      const on = Math.abs(s) < 1;
      world?.setPairSpark(n, on ? s : -9);
      card.classList.toggle('is-on', Math.abs(s) < 0.5);
    });
  } else if (M.local[2]) L[2] = progress(M.local[2], y);
  if (desk && M.pins.work) {
    const plan = workPlan(progress(M.pins.work, y));
    L[3] = plan.pf / 4;
    paintWindows(plan);
  } else L[3] = G.mobileWork ?? 0;

  // ---------- cache level of the commit being read ----------
  let c = 0;
  M.commits.forEach((st, i) => {
    if (y >= st.start) c = i;
  });
  G.level = +($$('[data-commit]')[c]?.dataset.level || 1);

  // ---------- push to the world + gauge ----------
  if (G.override == null) gauge.update(stills ? Math.round(T) : T, G.level, !desk);
  G.L = L;
  pushWorld();
}

function pushWorld() {
  if (!world) return;
  const T = G.T;
  if (stills) {
    // one still per station, crossfaded
    const k = Math.min(6, Math.round(T));
    if (k !== lastStation) {
      const first = lastStation < 0;
      lastStation = k;
      const show = () => {
        world.setT(k === 6 ? 6 : k);
        world.setLevel(G.level);
        world.renderNow();
      };
      if (first) show();
      else gsap.to(canvas, { opacity: 0, duration: 0.15, onComplete: () => (show(), gsap.to(canvas, { opacity: 1, duration: 0.15 })) });
    }
    return;
  }
  G.L?.forEach((v, k) => world.setLocal(k, v));
  world.setLevel(G.level);
  world.setT(T);
}

function paintWindows({ i, t }) {
  workState.wins.forEach((w, n) => {
    let z = -1600;
    let o = 0;
    if (n === i && t === 0) {
      z = 0;
      o = 1;
    } else if (n === i) {
      // outgoing: gone (opacity 0, z +700) by t = 0.6
      const q = clamp01(t / 0.6);
      z = 700 * q * q;
      o = 1 - q;
    } else if (n === i + 1 && t > 0.45) {
      // incoming: still under 0.3 opacity at t = 0.6
      const q = clamp01((t - 0.45) / 0.55);
      z = -1600 * (1 - (1 - (1 - q) * (1 - q)));
      o = q * q;
    }
    const key = `${z.toFixed(0)}|${o.toFixed(3)}`;
    if (w._k === key) return;
    w._k = key;
    w.style.transform = `translate3d(0,0,${z.toFixed(1)}px)`;
    w.style.opacity = o.toFixed(3);
    w.style.visibility = o < 0.01 && !workState.keyboard ? 'hidden' : 'visible';
    w.inert = !workState.keyboard && o < 0.5;
  });
}

/* ---------------------------------------------------------------- motion */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.lagSmoothing(0);
  $$('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      const target = a.getAttribute('href');
      if (target.length < 2 && target !== '#') return;
      e.preventDefault();
      lenis.scrollTo(target === '#top' || target === '#' ? 0 : target, { duration: 1.6 });
      if (target !== '#top') $(target)?.focus?.({ preventScroll: true });
    }),
  );
}
gsap.ticker.add((t) => {
  lenis?.raf(t * 1000);
  if (!stills) world?.tick(performance.now());
});

if (!reduceMotion) {
  // hero name rises letter by letter (the h1 renders without JS; it is hidden only here)
  const lines = $$('[data-chars]');
  const chars = lines.map(splitChars);
  lines.forEach((l) => l.removeAttribute('aria-label'));
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.1 });
  chars.forEach((c, i) => intro.from(c, { yPercent: 110, duration: 1.2, stagger: 0.035 }, i * 0.14));
  intro
    .from('.hero__pitch, .hero__hook', { opacity: 0, y: 12, duration: 0.9, stagger: 0.08 }, 0.45)
    .from('.gauge', { opacity: 0, duration: 0.8 }, 0.6)
    .from('.boot li:not([data-boot-last])', { opacity: 0, duration: 0.25, stagger: 0.28 }, 0.7)
    .from('.hero__cue', { opacity: 0, duration: 0.6 }, 1.2);

  $$('[data-split]').forEach((el) => {
    gsap.from(splitChars(el), {
      yPercent: 110,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.022,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });
  splitWords(els.about);
}

/* ---------------------------------------------------------------- layout-dependent triggers */
const mm = gsap.matchMedia();
function seam(trigger, start, end) {
  return ScrollTrigger.create({ trigger, start, end });
}
mm.add({ desk: DESK, mob: '(max-width: 1023.98px)' }, (ctx) => {
  const { desk } = ctx.conditions;
  const pin = desk && !reduceMotion;
  M.pins = {};
  const vh = () => innerHeight;

  if (pin) {
    // skills: pinned frame, the card track slides while the camera trucks along the pairs
    const track = $('[data-track]');
    skillsState.track = track;
    skillsState.cards = $$('.skill', track);
    const measure = () => {
      const first = skillsState.cards[0];
      skillsState.cardW = first.offsetWidth;
      skillsState.gap = parseFloat(getComputedStyle(track).columnGap) || 18;
      track.style.transform = 'none';
      skillsState.x0 = first.getBoundingClientRect().left;
      skillsState.shift = Math.max(0, track.scrollWidth - (innerWidth - skillsState.x0 * 2) + 0);
    };
    M.pins.skills = ScrollTrigger.create({
      trigger: '#skills',
      start: 'top top',
      end: () => `+=${vh() * 1.4}`,
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      refreshPriority: 2,
      onRefreshInit: measure,
    });
    // work: windows fly in from depth; the camera hops chip to chip along DIMM A1
    workState.wins = $$('[data-win]');
    M.pins.work = ScrollTrigger.create({
      trigger: '#work',
      start: 'top top',
      end: () => `+=${vh() * 2.4}`,
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      refreshPriority: 1,
    });
    // keyboard: hidden windows are inert for pointer users; Tab-ing in lifts that and
    // scrolls the pin to whichever window holds focus.
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      workState.keyboard = true;
      workState.wins.forEach((w) => {
        w.inert = false;
        w.style.visibility = 'visible';
        w._k = null;
      });
    };
    const onPointer = () => (workState.keyboard = false);
    addEventListener('keydown', onKey);
    addEventListener('pointerdown', onPointer);
    const onFocus = (e) => {
      const n = workState.wins.findIndex((w) => w.contains(e.target));
      if (n < 0) return;
      const st = M.pins.work;
      const total = workState.wins.length * HOLD + (workState.wins.length - 1);
      const y = st.start + ((n * (HOLD + 1) + HOLD / 2) / total) * (st.end - st.start);
      lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y);
    };
    $('[data-wins]').addEventListener('focusin', onFocus);
    ctx.add(() => () => {
      removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onPointer);
      $('[data-wins]').removeEventListener('focusin', onFocus);
      skillsState.track.style.transform = '';
      workState.wins.forEach((w) => {
        w.style.transform = w.style.opacity = w.style.visibility = '';
        w.inert = false;
        w._k = null;
      });
    });
  }

  // seams (desk ≈ 60–80 vh, mobile ≈ 35 vh)
  M.seams = [
    ScrollTrigger.create({ trigger: '#about', start: 0, end: desk ? 'top 25%' : 'top 40%' }),
    desk ? seam('#skills', 'top 85%', 'top 25%') : seam('#skills', 'top 70%', 'top 35%'),
    desk ? seam('#work', 'top 100%', 'top 30%') : seam('#work', 'top 70%', 'top 35%'),
    desk ? seam('#experience', 'top 100%', 'top 30%') : seam('#experience', 'top 70%', 'top 35%'),
    desk ? seam('#contact', 'top 100%', 'top 20%') : seam('#contact', 'top 75%', 'top 30%'),
    ScrollTrigger.create({ trigger: '.foot', start: desk ? 'top 85%' : 'top 90%', end: 'max' }),
  ];
  M.local = [
    null,
    seam('#about', 'top 30%', 'bottom 60%'),
    desk ? null : seam('[data-track]', 'top 60%', 'bottom 40%'),
    null,
    seam('.gitlog', 'top 60%', 'bottom 40%'),
    seam('#contact', 'top 20%', 'bottom bottom'),
  ];
  M.paragraph = ScrollTrigger.create({ trigger: '[data-words]', start: 'top 88%', end: () => `+=${vh() * 0.5}` });
  M.commits = $$('[data-commit]').map((c) =>
    ScrollTrigger.create({
      trigger: c,
      start: 'top 62%',
      onEnter: () => c.classList.add('is-on'),
      onLeaveBack: () => c.classList.remove('is-on'),
    }),
  );

  if (!desk) {
    // no pins on small screens: entering a card fires a spark down its pair; entering a
    // project hops the camera to its chip.
    $$('.skill').forEach((card, n) =>
      ScrollTrigger.create({
        trigger: card,
        start: 'top 70%',
        onEnter: () => {
          const o = { s: -1 };
          gsap.to(o, { s: 1, duration: 0.8, ease: 'none', onUpdate: () => world?.setPairSpark(n, o.s), onComplete: () => world?.setPairSpark(n, -9) });
        },
      }),
    );
    G.mobileWork = 0;
    $$('[data-win]').forEach((w, n) =>
      ScrollTrigger.create({
        trigger: w,
        start: 'top 65%',
        end: 'bottom 35%',
        onToggle: (self) => {
          if (!self.isActive) return;
          const o = { v: G.mobileWork };
          gsap.to(o, {
            v: n / 4,
            duration: 0.8,
            ease: 'power2.inOut',
            overwrite: true,
            onUpdate: () => {
              G.mobileWork = o.v;
              world?.setLocal(3, o.v);
            },
          });
        },
      }),
    );
  }

  // master: one trigger reads the whole page position
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

/* ---------------------------------------------------------------- non-scrubbed reveals */
if (!reduceMotion) {
  gsap.to('[data-git-fill]', {
    scaleY: 1,
    ease: 'none',
    scrollTrigger: { trigger: '[data-gitlog]', start: 'top 60%', end: 'bottom 60%', scrub: true },
  });
  gsap.from('.quotes blockquote', {
    y: 30,
    opacity: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.08,
    scrollTrigger: { trigger: '.quotes', start: 'top 85%', once: true },
  });
}

/* ---------------------------------------------------------------- contact terminal */
const typed = $('[data-type]');
const termOut = $('[data-term-out]');
function roundTripText() {
  const s = Math.max(1, Math.round(performance.now() / 1000));
  return `HTTP/1.1 200 OK · round trip: ${Math.floor(s / 60)}m ${s % 60}s · served: nvme0n1 → DRAM → L1 → you`;
}
if (reduceMotion) {
  ScrollTrigger.create({ trigger: '#contact', start: 'top 60%', once: true, onEnter: () => (termOut.textContent = roundTripText()) });
} else {
  const command = typed.dataset.type;
  typed.textContent = '';
  termOut.style.visibility = 'hidden';
  ScrollTrigger.create({
    trigger: '#contact',
    start: 'top 55%',
    once: true,
    onEnter: () => {
      const st = { n: 0 };
      gsap.to(st, {
        n: command.length,
        duration: command.length * 0.05,
        ease: 'none',
        onUpdate: () => (typed.textContent = command.slice(0, Math.round(st.n))),
        onComplete: () => {
          termOut.textContent = roundTripText();
          termOut.style.visibility = 'visible';
        },
      });
    },
  });
}

/* ---------------------------------------------------------------- form focus: a gate switches */
form.addEventListener('focusin', () => {
  if (!world || stills) return;
  const o = { v: 1 };
  gsap.to(o, { v: 0, duration: 0.6, ease: 'power2.out', onUpdate: () => world.setGatePulse(o.v) });
});

/* ---------------------------------------------------------------- pointer drift */
if (finePointer && !stills) {
  addEventListener('pointermove', (e) => world?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
}

document.fonts?.ready.then(() => ScrollTrigger.refresh());
