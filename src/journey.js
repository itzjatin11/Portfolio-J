// Scroll-driven fly-through: circuit board -> into the chip -> down a data tunnel.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Fog,
  Color,
  PlaneGeometry,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  PointsMaterial,
  LineBasicMaterial,
  Mesh,
  InstancedMesh,
  Points,
  LineLoop,
  Object3D,
  Vector3,
  CanvasTexture,
  SRGBColorSpace,
  AdditiveBlending,
  DynamicDrawUsage,
  MathUtils,
} from 'three';

const BG = 0x030507;
const CYAN = new Color('#3be8d8');
const ORANGE = new Color('#ff4d2e');
const WHITE = new Color('#f2f0eb');

const BOARD = 44; // board size in world units
const CHIP = 6; // chip size
const TUNNEL_DEPTH = 90;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ---------- procedural circuit traces (board coordinates, y-up plane) ---------- */
function makeTraces(count) {
  const traces = [];
  const half = CHIP / 2 + 0.5;
  for (let i = 0; i < count; i++) {
    const side = i % 4; // 0 top, 1 right, 2 bottom, 3 left
    const along = rand(-half + 0.6, half - 0.6);
    let x, z, dx, dz;
    if (side === 0) [x, z, dx, dz] = [along, -half, 0, -1];
    if (side === 1) [x, z, dx, dz] = [half, along, 1, 0];
    if (side === 2) [x, z, dx, dz] = [along, half, 0, 1];
    if (side === 3) [x, z, dx, dz] = [-half, along, -1, 0];
    const pts = [[x, z]];
    let segs = 2 + ((Math.random() * 3) | 0);
    while (segs--) {
      const len = rand(1.5, 7);
      x += dx * len;
      z += dz * len;
      pts.push([x, z]);
      // bend 45° or 90°, keeping roughly outward
      const turn = pick([-1, 1]);
      if (Math.random() < 0.5) {
        [dx, dz] = [dx - turn * dz, dz + turn * dx];
        const l = Math.hypot(dx, dz);
        dx /= l;
        dz /= l;
      } else if (Math.abs(dx) > 0.9 || Math.abs(dz) > 0.9) {
        // occasional dog-leg
        const l2 = rand(0.8, 2);
        x += -dz * turn * l2;
        z += dx * turn * l2;
        pts.push([x, z]);
      }
    }
    if (Math.abs(x) < BOARD / 2 - 1 && Math.abs(z) < BOARD / 2 - 1) traces.push(pts);
  }
  return traces;
}

function boardTexture(traces, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / BOARD;
  const tx = (v) => (v + BOARD / 2) * s;

  g.fillStyle = '#05090b';
  g.fillRect(0, 0, size, size);

  // fine grid
  g.strokeStyle = 'rgba(59,232,216,0.06)';
  g.lineWidth = 1;
  for (let i = 0; i <= BOARD; i += 1) {
    g.beginPath();
    g.moveTo(tx(i - BOARD / 2), 0);
    g.lineTo(tx(i - BOARD / 2), size);
    g.moveTo(0, tx(i - BOARD / 2));
    g.lineTo(size, tx(i - BOARD / 2));
    g.stroke();
  }

  // traces
  g.lineCap = 'round';
  g.lineJoin = 'round';
  traces.forEach((pts, i) => {
    g.strokeStyle = i % 7 === 0 ? 'rgba(255,77,46,0.55)' : 'rgba(59,232,216,0.38)';
    g.lineWidth = s * (i % 5 === 0 ? 0.16 : 0.09);
    g.beginPath();
    pts.forEach(([x, z], j) => (j ? g.lineTo(tx(x), tx(z)) : g.moveTo(tx(x), tx(z))));
    g.stroke();
    // end pad + via
    const [ex, ez] = pts[pts.length - 1];
    g.fillStyle = i % 7 === 0 ? '#ff4d2e' : 'rgba(59,232,216,0.8)';
    g.beginPath();
    g.arc(tx(ex), tx(ez), s * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#05090b';
    g.beginPath();
    g.arc(tx(ex), tx(ez), s * 0.09, 0, Math.PI * 2);
    g.fill();
  });

  // silkscreen labels
  g.fillStyle = 'rgba(242,240,235,0.35)';
  g.font = `${Math.round(s * 0.55)}px monospace`;
  [
    ['U1  JST-26', -2.4, -5.2],
    ['R12 10k', 8, -9],
    ['C7 100nF', -14, 6],
    ['J1 AKL', 12, 12],
    ['TP3 SQL', -12, -12],
    ['L2 .NET', 14, -3],
    ['Q4 NODE', -6, 14],
  ].forEach(([t, x, z]) => g.fillText(t, tx(x), tx(z)));

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function chipTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0d0f';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(242,240,235,0.12)';
  g.lineWidth = 2;
  g.strokeRect(20, 20, 472, 472);
  g.fillStyle = '#ff4d2e';
  g.beginPath();
  g.arc(56, 56, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2f0eb';
  g.font = 'bold 92px "Arial Narrow", Arial, sans-serif';
  g.fillText('JST-26', 56, 270);
  g.font = '26px monospace';
  g.fillStyle = 'rgba(242,240,235,0.6)';
  g.fillText('C#/.NET · NODE · SQL', 58, 320);
  g.fillText('AKL · NZ · FULL-STACK', 58, 360);
  g.fillStyle = 'rgba(59,232,216,0.8)';
  g.fillText('▮▮▮▮▮▮▮▯▯▯ 2026', 58, 440);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function createJourney(canvas, { reduced = false } = {}) {
  const small = window.matchMedia('(max-width: 760px)').matches;
  const renderer = new WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.25 : 1.5));
  renderer.setClearColor(BG, 1);

  const scene = new Scene();
  scene.fog = new Fog(BG, 8, 46);
  const camera = new PerspectiveCamera(55, 1, 0.05, 120);

  /* ---------- board ---------- */
  const traces = makeTraces(small ? 90 : 150);
  const board = new Mesh(
    new PlaneGeometry(BOARD, BOARD),
    new MeshBasicMaterial({ map: boardTexture(traces, small ? 1024 : 2048) }),
  );
  board.rotation.x = -Math.PI / 2;
  scene.add(board);

  /* ---------- chip + pins ---------- */
  const chipTop = new MeshBasicMaterial({ map: chipTexture() });
  const chipSide = new MeshBasicMaterial({ color: 0x0b0d0f });
  const chip = new Mesh(new BoxGeometry(CHIP, 0.5, CHIP), [chipSide, chipSide, chipTop, chipSide, chipSide, chipSide]);
  chip.position.y = 0.25;
  scene.add(chip);

  const pinsPerSide = 16;
  const pins = new InstancedMesh(new BoxGeometry(0.12, 0.08, 0.5), new MeshBasicMaterial({ color: 0x9aa0a6 }), pinsPerSide * 4);
  const o = new Object3D();
  let k = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < pinsPerSide; i++) {
      const t = -CHIP / 2 + 0.4 + (i * (CHIP - 0.8)) / (pinsPerSide - 1);
      const d = CHIP / 2 + 0.2;
      if (side === 0) o.position.set(t, 0.04, -d);
      if (side === 1) o.position.set(d, 0.04, t);
      if (side === 2) o.position.set(t, 0.04, d);
      if (side === 3) o.position.set(-d, 0.04, t);
      o.rotation.set(0, side % 2 ? Math.PI / 2 : 0, 0);
      o.updateMatrix();
      pins.setMatrixAt(k++, o.matrix);
    }
  }
  scene.add(pins);

  /* ---------- signal pulses racing along traces ---------- */
  const pulseCount = small ? 160 : 320;
  const pulseGeo = new BufferGeometry();
  const pulsePos = new Float32Array(pulseCount * 3);
  pulseGeo.setAttribute('position', new Float32BufferAttribute(pulsePos, 3).setUsage(DynamicDrawUsage));
  const pulseMat = new PointsMaterial({
    size: small ? 0.32 : 0.24,
    color: CYAN.clone().lerp(WHITE, 0.4),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const pulseLayer = new Points(pulseGeo, pulseMat);
  scene.add(pulseLayer);
  const pulses = Array.from({ length: pulseCount }, () => {
    const pts = pick(traces);
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    return { pts, lens, total, d: Math.random() * total, v: rand(3, 9) * (Math.random() < 0.5 ? 1 : -1) };
  });
  function placePulse(p, i) {
    let d = ((p.d % p.total) + p.total) % p.total;
    let s = 0;
    while (s < p.lens.length - 1 && d > p.lens[s]) d -= p.lens[s++];
    const a = p.pts[s];
    const b = p.pts[s + 1];
    const f = d / p.lens[s];
    pulsePos[i * 3] = a[0] + (b[0] - a[0]) * f;
    pulsePos[i * 3 + 1] = 0.06;
    pulsePos[i * 3 + 2] = a[1] + (b[1] - a[1]) * f;
  }

  /* ---------- data tunnel below the chip ---------- */
  const streamCount = small ? 260 : 520;
  const streams = new InstancedMesh(
    new BoxGeometry(0.035, 1, 0.035),
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    streamCount,
  );
  streams.instanceMatrix.setUsage(DynamicDrawUsage);
  const streamData = Array.from({ length: streamCount }, (_, i) => {
    const a = Math.random() * Math.PI * 2;
    const r = rand(1.4, 5.5);
    const c = Math.random() < 0.18 ? ORANGE : Math.random() < 0.3 ? WHITE : CYAN;
    streams.setColorAt(i, c);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: -rand(1, TUNNEL_DEPTH), len: rand(0.4, 3.5), v: rand(4, 16) };
  });
  scene.add(streams);

  // square "layer" frames down the tunnel
  const frames = [];
  for (let i = 0; i < 22; i++) {
    const s = 3.2 + (i % 3) * 0.6;
    const geo = new BufferGeometry().setFromPoints([
      new Vector3(-s, 0, -s),
      new Vector3(s, 0, -s),
      new Vector3(s, 0, s),
      new Vector3(-s, 0, s),
    ]);
    const f = new LineLoop(
      geo,
      new LineBasicMaterial({ color: i % 5 === 0 ? ORANGE : CYAN, transparent: true, opacity: i % 5 === 0 ? 0.9 : 0.45 }),
    );
    f.position.y = -3 - i * 4;
    f.rotation.y = i * 0.18;
    frames.push(f);
    scene.add(f);
  }

  /* ---------- camera path (driven by scroll progress 0..1) ---------- */
  const keys = [
    // p, camera position, look target
    [0.0, [0, 16, 24], [0, 0, 0]],
    [0.28, [3, 6.5, 7], [0, 0, 0]],
    [0.42, [0, 2.2, 0.8], [0, 0, -0.4]],
    [0.5, [0, 0.35, 0.02], [0, -6, -0.3]],
    [1.0, [0, -TUNNEL_DEPTH + 8, 0], [0, -TUNNEL_DEPTH, -0.3]],
  ];
  const pos = new Vector3();
  const look = new Vector3();
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  function sample(p) {
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const [p0, c0, l0] = keys[i];
    const [p1, c1, l1] = keys[i + 1];
    const t = MathUtils.smoothstep(MathUtils.clamp((p - p0) / (p1 - p0), 0, 1), 0, 1);
    pos.copy(tmpA.fromArray(c0)).lerp(tmpB.fromArray(c1), t);
    look.copy(tmpA.fromArray(l0)).lerp(tmpB.fromArray(l1), t);
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let progress = 0;
  let shown = 0; // eased progress
  let cruise = 0; // 0..1 through the rest of the page, after the hero
  let cruiseShown = 0;
  let boost = 0; // scroll velocity kick
  let running = false;
  let raf = 0;
  let last = performance.now();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 72 : 55;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function update(dt, t) {
    shown += (progress - shown) * Math.min(1, dt * 6);
    cruiseShown += (cruise - cruiseShown) * Math.min(1, dt * 4);
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    // pulses
    for (let i = 0; i < pulseCount; i++) {
      const p = pulses[i];
      p.d += p.v * dt;
      placePulse(p, i);
    }
    pulseGeo.attributes.position.needsUpdate = true;

    // streams rush up the tunnel, always staying ahead of the camera
    streams.visible = shown > 0.45;
    const ceiling = Math.min(-3, camera.position.y - 2.5);
    const m = o;
    for (let i = 0; i < streamCount; i++) {
      const s = streamData[i];
      s.y += s.v * dt * (0.4 + shown + boost);
      // recycle before a streak gets close enough to fill the lens
      if (s.y > ceiling) s.y -= TUNNEL_DEPTH;
      m.position.set(s.x, s.y, s.z);
      m.rotation.set(0, 0, 0);
      m.scale.set(1, s.len, 1);
      m.updateMatrix();
      streams.setMatrixAt(i, m.matrix);
    }
    streams.instanceMatrix.needsUpdate = true;
    // layer frames rise past the camera and recycle below, so the tunnel never ends
    frames.forEach((f, i) => {
      f.rotation.y = i * 0.18 + t * 0.00015 * (i % 2 ? 1 : -1);
      if (shown > 0.5) {
        f.position.y += dt * (1.2 + boost * 3) * shown;
        if (f.position.y > camera.position.y - 1.5) f.position.y -= 88;
      }
    });
    boost *= Math.pow(0.04, dt);

    // the package "opens" as the camera reaches it, so we pass through cleanly
    const through = shown > 0.455;
    chip.visible = pins.visible = pulseLayer.visible = board.visible = !through;

    // camera
    sample(shown);
    const inside = MathUtils.smoothstep(shown, 0.45, 0.55);
    camera.position.copy(pos);
    camera.position.x += pointer.x * (1.2 - inside * 0.8);
    camera.position.z += pointer.y * (1.2 - inside * 0.8);
    camera.lookAt(look);
    // slow spiral once inside; keeps turning as you scroll the rest of the page
    camera.rotateZ(inside * shown * 2.4 + cruiseShown * Math.PI * 3);
    scene.fog.near = 8 - inside * 6;
    scene.fog.far = 46 - inside * 22;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt, now);
    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  // first frame immediately so the page never shows an empty canvas
  update(0, 0);
  renderer.render(scene, camera);

  return {
    setProgress(p) {
      progress = p;
      if (reduced) {
        shown = p;
        update(0, 0);
        renderer.render(scene, camera);
      }
    },
    setCruise(c) {
      cruise = c;
      if (reduced) {
        cruiseShown = c;
        update(0, 0);
        renderer.render(scene, camera);
      }
    },
    kick(v) {
      boost = Math.min(4, boost + Math.abs(v) * 0.002);
    },
    setPointer(x, y) {
      pointer.tx = x;
      pointer.ty = y;
    },
    setRunning(on) {
      if (reduced || on === running) return;
      running = on;
      if (on) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else cancelAnimationFrame(raf);
    },
  };
}
