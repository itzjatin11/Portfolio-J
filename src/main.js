import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

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

  /* ---------- skills: ghost word drifts, cards deal in ---------- */
  gsap.fromTo(
    '[data-ghost]',
    { xPercent: 0 },
    {
      xPercent: -30,
      ease: 'none',
      scrollTrigger: { trigger: '.skills', start: 'top bottom', end: 'bottom top', scrub: true },
    },
  );
  gsap.from('.skill', {
    y: 60,
    opacity: 0,
    duration: 1,
    ease: 'expo.out',
    stagger: { each: 0.06, grid: 'auto', from: 'start' },
    scrollTrigger: { trigger: '.cards', start: 'top 80%', once: true },
  });

  /* ---------- work rows + experience reveal ---------- */
  gsap.from('.row', {
    y: 40,
    opacity: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.07,
    scrollTrigger: { trigger: '[data-rows]', start: 'top 80%', once: true },
  });
  gsap.from('.timeline li, .quotes blockquote', {
    y: 40,
    opacity: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.07,
    scrollTrigger: { trigger: '.timeline', start: 'top 80%', once: true },
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

    // skill cards tilt toward the pointer
    $$('[data-tilt]').forEach((card) => {
      const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
      const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });
      gsap.set(card, { transformPerspective: 900 });
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 10);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 10);
      });
      card.addEventListener('pointerleave', () => {
        rx(0);
        ry(0);
      });
    });

    // floating preview that follows the pointer over work rows (wide screens;
    // narrow layouts show the same text inline)
    const wide = window.matchMedia('(min-width: 761px)');
    const float = $('[data-peek-float]');
    const fx = gsap.quickTo(float, 'x', { duration: 0.5, ease: 'power3' });
    const fy = gsap.quickTo(float, 'y', { duration: 0.5, ease: 'power3' });
    $$('.row').forEach((row) => {
      const a = $('a', row);
      a.addEventListener('pointerenter', () => {
        if (!wide.matches) return;
        float.innerHTML = $('[data-peek]', row).innerHTML;
        float.classList.add('is-on');
      });
      a.addEventListener('pointerleave', () => float.classList.remove('is-on'));
      a.addEventListener('pointermove', (e) => {
        fx(Math.min(e.clientX + 24, innerWidth - 360));
        fy(e.clientY + 24);
      });
    });
  }

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
