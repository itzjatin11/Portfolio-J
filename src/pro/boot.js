// The boot intro: the visit powers the machine on. Traces draw in from the edges of the screen,
// a signal runs down each one into the chip, the chip lights up, and the camera falls through
// its die onto the page (the hero's 3D board settles in as the hole opens).
//
// It plays through on every fresh visit and takes about 3.5 s. Any click, key, wheel or swipe
// skips straight to the reveal. Not shown with reduced motion or when the URL points at a
// section (the head script decides, by adding .booting to <html>).
import { gsap } from 'gsap';

const NS = 'http://www.w3.org/2000/svg';
const CHIP = 78; // half the chip's size, in viewBox units (the viewBox is centred on the chip)
const PINS = [-52, -26, 0, 26, 52]; // pin offsets along each side
const LOG = ['Power on', 'POST · 16 GB · ok', 'Routing 20 signals → JST-26', 'Loading profile · Jatin Singh Taadiyal', 'Hello.'];

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

// a trace from a pin on the right-hand side, rotated onto the side it belongs to
function tracePoints(side, offset, rnd) {
  const out = CHIP + 10;
  const a = 24 + rnd() * 70; // straight run out of the pin
  const d = 30 + rnd() * 90; // the 45° jog
  const s = offset === 0 ? (rnd() < 0.5 ? -1 : 1) : Math.sign(offset);
  const pts = [
    [1400, offset + s * d],
    [out + a + d, offset + s * d],
    [out + a, offset],
    [out, offset],
  ];
  return pts.map(([x, y]) => {
    for (let k = 0; k < side; k++) [x, y] = [-y, x];
    return [x, y];
  });
}

function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

export function runBoot({ onReveal }) {
  const root = document.documentElement;
  const boot = document.querySelector('[data-boot]');
  const svg = boot.querySelector('[data-boot-svg]');
  const log = boot.querySelector('[data-boot-log]');
  const pct = boot.querySelector('[data-boot-pct]');
  const skipBtn = boot.querySelector('[data-boot-skip]');
  const rnd = rng(11);

  /* ---------------- build the board ---------------- */
  const scene = el('g', { class: 'boot__scene' }, svg);
  const traces = el('g', { class: 'boot__traces' }, scene);
  const pulses = el('g', { class: 'boot__pulses' }, scene);
  const chip = el('g', { class: 'boot__chip' }, scene);
  const paths = [];
  const pins = [];
  for (let side = 0; side < 4; side++) {
    PINS.forEach((o) => {
      const pts = tracePoints(side, o, rnd);
      const p = el('path', { d: 'M' + pts.map((q) => q.join(' ')).join('L'), class: 'boot__trace' }, traces);
      const end = pts[pts.length - 1];
      el('circle', { cx: end[0], cy: end[1], r: 3.2, class: 'boot__via' }, traces);
      paths.push(p);
      // the pin this trace lands on
      let [x, y, w, h] = [CHIP, o - 3, 10, 6];
      for (let k = 0; k < side; k++) [x, y, w, h] = [-y - h, x, h, w];
      pins.push(el('rect', { x, y, width: w, height: h, class: 'boot__pin' }, chip));
    });
  }
  el('rect', { x: -CHIP, y: -CHIP, width: CHIP * 2, height: CHIP * 2, rx: 8, class: 'boot__body', pathLength: 1 }, chip);
  const die = el('rect', { x: -40, y: -40, width: 80, height: 80, rx: 3, class: 'boot__die', pathLength: 1 }, chip);
  // the die's cores: one lights up for every signal that lands
  const core = el('g', { class: 'boot__core' }, chip);
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) cells.push(el('rect', { x: -31 + c * 12.6, y: -31 + r * 15.8, width: 10, height: 13, rx: 1.2, class: 'boot__cell' }, core));
  for (let i = cells.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const ring = el('rect', { x: -40, y: -40, width: 80, height: 80, rx: 3, class: 'boot__ring' }, chip);
  const label = el('text', { x: 0, y: CHIP - 18, 'text-anchor': 'middle', class: 'boot__silk' }, chip);
  label.textContent = 'JST-26 · AKL';

  const lens = paths.map((p) => p.getTotalLength());
  paths.forEach((p, i) => {
    p.style.strokeDasharray = lens[i];
    p.style.strokeDashoffset = lens[i];
  });
  const dots = paths.map(() => {
    const g = el('g', { class: 'boot__pulse' }, pulses);
    el('circle', { r: 10, class: 'boot__pulse-halo' }, g);
    el('circle', { r: 3.4, class: 'boot__pulse-dot' }, g);
    return g;
  });

  /* ---------------- the log ---------------- */
  const lines = LOG.map((t) => {
    const li = document.createElement('li');
    log.appendChild(li);
    return { li, t };
  });
  function type(i) {
    const { li, t } = lines[i];
    li.classList.add('on');
    const o = { n: 0 };
    return gsap.to(o, {
      n: t.length,
      duration: Math.min(0.5, t.length * 0.018),
      ease: 'none',
      onUpdate: () => (li.textContent = t.slice(0, Math.round(o.n))),
    });
  }
  let arrived = 0;
  const showPct = (n) => (pct.textContent = String(Math.round(n)).padStart(3, '0') + '%');

  /* ---------------- the timeline ---------------- */
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    root.classList.add('boot-revealing');
    onReveal && onReveal();
  };

  // While the intro plays, the 3D board is being built behind it. A frame stalled by that work
  // counts as one ordinary frame, so the intro waits instead of skipping ahead.
  gsap.ticker.lagSmoothing(80, 16);
  const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
  tl.set(boot, { '--r': '0px' })
    .add(type(0), 0.1)
    .fromTo(svg, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0)
    .add(type(1), 0.45);
  paths.forEach((p, i) => {
    tl.to(p, { strokeDashoffset: 0, duration: 0.8, ease: 'power3.out' }, 0.25 + rnd() * 0.45);
  });
  tl.fromTo(chip.querySelector('.boot__body'), { strokeDasharray: '0 1' }, { strokeDasharray: '1 0', duration: 0.7, ease: 'power2.out' }, 0.55)
    .fromTo(die, { strokeDasharray: '0 1' }, { strokeDasharray: '1 0', duration: 0.6, ease: 'power2.out' }, 0.75)
    .add(type(2), 0.95);

  // signals: each runs down its trace into its pin, which lights up
  dots.forEach((g, i) => {
    const p = paths[i];
    const L = lens[i];
    const o = { t: 0 };
    tl.fromTo(
      o,
      { t: 0 },
      {
        t: 1,
        duration: 0.55 + rnd() * 0.25,
        ease: 'power1.in',
        onStart: () => g.classList.add('on'),
        onUpdate: () => {
          const q = p.getPointAtLength(o.t * L);
          g.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`);
        },
        onComplete: () => {
          g.classList.remove('on');
          pins[i].classList.add('on');
          p.classList.add('on');
          cells[arrived] && cells[arrived].classList.add('on');
          showPct((++arrived / dots.length) * 100);
        },
      },
      1.0 + rnd() * 0.85
    );
  });

  tl.add(type(3), 1.5)
    .addLabel('power', 2.3)
    .call(() => chip.classList.add('on'), null, 'power')
    .fromTo(core, { scale: 1, transformOrigin: '50% 50%' }, { scale: 1.06, duration: 0.15, yoyo: true, repeat: 1, ease: 'power1.out' }, 'power')
    .fromTo(ring, { scale: 1, opacity: 0.9, transformOrigin: '50% 50%' }, { scale: 3.2, opacity: 0, duration: 0.7, ease: 'power2.out', immediateRender: false }, 'power')
    .add(type(4), 'power+=0.05')
    // through the die: the board rushes past and a hole opens onto the page
    .addLabel('reveal', 'power+=0.45')
    .call(reveal, null, 'reveal')
    .to(scene, { scale: 9, transformOrigin: '50% 50%', duration: 1.0, ease: 'power3.in' }, 'reveal')
    .to(boot, { '--r': '160vmax', duration: 1.0, ease: 'power3.in' }, 'reveal+=0.12')
    .to([log, pct, skipBtn], { opacity: 0, duration: 0.3, ease: 'power1.out' }, 'reveal');

  if (location.search.includes('debug')) window.__boot = tl;
  if (location.search.includes('bootpause')) tl.pause();

  /* ---------------- skipping ---------------- */
  const skip = () => {
    if (tl.time() >= tl.labels.reveal) return;
    showPct(100);
    pins.forEach((p) => p.classList.add('on'));
    cells.forEach((c) => c.classList.add('on'));
    chip.classList.add('on');
    tl.seek('reveal-=0.01', false).timeScale(1.6);
  };
  const keys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Enter', 'Escape', 'End', 'Home'];
  const onKey = (e) => keys.includes(e.key) && skip();
  skipBtn.addEventListener('click', skip);
  boot.addEventListener('pointerdown', skip);
  addEventListener('wheel', skip, { passive: true });
  addEventListener('touchmove', skip, { passive: true });
  addEventListener('keydown', onKey);

  return new Promise((done) => {
    tl.eventCallback('onComplete', () => {
      removeEventListener('wheel', skip);
      removeEventListener('touchmove', skip);
      removeEventListener('keydown', onKey);
      // focus would otherwise be lost with the skip button
      if (document.activeElement === skipBtn) document.querySelector('.nav__mark').focus({ preventScroll: true });
      reveal();
      gsap.ticker.lagSmoothing(500, 33);
      root.classList.remove('booting', 'boot-revealing');
      boot.remove();
      done();
    });
  });
}
