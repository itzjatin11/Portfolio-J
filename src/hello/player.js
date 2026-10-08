// The page is played as an ordered list of steps, like a slideshow you drive by scrolling.
//
// A step ("keyframe") is a moment where one card is fully out and readable: the hero, then each
// card of each stop in order. The scroll position only says which step the visitor is asking
// for; the player walks there one step at a time, each step with its own fixed, eased timing.
// So nothing is ever skipped: a quick flick plays the cards in order (a little faster when far
// behind) instead of landing in the middle of a section. Going further than the next section
// (menu links, dragging the scrollbar) fades straight there.
//
// Output, every frame: T (camera: 0 hero … 5 contact, fractional while travelling), L[k] (each
// stop's own progress, which decides which card is out), irisF (progress of a change of place,
// or null) and veil (a plain fade, 0..1).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10); // zero speed and acceleration at both ends

const EXIT = 0.18; // share of a travel step spent on the old stop's last card leaving
const ARRIVE = 0.82; // …and from here on, on the new stop's first card coming out
const TRIGGER = 0.15; // how far past a step the scroll must go (in steps) to ask for the next one
const JUMP_FADE_OUT = 0.3;
const JUMP_FADE_IN = 0.45;
const ZERO = [0, 0, 0, 0, 0, 0];

export function createPlayer({ travelSeconds, itemSeconds, placeChanges }) {
  let K = []; // keyframes: { T, stop, L: number[6], y }
  let pos = 0; // keyframe index we're at (when idle)
  let seg = null; // { from, to, u } a step being played
  let jump = null; // { t, to }
  let goal = 0;
  let target = 0; // continuous keyframe index from the scroll position
  let calm = false;
  let speed = 1; // playback rate, eased towards what the backlog asks for (no sudden lurches)

  // Rebuild the keyframes (layout or breakpoint changed). Keeps the current step.
  function setKeyframes(list) {
    const was = K[pos];
    K = list;
    if (was) {
      const i = K.findIndex((k) => k.stop === was.stop && k.item === was.item);
      if (i >= 0) pos = goal = i;
    }
    pos = clamp(pos, 0, K.length - 1);
    goal = clamp(goal, 0, K.length - 1);
  }

  // Scroll position → which step is asked for. A step is triggered by crossing a point a little
  // past the current one, in the direction of travel, so stopping halfway never flip-flops.
  function setScroll(y) {
    if (!K.length) return;
    let t = K.length - 1;
    if (y <= K[0].y) t = 0;
    else
      for (let j = 0; j < K.length - 1; j++)
        if (y < K[j + 1].y) {
          t = j + (y - K[j].y) / Math.max(1, K[j + 1].y - K[j].y);
          break;
        }
    const prev = target;
    target = t;
    if (t > prev && Math.floor(t - TRIGGER) > Math.floor(prev - TRIGGER)) goal = Math.min(K.length - 1, Math.max(goal, Math.floor(t - TRIGGER) + 1));
    if (t < prev && Math.ceil(t + TRIGGER) < Math.ceil(prev + TRIGGER)) goal = Math.max(0, Math.min(goal, Math.ceil(t + TRIGGER) - 1));
  }

  // jump straight to where the scroll is (first load, resize)
  function settle() {
    goal = pos = clamp(Math.round(target), 0, K.length - 1);
    seg = jump = null;
  }

  const durationOf = (from, to) => {
    const a = K[Math.min(from, to)];
    const b = K[Math.max(from, to)];
    return a.stop === b.stop ? itemSeconds(a.stop) : travelSeconds(a.stop);
  };

  function tick(dt) {
    if (!K.length) return false;
    if (!seg && !jump && goal !== pos) {
      // more than one section away: fade across instead of playing everything in between
      if (Math.abs(K[goal].stop - K[pos].stop) > 1) jump = { t: 0, to: goal };
      else {
        const to = pos + Math.sign(goal - pos);
        seg = { from: pos, to, u: 0 };
      }
    }
    if (seg) {
      // the scroll turned round: play this step back from where it is
      if ((goal - seg.from) * (seg.to - seg.from) <= 0 && goal !== seg.to) {
        [seg.from, seg.to] = [seg.to, seg.from];
        seg.u = 1 - seg.u;
      }
      // further behind = a little quicker (never under 45% of the normal time). The rate eases
      // over ~0.2 s rather than jumping when another flick lands mid-step, so a move never lurches.
      const backlog = Math.abs(goal - seg.to);
      const want = 1 / Math.max(0.45, 1 - 0.14 * backlog);
      speed += (want - speed) * (1 - Math.exp(-dt * 10));
      seg.u = Math.min(1, seg.u + (dt * speed) / durationOf(seg.from, seg.to));
      if (seg.u >= 1) {
        pos = seg.to;
        seg = null;
      }
      return true;
    }
    speed = 1;
    if (jump) {
      jump.t += dt;
      if (jump.t >= JUMP_FADE_OUT && pos !== jump.to) pos = jump.to;
      if (jump.t >= JUMP_FADE_OUT + JUMP_FADE_IN + 0.1) jump = null;
      return true;
    }
    return false;
  }

  // The state to draw, interpolated along the current step. It's read every frame, so it's one
  // object reused (callers read it straight away and don't keep it).
  const out = { T: 0, L: [0, 0, 0, 0, 0, 0], irisF: null, veil: 0, step: 0, stop: 0 };
  const setL = (src) => {
    for (let i = 0; i < 6; i++) out.L[i] = src[i];
  };
  function view() {
    out.T = 0;
    out.irisF = null;
    out.veil = 0;
    out.step = pos;
    out.stop = 0;
    setL(ZERO);
    if (!K.length) return out;
    if (jump) {
      const t = jump.t;
      out.veil = t < JUMP_FADE_OUT ? smoother(t / JUMP_FADE_OUT) : 1 - smoother(clamp((t - JUMP_FADE_OUT - 0.1) / JUMP_FADE_IN, 0, 1));
    }
    if (!seg) {
      const k = K[pos];
      out.T = k.T;
      setL(k.L);
      out.stop = k.stop;
      return out;
    }
    // play forwards from the lower keyframe; a reversed step is the same step at 1 - u
    const lo = Math.min(seg.from, seg.to);
    const a = K[lo];
    const b = K[lo + 1];
    const f = seg.from < seg.to ? seg.u : 1 - seg.u;
    setL(a.L);
    out.step = lo + f;
    if (a.stop === b.stop) {
      // within a stop: one card leaves, the next comes out
      const e = smoother(f);
      out.L[a.stop] = a.L[a.stop] + (b.L[a.stop] - a.L[a.stop]) * e;
      out.T = a.T;
      out.stop = a.stop;
      return out;
    }
    // to the next stop: the last card leaves, the camera travels, the first card comes out
    const k = a.stop;
    const exit = k === 0 ? 0 : EXIT; // the hero has no card to put away
    if (f < exit) {
      out.L[k] = a.L[k] + (1 - a.L[k]) * smoother(f / exit);
      out.T = a.T;
      out.stop = k;
      return out;
    }
    out.L[k] = 1;
    if (f < ARRIVE) {
      const g = (f - exit) / (ARRIVE - exit);
      if (calm) {
        // calm: no flight, a fade while the camera changes place
        out.T = g < 0.5 ? a.T : b.T;
        out.veil = Math.max(out.veil, 1 - Math.abs(g * 2 - 1) ** 2);
      } else if (placeChanges.includes(k)) {
        // a change of place is two eased halves: the camera brakes to a stop exactly when the
        // iris covers the screen, and sets off again in the new place as it opens
        out.T = k + (g < 0.5 ? 0.5 * smoother(g * 2) : 0.5 + 0.5 * smoother(g * 2 - 1));
        out.irisF = g;
      } else out.T = k + smoother(g);
      out.stop = g < 0.5 ? k : b.stop;
      return out;
    }
    out.T = b.T;
    out.stop = b.stop;
    out.L[b.stop] = b.L[b.stop] * smoother((f - ARRIVE) / (1 - ARRIVE));
    return out;
  }

  return {
    setKeyframes,
    setScroll,
    settle,
    tick,
    view,
    setCalm(on) {
      calm = on;
    },
    // playing, or about to start the next step (between two steps there's a frame with no step)
    get busy() {
      return !!(seg || jump) || (K.length > 0 && goal !== pos);
    },
    // scroll position of a step (for links and keyboard focus)
    yOf(stop, item = 0) {
      return K.find((k) => k.stop === stop && k.item === item)?.y ?? 0;
    },
  };
}
