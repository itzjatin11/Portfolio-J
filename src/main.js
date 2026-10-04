import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- small static bits ---------- */
$('[data-year]').textContent = new Date().getFullYear();

const clock = $('[data-clock]');
const fmt = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const tick = () => (clock.textContent = fmt.format(new Date()));
tick();
setInterval(tick, 15_000);

// Email: set data-email on the contact button to switch it from GitHub to mailto.
const mail = $('[data-email]');
if (mail.dataset.email) {
  mail.href = `mailto:${mail.dataset.email}`;
  $('[data-email-label]', mail).textContent = mail.dataset.email;
}

// Split the about statement into words for the scroll-linked reveal.
const statement = $('[data-words]');
statement.innerHTML = statement.textContent
  .trim()
  .split(/\s+/)
  .map((w) => `<span class="w">${w}</span>`)
  .join(' ');

if (reduceMotion) {
  // Everything is readable in its static state; skip all motion.
} else {
  document.documentElement.classList.add('js-motion');
  initMotion();
}

function initMotion() {
  /* ---------- smooth scroll ---------- */
  const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
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

  /* ---------- intro ---------- */
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.15 });
  intro
    .to('.line__inner', { y: 0, duration: 1.4, stagger: 0.12 })
    .to('.reveal-up', { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, '-=0.9')
    .from('.hero__glyph', { opacity: 0, scale: 1.08, duration: 2 }, 0);

  /* ---------- generic parallax: data-speed (<1 = slower than scroll) ---------- */
  $$('[data-speed]').forEach((el) => {
    const speed = parseFloat(el.dataset.speed);
    gsap.to(el, {
      y: () => (1 - speed) * window.innerHeight * 0.6,
      ease: 'none',
      scrollTrigger: {
        trigger: el.parentElement,
        start: el.closest('[data-hero]') ? 'top top' : 'top bottom',
        end: 'bottom top',
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
  });

  /* ---------- horizontal drift on big type ---------- */
  $$('[data-drift]').forEach((el) => {
    const dir = parseFloat(el.dataset.drift);
    gsap.fromTo(
      el,
      { xPercent: 0 },
      {
        xPercent: dir * 8,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      },
    );
  });

  // Hero lifts away slightly as you leave it.
  gsap.to('.hero__foot', {
    y: -60,
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '[data-hero]', start: 'center center', end: 'bottom top', scrub: true },
  });

  /* ---------- image-style parallax inside framed boxes ---------- */
  $$('[data-parallax-wrap]').forEach((wrap) => {
    const inner = $('[data-parallax-img]', wrap);
    if (!inner) return;
    gsap.fromTo(
      inner,
      { yPercent: -8 },
      {
        yPercent: 8,
        ease: 'none',
        scrollTrigger: { trigger: wrap, start: 'top bottom', end: 'bottom top', scrub: true },
      },
    );
  });

  /* ---------- word-by-word statement ---------- */
  gsap.to('.about__statement .w', {
    opacity: 1,
    stagger: 0.05,
    ease: 'none',
    scrollTrigger: { trigger: statement, start: 'top 80%', end: 'bottom 45%', scrub: true },
  });

  /* ---------- marquee driven by time + scroll velocity ---------- */
  const track = $('[data-marquee]');
  track.innerHTML += track.innerHTML; // duplicate for a seamless loop
  let x = 0;
  let boost = 0;
  let dir = -1;
  lenis.on('scroll', ({ velocity }) => {
    boost = gsap.utils.clamp(-30, 30, velocity);
    if (velocity !== 0) dir = velocity > 0 ? -1 : 1;
  });
  gsap.ticker.add(() => {
    const half = track.scrollWidth / 2;
    x += dir * (0.6 + Math.abs(boost) * 0.35);
    if (x <= -half) x += half;
    if (x > 0) x -= half;
    boost *= 0.92;
    gsap.set(track, { x, skewX: boost * -0.25 });
  });

  /* ---------- stacked project cards (desktop only; tall mobile cards just scroll) ---------- */
  gsap.matchMedia().add('(min-width: 901px)', () => {
    const cards = $$('[data-card]');
    cards.forEach((card, i) => {
      const next = cards[i + 1];
      if (!next) return;
      const shade = card.appendChild(document.createElement('div'));
      shade.className = 'card__shade';
      const st = {
        trigger: next,
        start: 'top bottom',
        // finish exactly when the next card docks at its sticky offset
        end: () => `top ${parseFloat(getComputedStyle(next).top)}px`,
        scrub: true,
        invalidateOnRefresh: true,
      };
      gsap.to(card, { scale: 0.9, ease: 'none', scrollTrigger: st });
      gsap.to(shade, { opacity: 0.45, ease: 'none', scrollTrigger: { ...st } });
    });
    return () => $$('.card__shade').forEach((el) => el.remove());
  });

  /* ---------- reveal labels / small elements ---------- */
  $$('.label, .caps__col, .index__list li, .contact__title, .contact__mail').forEach((el) => {
    gsap.from(el, {
      y: 40,
      opacity: 0,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  /* ---------- cursor + magnetic button ---------- */
  if (finePointer) {
    const cursor = $('.cursor');
    const xTo = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3' });
    const yTo = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3' });
    window.addEventListener('pointermove', (e) => {
      cursor.classList.add('is-active');
      xTo(e.clientX);
      yTo(e.clientY);
    });
    $$('a, button').forEach((el) => {
      el.addEventListener('pointerenter', () => cursor.classList.add('is-hover'));
      el.addEventListener('pointerleave', () => cursor.classList.remove('is-hover'));
    });

    $$('[data-magnetic]').forEach((el) => {
      const mx = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      const my = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.25);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      el.addEventListener('pointerleave', () => {
        mx(0);
        my(0);
      });
    });
  }

  // Fonts change line heights; re-measure once they land.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
