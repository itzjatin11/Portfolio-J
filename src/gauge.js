// The persistent gauge: how wide the view is, how long the data takes to arrive, and what
// that is in human terms. Values interpolate in log space with T, so going in they only
// count down.

// View width matched to what each station actually frames.
const VIEW = [
  [0, 0.3],
  [1, 0.02],
  [2, 0.01],
  [3, 0.02],
  [4, 1e-3],
  [4.32, 1e-5],
  [4.7, 5e-8],
  [5, 2e-9],
  [6, 0.3],
];
// access time in seconds (null = nothing requested yet); at the transistor it is switching time
const ACCESS = [
  [0.85, 100e-6],
  [1, 100e-6],
  [2, 0.3e-6],
  [3, 100e-9],
  [3.999, 10e-9],
  [4.001, 1e-9],
  [4.32, 0.2e-9],
  [4.7, 1e-12],
  [5, 1e-12],
];
// [T, desktop, mobile] — shown only close to a station, so the comparison always matches the view
const HUMAN = [
  [0, 'a ruler', 'a ruler'],
  [1, 'a postage stamp', 'a stamp'],
  [2, 'a fingernail · traces ≈ a hair', 'a fingernail'],
  [3, 'a postage stamp', 'a stamp'],
  [4, 'a grain of sand', 'a grain of sand'],
  [4.32, 'a red blood cell', 'a blood cell'],
  [4.7, 'a virus', 'a virus'],
  [5, 'a strand of DNA', 'DNA'],
  [6, 'a ruler', 'a ruler'],
];
function placeOf(T) {
  if (T < 0.5) return ['Board', 'Board'];
  if (T < 1.5) return ['Storage', 'Storage'];
  if (T < 2.5) return ['PCIe bus', 'Bus'];
  if (T < 3.5) return ['Memory', 'Memory'];
  if (T < 4.15) return ['Cache', 'Cache'];
  if (T < 4.6) return ['Register', 'Register'];
  if (T < 5.5) return ['Transistor', 'Transistor'];
  return ['Board', 'Board'];
}
const CACHE_NS = { 1: 1e-9, 2: 3e-9, 3: 10e-9 };

function logLerp(table, T) {
  if (T <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [t1, v1] = table[i];
    const [t0, v0] = table[i - 1];
    if (T <= t1) {
      const f = (T - t0) / (t1 - t0);
      return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * f);
    }
  }
  return table[table.length - 1][1];
}

const MU = 'µ'; // U+00B5 (Latin-1), not the Greek mu, so it stays in the Latin font subset
function sig(v) {
  return v >= 100 ? Math.round(v).toString() : v >= 10 ? Math.round(v).toString() : v >= 1 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString();
}
export function fmtLength(m) {
  if (m >= 0.01) return `${sig(m * 100)} cm`;
  if (m >= 1e-3) return `${sig(m * 1e3)} mm`;
  if (m >= 1e-6) return `${sig(m * 1e6)} ${MU}m`;
  if (m >= 1e-9) return `${sig(m * 1e9)} nm`;
  return `${sig(m * 1e9)} nm`;
}
export function fmtTime(s) {
  if (s >= 1e-6) return `~${sig(s * 1e6)} ${MU}s`;
  if (s >= 1e-9) return s >= 1e-7 ? `~${sig(s * 1e9)} ns` : `~${sig(s * 1e9)} ns`;
  if (s >= 1e-12 * 5) return `~${sig(s * 1e12)} ps`;
  return '~1 ps';
}
// "if L1 cache took 1 second…"
export function fmtHuman(s) {
  const h = s / 1e-9;
  const n = (v, unit) => `${Math.round(v)} ${unit}${Math.round(v) === 1 ? '' : 's'}`;
  if (h < 0.01) return n(h * 1000, 'millisecond');
  if (h < 1) return `${Math.round(h * 10) / 10} seconds`;
  if (h < 90) return n(h, 'second');
  if (h < 90 * 60) return n(h / 60, 'minute');
  if (h < 20 * 3600) return n(h / 3600, 'hour');
  return n(h / 86400, 'day');
}

export function createGauge(root) {
  if (!root) return { update() {} };
  const el = (s) => root.querySelector(s);
  const where_ = el('[data-g-where]');
  const accessK = el('[data-g-access-k]');
  const view = el('[data-g-view]');
  const access = el('[data-g-access]');
  const humanEl = el('[data-g-human]');
  const mark = el('[data-g-mark]');
  const bar = el('[data-g-bar]');
  const last = {};
  const set = (node, key, text) => {
    if (last[key] !== text) {
      node.textContent = text;
      last[key] = text;
    }
  };
  return {
    update(T, level = 1, mobile = false, extra = '') {
      const v = logLerp(VIEW, T);
      const near = HUMAN.reduce((x, y) => (Math.abs(y[0] - T) < Math.abs(x[0] - T) ? y : x));
      const showHuman = Math.abs(near[0] - T) < 0.12;
      const place = placeOf(T);
      const viewText = fmtLength(v);
      let acc = null;
      let accText = '—';
      const inCache = T > 3.97 && T < 4.03;
      if (T >= 0.85 && T < 5.5) {
        if (inCache) {
          acc = CACHE_NS[level];
          accText = 'L3 10 · L2 3 · L1 1 ns';
        } else {
          acc = logLerp(ACCESS, T);
          accText = fmtTime(acc);
        }
      }
      const where = extra ? `${place[0]} · ${extra}` : place[0];
      if (mobile) {
        set(where_, 'where', [extra ? `${place[1]} ${extra}` : place[1], viewText, showHuman ? `≈ ${near[2]}` : ''].filter(Boolean).join(' · '));
      } else {
        set(where_, 'where', where);
        set(view, 'view', viewText);
        set(accessK, 'accK', T >= 4.6 && T < 5.5 ? 'Switch' : 'Access');
        set(access, 'access', accText);
        const human = [showHuman ? `≈ ${near[1]}` : '', acc ? `≈ ${fmtHuman(acc)}, if L1 were 1 second` : ''].filter(Boolean).join(' · ');
        set(humanEl, 'human', human || '\u00a0');
        root.dataset.level = inCache ? String(level) : '';
      }
      // log ruler: 30 cm (left) → 0.5 nm (right)
      const f = Math.min(1, Math.max(0, (Math.log10(0.3) - Math.log10(v)) / (Math.log10(0.3) - Math.log10(5e-10))));
      const pct = (f * 100).toFixed(2);
      if (last.pct !== pct) {
        last.pct = pct;
        if (mark) mark.style.left = `${pct}%`;
        if (bar) bar.style.transform = `scaleX(${f.toFixed(4)})`;
      }
    },
  };
}
