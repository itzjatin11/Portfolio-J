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
let heroProgress = 0;
let inHero = true;
import('./journey.js')
  .then(({ createJourney }) => {
    journey = createJourney($('[data-gl]'), { reduced: reduceMotion });
    journey.setProgress(heroProgress);
    journey.setRunning(inHero && !document.hidden);
  })
  .catch(() => {
    // No WebGL: the hero still reads as type on a dark background.
  });

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
    .from('[data-gl]', { opacity: 0, duration: 1.6, ease: 'power2.out', clearProps: 'opacity' }, 0);

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
        if (p < 1) setLayer(layers.find(([t]) => p < t)[1]);
        depthEl.textContent = String(Math.round(p * 1600)).padStart(4, '0');
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
  document.addEventListener('visibilitychange', () => journey?.setRunning(inHero && !document.hidden));

  function setLayer(name) {
    if (layerEl.dataset.v === name) return;
    layerEl.dataset.v = name;
    scramble(layerEl, name);
  }

  /* ---------- the intro ends; the story begins ---------- */
  // Past the core the 3D scene fades out and stops rendering; the rest of the
  // page is read, not flown through.
  ScrollTrigger.create({
    trigger: '[data-journey]',
    start: 'bottom 60%',
    onEnter: () => {
      inHero = false;
      root.classList.add('is-story');
      gsap.delayedCall(0.8, () => !inHero && journey?.setRunning(false));
    },
    onLeaveBack: () => {
      inHero = true;
      root.classList.remove('is-story');
      journey?.setRunning(!document.hidden);
    },
  });

  /* ---------- story spine: chapters as a reading-progress rail ---------- */
  const chapters = $$('[data-chapter]');
  const spineList = $('.spine__list');
  spineList.innerHTML = chapters
    .map((c) => `<li><a href="#${c.id}"><b>${c.dataset.chapter}</b><span>${c.dataset.chapterTitle}</span></a></li>`)
    .join('');
  const spineLinks = $$('a', spineList);
  spineLinks.forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      lenis.scrollTo(a.getAttribute('href'), { duration: 1.4 });
    }),
  );
  chapters.forEach((c, i) =>
    ScrollTrigger.create({
      trigger: c,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && spineLinks.forEach((a, k) => a.classList.toggle('is-active', k === i)),
    }),
  );
  gsap.to('[data-spine-fill]', {
    scaleY: 1,
    ease: 'none',
    scrollTrigger: { trigger: chapters[0], start: 'top 55%', endTrigger: chapters.at(-1), end: 'top 55%', scrub: true },
  });

  /* ---------- chapter titles rise word by word, like turning a page ---------- */
  $$('[data-split]').forEach((el) => {
    gsap.from(splitChars(el), {
      yPercent: 110,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.022,
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

  /* ---------- chapter openers: year parallax + story lines ---------- */
  $$('[data-year-par]').forEach((el) => {
    gsap.fromTo(
      el,
      { yPercent: 30 },
      {
        yPercent: -30,
        ease: 'none',
        scrollTrigger: { trigger: el.closest('.chapter'), start: 'top bottom', end: 'bottom top', scrub: true },
      },
    );
  });
  $$('[data-lines]').forEach((box) => {
    gsap.from(box.children, {
      y: 28,
      opacity: 0,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.18,
      scrollTrigger: { trigger: box, start: 'top 82%', once: true },
    });
  });
  $$('.ch-open__num').forEach((el) =>
    gsap.from(el, {
      opacity: 0,
      x: -16,
      duration: 0.8,
      ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    }),
  );

  /* ---------- chapter artefacts rise in, with a little depth ---------- */
  $$('[data-rise]').forEach((el) => {
    gsap.from(el, {
      y: 70,
      opacity: 0,
      rotationX: 6,
      transformPerspective: 1000,
      transformOrigin: '50% 100%',
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  /* ---------- skills unlocked pop in at the end of each chapter ---------- */
  $$('[data-unlock]').forEach((box) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: box, start: 'top 90%', once: true } });
    tl.from(box, { opacity: 0, duration: 0.4 }).from(
      $$('li', box),
      { scale: 0.6, opacity: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.07 },
      0.15,
    );
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
function scramble(node, final, delay = 0, maxDur = 0.7) {
  gsap.killTweensOf(node._sc || {});
  const glyphs = '!<>-_\\/[]{}=+*^?#01';
  const state = (node._sc = { p: 0 });
  gsap.to(state, {
    p: 1,
    duration: Math.min(maxDur, 0.25 + final.length * 0.03),
    delay,
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
