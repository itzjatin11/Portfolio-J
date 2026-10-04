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
  note.textContent = 'Sending…';
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    note.textContent = "Thanks — I'll get back to you within a day.";
  } catch {
    note.classList.add('is-error');
    note.textContent = 'That didn’t send. Email me directly instead.';
  } finally {
    button.disabled = false;
  }
});

// Split the about statement into words for the scroll-linked reveal.
const statement = $('[data-words]');
statement.innerHTML = statement.textContent
  .trim()
  .split(/\s+/)
  .map((w) => `<span class="w">${w}</span>`)
  .join(' ');

// Wrap every word/character so headings can be revealed letter by letter.
function splitChars(root) {
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.append(' ');
          const wd = document.createElement('span');
          wd.className = 'wd';
          [...part].forEach((c) => {
            const ch = document.createElement('span');
            ch.className = 'ch';
            ch.textContent = c;
            wd.append(ch);
          });
          frag.append(wd);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    });
  };
  walk(root);
  root.classList.add('is-split');
  return $$('.ch', root);
}

// Rolling hover labels on buttons.
$$('[data-roll]').forEach((el) => {
  const label = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  if (!label) return;
  const text = label.textContent.trim();
  const roll = document.createElement('span');
  roll.className = 'roll';
  roll.innerHTML = `<span><span>${text}</span><span aria-hidden="true">${text}</span></span>`;
  label.replaceWith(roll, ' ');
});

if (reduceMotion) {
  // Everything is readable in its static state; skip all motion.
  document.documentElement.classList.remove('js-motion');
} else {
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

  /* ---------- loader -> hero intro ---------- */
  const heroChars = splitChars($('[data-chars]'));
  gsap.set('.line__inner', { y: 0 });
  gsap.set(heroChars, { yPercent: 115, rotate: 6 });
  lenis.stop();

  const counter = { v: 0 };
  const countEl = $('[data-loader-count]');
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
  intro
    .from('.loader__name > *', { yPercent: 110, duration: 0.9, stagger: 0.08 })
    .to(counter, {
      v: 100,
      duration: 1.1,
      ease: 'power2.inOut',
      onUpdate: () => (countEl.textContent = Math.round(counter.v)),
    }, 0)
    .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1, ease: 'expo.inOut' }, '+=0.1')
    .to(heroChars, { yPercent: 0, rotate: 0, duration: 1.3, stagger: 0.025 }, '-=0.45')
    .to('.reveal-up', { opacity: 1, y: 0, duration: 1, stagger: 0.07 }, '-=1.1')
    .from('.hero__glyph', { opacity: 0, yPercent: 10, duration: 1.8 }, '<')
    .from('.fl', { opacity: 0, scale: 0.6, duration: 1, stagger: 0.08, ease: 'back.out(1.8)' }, '<0.1')
    .add(() => {
      $('.loader').remove();
      lenis.start();
      startCounters();
    }, '<');

  /* ---------- section headings: letters rise on scroll ---------- */
  $$('[data-split]').forEach((el) => {
    const chars = splitChars(el);
    gsap.from(chars, {
      yPercent: 115,
      rotate: 5,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.02,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    });
  });

  /* ---------- scroll progress + hide nav on the way down ---------- */
  gsap.to('.progress span', {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: 0.3 },
  });
  const nav = $('.nav');
  lenis.on('scroll', ({ direction, scroll }) => {
    nav.classList.toggle('is-hidden', direction === 1 && scroll > window.innerHeight * 0.6);
  });

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

  /* ---------- glance panel: seal turns with scroll, rows slide in ---------- */
  gsap.to('[data-seal]', {
    rotation: 360,
    ease: 'none',
    transformOrigin: '50% 50%',
    scrollTrigger: { trigger: '.about', start: 'top bottom', end: 'bottom top', scrub: 0.5 },
  });
  gsap.from('.glance__list > div', {
    x: 30,
    opacity: 0,
    duration: 0.9,
    ease: 'expo.out',
    stagger: 0.07,
    scrollTrigger: { trigger: '.glance', start: 'top 80%', once: true },
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
  let marqueeOn = true;
  ScrollTrigger.create({
    trigger: '.marquee',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => (marqueeOn = self.isActive),
  });
  const half = () => track.scrollWidth / 2;
  gsap.ticker.add(() => {
    if (!marqueeOn) return;
    const w = half();
    x += dir * (0.6 + Math.abs(boost) * 0.35);
    if (x <= -w) x += w;
    if (x > 0) x -= w;
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

  /* ---------- counters ---------- */
  function startCounters() {
    $$('[data-count]').forEach((el) => {
      const n = { v: 0 };
      gsap.to(n, {
        v: +el.dataset.count,
        duration: 1.6,
        ease: 'power3.out',
        onUpdate: () => (el.textContent = Math.round(n.v)),
      });
    });
  }
  $$('[data-count]').forEach((el) => (el.textContent = '0'));

  /* ---------- project visuals animate in as each card arrives ---------- */
  const enter = (sel, from, extra = {}) => {
    const el = $(sel);
    if (!el) return;
    gsap.from(el.children.length && !extra.self ? el.children : el, {
      ...from,
      duration: 1.2,
      ease: 'expo.out',
      stagger: 0.09,
      scrollTrigger: { trigger: el.closest('[data-card]'), start: 'top 70%', once: true },
    });
  };
  enter('.viz--cv', { yPercent: 40, opacity: 0, rotate: -6 });
  enter('.viz--spec', { y: 50, opacity: 0 });
  enter('.viz--booking', { y: 60, opacity: 0 });
  enter('.phone ul', { x: -24, opacity: 0 });
  enter('.receipt', { clipPath: 'inset(0 0 100% 0)' }, { self: true });
  const lenses = $$('.glasses circle, .glasses path');
  lenses.forEach((p) => {
    const len = p.getTotalLength();
    gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, {
      strokeDashoffset: 0,
      duration: 1.6,
      ease: 'power2.inOut',
      scrollTrigger: { trigger: p.closest('[data-card]'), start: 'top 70%', once: true },
    });
  });
  // the selected booking slot hops between options, like someone deciding
  const slots = $$('.slots li');
  if (slots.length) {
    let i = 1;
    setInterval(() => {
      if (document.hidden) return;
      slots[i].classList.remove('on');
      i = (i + 1) % slots.length;
      slots[i].classList.add('on');
    }, 1800);
  }

  /* ---------- experience: a line draws down the timeline ---------- */
  gsap.to('.exp__line', {
    scaleY: 1,
    ease: 'none',
    scrollTrigger: { trigger: '[data-exp]', start: 'top 70%', end: 'bottom 60%', scrub: true },
  });

  /* ---------- the work section opens up as it arrives ---------- */
  gsap.fromTo(
    '.work',
    { clipPath: 'inset(0% 5% 0% 5% round 48px)' },
    {
      clipPath: 'inset(0% 0% 0% 0% round 0px)',
      ease: 'none',
      scrollTrigger: { trigger: '.work', start: 'top bottom', end: 'top 20%', scrub: true },
    },
  );

  /* ---------- hire band: scroll-driven, direction-aware ---------- */
  const hire = $('[data-hire-track]');
  gsap.fromTo(hire, { xPercent: 0 }, {
    xPercent: -40,
    ease: 'none',
    scrollTrigger: { trigger: '.hire', start: 'top bottom', end: 'bottom top', scrub: 0.5 },
  });

  /* ---------- testimonials drift at different rates ---------- */
  gsap.matchMedia().add('(min-width: 901px)', () => {
    $$('[data-lift]').forEach((el) => {
      gsap.fromTo(
        el,
        { y: 40 * +el.dataset.lift },
        {
          y: -40 * +el.dataset.lift,
          ease: 'none',
          scrollTrigger: { trigger: '.quotes', start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
    });
  });

  /* ---------- reveal labels / small elements ---------- */
  $$('.label, .caps__col, .index__list li, .exp__row, .contact__title, .contact__mail, .form').forEach((el) => {
    gsap.from(el, {
      y: 40,
      opacity: 0,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  /* ---------- pointer: cursor, magnetic buttons, depth parallax, tilt ---------- */
  if (finePointer) {
    const cursor = $('.cursor');
    const xTo = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3' });
    const yTo = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3' });
    const mouse = { x: 0, y: 0 }; // -1..1 from viewport centre
    window.addEventListener('pointermove', (e) => {
      cursor.classList.add('is-active');
      xTo(e.clientX);
      yTo(e.clientY);
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    $$('a, button').forEach((el) => {
      el.addEventListener('pointerenter', () => cursor.classList.add('is-hover'));
      el.addEventListener('pointerleave', () => cursor.classList.remove('is-hover'));
    });
    $$('[data-cursor]').forEach((el) => {
      el.addEventListener('pointerenter', () => cursor.classList.add('is-view'));
      el.addEventListener('pointerleave', () => cursor.classList.remove('is-view'));
    });

    $$('[data-magnetic], .nav__hire, .card__link, .badge').forEach((el) => {
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

    // Hero layers shift with the mouse at different depths. Uses the CSS
    // `translate` property so it stacks with the scroll parallax on `transform`.
    const layers = $$('[data-depth]').map((el) => ({ el, d: +el.dataset.depth, x: 0, y: 0 }));
    let heroOn = true;
    ScrollTrigger.create({
      trigger: '[data-hero]',
      start: 'top top',
      end: 'bottom top',
      onToggle: (self) => (heroOn = self.isActive),
    });
    gsap.ticker.add(() => {
      if (!heroOn) return;
      layers.forEach((l) => {
        l.x += (mouse.x * 18 * l.d - l.x) * 0.08;
        l.y += (mouse.y * 14 * l.d - l.y) * 0.08;
        l.el.style.translate = `${l.x.toFixed(1)}px ${l.y.toFixed(1)}px`;
      });
    });

    // Project visuals tilt toward the pointer.
    $$('[data-tilt]').forEach((wrap) => {
      const viz = $('.viz', wrap);
      const rx = gsap.quickTo(viz, 'rotationX', { duration: 0.8, ease: 'power3' });
      const ry = gsap.quickTo(viz, 'rotationY', { duration: 0.8, ease: 'power3' });
      wrap.addEventListener('pointermove', (e) => {
        const r = wrap.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 12);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 10);
      });
      wrap.addEventListener('pointerleave', () => {
        rx(0);
        ry(0);
      });
    });
  }

  // Fonts change line heights; re-measure once they land.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
