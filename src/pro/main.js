import './pro.css';

  var d = document, root = d.documentElement, motion = root.classList.contains('motion');
  var $$ = function (s, c) { return [].slice.call((c || d).querySelectorAll(s)); };

  /* theme toggle */
  var tb = d.querySelector('[data-theme-toggle]'), tl = tb.querySelector('.theme__label'), meta = d.querySelector('meta[name=theme-color]');
  function sync() {
    var light = root.dataset.theme === 'light';
    tl.textContent = light ? 'Light' : 'Dark';
    tb.setAttribute('aria-label', 'Colour theme: ' + (light ? 'light' : 'dark') + '. Switch to ' + (light ? 'dark' : 'light'));
    meta.content = light ? '#f4f2ed' : '#08090a';
  }
  sync();
  tb.addEventListener('click', function () {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    sync();
  });

  /* scroll-spy: the section crossing 40% of the viewport is "here" */
  var links = {};
  $$('.nav__links a').forEach(function (a) { links[a.hash.slice(1)] = a; });
  function spyTo(id) {
    for (var k in links) {
      var on = k === id; links[k].classList.toggle('is-on', on);
      if (on) links[k].setAttribute('aria-current', 'location'); else links[k].removeAttribute('aria-current');
    }
  }
  var spy = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) spyTo(e.target.id); });
  }, { rootMargin: '-40% 0px -60% 0px' });
  $$('main section[id]').forEach(function (s) { spy.observe(s); });
  new IntersectionObserver(function (es) { if (es[0].isIntersecting && scrollY < 10) spyTo(''); }).observe(d.querySelector('.hero'));

  /* skills: inline "Used in" disclosures, one open at a time */
  var names = {};
  $$('[data-p]').forEach(function (c) { names[c.dataset.p] = c.querySelector('.card__name').textContent; });
  var open = null;
  function close() {
    if (!open) return;
    open.setAttribute('aria-expanded', 'false');
    d.getElementById(open.getAttribute('aria-controls')).hidden = true;
    open = null;
  }
  $$('.tags[data-group]').forEach(function (ul) {
    var out = d.getElementById('used-' + ul.dataset.group);
    $$('.tag', ul).forEach(function (b) {
      b.setAttribute('aria-controls', out.id);
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var was = open === b; close(); if (was) return;
        out.innerHTML = '<b>' + b.textContent + '</b>' + (b.hasAttribute('data-none')
          ? '<span>Used at work and at Source Infinity</span>'
          : '<span>Used in:</span>' + b.dataset.uses.split(' ').map(function (u) {
              return '<a class="tap" href="#p-' + u + '"><span>' + names[u] + '</span></a>';
            }).join('<span aria-hidden="true">·</span>') +
            (b.dataset.work ? '<span aria-hidden="true">·</span><span>' + b.dataset.work + '</span>' : ''));
        out.hidden = false; b.setAttribute('aria-expanded', 'true'); open = b;
      });
    });
  });
  d.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) { var b = open; close(); b.focus(); }
  });

  /* schematic plates, generated from each card's flow items */
  var NS = 'http://www.w3.org/2000/svg', CH = 6.6, H = 28, PAD = 12, GAP = 32, LANE = 16, ROWGAP = 40;
  function el(tag, attrs, parent) {
    var n = d.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function draw(plate) {
    var items = plate._items, widths = items.map(function (t) { return Math.round(t.length * CH + PAD * 2); });
    var one = widths.reduce(function (a, b) { return a + b; }, 0) + GAP * (items.length - 1);
    var two = innerWidth < 480 || one > plate.clientWidth - 48;
    if (plate._two === two) return; plate._two = two;
    var split = two ? Math.ceil(items.length / 2) : items.length;
    var boxes = [], x = two ? LANE : 0, y = 0, maxX = 0;
    items.forEach(function (t, i) {
      if (i === split) { x = LANE; y = H + ROWGAP; }
      boxes.push({ x: x, y: y, w: widths[i], t: t });
      x += widths[i] + GAP; maxX = Math.max(maxX, x - GAP);
    });
    var W = maxX + (two ? LANE : 0), Ht = y + H;
    var svg = el('svg', { viewBox: '-4 -4 ' + (W + 8) + ' ' + (Ht + 8), width: W + 8, height: Ht + 8, 'aria-hidden': 'true', focusable: 'false' });
    var segs = el('g', {}, svg), hots = el('g', {}, svg), vias = el('g', {}, svg);
    for (var i = 0; i < boxes.length - 1; i++) {
      var a = boxes[i], b = boxes[i + 1], ay = a.y + H / 2, by = b.y + H / 2, p, vx, vy;
      if (a.y === b.y) { p = 'M' + (a.x + a.w) + ' ' + ay + 'H' + b.x; vx = a.x + a.w + GAP / 2; vy = ay; }
      else {
        var mid = H + ROWGAP / 2, rx = a.x + a.w + LANE / 2;
        p = 'M' + (a.x + a.w) + ' ' + ay + 'H' + rx + 'V' + mid + 'H' + (LANE / 2) + 'V' + by + 'H' + b.x;
        vx = (rx + LANE / 2) / 2; vy = mid;
      }
      el('path', { d: p, class: 'sch-seg' }, segs);
      el('path', { d: p, class: 'sch-hot' }, hots);
      el('circle', { cx: vx, cy: vy, r: 3, class: 'sch-via' }, vias);
    }
    boxes.forEach(function (bx) {
      el('rect', { x: bx.x + 0.5, y: bx.y + 0.5, width: bx.w - 1, height: H - 1, rx: 4, class: 'sch-node' }, svg);
      el('text', { x: bx.x + bx.w / 2, y: bx.y + H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'sch-text' }, svg).textContent = bx.t;
    });
    var old = plate.querySelector('svg'); if (old) old.remove();
    plate.appendChild(svg);
  }
  function pulse(plate) {
    var now = Date.now(); if (now - (plate._t || 0) < 2000) return; plate._t = now;
    $$('.sch-hot', plate).forEach(function (s, k) {
      setTimeout(function () { s.classList.add('on'); setTimeout(function () { s.classList.remove('on'); }, 120); }, k * 120);
    });
  }
  var plates = $$('[data-plate]');
  plates.forEach(function (p) {
    p._items = $$('.flow span', p.closest('.card')).map(function (s) { return s.textContent; });
    draw(p);
  });
  var ro = 'ResizeObserver' in window ? new ResizeObserver(function (es) { es.forEach(function (e) { draw(e.target); }); }) : null;
  if (ro) plates.forEach(function (p) { ro.observe(p); });


/* ---------------------------------------------------------------- the hero's board */
// Capable screens get the live 3D board; phones, reduced motion and weaker devices get a still of
// it (the same frame), so the page stays light where it matters.
(function hero() {
  var heroEl = d.querySelector('.hero');
  var canvas = d.querySelector('[data-hero-canvas]');
  var poster = d.querySelector('[data-hero-poster]');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wide = matchMedia('(min-width: 760px)').matches;
  var capable = (function () {
    try {
      if ((navigator.deviceMemory || 8) <= 2) return false;
      if (navigator.connection && navigator.connection.saveData) return false;
      return !!d.createElement('canvas').getContext('webgl2');
    } catch (e) { return false; }
  })();
  function showPoster() {
    poster.hidden = false;
    poster.src = import.meta.env.BASE_URL + 'hero-poster.jpg';
    poster.decode ? poster.decode().then(function () { heroEl.classList.add('has-poster'); }, function () {}) : heroEl.classList.add('has-poster');
  }
  if (reduce || !wide || !capable) return showPoster();

  var idle = function (fn) { 'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 120); };
  (d.fonts ? d.fonts.ready : Promise.resolve()).then(function () {
    idle(function () {
      import('./hero3d.js').then(function (mod) {
        canvas.hidden = false;
        var h = mod.createHero(canvas);
        return h.prepare().then(function () {
          h.renderNow();
          heroEl.classList.add('has-3d');
          // only draw while the hero is on screen and the tab is visible
          var onScreen = true;
          var sync = function () { onScreen && !d.hidden ? h.start() : h.stop(); };
          new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(heroEl);
          d.addEventListener('visibilitychange', sync);
          sync();
          // as the hero scrolls away, the camera leans in towards the chip
          addEventListener('scroll', function () { if (onScreen) h.setLean(scrollY / heroEl.offsetHeight); }, { passive: true });
          addEventListener('pointermove', function (e) { if (onScreen) h.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); }, { passive: true });
          var rt = 0;
          addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { h.resize(); h.renderNow(); }, 120); });
        });
      }).catch(function () { canvas.hidden = true; showPoster(); });
    });
  });
})();

if (motion) motionFx();

function motionFx() {

  /* hero: letters rise once */
  var n = 0;
  $$('[data-chars]').forEach(function (line) {
    var text = line.textContent; line.textContent = '';
    for (var k = 0; k < text.length; k++) {
      var s = d.createElement('span');
      s.className = 'ch'; s.setAttribute('aria-hidden', 'true');
      s.textContent = text[k] === ' ' ? ' ' : text[k];
      s.style.setProperty('--i', n++);
      line.appendChild(s);
    }
  });
  $$('.glance__in > div').forEach(function (c, k) { c.style.setProperty('--k', k); });

  /* reveals: once; cards on one row stagger by 60ms */
  $$('.projects .card:not(.card--feature)').forEach(function (c, k) { c.style.setProperty('--k', k % 2); });
  $$('.quotes .quote').forEach(function (c, k) { c.style.setProperty('--k', k); });
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' });
  $$('.rv').forEach(function (x) { io.observe(x); });

  /* data runs through each plate once on arrival; replays on hover/focus, at most every 2s */
  var pio = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { setTimeout(function () { pulse(e.target); }, 300); pio.unobserve(e.target); } });
  }, { threshold: 0.6 });
  plates.forEach(function (p) {
    pio.observe(p);
    var c = p.closest('.card');
    c.addEventListener('mouseenter', function () { pulse(p); });
    c.addEventListener('focusin', function () { pulse(p); });
  });

  /* the hero gives way, gently: at most -20px and 0.7 opacity. Reads scrollY only, writes transform/opacity */
  var hero = d.querySelector('.hero'), hc = d.querySelector('.hero__copy'), ha = d.querySelector('.hero__art'), heroOn = true, raf = 0;
  function give() {
    if (!heroOn || raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var h = Math.min(1, scrollY / (innerHeight * 0.9));
      hc.style.transform = 'translate3d(0,' + (-20 * h).toFixed(1) + 'px,0)';
      hc.style.opacity = (1 - 0.3 * h).toFixed(3);
      ha.style.opacity = (1 - 0.3 * h).toFixed(3);
    });
  }
  new IntersectionObserver(function (es) { heroOn = es[0].isIntersecting; give(); }).observe(hero);
  addEventListener('scroll', give, { passive: true });
}
