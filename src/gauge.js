// The persistent gauge: how wide the view is, how long the data takes to arrive, and what
// that is in human terms. Values interpolate in log space with T, so going in they only
// count down.

const VIEW = [
  [0, 0.3],
  [1, 0.02],
  [2, 1e-3],
  [3, 1e-5],
  [4, 1e-6],
  [4.5, 1e-7],
  [5, 5e-10],
  [6, 0.3],
];
// access time in seconds (null = nothing requested yet)
const ACCESS = [
  [0.85, 100e-6],
  [1, 100e-6],
  [2, 0.3e-6],
  [3, 100e-9],
  [3.999, 10e-9],
  [4.001, 1e-9],
  [4.5, 0.2e-9],
  [5, 1e-12],
];
const PLACES = [
  ['Board', 'Board'],
  ['Storage', 'Storage'],
  ['PCIe bus', 'Bus'],
  ['Memory', 'Memory'],
  ['Cache', 'Cache'],
  ['Core', 'Core'],
  ['Transistor', 'Transistor'],
];
const HUMAN = [
  [0, 'a ruler', 'a ruler'],
  [1, 'a postage stamp', 'a stamp'],
  [2, 'a human hair', 'a hair'],
  [3, 'a red blood cell', 'a blood cell'],
  [4, 'a bacterium', 'a bacterium'],
  [4.5, 'a virus', 'a virus'],
  [5, 'a few atoms', 'atoms'],
  [6, 'a ruler', 'a ruler'],
];
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
  const where = el('[data-g-where]');
  const view = el('[data-g-view]');
  const access = el('[data-g-access]');
  const human = el('[data-g-human]');
  const time = el('[data-g-time]');
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
    update(T, level = 1, mobile = false) {
      const v = logLerp(VIEW, T);
      const station = T >= 5.5 ? 0 : T >= 4.75 ? 6 : T >= 4.4 ? 5 : Math.round(T);
      const nearHuman = HUMAN.reduce((a, b) => (Math.abs(b[0] - T) < Math.abs(a[0] - T) ? b : a));
      const place = PLACES[station];
      const viewText = fmtLength(v);
      // access
      let acc = null;
      let accText = '—';
      if (T >= 0.85 && T < 5.5) {
        if (T > 3.97 && T < 4.03) {
          acc = CACHE_NS[level];
          accText = `L3 10 · L2 3 · L1 1 ns`;
        } else {
          acc = logLerp(ACCESS, T);
          accText = fmtTime(acc);
        }
      }
      if (mobile) {
        set(where, 'where', `${place[1]} · ${viewText} · ≈ ${nearHuman[2]}`);
      } else {
        set(where, 'where', place[0]);
        set(view, 'view', viewText);
        set(access, 'access', accText);
        set(human, 'human', `≈ ${nearHuman[1]}`);
        set(time, 'time', acc ? `≈ ${fmtHuman(acc)}, if L1 were 1 second` : '');
        root.dataset.level = T > 3.97 && T < 4.03 ? String(level) : '';
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
