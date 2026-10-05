import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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

// Contact form: post to Formspree without leaving the page.
const form = $('[data-form]');
const note = $('.form__note', form);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('button', form);
  button.disabled = true;
  note.classList.remove('is-error');
  note.textContent = 'sending…';
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    note.textContent = '200 OK — thanks, I’ll reply soon.';
  } catch {
    note.classList.add('is-error');
    note.textContent = 'Didn’t send. Email me directly instead.';
  } finally {
    button.disabled = false;
  }
});

// Highlight the nav entry for the section in view (works without motion too).
const navLinks = $$('[data-nav]');
const setActive = (id) =>
  navLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.nav === id));
$$('[data-section]').forEach((sec) => {
  ScrollTrigger.create({
    trigger: sec,
    start: 'top 45%',
    end: 'bottom 45%',
    onToggle: (self) => self.isActive && setActive(sec.id),
  });
});

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
      if (target.length < 2 || target === '#content') return;
      e.preventDefault();
      lenis.scrollTo(target === '#top' ? 0 : target, { duration: 1.2, offset: -8 });
    }),
  );

  /* ---------- intro: rail fades up, name decodes ---------- */
  gsap.to('.intro', {
    opacity: 1,
    y: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.07,
    delay: 0.1,
  });
  const name = $('[data-scramble]');
  scramble(name, name.dataset.scramble, 0.25);

  /* ---------- content reveals ---------- */
  $$('.reveal').forEach((el) => {
    gsap.from(el, {
      y: 24,
      opacity: 0,
      duration: 0.9,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // Section titles decode once when they arrive, and again on hover.
  $$('.sec__title').forEach((el) => {
    const label = el.lastChild; // text node after the number
    const text = label.textContent;
    const run = () => scramble(label, text);
    el.addEventListener('mouseenter', run);
    ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: run });
  });

  /* ---------- architecture diagrams: data starts flowing when seen ---------- */
  $$('[data-flow]').forEach((flow) => {
    ScrollTrigger.create({
      trigger: flow,
      start: 'top 85%',
      end: 'bottom 10%',
      onToggle: (self) => flow.classList.toggle('is-live', self.isActive),
    });
    gsap.from($$('.node, .edge', flow), {
      opacity: 0,
      x: -10,
      duration: 0.6,
      ease: 'power3.out',
      stagger: 0.06,
      scrollTrigger: { trigger: flow, start: 'top 88%', once: true },
    });
  });

  /* ---------- parallax: background grid drifts slower than the content ---------- */
  gsap.to('[data-grid]', {
    yPercent: -12,
    ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: true },
  });

  /* ---------- pointer spotlight (desktop only) ---------- */
  if (finePointer) {
    const spot = $('.spot');
    const sx = gsap.quickTo(spot, 'x', { duration: 0.6, ease: 'power3' });
    const sy = gsap.quickTo(spot, 'y', { duration: 0.6, ease: 'power3' });
    window.addEventListener('pointermove', (e) => {
      spot.classList.add('is-on');
      sx(e.clientX);
      sy(e.clientY);
    });
    document.addEventListener('pointerleave', () => spot.classList.remove('is-on'));
  }

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/* Text decode: characters cycle through glyphs and settle left to right. */
function scramble(node, final, delay = 0) {
  if (!node || node._scrambling) return;
  node._scrambling = true;
  const glyphs = '!<>-_\\/[]{}=+*^?#01';
  const state = { p: 0 };
  gsap.to(state, {
    p: 1,
    duration: Math.min(1.1, 0.35 + final.length * 0.03),
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
    onComplete: () => {
      node.textContent = final;
      node._scrambling = false;
    },
  });
}
