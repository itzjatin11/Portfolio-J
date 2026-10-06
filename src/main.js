import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { paintPatterns } from './layers.js';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- static bits ---------- */
$('[data-year]').textContent = new Date().getFullYear();

const clocks = $$('[data-clock]');
const fmt = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const tick = () => clocks.forEach((c) => (c.textContent = fmt.format(new Date())));
tick();
setInterval(tick, 15_000);

/* ---------- 3D fly-through hero ---------- */
// three.js loads after the page is interactive, so text paints first.
let journey = null;
let heroActive = true;
let heroProgress = 0;
import('./journey.js')
  .then(({ createJourney }) => {
    journey = createJourney($('[data-gl]'), { reduced: reduceMotion });
    journey.setProgress(heroProgress);
    journey.setRunning(heroActive && !document.hidden);
  })
  .catch(() => {
    // No WebGL: the hero still reads as type on a dark background.
  });

/* ---------- theme toggle ---------- */
const themeLabel = $('.theme__label');
function applyTheme(theme) {
  root.dataset.theme = theme;
  themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
  try {
    localStorage.setItem('theme', theme);
  } catch {}
}
applyTheme(root.dataset.theme || 'dark');
$('[data-theme-toggle]').addEventListener('click', () =>
  applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'),
);

/* ---------- contact form ---------- */
const form = $('[data-form]');
const note = $('.form__note', form);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('button', form);
  button.disabled = true;
  note.classList.remove('is-error');
  note.textContent = 'Sending…';
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    note.textContent = 'Sent — thanks, I’ll reply soon.';
  } catch {
    note.classList.add('is-error');
    note.textContent = 'Didn’t send. Email me directly instead.';
  } finally {
    button.disabled = false;
  }
});

/* ---------- text splitting ---------- */
function splitChars(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words
    .map((w) => `<span class="wd">${[...w].map((c) => `<span class="ch">${c}</span>`).join('')}</span>`)
    .join(' ');
  el.classList.add('is-split');
  return $$('.ch', el);
}
function splitSoft(el) {
  // per-character spans without clipping, for the scroll-scrubbed paragraph
  el.innerHTML = el.textContent
    .trim()
    .split(/(\s+)/)
    .map((part) =>
      /^\s+$/.test(part) ? ' ' : `<span style="white-space:nowrap">${[...part].map((c) => `<span class="c">${c}</span>`).join('')}</span>`,
    )
    .join('');
  return $$('.c', el);
}

paintPatterns();

if (!reduceMotion) initMotion();

function initMotion() {
  /* ---------- smooth scroll ---------- */
  const lenis = new Lenis({ lerp: 0.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  $$('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      const target = a.getAttribute('href');
      if (target.length < 2) return;
      e.preventDefault();
      lenis.scrollTo(target === '#top' ? 0 : target, { duration: 1.4 });
    }),
  );

  /* ---------- hero intro ---------- */
  const titleChars = $$('[data-chars]').map(splitChars);
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.2 });
  titleChars.forEach((chars, i) =>
    intro.from(chars, { yPercent: 110, duration: 1.3, stagger: 0.04 }, i * 0.15),
  );
  intro
    .from('.stage__kicker', { opacity: 0, y: 10, duration: 0.8 }, 0.3)
    .from('.hud__tl, .hud__tr, .hud__br', { opacity: 0, duration: 0.8, stagger: 0.1 }, 0.5)
    .from('[data-gl]', { opacity: 0, duration: 1.6, ease: 'power2.out' }, 0);

  /* ---------- fly-through: one scrubbed timeline drives the overlays ---------- */
  const layerEl = $('[data-layer]');
  const depthEl = $('[data-depth]');
  const layers = [
    [0.25, 'PCB'],
    [0.42, 'Package'],
    [0.52, 'Die'],
    [0.76, 'L1 cache'],
    [1.01, 'Core'],
  ];
  const fly = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '[data-journey]',
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => {
        const p = self.progress;
        heroProgress = p;
        journey?.setProgress(p);
        layerEl.textContent = layers.find(([t]) => p < t)[1];
        depthEl.textContent = String(Math.round(p * 1600)).padStart(4, '0');
      },
      onToggle: (self) => {
        heroActive = self.isActive || window.scrollY < 10;
        journey?.setRunning(heroActive && !document.hidden);
      },
    },
  });
  fly
    .to('[data-bar]', { scaleX: 1, duration: 1 }, 0)
    .to('[data-boot] li', { opacity: 1, duration: 0.02, stagger: 0.035 }, 0.02)
    .to('[data-stage="a"]', { scale: 1.5, opacity: 0, duration: 0.12, ease: 'power2.in' }, 0.28)
    .to('[data-flash]', { opacity: 0.85, duration: 0.03, ease: 'power2.in' }, 0.43)
    .to('[data-flash]', { opacity: 0, duration: 0.07, ease: 'power2.out' }, 0.46)
    .to('[data-boot]', { opacity: 0, duration: 0.08 }, 0.5)
    .fromTo('[data-stage="b"]', { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.1 }, 0.62)
    .to('[data-stage="b"]', { opacity: 0, scale: 1.25, duration: 0.08 }, 0.88);
  document.addEventListener('visibilitychange', () =>
    journey?.setRunning(heroActive && !document.hidden),
  );

  /* ---------- section titles rise letter by letter ---------- */
  $$('[data-split]').forEach((el) => {
    gsap.from(splitChars(el), {
      yPercent: 110,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.025,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    });
  });

  /* ---------- hello paragraph lights up with scroll ---------- */
  const helloChars = splitSoft($('[data-reveal-chars]'));
  gsap.to(helloChars, {
    opacity: 1,
    stagger: 0.02,
    ease: 'none',
    scrollTrigger: { trigger: '[data-reveal-chars]', start: 'top 80%', end: 'bottom 50%', scrub: true },
  });

  /* ---------- going deeper: each section is a layer inside the machine ---------- */
  // Layer backgrounds drift at two depths behind the content.
  $$('.layer').forEach((sec) => {
    $$('[data-plane]', sec).forEach((plane) =>
      gsap.fromTo(
        plane,
        { yPercent: 0 },
        {
          yPercent: -100 * +plane.dataset.plane,
          ease: 'none',
          // refreshed after the pinned sections add their scroll length
          scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true, refreshPriority: -1 },
        },
      ),
    );
  });

  // Dives: the window on the next layer opens until you're inside it.
  $$('[data-dive]').forEach((dive) => {
    const win = $('[data-dive-win]', dive);
    const from = $('[data-dive-from]', dive);
    const label = $('[data-dive-label]', dive);
    const name = $('[data-dive-name]', dive);
    // scale needed for the window to cover the whole viewport
    const cover = () => (Math.hypot(innerWidth, innerHeight) / win.offsetWidth) * 1.05;
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: dive,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.5,
        invalidateOnRefresh: true,
        refreshPriority: -1,
        onEnter: () => scramble(name, name.dataset.diveName),
        onEnterBack: () => scramble(name, name.dataset.diveName),
      },
    });
    // 0 → .25 window arrives · .3 → .8 zoom until it fills the screen · .8 → 1
    // the new layer settles to the same faint pattern its section sits on
    const [winPat, winAccent] = $$('.pat', win);
    tl.fromTo(win, { scale: 0.35, rotation: -8 }, { scale: 1, rotation: 0, duration: 0.25, ease: 'power2.out' }, 0)
      .to(win, { scale: cover, duration: 0.5, ease: 'power3.in' }, 0.3)
      .to(from, { scale: 3.2, opacity: 0, duration: 0.5, ease: 'power2.in' }, 0.3)
      .to(label, { opacity: 0, y: 40, duration: 0.15 }, 0.4)
      .to(winPat, { opacity: 0.07, duration: 0.2 }, 0.8)
      .to(winAccent, { opacity: 0.14, duration: 0.2 }, 0.8);
  });

  gsap.fromTo(
    '[data-ghost]',
    { xPercent: 0 },
    {
      xPercent: -30,
      ease: 'none',
      scrollTrigger: { trigger: '.skills', start: 'top bottom', end: 'bottom top', scrub: true },
    },
  );

  const mm = gsap.matchMedia();

  /* ---------- skills: pinned data bus on desktop, cards socket in sideways ---------- */
  mm.add('(min-width: 1101px)', () => {
    const track = $('[data-cards]');
    const cards = $$('.skill', track);
    const distance = () => track.scrollWidth - ($('[data-bus]').clientWidth) + 40;
    const countEl = $('[data-bus-count]');
    const bus = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '.skills',
        start: 'top top',
        end: () => `+=${distance() + innerHeight * 0.4}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onUpdate: (self) =>
          (countEl.textContent = String(Math.min(8, 1 + Math.floor(self.progress * 8))).padStart(2, '0')),
      },
    });
    bus
      .to(track, { x: () => -distance(), duration: 1 }, 0)
      .fromTo('[data-bus-pulse]', { x: 0 }, { x: () => innerWidth - 140, duration: 0.25, repeat: 3 }, 0);
    // each card swings into its socket as it reaches the viewport
    cards.forEach((card) => {
      gsap.fromTo(
        card,
        { rotationY: -55, opacity: 0.2, z: -200 },
        {
          rotationY: 0,
          opacity: 1,
          z: 0,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: card,
            containerAnimation: bus,
            start: 'left 100%',
            end: 'left 55%',
            scrub: true,
          },
        },
      );
    });
  });
  mm.add('(max-width: 1100px)', () => {
    gsap.from('.skill', {
      y: 50,
      opacity: 0,
      duration: 0.9,
      ease: 'expo.out',
      stagger: 0.06,
      scrollTrigger: { trigger: '[data-cards]', start: 'top 85%', once: true },
    });
  });

  /* ---------- work: app windows fly out of the depth toward you ---------- */
  mm.add('(min-width: 1101px)', () => {
    const wins = $$('[data-win]');
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '.work',
        start: 'top top',
        end: () => `+=${innerHeight * wins.length * 0.9}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });
    wins.forEach((w, i) => {
      gsap.set(w, { z: -1600, opacity: 0, rotationX: 8, zIndex: wins.length - i });
      tl.to(w, { z: 0, opacity: 1, rotationX: 0, duration: 1, ease: 'power2.out' }, i * 1.2);
      if (i < wins.length - 1) {
        tl.to(w, { z: 700, opacity: 0, duration: 0.8, ease: 'power2.in' }, i * 1.2 + 1.2);
      }
    });
  });
  mm.add('(max-width: 1100px)', () => {
    $$('[data-win]').forEach((w) =>
      gsap.from(w, {
        y: 60,
        opacity: 0,
        duration: 0.9,
        ease: 'expo.out',
        scrollTrigger: { trigger: w, start: 'top 88%', once: true },
      }),
    );
  });

  /* ---------- experience: git graph draws as you scroll ---------- */
  gsap.to('[data-git-fill]', {
    scaleY: 1,
    ease: 'none',
    scrollTrigger: { trigger: '[data-gitlog]', start: 'top 60%', end: 'bottom 60%', scrub: true },
  });
  $$('[data-commit]').forEach((c) => {
    ScrollTrigger.create({
      trigger: c,
      start: 'top 62%',
      onEnter: () => c.classList.add('is-on'),
      onLeaveBack: () => c.classList.remove('is-on'),
    });
    gsap.from(c, {
      x: 40,
      opacity: 0,
      duration: 0.9,
      ease: 'expo.out',
      scrollTrigger: { trigger: c, start: 'top 90%', once: true },
    });
  });
  gsap.from('.quotes blockquote', {
    y: 40,
    opacity: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.08,
    scrollTrigger: { trigger: '.quotes', start: 'top 85%', once: true },
  });

  /* ---------- contact: terminal command types itself ---------- */
  const typed = $('[data-type]');
  const command = typed.dataset.type;
  typed.textContent = '';
  ScrollTrigger.create({
    trigger: '.contact',
    start: 'top 60%',
    once: true,
    onEnter: () => {
      const state = { n: 0 };
      gsap.to(state, {
        n: command.length,
        duration: command.length * 0.06,
        ease: 'none',
        onUpdate: () => (typed.textContent = command.slice(0, Math.round(state.n))),
      });
    },
  });

  /* ---------- contact: giant line moves with scroll ---------- */
  gsap.fromTo(
    '[data-marquee]',
    { xPercent: 0 },
    {
      xPercent: -35,
      ease: 'none',
      scrollTrigger: { trigger: '.contact', start: 'top bottom', end: 'bottom bottom', scrub: true },
    },
  );

  /* ---------- pointer-driven pieces (desktop) ---------- */
  if (finePointer) {
    window.addEventListener('pointermove', (e) => {
      journey?.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    });

  }

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/* Text decode: characters cycle through glyphs and settle left to right. */
function scramble(node, final) {
  gsap.killTweensOf(node._sc || {});
  const glyphs = '!<>-_\\/[]{}=+*^?#01';
  const state = (node._sc = { p: 0 });
  gsap.to(state, {
    p: 1,
    duration: Math.min(0.8, 0.25 + final.length * 0.04),
    ease: 'none',
    onUpdate: () => {
      const settled = Math.floor(state.p * final.length);
      let out = final.slice(0, settled);
      for (let i = settled; i < final.length; i++) {
        out += final[i] === ' ' ? ' ' : glyphs[(Math.random() * glyphs.length) | 0];
      }
      node.textContent = out;
    },
    onComplete: () => (node.textContent = final),
  });
}
