// Procedural canvas textures for the machine.
// Most are "channel coded" so the theme can recolour them on the GPU without a redraw:
//   R = trace / ink   G = accent   B = silkscreen / gold   (black = base material colour)
import { CanvasTexture, NoColorSpace, RepeatWrapping } from 'three';

export const BOARD = 44;

// Seeded RNG so the board looks the same on every visit.
export function rng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  return [c, g];
}

function tex(c, aniso = 4) {
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

const ch = (r, gg, b, a = 1) => `rgba(${r},${gg},${b},${a})`;

/* ---------- areas the random board traces must keep clear of ---------- */
const KEEP_OUT = [
  [-19, 7.6, -6.6, 12.6], // SSD (x0, z0, x1, z1)
  [-7.6, -1.2, -2.6, 11.4], // PCIe pairs
  [2.6, -11.6, 8.4, 0.6], // memory channel
  [7.4, -11.2, 11.2, 10.8], // DIMM slots
  [15.6, -20.5, 21, -15.5], // NIC
];
const blocked = (x, z) => KEEP_OUT.some(([a, b, c, d]) => x > a && x < c && z > b && z < d);

export function makeTraces(count, seed = 11) {
  const r = rng(seed);
  const rand = (a, b) => a + r() * (b - a);
  const traces = [];
  const half = 3.4;
  let guard = 0;
  while (traces.length < count && guard++ < count * 12) {
    const side = guard % 4;
    const along = rand(-half + 0.5, half - 0.5);
    let x, z, dx, dz;
    if (side === 0) [x, z, dx, dz] = [along, -half, 0, -1];
    if (side === 1) [x, z, dx, dz] = [half, along, 1, 0];
    if (side === 2) [x, z, dx, dz] = [along, half, 0, 1];
    if (side === 3) [x, z, dx, dz] = [-half, along, -1, 0];
    const pts = [[x, z]];
    let segs = 2 + ((r() * 3) | 0);
    let ok = true;
    while (segs--) {
      const len = rand(1.5, 7);
      const steps = Math.ceil(len / 0.5);
      for (let s = 1; s <= steps; s++) if (blocked(x + (dx * len * s) / steps, z + (dz * len * s) / steps)) ok = false;
      x += dx * len;
      z += dz * len;
      pts.push([x, z]);
      const turn = r() < 0.5 ? -1 : 1;
      if (r() < 0.5) {
        [dx, dz] = [dx - turn * dz, dz + turn * dx];
        const l = Math.hypot(dx, dz);
        dx /= l;
        dz /= l;
      }
    }
    if (ok && Math.abs(x) < BOARD / 2 - 1 && Math.abs(z) < BOARD / 2 - 1) traces.push(pts);
  }
  return traces;
}

export function boardTexture(traces, size) {
  const [c, g] = canvas(size, size);
  const s = size / BOARD;
  const X = (v) => (v + BOARD / 2) * s;

  // fine grid
  g.strokeStyle = ch(30, 0, 0);
  g.lineWidth = Math.max(1, s * 0.02);
  g.beginPath();
  for (let i = 0; i <= BOARD; i += 1) {
    g.moveTo(X(i - BOARD / 2), 0);
    g.lineTo(X(i - BOARD / 2), size);
    g.moveTo(0, X(i - BOARD / 2));
    g.lineTo(size, X(i - BOARD / 2));
  }
  g.stroke();

  // random traces fanning out of the CPU
  g.lineCap = 'round';
  g.lineJoin = 'round';
  traces.forEach((pts, i) => {
    const hot = i % 7 === 0;
    g.strokeStyle = hot ? ch(0, 150, 0) : ch(120, 0, 0);
    g.lineWidth = s * (i % 5 === 0 ? 0.16 : 0.09);
    g.beginPath();
    pts.forEach(([x, z], j) => (j ? g.lineTo(X(x), X(z)) : g.moveTo(X(x), X(z))));
    g.stroke();
    const [ex, ez] = pts[pts.length - 1];
    g.fillStyle = hot ? ch(0, 255, 0) : ch(220, 0, 0);
    g.beginPath();
    g.arc(X(ex), X(ez), s * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(X(ex), X(ez), s * 0.09, 0, Math.PI * 2);
    g.fill();
  });

  // silkscreen: outlines and reference designators
  g.strokeStyle = ch(0, 0, 80);
  g.lineWidth = Math.max(1, s * 0.035);
  g.setLineDash([s * 0.3, s * 0.2]);
  g.strokeRect(X(8.0), X(-10.6), 1.0 * s, 21.2 * s); // DIMM A1
  g.strokeRect(X(9.5), X(-10.6), 1.0 * s, 21.2 * s); // DIMM A2
  g.strokeRect(X(-3.6), X(-3.6), 7.2 * s, 7.2 * s); // CPU
  g.strokeRect(X(16.6), X(-19.6), 2.8 * s, 3.2 * s); // NIC
  g.setLineDash([]);
  g.fillStyle = ch(0, 0, 200);
  g.font = `600 ${Math.round(s * 0.5)}px monospace`;
  [
    ['M2_1', -18.6, 12.4],
    ['DIMM_A1', 7.6, -11.2],
    ['DIMM_A2', 9.6, 11.6],
    ['CPU1  JST-26', -3.5, -4.0],
    ['J_ETH1', 16.6, -20.0],
    ['C7 100nF', -14, 6],
    ['R12 10k', 12, 14],
    ['TP3 SQL', -12, -12],
    ['L2 .NET', 14, -3],
    ['Q4 NODE', -6, 16],
    ['AKL · NZ · 2026', -20, -20],
  ].forEach(([t, x, z]) => g.fillText(t, X(x), X(z)));

  // mounting holes
  g.fillStyle = ch(0, 0, 120);
  [
    [-20.5, -20.5],
    [20.5, -20.5],
    [-20.5, 20.5],
    [20.5, 20.5],
    [-18.6, 10],
  ].forEach(([x, z]) => {
    g.beginPath();
    g.arc(X(x), X(z), s * 0.55, 0, Math.PI * 2);
    g.fill();
  });

  return tex(c, 8);
}

export function lidTexture() {
  const [c, g] = canvas(1024, 1024);
  g.scale(2, 2);
  g.strokeStyle = ch(90, 0, 0);
  g.lineWidth = 3;
  g.strokeRect(18, 18, 476, 476);
  g.fillStyle = ch(0, 255, 0);
  g.beginPath();
  g.arc(52, 52, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ch(0, 0, 255);
  g.font = 'bold 104px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillText('JST-26', 52, 270);
  g.font = '600 26px monospace';
  g.fillStyle = ch(0, 0, 170);
  g.fillText('C#/.NET · NODE · SQL', 54, 322);
  g.fillText('AKL · NZ · FULL-STACK', 54, 360);
  g.fillStyle = ch(200, 0, 0);
  for (let i = 0; i < 10; i++) g.fillRect(54 + i * 22, 418, 16, 26 - (i > 6 ? 18 : 0));
  return tex(c);
}

// M.2 2280 board, lying along X. Gold fingers at +X (towards the CPU).
export function ssdTexture() {
  const [c, g] = canvas(1024, 280);
  const sx = 1024 / 10.7;
  // traces between parts
  g.strokeStyle = ch(110, 0, 0);
  g.lineWidth = 3;
  for (let i = 0; i < 18; i++) {
    const y = 40 + i * 11;
    g.beginPath();
    g.moveTo(300, y);
    g.lineTo(820, y);
    g.stroke();
  }
  // gold fingers
  g.fillStyle = ch(0, 0, 255);
  for (let i = 0; i < 34; i++) {
    if (i === 12) continue; // key notch
    g.fillRect(1024 - 0.55 * sx, 12 + i * 7.6, 0.55 * sx - 4, 5);
  }
  // silkscreen text
  g.fillStyle = ch(170, 0, 0);
  g.font = '600 22px monospace';
  g.fillText('NVMe · M.2 2280 · PCIe ×4', 40, 262);
  g.fillText('nvme0n1', 40, 28);
  // half-moon screw notch
  g.fillStyle = ch(0, 0, 160);
  g.beginPath();
  g.arc(0, 140, 26, -Math.PI / 2, Math.PI / 2);
  g.fill();
  return tex(c);
}

export function labelTexture(lines) {
  const [c, g] = canvas(256, 256);
  g.strokeStyle = ch(100, 0, 0);
  g.lineWidth = 4;
  g.strokeRect(10, 10, 236, 236);
  g.fillStyle = ch(0, 255, 0);
  g.beginPath();
  g.arc(36, 36, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ch(0, 0, 255);
  g.font = 'bold 44px monospace';
  g.fillText(lines[0], 26, 140);
  g.font = '600 22px monospace';
  g.fillStyle = ch(0, 0, 170);
  lines.slice(1).forEach((l, i) => g.fillText(l, 28, 182 + i * 28));
  return tex(c);
}

// DRAM die decal: word lines × bit lines with capacitor dots. White on transparent.
export function dramDecal() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  g.strokeRect(6, 6, 244, 180);
  g.lineWidth = 1;
  g.globalAlpha = 0.5;
  for (let x = 20; x < 240; x += 12) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x, 176);
    g.stroke();
  }
  for (let y = 22; y < 176; y += 12) {
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(242, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#fff';
  for (let x = 26; x < 240; x += 12)
    for (let y = 28; y < 176; y += 12) {
      g.beginPath();
      g.arc(x, y, 2.1, 0, Math.PI * 2);
      g.fill();
    }
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// DIMM PCB face: gold fingers along the bottom edge, fine traces above.
export function dimmTexture() {
  const W = 2048;
  const H = 472;
  const [c, g] = canvas(W, H);
  g.fillStyle = ch(0, 0, 255);
  for (let x = 30; x < W - 30; x += 15) {
    if (Math.abs(x - W * 0.56) < 20) continue;
    g.fillRect(x, H - 52, 10, 46);
  }
  g.strokeStyle = ch(80, 0, 0);
  g.lineWidth = 2;
  for (let x = 40; x < W - 40; x += 26) {
    g.beginPath();
    g.moveTo(x, H - 56);
    g.lineTo(x, H - 110);
    g.lineTo(x + 18, H - 140);
    g.stroke();
  }
  g.fillStyle = ch(150, 0, 0);
  g.font = '600 22px monospace';
  g.fillText('DDR5 · 4800 · 16 GB · rank 1', 60, 40);
  return tex(c);
}

// Die floorplan for a 30×30 die. Layout constants are shared with world.js.
export const DIE = {
  size: 30,
  l3: [-13, -2.5, 13, 2.5], // x0 z0 x1 z1
  coreX: [-9.75, -3.25, 3.25, 9.75],
  coreW: 6,
  coreZ: [-13.5, -3.1], // top row z range; bottom row mirrored
};

export function dieTexture(size) {
  const [c, g] = canvas(size, size);
  const s = size / DIE.size;
  const X = (v) => (v + DIE.size / 2) * s;
  const rect = (x0, z0, x1, z1) => [X(x0), X(z0), (x1 - x0) * s, (z1 - z0) * s];

  // seal ring + pad ring
  g.strokeStyle = ch(140, 0, 0);
  g.lineWidth = s * 0.15;
  g.strokeRect(...rect(-14.6, -14.6, 14.6, 14.6));
  g.fillStyle = ch(90, 0, 0);
  for (let i = -14; i <= 14; i += 0.8) {
    g.fillRect(X(i) - 2, X(-14.3), 4 * (s / 20), s * 0.3);
    g.fillRect(X(i) - 2, X(14.0), 4 * (s / 20), s * 0.3);
  }

  // L3: SRAM bitcell array
  const [lx0, lz0, lx1, lz1] = DIE.l3;
  g.fillStyle = ch(36, 0, 0);
  g.fillRect(...rect(lx0, lz0, lx1, lz1));
  g.fillStyle = ch(110, 0, 0);
  const cell = s * 0.18;
  for (let y = X(lz0) + 2; y < X(lz1) - 2; y += cell) {
    for (let x = X(lx0) + 2; x < X(lx1) - 2; x += cell * 1.6) g.fillRect(x, y, cell * 1.1, cell * 0.45);
  }
  g.strokeStyle = ch(170, 0, 0);
  g.lineWidth = Math.max(1, s * 0.04);
  for (let x = lx0; x <= lx1; x += 3.25) g.strokeRect(...rect(x, lz0, Math.min(lx1, x + 3.25), lz1));

  // cores (both rows)
  DIE.coreX.forEach((cx) =>
    [1, -1].forEach((sgn) => {
      const z0 = sgn > 0 ? -13.5 : 3.1;
      const z1 = sgn > 0 ? -3.1 : 13.5;
      const near = sgn > 0 ? z1 : z0; // edge next to L3
      g.strokeStyle = ch(190, 0, 0);
      g.lineWidth = Math.max(1, s * 0.06);
      g.strokeRect(...rect(cx - 2.9, z0, cx + 2.9, z1));
      // standard-cell rows (logic)
      const r = rng(Math.round(cx * 10 + sgn * 3 + 50));
      g.fillStyle = ch(70, 0, 0);
      const lz = sgn > 0 ? [-13.2, -7.4] : [7.4, 13.2];
      for (let z = lz[0]; z < lz[1]; z += 0.22) {
        let x = cx - 2.7;
        while (x < cx + 2.7) {
          const w = 0.1 + r() * 0.5;
          if (r() > 0.25) g.fillRect(X(x), X(z), Math.min(w, cx + 2.7 - x) * s, s * 0.14);
          x += w + 0.05;
        }
      }
      // L2 strip, finer cells
      const l2 = sgn > 0 ? [near - 1.7, near - 0.15] : [near + 0.15, near + 1.7];
      g.fillStyle = ch(60, 0, 0);
      g.fillRect(...rect(cx - 2.7, l2[0], cx + 2.7, l2[1]));
      g.fillStyle = ch(150, 0, 0);
      const c2 = s * 0.12;
      for (let y = X(l2[0]) + 2; y < X(l2[1]) - 2; y += c2) for (let x = X(cx - 2.7) + 2; x < X(cx + 2.7) - 2; x += c2 * 1.6) g.fillRect(x, y, c2, c2 * 0.4);
      // L1 I$ + D$, finest and brightest
      const l1 = sgn > 0 ? [near - 3.6, near - 2.0] : [near + 2.0, near + 3.6];
      [
        [cx - 2.6, cx - 0.2],
        [cx + 0.2, cx + 2.6],
      ].forEach(([a, b]) => {
        g.fillStyle = ch(90, 0, 0);
        g.fillRect(...rect(a, l1[0], b, l1[1]));
        g.fillStyle = ch(220, 0, 0);
        const c1 = s * 0.09;
        for (let y = X(l1[0]) + 2; y < X(l1[1]) - 2; y += c1) for (let x = X(a) + 2; x < X(b) - 2; x += c1 * 1.7) g.fillRect(x, y, c1, c1 * 0.4);
      });
    }),
  );

  // memory controller (right) and PCIe (left) PHYs
  g.fillStyle = ch(0, 120, 0);
  g.fillRect(...rect(13.4, -6, 14.2, 6));
  g.fillRect(...rect(-14.2, -6, -13.4, 6));
  g.fillStyle = ch(0, 0, 200);
  g.font = `600 ${Math.round(s * 0.42)}px monospace`;
  g.fillText('L3 · shared', X(-12.6), X(-1.9));
  g.save();
  g.translate(X(13.1), X(-5.6));
  g.rotate(Math.PI / 2);
  g.fillText('DDR PHY', 0, 0);
  g.restore();
  g.save();
  g.translate(X(-13.1), X(5.6));
  g.rotate(-Math.PI / 2);
  g.fillText('PCIe PHY', 0, 0);
  g.restore();
  g.fillText('CORE 0', X(0.6), X(-12.8));
  g.fillText('L2', X(0.6), X(-4.1));
  g.fillText('L1 I$', X(0.6), X(-6.2));
  g.fillText('L1 D$', X(3.6), X(-6.2));
  return tex(c, 8);
}

// Fine repeating grid for the transistor floor (R channel), tiles.
export function gridTexture() {
  const [c, g] = canvas(256, 256);
  g.strokeStyle = ch(60, 0, 0);
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = ch(28, 0, 0);
  g.lineWidth = 1;
  for (let i = 32; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  const t = tex(c, 8);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(12, 12);
  return t;
}

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
