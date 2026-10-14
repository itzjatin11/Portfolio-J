// How the page reads after the intro. One motion language, used the same way everywhere:
// headings rise word by word out of a slot, blocks fade up once as they arrive, and nothing
// moves while you're reading it. Three set pieces carry the story:
//   - scrolling the hero dives you into the chip, and you come out into the page,
//   - the road here: the year sticks beside its chapter and ticks over to the next one,
//   - the work: one board shows the data flow of whichever build you're reading.
// Only runs with motion allowed; without it the page is the same content, still.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const d = document;
const $$ = (s, c = d) => [...c.querySelectorAll(s)];
const navH = () => d.querySelector('.nav').offsetHeight;
const EASE = 'expo.out';

// Wrap each word in a clipping slot with an inner span that can rise into it
function slotWords(node) {
  const out = [];
  [...node.childNodes].forEach((n) => {
    if (n.nodeType === 1) return out.push(...slotWords(n));
    if (n.nodeType !== 3 || !n.textContent.trim()) return;
    const frag = d.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) return frag.appendChild(d.createTextNode(part));
      const s = d.createElement('span');
      s.className = 'wm';
      const i = d.createElement('span');
      i.className = 'wi';
      i.textContent = part;
      s.appendChild(i);
      frag.appendChild(s);
      out.push(i);
    });
    n.replaceWith(frag);
  });
  return out;
}

// fade up once, when it arrives
function arrive(targets, trigger, { y = 28, stagger = 0.08, start = 'top 85%', delay = 0 } = {}) {
  return gsap.from(targets, { y, opacity: 0, duration: 1.1, ease: EASE, stagger, delay, scrollTrigger: { trigger, start, once: true } });
}

export function initStory({ plates, pulse }) {
  /* ---------------------------------------------------------------- smooth scroll */
  const lenis = new Lenis({ lerp: 0.11 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  if (d.documentElement.classList.contains('booting')) lenis.stop();

  const mm = gsap.matchMedia();

  /* ---------------------------------------------------------------- in-page links glide */
  function go(id, immediate) {
    const t = id && d.getElementById(id);
    if (id && !t) return false;
    const y = t ? Math.max(0, t.getBoundingClientRect().top + scrollY - navH() - 16) : 0;
    lenis.scrollTo(y, { immediate, duration: Math.min(1.8, 0.8 + Math.abs(y - scrollY) / 5000), force: true });
    if (t) {
      if (!t.matches('a, button, input, [tabindex]')) t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
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

  /* ---------------------------------------------------------------- the dive */
  // The hero holds while you scroll: the words lift away, the camera falls into the chip, and
  // the screen fades into the page as you arrive inside it. (Phones without the live board get
  // the same dive on the still image.)
  const hero = d.querySelector('.hero');
  const copy = hero.querySelector('.hero__copy');
  const still = hero.querySelector('.hero__poster');
  mm.add('(min-height: 520px)', () => {
    const fits = hero.offsetHeight <= innerHeight - navH() + 2;
    if (!fits) return;
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: hero,
        start: () => `top ${navH()}`,
        end: '+=130%',
        pin: true,
        scrub: 0.4,
        onUpdate: (st) => dispatchEvent(new CustomEvent('hero:dive', { detail: Math.min(1, st.progress / 0.85) })),
      },
    });
    tl.to(copy, { y: -60, opacity: 0, duration: 0.3, ease: 'power1.in' }, 0)
      .fromTo(still, { scale: 1 }, { scale: 4.5, duration: 0.85, ease: 'power2.in' }, 0)
      .fromTo(hero, { '--veil': 0 }, { '--veil': 1, duration: 0.2 }, 0.8);
  });
  /* ---------------------------------------------------------------- headings rise word by word */
  $$('.section .head').forEach((head) => {
    const words = slotWords(head.querySelector('.h2'));
    const tl = gsap.timeline({ scrollTrigger: { trigger: head, start: 'top 80%', once: true, onEnter: () => head.classList.add('in') } });
    tl.from(head.querySelector('.kicker'), { opacity: 0, duration: 0.8, ease: 'power2.out' })
      .from(words, { yPercent: 110, duration: 1.1, stagger: 0.06, ease: EASE }, 0.05);
    const intro = head.querySelector('.intro');
    if (intro) tl.from(intro, { y: 20, opacity: 0, duration: 1, ease: EASE }, 0.35);
  });

  /* ---------------------------------------------------------------- why: the statement */
  const st = d.querySelector('.statement');
  const stWords = slotWords(st.querySelector('.h2'));
  gsap.timeline({ scrollTrigger: { trigger: st, start: 'top 70%', once: true } })
    .from(stWords, { yPercent: 110, duration: 1.2, stagger: 0.07, ease: EASE })
    .from($$('.statement__body p', st), { y: 24, opacity: 0, duration: 1.1, stagger: 0.15, ease: EASE }, 0.4);

  /* ---------------------------------------------------------------- the road here */
  const road = d.querySelector('.road');
  road.classList.add('is-live');
  const years = $$('.yr', road);
  years.forEach((yr, i) => {
    // the year's last digit ticks over from the one before
    const n = yr.querySelector('.yr__n');
    const t = n.textContent;
    n.innerHTML = `${t.slice(0, -1)}<span class="yr__d"><span>${t.slice(-1)}</span></span>`;
    const digit = n.querySelector('.yr__d > span');
    ScrollTrigger.create({
      trigger: yr,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (s) => yr.classList.toggle('is-on', s.isActive),
      onEnter: () => i && gsap.fromTo(digit, { yPercent: 100 }, { yPercent: 0, duration: 0.9, ease: EASE }),
      onEnterBack: () => gsap.fromTo(digit, { yPercent: -100 }, { yPercent: 0, duration: 0.9, ease: EASE }),
    });
    // the thread down the year fills as you read it
    const steps = yr.querySelector('.steps');
    gsap.fromTo(steps, { '--fill': 0 }, { '--fill': 1, ease: 'none', scrollTrigger: { trigger: steps, start: 'top 60%', end: 'bottom 60%', scrub: true } });
    arrive(yr.querySelector('.yr__p'), yr, { y: 12, start: 'top 75%' });
    $$('.step', yr).forEach((step) => arrive(step, step, { start: 'top 88%' }));
  });

  /* ---------------------------------------------------------------- the work */
  const stage = d.querySelector('.work__stage');
  const board = {};
  $$('.work__item', stage).forEach((it) => (board[it.dataset.for] = it));
  const projs = $$('.proj');
  const setActive = (proj) => {
    projs.forEach((x) => x.classList.toggle('is-on', x === proj));
    Object.entries(board).forEach(([id, p]) => p.classList.toggle('is-on', id === proj.id));
    const wide = getComputedStyle(stage).display !== 'none';
    pulse((wide ? board[proj.id] : proj).querySelector('[data-plate]'));
  };
  projs.forEach((proj) => {
    ScrollTrigger.create({ trigger: proj, start: 'top 55%', end: 'bottom 55%', onToggle: (s) => s.isActive && setActive(proj) });
    arrive([...proj.children].filter((c) => !c.classList.contains('vh')), proj, { y: 24, stagger: 0.06 });
  });
  d.querySelector('.work').classList.add('is-live');
  setActive(projs[0]);

  /* ---------------------------------------------------------------- the toolkit, kind words, contact */
  $$('.skill, .certs-block').forEach((sk) => arrive(sk, sk));
  $$('.quote').forEach((q) => arrive(q, q, { y: 36 }));
  arrive(['.contact__mail', '.contact__links'], '.mailrow', { stagger: 0.12 });

  // fonts change heights: measure again once they're in
  d.fonts && d.fonts.ready.then(() => ScrollTrigger.refresh());

  return {
    lenis,
    start() {
      lenis.start();
      ScrollTrigger.refresh();
    },
    go,
  };
}
