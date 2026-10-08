// When each piece of content comes out, stays and leaves, shared by the page and the 3D world
// so a card leaves its source at the same moment the source lights up.
//
// A stop's local progress L (0..1) is split into equal windows, one per item. Inside its window an
// item comes out (first 30%), holds still while it's read, and moves on (last 20%).

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const OUT_END = 0.3;
export const EXIT_START = 0.8;

// sequence: one item at a time
export function sequence(L, n, i) {
  const u = L * n - i;
  return { appear: sstep(0, OUT_END, u), exit: i === n - 1 && L >= 1 ? 1 : sstep(EXIT_START, 1, u) };
}

// accumulate: a heading, then the items come out one by one and stay together until the end
export function accumulate(L, n, i) {
  if (i === 0) return { appear: sstep(0, 0.06, L), exit: sstep(0.9, 1, L) };
  const a = 0.06 + ((i - 1) * 0.76) / (n - 1);
  return { appear: sstep(a, a + 0.08, L), exit: sstep(0.9, 1, L) };
}

// The camera's position among the items: it rests on item i while it's read and moves on to
// the next one while i is leaving.
export function dwell(L, n) {
  const x = Math.min(n - 1e-6, Math.max(0, L * n));
  const k = Math.floor(x);
  return Math.min(n - 1, k + sstep(EXIT_START - 0.05, 1, x - k));
}

// L at which item i is fully out and being read (used to scroll a focused item into view)
export function holdAt(n, i, mode = 'sequence') {
  if (mode === 'accumulate') return i === 0 ? 0.04 : 0.86;
  return (i + 0.55) / n;
}
