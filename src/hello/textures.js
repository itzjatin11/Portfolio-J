// Canvas textures for the "Hello from Auckland" journey.
// Channel coded like ../textures.js so the theme recolours them on the GPU:
//   R = ink / lines   G = accent   B = silhouettes / labels   (black = base colour)
import { CanvasTexture, NoColorSpace, RepeatWrapping } from 'three';
import { rng } from '../textures.js';

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
const ch = (r, g, b, a = 1) => `rgba(${r},${g},${b},${a})`;

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Laptop deck: keys and a trackpad, seen from above. 64 × 46 units.
export function keyboardTexture() {
  const W = 1280;
  const H = 920;
  const [c, g] = canvas(W, H);
  const s = W / 64;
  g.strokeStyle = ch(150, 0, 0);
  g.lineWidth = 2;
  const rows = [14, 14, 13, 12, 11];
  const key = 3.2 * s;
  const gap = 0.55 * s;
  rows.forEach((n, r) => {
    const rowW = n * key + (n - 1) * gap;
    const x0 = (W - rowW) / 2;
    const y = 4 * s + r * (key + gap);
    for (let i = 0; i < n; i++) {
      roundRect(g, x0 + i * (key + gap), y, key, key, 6);
      g.stroke();
    }
  });
  // space bar row
  const y = 4 * s + 5 * (key + gap);
  roundRect(g, W / 2 - 9 * s, y, 18 * s, key, 6);
  g.stroke();
  // trackpad
  roundRect(g, W / 2 - 11 * s, 29 * s, 22 * s, 14 * s, 14);
  g.stroke();
  // power light
  g.fillStyle = ch(0, 255, 0);
  g.beginPath();
  g.arc(W - 3 * s, 2.2 * s, 0.45 * s, 0, Math.PI * 2);
  g.fill();
  return tex(c, 8);
}

// Laptop display: a few lines of code and the word that's about to travel.
export function screenTexture() {
  const W = 1280;
  const H = 840;
  const [c, g] = canvas(W, H);
  g.fillStyle = ch(70, 0, 0);
  const r = rng(21);
  for (let i = 0; i < 14; i++) {
    const indent = [0, 1, 1, 2, 2, 1, 0][i % 7] * 40;
    g.fillRect(70 + indent, 70 + i * 26, 120 + r() * 360, 10);
  }
  g.fillStyle = ch(0, 255, 0);
  g.font = '800 230px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('HELLO', W / 2, 640);
  g.fillStyle = ch(0, 0, 200);
  g.font = '600 30px monospace';
  g.fillText('FROM AUCKLAND, NZ', W / 2, 700);
  return tex(c, 8);
}

// Night view of Auckland through the window: buildings, the Sky Tower, a few lit windows.
export function skylineTexture() {
  const W = 2048;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const r = rng(9);
  // stars
  g.fillStyle = ch(60, 0, 0);
  for (let i = 0; i < 90; i++) g.fillRect(r() * W, r() * H * 0.5, 2, 2);
  // buildings (B channel = silhouette)
  const base = H * 0.86;
  const towers = [];
  let x = 0;
  while (x < W) {
    const w = 40 + r() * 90;
    const near = Math.abs(x - W * 0.38) < 360;
    const h = (near ? 160 : 70) + r() * (near ? 280 : 150);
    towers.push([x, w, h]);
    x += w + 4 + r() * 10;
  }
  g.fillStyle = ch(0, 0, 255);
  towers.forEach(([tx, w, h]) => g.fillRect(tx, base - h, w, h + 200));
  // the Sky Tower
  const sx = W * 0.4;
  g.fillRect(sx - 10, base - 640, 20, 640);
  g.beginPath();
  g.moveTo(sx - 34, base - 470);
  g.lineTo(sx + 34, base - 470);
  g.lineTo(sx + 26, base - 440);
  g.lineTo(sx - 26, base - 440);
  g.fill();
  g.fillRect(sx - 4, base - 760, 8, 130);
  g.fillStyle = ch(0, 255, 255);
  g.beginPath();
  g.arc(sx, base - 762, 7, 0, Math.PI * 2);
  g.fill();
  // the harbour bridge, low on the right
  g.strokeStyle = ch(0, 0, 255);
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(W * 0.62, base - 40);
  g.lineTo(W * 0.98, base - 40);
  g.moveTo(W * 0.7, base - 40);
  g.quadraticCurveTo(W * 0.78, base - 150, W * 0.86, base - 40);
  g.stroke();
  // lit windows (R)
  g.fillStyle = ch(200, 0, 255);
  towers.forEach(([tx, w, h]) => {
    for (let wy = base - h + 12; wy < base - 8; wy += 16)
      for (let wx = tx + 8; wx < tx + w - 8; wx += 14) if (r() < 0.16) g.fillRect(wx, wy, 6, 8);
  });
  // ground line
  g.fillStyle = ch(0, 0, 255);
  g.fillRect(0, base, W, H - base);
  return tex(c, 8);
}

// Desk top: a faint grain.
export function deskTexture() {
  const [c, g] = canvas(1024, 512);
  const r = rng(4);
  g.strokeStyle = ch(40, 0, 0);
  for (let i = 0; i < 70; i++) {
    const y = r() * 512;
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x * 0.006 + i) * 6);
    g.stroke();
  }
  return tex(c, 8);
}

// Raised-floor tiles in the data centre (tiles, repeats).
export function floorTexture() {
  const [c, g] = canvas(256, 256);
  g.strokeStyle = ch(90, 0, 0);
  g.lineWidth = 3;
  g.strokeRect(1, 1, 254, 254);
  g.fillStyle = ch(40, 0, 0);
  for (let x = 24; x < 256; x += 26) for (let y = 24; y < 256; y += 26) g.fillRect(x, y, 3, 3);
  const t = tex(c, 8);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// Front of a server rack: stacked units with status lights. White on transparent (tinted per rack).
export function rackDecal() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  const r = rng(13);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, 120, 504);
  for (let y = 14; y < 500; y += 22) {
    g.globalAlpha = 0.35;
    g.strokeRect(12, y, 104, 18);
    g.globalAlpha = 1;
    g.fillStyle = '#fff';
    const n = 1 + ((r() * 4) | 0);
    for (let i = 0; i < n; i++) g.fillRect(20 + i * 9, y + 7, 5, 4);
    if (r() < 0.6) g.fillRect(84 + r() * 20, y + 7, 10, 3);
  }
  return new CanvasTexture(c);
}

// Sea floor: soft ripples (repeats).
export function sandTexture() {
  const [c, g] = canvas(512, 512);
  const r = rng(8);
  g.strokeStyle = ch(55, 0, 0);
  for (let i = 0; i < 40; i++) {
    const y = (i / 40) * 512 + r() * 6;
    g.lineWidth = 1 + r() * 2.5;
    g.beginPath();
    for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin((x / 512) * Math.PI * 4 + i * 0.7) * 5);
    g.stroke();
  }
  const t = tex(c, 8);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// Soft vertical gradient used for light shafts under water.
export function shaftTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 256);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return new CanvasTexture(c);
}

// Front of one tower unit: vents, a row of status lights, a handle. White on transparent.
export function unitDecal() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  const r = rng(31);
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineWidth = 3;
  g.strokeRect(4, 6, 504, 84);
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  for (let x = 30; x < 300; x += 12) {
    g.beginPath();
    g.moveTo(x, 26);
    g.lineTo(x, 70);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#fff';
  for (let i = 0; i < 7; i++) if (r() < 0.75) g.fillRect(330 + i * 18, 40, 10, 6);
  g.fillRect(470, 30, 6, 36);
  return new CanvasTexture(c);
}
