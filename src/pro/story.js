// Reading the page as a story: smooth scrolling, a signal rail that tracks where you are, and each
// section arriving as its own beat (text that lights up as it's read, project cards that stack,
// a timeline that fills as you pass it, quotes that write themselves out, a "next" line at the
// end of every chapter). Only runs with motion allowed; without it the page is the same content,
// still.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const d = document;
const $$ = (s, c = d) => [...c.querySelectorAll(s)];
const navH = () => d.querySelector('.nav').offsetHeight;

// Wrap every word of an element's text in a span (nested elements are walked, not replaced).
// With `inner`, each word gets a clipping wrapper and an inner span to slide up inside it.
function splitWords(node, cls, inner) {
  const out = [];
  [...node.childNodes].forEach((n) => {
    if (n.nodeType === 1) {
      out.push(...splitWords(n, cls, inner));
      return;
    }
    if (n.nodeType !== 3 || !n.textContent.trim()) return;
    const frag = d.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) return frag.appendChild(d.createTextNode(part));
      const s = d.createElement('span');
      s.className = cls;
      if (inner) {
        const i = d.createElement('span');
        i.className = inner;
        i.textContent = part;
        s.appendChild(i);
        out.push(i);
      } else {
        s.textContent = part;
        out.push(s);
      }
      frag.appendChild(s);
    });
    n.replaceWith(frag);
  });
  return out;
}

// Text that decodes out of noise, left to right
function decode(elm, duration = 1.1) {
  const text = elm.textContent;
  const glyphs = '01#%&*+=<>/\\[]{}ABCDEFXZ';
  const o = { p: 0 };
  return gsap.to(o, {
    p: 1,
    duration,
    ease: 'power2.out',
    onUpdate() {
      const n = Math.floor(o.p * text.length);
      let s = text.slice(0, n);
      for (let k = n; k < text.length; k++) s += text[k] === ' ' || text[k] === '@' || text[k] === '.' ? text[k] : glyphs[(Math.random() * glyphs.length) | 0];
      elm.textContent = s;
    },
    onComplete: () => (elm.textContent = text),
  });
}

export function initStory({ plates, pulse }) {
  /* ---------------------------------------------------------------- smooth scroll */
  const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
  // (GSAP's lag smoothing stays on: if the 3D board's build stalls a frame during the intro, the
  // intro waits rather than jumping ahead)
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  if (d.documentElement.classList.contains('booting')) lenis.stop();

  /* ---------------------------------------------------------------- in-page links */
  const projects = d.querySelector('.projects');
  const cards = $$('.card', projects);
  // where an element sits in the page when it isn't stuck (the stacked cards are sticky)
  function yOf(t) {
    const i = cards.indexOf(t);
    if (i > 0 && projects.classList.contains('stack')) {
      const gap = parseFloat(getComputedStyle(projects).rowGap) || 0;
      let y = projects.getBoundingClientRect().top + scrollY;
      for (let k = 0; k < i; k++) y += cards[k].offsetHeight + gap;
      return y;
    }
    return t.getBoundingClientRect().top + scrollY;
  }
  function go(id, immediate) {
    const t = id && d.getElementById(id);
    if (id && !t) return false;
    const y = t ? Math.max(0, yOf(t) - navH() - 16) : 0;
    lenis.scrollTo(y, { immediate, duration: Math.min(2, 0.8 + Math.abs(y - scrollY) / 4000), force: true });
    if (t) {
      if (!t.matches('a, button, input, [tabindex]')) t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
      if (t.classList.contains('card')) {
        t.classList.add('is-target');
        setTimeout(() => t.classList.remove('is-target'), 2400);
      }
    }
    return true;
  }
  d.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (go(a.hash.slice(1))) {
      e.preventDefault();
      history.replaceState(null, '', a.hash || location.pathname);
    }
  });

  /* ---------------------------------------------------------------- the rail */
  // A trace down the left edge (wide screens) or along the nav (everywhere else): it fills as you
  // read, and each chapter's via lights up as you reach it.
  const chapters = [['top', 'Hello'], ['about', 'About'], ...$$('.section .kicker').map((k) => [k.closest('section').id, k.textContent.trim().replace(/\s+/, ' ')])];
  const rail = d.createElement('div');
  rail.className = 'rail';
  rail.setAttribute('aria-hidden', 'true');
  rail.innerHTML = '<div class="rail__track"><i class="rail__fill"></i><i class="rail__head"></i></div>' + chapters.map(([id, t]) => `<a class="rail__dot" href="#${id === 'top' ? 'top' : id}" tabindex="-1"><span class="mono caps">${t}</span></a>`).join('');
  d.body.appendChild(rail);
  const dots = $$('.rail__dot', rail);
  const nav = d.querySelector('.nav');
  let marks = [];
  function measure() {
    const max = Math.max(1, d.documentElement.scrollHeight - innerHeight);
    marks = chapters.map(([id]) => (id === 'top' ? 0 : Math.min(1, Math.max(0, (yOf(d.getElementById(id)) - innerHeight * 0.4) / max))));
    dots.forEach((dot, i) => dot.style.setProperty('--y', marks[i]));
    track();
  }
  let current = -1;
  function track() {
    const max = Math.max(1, d.documentElement.scrollHeight - innerHeight);
    const p = Math.min(1, Math.max(0, scrollY / max));
    rail.style.setProperty('--p', p.toFixed(4));
    nav.style.setProperty('--p', p.toFixed(4));
    let k = 0;
    marks.forEach((m, i) => p >= m - 0.001 && (k = i));
    if (k !== current) {
      current = k;
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-past', i < k);
        dot.classList.toggle('is-on', i === k);
      });
    }
  }
  lenis.on('scroll', track);
  ScrollTrigger.addEventListener('refresh', measure);

  const mm = gsap.matchMedia();

  /* ---------------------------------------------------------------- hero: you leave it like a screen */
  const hero = d.querySelector('.hero');
  gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } })
    .to('.hero__copy', { yPercent: -18, opacity: 0.1, ease: 'none' }, 0)
    .to('.hero__stage', { scale: 1.12, yPercent: 8, ease: 'none' }, 0)
    .to('.hero__cue', { opacity: 0, ease: 'none', duration: 0.2 }, 0);

  /* ---------------------------------------------------------------- the statement: read it as it lights up */
  const st = d.querySelector('.statement');
  const stWords = [...splitWords(st.querySelector('.h2'), 'sw'), ...$$('.statement__body p', st).flatMap((p) => splitWords(p, 'sw'))];
  st.querySelector('.rv').classList.remove('rv');
  st.classList.add('is-split');
  mm.add('(min-width: 760px) and (min-height: 620px)', () => {
    gsap.fromTo(stWords, { opacity: 0.12 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: st, start: 'center center', end: '+=110%', scrub: 0.6, pin: true } });
  });
  mm.add('(max-width: 759px), (max-height: 619px)', () => {
    gsap.fromTo(stWords, { opacity: 0.12 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: st, start: 'top 75%', end: 'bottom 55%', scrub: 0.6 } });
  });

  /* ---------------------------------------------------------------- chapter heads */
  $$('.section .head').forEach((head) => {
    head.classList.remove('rv');
    const h2 = head.querySelector('.h2');
    const ws = splitWords(h2, 'wm', 'wi');
    const kick = head.querySelector('.kicker');
    const intro = head.querySelector('.intro');
    const tl = gsap.timeline({ scrollTrigger: { trigger: head, start: 'top 82%', once: true, onEnter: () => head.classList.add('in') } })
      .from(kick, { x: -24, opacity: 0, duration: 0.5, ease: 'power3.out' })
      .from(ws, { yPercent: 110, duration: 0.8, stagger: 0.05, ease: 'power4.out' }, 0.1);
    if (intro) tl.from(intro, { y: 16, opacity: 0, duration: 0.6, ease: 'power2.out' }, 0.45);
  });

  /* ---------------------------------------------------------------- work: the builds stack up */
  projects.classList.add('stack');
  cards.forEach((c, i) => {
    c.classList.remove('rv');
    c.style.setProperty('--k', i);
  });
  const stickTop = (i) => navH() + 20 + i * 14;
  cards.forEach((c, i) => {
    gsap.from(c, { y: 80, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: c, start: 'top 92%', once: true } });
    // the card on top lights its data flow when it lands
    ScrollTrigger.create({ trigger: c, start: () => `top ${stickTop(i) + 60}px`, onEnter: () => pulse(plates[i]) });
    if (i === cards.length - 1) return;
    gsap.to(c, {
      scale: 0.9 + i * 0.012,
      '--dim': 0.55,
      ease: 'none',
      scrollTrigger: { trigger: cards[i + 1], start: 'top bottom', end: () => `top ${stickTop(i + 1)}px`, scrub: true },
    });
  });

  /* ---------------------------------------------------------------- experience: a timeline that fills */
  $$('.xp__org').forEach((org) => {
    org.classList.remove('rv');
    const side = org.querySelector('.xp__side');
    const main = org.querySelector('.xp__main');
    const items = $$('.role, .earlier li, .cred', org);
    gsap.timeline({ scrollTrigger: { trigger: org, start: 'top 80%', once: true } })
      .from(side, { x: -40, opacity: 0, duration: 0.7, ease: 'power3.out' })
      .from(items.length ? items : main, { x: 40, opacity: 0, duration: 0.7, stagger: 0.12, ease: 'power3.out' }, 0.1);
  });
  $$('.role').forEach((r) => {
    ScrollTrigger.create({
      trigger: r,
      start: 'top 62%',
      end: 'bottom 62%',
      onToggle: (s) => s.isActive && r.classList.add('lit'),
      onUpdate: (s) => r.style.setProperty('--fill', s.progress.toFixed(3)),
    });
  });
  $$('.certs li').forEach((li, i) => gsap.from(li, { x: 20, opacity: 0, duration: 0.5, delay: (i % 9) * 0.05, ease: 'power2.out', scrollTrigger: { trigger: li, start: 'top 92%', once: true } }));

  /* ---------------------------------------------------------------- skills: each group boots its tags */
  $$('.skill').forEach((sk, i) => {
    sk.classList.remove('rv');
    gsap.timeline({ scrollTrigger: { trigger: sk, start: 'top 85%', once: true } })
      .from(sk, { y: 40, opacity: 0, duration: 0.7, ease: 'power3.out', delay: (i % 2) * 0.1 })
      .from($$('.tags li', sk), { scale: 0.6, opacity: 0, duration: 0.45, stagger: 0.035, ease: 'back.out(2)' }, 0.25);
  });

  /* ---------------------------------------------------------------- kind words: written out as you arrive */
  $$('.quote').forEach((q, i) => {
    q.classList.remove('rv');
    const ws = splitWords(q.querySelector('blockquote p'), 'qw');
    gsap.timeline({ scrollTrigger: { trigger: q, start: 'top 85%', once: true } })
      .from(q, { y: 70, rotate: i % 2 ? 1.5 : -1.5, opacity: 0, duration: 0.9, ease: 'power3.out', delay: i * 0.12 })
      .from(ws, { opacity: 0.08, duration: 0.25, stagger: 0.035, ease: 'none' }, '-=0.4')
      .from(q.querySelector('figcaption'), { y: 10, opacity: 0, duration: 0.4 }, '-=0.2');
  });

  /* ---------------------------------------------------------------- contact: the line comes in to land */
  const mail = d.querySelector('.contact__mail');
  mail.setAttribute('aria-label', mail.textContent);
  const mr = d.querySelector('.mailrow');
  mr.classList.remove('rv');
  gsap.timeline({ scrollTrigger: { trigger: mr, start: 'top 85%', once: true } })
    .from('.mailrow__trace', { scaleX: 0, transformOrigin: '0 50%', duration: 0.8, ease: 'power3.inOut' })
    .add(decode(mail, 1.2), 0.3)
    .from('.contact__links .btn', { y: 20, opacity: 0, duration: 0.5, stagger: 0.1, ease: 'power3.out' }, 0.8);

  /* ---------------------------------------------------------------- "next" lines: a hook at every chapter's end */
  $$('.next').forEach((n) => {
    gsap.from(n.children, { y: 24, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: n, start: 'top 90%', once: true } });
  });

  /* ---------------------------------------------------------------- everything else that was marked to reveal */
  $$('.rv').forEach((x) => {
    gsap.from(x, { y: 30, opacity: 0, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: x, start: 'top 88%', once: true, onEnter: () => x.classList.add('in') } });
  });

  // fonts change heights: measure again once they're in
  d.fonts && d.fonts.ready.then(() => ScrollTrigger.refresh());
  measure();

  return {
    lenis,
    start() {
      lenis.start();
      ScrollTrigger.refresh();
    },
    go,
  };
}
