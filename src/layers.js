// "Going deeper": every section is one layer further inside the machine.
// Each layer has its own procedural pattern (drawn as a CSS mask so it takes
// the theme colour) and a pinned "dive" transition zooms you into the next one.

export const LAYERS = {
  core: { zoom: '×10³', name: 'Core', scale: '1.6 mm' },
  registers: { zoom: '×10⁴', name: 'Registers', scale: '120 µm' },
  bus: { zoom: '×10⁵', name: 'Data bus', scale: '12 µm' },
  memory: { zoom: '×10⁶', name: 'Memory', scale: '1.2 µm' },
  storage: { zoom: '×10⁷', name: 'Storage', scale: '120 nm' },
  transistor: { zoom: '×10⁸', name: 'Transistor', scale: '5 nm' },
};

// Small seeded RNG so the patterns are identical on every load.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const TILES = {
  core(accent) {
    const r = rng(3);
    let b = '<g fill="none" stroke="#000" stroke-width="1">';
    for (let i = 1; i <= 4; i++) b += `<rect x="${100 - i * 22}" y="${100 - i * 22}" width="${i * 44}" height="${i * 44}"/>`;
    b += '<path d="M100 0v200M0 100h200"/></g>';
    if (accent) b = `<g fill="#000">${Array.from({ length: 6 }, () => `<rect x="${(r() * 9 | 0) * 22}" y="${(r() * 9 | 0) * 22}" width="6" height="6"/>`).join('')}</g>`;
    return { w: 200, h: 200, body: b };
  },
  registers(accent) {
    const r = rng(7);
    const hex = () => (r() * 65536 | 0).toString(16).toUpperCase().padStart(4, '0');
    let b = `<g font-family="ui-monospace,Menlo,monospace" font-size="11" fill="#000">`;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 8 + col * 124;
        const y = 22 + row * 26;
        if (accent) {
          if (r() < 0.12) b += `<text x="${x}" y="${y}">R${String(row * 3 + col).padStart(2, '0')} 0x${hex()}</text>`;
        } else b += `<text x="${x}" y="${y}">R${String(row * 3 + col).padStart(2, '0')} 0x${hex()}</text>`;
      }
    }
    return { w: 372, h: 212, body: b + '</g>' };
  },
  bus(accent) {
    const r = rng(11);
    let b = '<g fill="#000">';
    for (let lane = 0; lane < 6; lane++) {
      const y = 8 + lane * 16;
      if (!accent) b += `<rect x="0" y="${y}" width="480" height="1"/>`;
      let x = r() * 40;
      while (x < 470) {
        const w = r() < 0.5 ? 8 : 22;
        if (!accent || r() < 0.15) b += `<rect x="${x.toFixed(1)}" y="${y - 3}" width="${w}" height="7" rx="1"/>`;
        x += w + 10 + r() * 40;
      }
    }
    return { w: 480, h: 96, body: b + '</g>' };
  },
  memory(accent) {
    const r = rng(19);
    let b = '<g stroke="#000" stroke-width="1">';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const on = r() < (accent ? 0.08 : 0.3);
        if (accent && !on) continue;
        b += `<rect x="${x * 24 + 3}" y="${y * 24 + 3}" width="18" height="18" fill="${on ? '#000' : 'none'}"/>`;
      }
    }
    return { w: 192, h: 192, body: b + '</g>' };
  },
  storage(accent) {
    // stacked 3D-NAND plates in isometric
    let b = '<g fill="none" stroke="#000" stroke-width="1">';
    for (let i = 0; i < 6; i++) {
      const y = 20 + i * 18;
      if (accent && i !== 2) continue;
      b += `<path d="M20 ${y + 20}L120 ${y - 10}L220 ${y + 20}L120 ${y + 50}Z" ${accent ? 'fill="#000"' : ''}/>`;
    }
    b += '<path d="M120 10v150"/></g>';
    return { w: 240, h: 170, body: b };
  },
  transistor(accent) {
    // FinFET from above: vertical fins crossed by gate stripes, with contacts
    let b = '<g fill="#000">';
    if (!accent) {
      for (let x = 14; x < 160; x += 36) b += `<rect x="${x}" y="0" width="8" height="160"/>`;
      for (let y = 30; y < 160; y += 60) b += `<rect x="0" y="${y}" width="160" height="4" opacity="0.6"/>`;
    }
    for (let x = 14; x < 160; x += 72) b += `<rect x="${x - 3}" y="${accent ? 70 : 58}" width="14" height="14" ${accent ? '' : 'fill="none" stroke="#000"'}/>`;
    return { w: 160, h: 160, body: b + '</g>' };
  },
};

const cache = new Map();
function tileURL(name, accent) {
  const key = name + accent;
  if (!cache.has(key)) {
    const t = TILES[name](accent);
    const url = URL.createObjectURL(new Blob([svg(t.w, t.h, t.body)], { type: 'image/svg+xml' }));
    cache.set(key, { url, w: t.w, h: t.h });
  }
  return cache.get(key);
}

/** Paint every [data-pat="name"] element with its layer pattern. */
export function paintPatterns(root = document) {
  root.querySelectorAll('[data-pat]').forEach((el) => {
    const accent = el.hasAttribute('data-pat-accent');
    const t = tileURL(el.dataset.pat, accent);
    const k = +(el.dataset.patScale || 1);
    el.style.maskImage = el.style.webkitMaskImage = `url(${t.url})`;
    el.style.maskSize = el.style.webkitMaskSize = `${t.w * k}px ${t.h * k}px`;
  });
}
