// "Hello" journey: one three.js world behind the page.
//
// Start on the motherboard, dive into the chip (About comes up out of the die), pull out of the
// laptop to the Wi-Fi router (skills leave its antennas like payloads), into a row of memory
// (each project lifts out of a chip), up a tower of drawers (each step of the career slides out),
// and back to the laptop, where the contact form sits on its screen.
// The page's content is laid out over the scene by main.js: every card starts at the screen
// position of the thing it comes out of, then settles where it can be read.
//
// One number drives the camera: T (0 hero, 1 About … 5 Contact). main.js sets a target from the
// scroll position and the world eases towards it at a capped speed, so a fast flick of the wheel
// can't spin the view. Changes of place happen behind a short fade while the camera is still.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Fog,
  Color,
  Vector3,
  Vector4,
  Object3D,
  Group,
  Mesh,
  InstancedMesh,
  Points,
  Sprite,
  PlaneGeometry,
  BoxGeometry,
  CylinderGeometry,
  TorusGeometry,
  BufferGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  ShaderMaterial,
  MeshBasicMaterial,
  PointsMaterial,
  SpriteMaterial,
  UniformsUtils,
  UniformsLib,
  AdditiveBlending,
  NormalBlending,
  DynamicDrawUsage,
  MathUtils,
} from 'three';
import * as TX from '../textures.js';
import * as HX from './textures.js';
import { dwell, PLACE_CHANGES } from './schedule.js';

const { clamp, lerp, smoothstep } = MathUtils;
const sstep = (a, b, x) => smoothstep(x, a, b);
const ease = (x) => x * x * (3 - 2 * x);
const bump = (x, a, b, c, d) => Math.min(sstep(a, b, x), 1 - sstep(c, d, x));
const V = (a) => new Vector3(a[0], a[1], a[2]);

// Places sit far apart; only the one the camera is in is drawn.
const OFF = { room: 0, mem: 1000, tower: 2000 };
const at3 = (place, x, y, z) => [x + OFF[place], y, z];

/* ------------------------------------------------------------------ palette */
const KEYS = ['bg', 'board', 'pcb', 'body', 'slot', 'metal', 'gold', 'trace', 'hot', 'accent', 'silk', 'edge', 'die'];
const U = Object.fromEntries(KEYS.map((k) => [k, { value: new Color(0x000000) }]));
U.glow = { value: 0.8 };
U.edgeAmt = { value: 0.3 };

/* ------------------------------------------------------------------ shaders */
const VS = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vIC;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vIC = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vIC = instanceColor;
  #endif
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vN = normalize(mat3(modelMatrix) * n);
  vec4 mvPosition = modelViewMatrix * p;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS_HEAD = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vIC;
uniform vec3 uEdge; uniform float uEdgeAmt; uniform float uEdgeK; uniform float uOpacity;
#include <common>
#include <fog_pars_fragment>
float shade() { return 0.66 + 0.34 * clamp(dot(normalize(vN), normalize(vec3(0.45, 1.0, 0.6))), 0.0, 1.0); }
float edge() {
  vec2 d = min(vUv, 1.0 - vUv);
  vec2 fw = fwidth(vUv) * 1.3 + 1e-5;
  return 1.0 - min(smoothstep(0.0, fw.x, d.x), smoothstep(0.0, fw.y, d.y));
}`;
const FS_TAIL = /* glsl */ `
  c = mix(c, uEdge, edge() * uEdgeAmt * uEdgeK);
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const FS_SOLID = `${FS_HEAD}
uniform vec3 uColor; uniform vec3 uEmit; uniform float uEmitAmt;
void main() {
  vec3 c = uColor * vIC * shade();
  c = mix(c, uEmit, uEmitAmt);
${FS_TAIL}`;
const FS_CHANNEL = `${FS_HEAD}
uniform sampler2D uMap; uniform vec3 uBase, uC1, uC2, uC3; uniform vec3 uK; uniform float uGlow;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec3 c = uBase * shade();
  c = mix(c, uC3, clamp(t.b * uK.z, 0.0, 1.0));
  c = mix(c, uC1, clamp(t.r * uK.x * uGlow, 0.0, 1.0));
  c = mix(c, uC2, clamp(t.g * uK.y * uGlow, 0.0, 1.0));
${FS_TAIL}`;
// Full-screen veil in the page colour, used for the place changes and jumps.
const VS_VEIL = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// It is also the "iris" for changes of place: a rounded box in the page colour grows out of a
// part in one place until it fills the screen (cover), then a window opens out of a matching
// part in the next place (reveal). uRect: centre and half-size in device pixels.
const FS_VEIL = /* glsl */ `
uniform vec3 uColor; uniform vec3 uRim; uniform float uOpacity;
uniform float uIris; uniform float uMode; uniform float uR; uniform float uRimAmt; uniform vec4 uRect;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float a = uOpacity;
  float rim = 0.0;
  if (uIris > 0.5) {
    float d = sdBox(gl_FragCoord.xy - uRect.xy, uRect.zw, uR);
    float inside = 1.0 - smoothstep(-1.5, 1.5, d);
    a = max(a, uMode < 0.5 ? inside : 1.0 - inside);
    rim = (1.0 - smoothstep(0.0, 2.0, abs(d))) * uRimAmt;
  }
  gl_FragColor = vec4(mix(uColor, uRim, rim), max(a, rim));
  #include <colorspace_fragment>
}`;

const fogU = () => UniformsUtils.clone(UniformsLib.fog);

function solid(key, { edge = 1, opacity = 1, transparent = false, emit = 'hot' } = {}) {
  return new ShaderMaterial({
    uniforms: {
      ...fogU(),
      uColor: U[key],
      uEmit: U[emit],
      uEmitAmt: { value: 0 },
      uEdge: U.edge,
      uEdgeAmt: U.edgeAmt,
      uEdgeK: { value: edge },
      uOpacity: { value: opacity },
    },
    vertexShader: VS,
    fragmentShader: FS_SOLID,
    fog: true,
    transparent,
  });
}
function channel(map, base, { c1 = 'trace', c2 = 'accent', c3 = 'silk', k = [1, 1, 1], edge = 0, transparent = false } = {}) {
  return new ShaderMaterial({
    uniforms: {
      ...fogU(),
      uMap: { value: map },
      uBase: U[base],
      uC1: U[c1],
      uC2: U[c2],
      uC3: U[c3],
      uK: { value: new Vector3(...k) },
      uGlow: U.glow,
      uEdge: U.edge,
      uEdgeAmt: U.edgeAmt,
      uEdgeK: { value: edge },
      uOpacity: { value: 1 },
    },
    vertexShader: VS,
    fragmentShader: FS_CHANNEL,
    fog: true,
    transparent,
  });
}
const dummy = new Object3D();
function place(mesh, i, pos, scale = [1, 1, 1], rotY = 0) {
  dummy.position.set(pos[0], pos[1], pos[2]);
  dummy.rotation.set(0, rotY, 0);
  dummy.scale.set(scale[0], scale[1], scale[2]);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}
function boxes(list, mat) {
  const m = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, list.length);
  list.forEach(([p, s], i) => place(m, i, p, s));
  m.instanceMatrix.needsUpdate = true;
  return m;
}

/* Camera paths: CatmullRom for position and look target, remapped so perceived speed is even
   (distance moved ÷ distance to the subject, plus change in log distance when pulling back). */
function camPath(pos, look) {
  const pc = new CatmullRomCurve3(pos.map(V), false, 'centripetal');
  const lc = new CatmullRomCurve3(look.map(V), false, 'centripetal');
  const N = 200;
  const cum = new Float32Array(N + 1);
  const a = new Vector3();
  const b = new Vector3();
  const la = new Vector3();
  const lb = new Vector3();
  pc.getPoint(0, a);
  lc.getPoint(0, la);
  for (let i = 1; i <= N; i++) {
    pc.getPoint(i / N, b);
    lc.getPoint(i / N, lb);
    const d0 = a.distanceTo(la) || 1e-3;
    const d1 = b.distanceTo(lb) || 1e-3;
    const dm = (d0 + d1) / 2;
    cum[i] = cum[i - 1] + a.distanceTo(b) / dm + (0.5 * la.distanceTo(lb)) / dm + Math.abs(Math.log(d1 / d0)) + 1e-5;
    a.copy(b);
    la.copy(lb);
  }
  for (let i = 0; i <= N; i++) cum[i] /= cum[N];
  return (p, outP, outL) => {
    p = clamp(p, 0, 1);
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < p) lo = mid;
      else hi = mid;
    }
    const u = (lo + (p - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])) / N;
    pc.getPoint(u, outP);
    lc.getPoint(u, outL);
  };
}

/* ================================================================== WORLD */
// Named points that content comes out of. The page asks for their screen position every frame.
export const SOURCES = ['die', 'router', 'ant0', 'ant1', 'ant2', 'dimm', 'chip0', 'chip1', 'chip2', 'chip3', 'chip4', 'tower', 'drawer0', 'drawer1', 'drawer2', 'drawer3', 'drawer4', 'beacon', 'screen'];

export function createWorld(canvas, { mobile = false, still = false, workN = 6, expN = 7 } = {}) {
  // High-density screens already look smooth, so they skip multisampling (the costliest part of
  // a frame there). The resolution starts at 1.5× at most and the governor below moves it.
  const deviceDpr = window.devicePixelRatio || 1;
  const renderer = new WebGLRenderer({ canvas, antialias: deviceDpr < 1.5, powerPreference: 'high-performance' });
  const dprMax = Math.min(deviceDpr, 1.5);
  const dprMin = Math.min(deviceDpr, mobile ? 0.75 : 0.85);
  let dpr = Math.min(dprMax, (innerWidth * innerHeight * dprMax * dprMax) > 3.2e6 ? 1.25 : dprMax);
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  scene.fog = new Fog(0x000000, 10, 50);
  scene.background = U.bg.value;
  const camera = new PerspectiveCamera(48, 1, 0.1, 3000);

  const W = { room: new Group(), mem: new Group(), tower: new Group() };
  Object.entries(W).forEach(([k, g]) => {
    g.position.x = OFF[k];
    scene.add(g);
  });
  const glowTex = TX.glowTexture();
  const level = Object.fromEntries(SOURCES.map((s) => [s, 0])); // how far each source's content is out (0..1)

  /* ================================================================ ROOM */
  // The motherboard of the hero, inside a laptop on a desk, with a Wi-Fi router beside it.
  const R = W.room;
  const traces = TX.makeTraces(mobile ? 80 : 140);
  const boardTex = TX.boardTexture(traces, mobile ? 1024 : 2048);
  const board = new Mesh(new PlaneGeometry(TX.BOARD, TX.BOARD), channel(boardTex, 'board', { k: [1, 1, 0.55] }));
  board.rotation.x = -Math.PI / 2;
  R.add(board);
  const substrate = new Mesh(new BoxGeometry(6, 0.18, 6), solid('pcb'));
  substrate.position.y = 0.09;
  const dieMat = channel(TX.dieTexture(mobile ? 1024 : 2048), 'die', { k: [1, 1, 0.8] });
  const die = new Mesh(new PlaneGeometry(4.4, 4.4), dieMat);
  die.rotation.x = -Math.PI / 2;
  die.position.y = 0.185;
  const lidMat = solid('body', { transparent: true });
  const lid = new Mesh(new BoxGeometry(5.2, 0.15, 5.2), lidMat);
  lid.position.y = 0.255;
  const lidTopMat = channel(TX.lidTexture(), 'body', { k: [0.8, 1, 0.9], transparent: true });
  const lidTop = new Mesh(new PlaneGeometry(5.2, 5.2), lidTopMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.3315;
  R.add(substrate, die, lid, lidTop);
  const parts = [
    [[0, 0.05, -3.25], [6.9, 0.1, 0.35]],
    [[0, 0.05, 3.25], [6.9, 0.1, 0.35]],
    [[-3.25, 0.05, 0], [0.35, 0.1, 6.15]],
    [[3.25, 0.05, 0], [0.35, 0.1, 6.15]],
    [[-7.25, 0.17, 10], [0.7, 0.34, 3.2]],
    [[-9.4, 0.24, 10], [1.5, 0.12, 1.5]],
    [[-12.0, 0.27, 10], [2.0, 0.18, 2.2]],
    [[-15.0, 0.27, 10], [2.0, 0.18, 2.2]],
    [[18, 0.6, -18], [2.0, 1.2, 2.4]],
    [[9.2, 0.25, 0], [3.4, 0.3, 19.5]],
    [[13.2, 0.25, 0], [3.4, 0.3, 19.5]],
  ];
  for (let i = 0; i < 6; i++) parts.push([[-3.75 + i * 1.5, 0.35, -5.2], [1.1, 0.7, 1.1]]);
  const capR = TX.rng(5);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 4.3 + capR() * 0.6;
    parts.push([[Math.cos(a) * r, 0.08, Math.sin(a) * r], [0.3, 0.16, 0.18]]);
  }
  R.add(boxes(parts, solid('body')));
  const ssd = new Mesh(new BoxGeometry(10.7, 0.12, 2.9), channel(TX.ssdTexture(), 'pcb', { c3: 'gold', edge: 0.6 }));
  ssd.position.set(-13, 0.12, 10);
  R.add(ssd);

  const pulseCount = mobile ? 120 : 240;
  const pulseGeo = new BufferGeometry();
  const pulsePos = new Float32Array(pulseCount * 3);
  pulseGeo.setAttribute('position', new BufferAttribute(pulsePos, 3).setUsage(DynamicDrawUsage));
  const pulseMat = new PointsMaterial({ size: mobile ? 0.36 : 0.26, map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true });
  const pulseLayer = new Points(pulseGeo, pulseMat);
  R.add(pulseLayer);
  const pr = TX.rng(3);
  const pulses = Array.from({ length: pulseCount }, () => {
    const pts = traces[(pr() * traces.length) | 0];
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(l);
      total += l;
    }
    return { pts, lens, total, d: pr() * total, v: (2 + pr() * 5) * (pr() < 0.5 ? 1 : -1) };
  });
  function placePulses(dt) {
    for (let i = 0; i < pulseCount; i++) {
      const p = pulses[i];
      p.d += p.v * dt;
      let d = ((p.d % p.total) + p.total) % p.total;
      let s = 0;
      while (s < p.lens.length - 1 && d > p.lens[s]) d -= p.lens[s++];
      const a = p.pts[s];
      const b = p.pts[s + 1];
      const f = d / p.lens[s];
      pulsePos[i * 3] = a[0] + (b[0] - a[0]) * f;
      pulsePos[i * 3 + 1] = 0.07;
      pulsePos[i * 3 + 2] = a[1] + (b[1] - a[1]) * f;
    }
    pulseGeo.attributes.position.needsUpdate = true;
  }
  placePulses(0);

  // laptop: open-topped shell around the board; deck and screen close over it when we pull out
  R.add(
    boxes(
      [
        [[0, -0.6, 0], [64, 0.8, 46]],
        [[0, 0.8, -23], [64, 2.8, 0.6]],
        [[0, 0.8, 23], [64, 2.8, 0.6]],
        [[-32, 0.8, 0], [0.6, 2.8, 46]],
        [[32, 0.8, 0], [0.6, 2.8, 46]],
      ],
      solid('body', { edge: 1.2 }),
    ),
  );
  const deckMat = channel(HX.keyboardTexture(), 'body', { c1: 'edge', c2: 'trace', k: [0.9, 1, 1], edge: 1.2, transparent: true });
  const deck = new Mesh(new PlaneGeometry(64, 46), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 2.22;
  R.add(deck);
  const screen = new Group();
  screen.position.set(0, 2.2, -23);
  screen.rotation.x = -0.24;
  const screenBackMat = solid('body', { edge: 1.2, transparent: true });
  const screenBack = new Mesh(new BoxGeometry(64, 42, 0.9), screenBackMat);
  screenBack.position.set(0, 21, -0.5);
  const displayMat = channel(HX.screenTexture(), 'die', { c1: 'trace', c2: 'hot', c3: 'silk', k: [0.9, 1, 0.9], transparent: true });
  const display = new Mesh(new PlaneGeometry(60, 38), displayMat);
  display.position.set(0, 21, 0.01);
  screen.add(screenBack, display);
  R.add(screen);
  R.updateMatrixWorld(true);
  const screenAt = (x, y) => display.localToWorld(new Vector3(x, y, 0));
  const SCREEN = { c: screenAt(0, 0), corners: [screenAt(-30, 19), screenAt(30, 19), screenAt(30, -19), screenAt(-30, -19)] };

  const desk = new Mesh(new PlaneGeometry(700, 340), channel(HX.deskTexture(), 'board', { c1: 'edge', k: [0.6, 0, 0] }));
  desk.rotation.x = -Math.PI / 2;
  desk.position.set(40, -1.02, -20);
  R.add(desk);
  const wall = new Mesh(new PlaneGeometry(900, 420), solid('pcb', { edge: 0 }));
  wall.position.set(40, 150, -190);
  R.add(wall);
  const city = new Mesh(new PlaneGeometry(300, 150), channel(HX.skylineTexture(), 'die', { c1: 'trace', c2: 'hot', c3: 'body', k: [0.9, 1, 1] }));
  city.position.set(10, 75, -189);
  R.add(city);
  R.add(
    boxes(
      [
        [[10, 151, -188.5], [306, 3, 2]],
        [[10, -1, -188.5], [306, 3, 2]],
        [[-143, 75, -188.5], [3, 155, 2]],
        [[163, 75, -188.5], [3, 155, 2]],
        [[10, 75, -188.5], [2, 152, 2]],
      ],
      solid('metal', { edge: 0.6 }),
    ),
  );

  // Wi-Fi router: skills come out of its antennas
  const ROUTER = [60, 0, -12];
  const router = new Group();
  router.position.set(...ROUTER);
  const routerBody = new Mesh(new BoxGeometry(22, 3.6, 13), solid('body', { edge: 1.4 }));
  routerBody.position.y = 0.8;
  router.add(routerBody);
  const antennaMat = solid('body', { edge: 1 });
  const antTips = [];
  [-8, 0, 8].forEach((x, i) => {
    const a = new Mesh(new CylinderGeometry(0.55, 0.7, 13, 10), antennaMat);
    a.position.set(x, 8.5, -5.6);
    a.rotation.z = (i - 1) * 0.16;
    router.add(a);
    antTips.push(new Vector3(ROUTER[0] + x - Math.sin((i - 1) * 0.16) * 6.5, 15, ROUTER[2] - 5.6));
  });
  const ledMat = solid('trace', { edge: 0 });
  router.add(boxes(Array.from({ length: 6 }, (_, i) => [[-6 + i * 2.4, 1.2, 6.55], [0.9, 0.5, 0.1]]), ledMat));
  R.add(router);
  const tipMat = new SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const tips = antTips.map((p) => {
    const s = new Sprite(tipMat.clone());
    s.position.copy(p);
    R.add(s);
    return s;
  });
  const ringMat = solid('trace', { edge: 0, transparent: true });
  ringMat.depthWrite = false;
  const rings = [0, 1, 2].map(() => {
    const m = new Mesh(new TorusGeometry(1, 0.045, 6, 64), ringMat.clone());
    m.material.uniforms.uColor = U.trace;
    m.position.set(ROUTER[0], 10, ROUTER[2]);
    R.add(m);
    return m;
  });

  /* ================================================================ MEMORY */
  // Two memory sticks, magnified. Each project comes out of one of the chips.
  const Mm = W.mem;
  const memBoard = new Mesh(new PlaneGeometry(TX.BOARD, TX.BOARD), channel(boardTex, 'board', { k: [1, 1, 0.55] }));
  memBoard.rotation.x = -Math.PI / 2;
  Mm.add(memBoard);
  const DIMM_X = [8.5, 10];
  const CHIP_Z = Array.from({ length: 8 }, (_, i) => -7.7 + i * 2.2);
  const PROJECT_CHIP = [0, 2, 3, 5, 7];
  const chipList = [];
  DIMM_X.forEach((x) => [-1, 1].forEach((s) => CHIP_Z.forEach((z) => chipList.push([[x + s * 0.125, 2.7, z], [0.15, 1.2, 1.6]]))));
  Mm.add(boxes([...chipList, [[8.5, 0.3, 0], [0.5, 0.6, 20.4]], [[10, 0.3, 0], [0.5, 0.6, 20.4]]], solid('body')));
  const dimmMat = channel(TX.dimmTexture(), 'pcb', { c3: 'gold', edge: 0.7 });
  DIMM_X.forEach((x) => {
    const pcb = new Mesh(new BoxGeometry(0.1, 4.5, 19.5), dimmMat);
    pcb.position.set(x, 2.6, 0);
    Mm.add(pcb);
  });
  const decalMat = new MeshBasicMaterial({ map: TX.dramDecal(), transparent: true, depthWrite: false, fog: true });
  const decals = new InstancedMesh(new PlaneGeometry(1.42, 1.04), decalMat, 8);
  CHIP_Z.forEach((z, i) => place(decals, i, [8.5 - 0.202, 2.7, z], [1, 1, 1], -Math.PI / 2));
  const decalCol = new Color();
  decals.setColorAt(0, decalCol);
  Mm.add(decals);
  // the "plate" that lifts out of a chip as its project comes out
  const plateMat = solid('hot', { edge: 0, transparent: true });
  plateMat.uniforms.uEmitAmt.value = 0.5;
  plateMat.depthWrite = false;
  const plate = new Mesh(new BoxGeometry(0.05, 1.04, 1.42), plateMat);
  Mm.add(plate);
  const chipPos = (i) => new Vector3(OFF.mem + 8.5 - 0.25, 2.7, CHIP_Z[PROJECT_CHIP[i]]);

  /* ================================================================ TOWER */
  // A tall stack of units. Each step of the career slides out of it like a drawer.
  const Tw = W.tower;
  const floorTex = HX.floorTexture();
  floorTex.repeat.set(30, 30);
  const floor = new Mesh(new PlaneGeometry(400, 400), channel(floorTex, 'board', { c1: 'edge', k: [0.8, 0, 0] }));
  floor.rotation.x = -Math.PI / 2;
  Tw.add(floor);
  const UNITS = 26;
  const UH = 2.4;
  const unitY = (i) => 1.3 + i * UH;
  const JOB_U = [3, 7, 11, 15, 19];
  const units = [];
  for (let i = 0; i < UNITS; i++) if (!JOB_U.includes(i)) units.push([[0, unitY(i), 0], [16, UH - 0.2, 10]]);
  Tw.add(boxes(units, solid('body', { edge: 1.3 })));
  const unitDecalTex = HX.unitDecal();
  const unitDecals = new InstancedMesh(new PlaneGeometry(15.4, 2.0), new MeshBasicMaterial({ map: unitDecalTex, transparent: true, depthWrite: false, fog: true }), UNITS);
  for (let i = 0; i < UNITS; i++) place(unitDecals, i, [0, unitY(i), JOB_U.includes(i) ? -99 : 5.02], JOB_U.includes(i) ? [0, 0, 0] : [1, 1, 1]);
  unitDecals.setColorAt(0, decalCol);
  Tw.add(unitDecals);
  const drawerMats = JOB_U.map(() => solid('body', { edge: 1.6 }));
  const drawerFrontMat = new MeshBasicMaterial({ map: unitDecalTex, transparent: true, depthWrite: false, fog: true });
  const drawers = JOB_U.map((u, i) => {
    const g = new Group();
    g.position.set(0, unitY(u), 0);
    g.add(new Mesh(new BoxGeometry(15.4, UH - 0.3, 10), drawerMats[i]));
    const front = new Mesh(new PlaneGeometry(15, 1.9), drawerFrontMat.clone());
    front.position.z = 5.02;
    g.add(front);
    g.userData.front = front;
    Tw.add(g);
    return g;
  });
  const TOP = unitY(UNITS - 1) + UH / 2;
  const mast = new Mesh(new CylinderGeometry(0.3, 0.5, 9, 8), solid('metal', { edge: 0.6 }));
  mast.position.set(0, TOP + 4.5, 0);
  Tw.add(mast);
  const beaconMat = new SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const beacon = new Sprite(beaconMat);
  beacon.position.set(0, TOP + 9.4, 0);
  Tw.add(beacon);
  // distant towers for depth as we rise
  const farR = TX.rng(41);
  const far = [];
  for (let i = 0; i < 18; i++) {
    const h = 20 + farR() * 70;
    const x = (farR() < 0.5 ? -1 : 1) * (28 + farR() * 90);
    far.push([[x, h / 2, -30 - farR() * 120], [8 + farR() * 10, h, 8 + farR() * 10]]);
  }
  Tw.add(boxes(far, solid('pcb', { edge: 1 })));
  const drawerPos = (i) => new Vector3(OFF.tower, unitY(JOB_U[i]), 5.2 + level[`drawer${i}`] * 4.5);
  const towerY = (idx) => {
    // camera height for item idx: 0 heading (low), 1–5 jobs, 6 quotes (top)
    const ys = [6, ...JOB_U.map(unitY), TOP + 6];
    const i = clamp(Math.floor(idx), 0, ys.length - 2);
    return lerp(ys[i], ys[i + 1], clamp(idx - i, 0, 1));
  };

  /* ================================================================ guide spark + veil */
  const sparkMat = new SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, fog: false });
  const spark = new Sprite(sparkMat);
  spark.renderOrder = 10;
  scene.add(spark);
  const veilMat = new ShaderMaterial({ uniforms: { uColor: U.bg, uRim: U.trace, uOpacity: { value: 0 }, uIris: { value: 0 }, uMode: { value: 0 }, uR: { value: 0 }, uRimAmt: { value: 0 }, uRect: { value: new Vector4() } }, vertexShader: VS_VEIL, fragmentShader: FS_VEIL, transparent: true, depthTest: false, depthWrite: false });
  const veil = new Mesh(new PlaneGeometry(2, 2), veilMat);
  veil.frustumCulled = false;
  veil.renderOrder = 100;
  scene.add(veil);

  /* ================================================================ camera rig */
  const memZ = (idx) => {
    const zs = [CHIP_Z[0] - 2.2, ...PROJECT_CHIP.map((c) => CHIP_Z[c])];
    const i = clamp(Math.floor(idx), 0, zs.length - 2);
    return lerp(zs[i], zs[i + 1], clamp(idx - i, 0, 1));
  };
  const ST = [
    () => [[1.5, 21, 25], [0.5, 0, -1]],
    (L) => [[lerp(0.6, 0.3, L), lerp(6.4, 5.2, L), lerp(4.8, 3.8, L)], [0, 0.18, -0.1]],
    (L) => [[lerp(42, 45, L), lerp(22, 20, L), lerp(50, 44, L)], [58, lerp(7, 8, L), -12]],
    (L) => {
      const z = memZ(dwell(L, workN));
      return [at3('mem', 2.6, 3.9, z - 1.8), at3('mem', 8.4, 2.6, z)];
    },
    (L) => {
      const y = towerY(dwell(L, expN));
      return [at3('tower', 9, y + 3, 42), at3('tower', 0, y, 0)];
    },
    (L) => [[0, lerp(36.5, 34.6, L), lerp(28, 20.5, L)], [SCREEN.c.x, SCREEN.c.y, SCREEN.c.z]],
  ];
  const at = (k, L) => ST[k](L);
  const SEAMS = [
    [{ a: 0, b: 1, w: 'room', path: camPath([[1.5, 21, 25], [1.4, 12, 14], [0.9, 8, 7.5], at(1, 0)[0]], [[0.5, 0, -1], [0.3, 0, -0.5], [0.05, 0.1, -0.2], at(1, 0)[1]]) }],
    // pull straight up out of the chip to a wide shot of laptop and router, then push in to the router
    [{ a: 0, b: 1, w: 'room', path: camPath([at(1, 1)[0], [0.4, 14, 9], [12, 34, 64], [34, 40, 92], [40, 28, 64], at(2, 0)[0]], [at(1, 1)[1], [0.2, 0, -1.5], [14, 4, -6], [44, 5, -9], [54, 6, -11], at(2, 0)[1]]) }],
    [
      { a: 0, b: 0.5, w: 'room', path: camPath([at(2, 1)[0], [48, 19, 38]], [at(2, 1)[1], [62, 9, -14]]) },
      // arrive by pushing straight in along the view (no turning), out of the first chip
      { a: 0.5, b: 1, w: 'mem', path: (() => { const [p1, l1] = at(3, 0); const d = [p1[0] - l1[0], p1[1] - l1[1], p1[2] - l1[2]]; return camPath([[p1[0] + d[0] * 1.6, p1[1] + d[1] * 1.6, p1[2] + d[2] * 1.6], [p1[0] + d[0] * 0.6, p1[1] + d[1] * 0.6, p1[2] + d[2] * 0.6], p1], [l1, l1, l1]); })() },
    ],
    [
      { a: 0, b: 0.5, w: 'mem', path: camPath([at(3, 1)[0], at3('mem', 3.4, 4.2, CHIP_Z[7] + 1.5)], [at(3, 1)[1], at3('mem', 8.4, 2.8, CHIP_Z[7] + 3)]) },
      { a: 0.5, b: 1, w: 'tower', path: camPath([at3('tower', 16, 2, 70), at3('tower', 12, 4, 54), at(4, 0)[0]], [at3('tower', 0, 10, 0), at3('tower', 0, 8, 0), at(4, 0)[1]]) },
    ],
    [
      { a: 0, b: 0.5, w: 'tower', path: camPath([at(4, 1)[0], at3('tower', 9, TOP + 14, 40)], [at(4, 1)[1], at3('tower', 0, TOP + 9, 0)]) },
      { a: 0.5, b: 1, w: 'room', path: camPath([[8, 62, 96], [3, 48, 66], at(5, 0)[0]], [[0, 18, -28], [0, 21, -28], at(5, 0)[1]]) },
    ],
  ];
  // the matching parts each change of place zooms through: [outgoing, incoming], as world-space quads
  const quadXY = (x0, x1, y0, y1, z) => [new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)];
  const quadZY = (x, z0, z1, y0, y1) => [new Vector3(x, y0, z0), new Vector3(x, y0, z1), new Vector3(x, y1, z1), new Vector3(x, y1, z0)];
  const chipQuad = (c) => quadZY(OFF.mem + 8.5 - 0.202, CHIP_Z[c] - 0.71, CHIP_Z[c] + 0.71, 2.18, 3.22);
  const unitQuad = (u) => quadXY(OFF.tower - 7.7, OFF.tower + 7.7, unitY(u) - 1, unitY(u) + 1, 5.02);
  // keys are PLACE_CHANGES
  const IRIS = {
    2: [quadXY(ROUTER[0] - 11, ROUTER[0] + 11, -1, 2.6, ROUTER[2] + 6.5), chipQuad(0)], // router → first memory chip
    3: [chipQuad(7), unitQuad(0)], // last memory chip → the tower's bottom unit
    4: [unitQuad(UNITS - 1), SCREEN.corners], // the tower's top unit → the laptop screen
  };

  /* ================================================================ state */
  // what to draw; set every frame by the page's player (see player.js)
  const S = { T: 0, L: [0, 0, 0, 0, 0, 0], irisF: null, jumpVeil: 0, calm: still, sendBack: null };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const view = { w: 1, h: 1 };
  const P = new Vector3();
  const Lk = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  let place_ = 'room';
  let dirty = true;
  let running = true;
  let lastRender = 0;
  let anim = 0;
  let clock = 0;
  const costs = [];
  let prevFrame = 0;

  function cameraFor(T, outP, outL) {
    const k = Math.min(5, Math.floor(T));
    const p = T - k;
    if (k >= 5 || p < 1e-6) {
      const [a, b] = at(k, S.L[k]);
      outP.fromArray(a);
      outL.fromArray(b);
      return { w: ['room', 'room', 'room', 'mem', 'tower', 'room'][k], veil: 0, k, p: 0 };
    }
    const phases = SEAMS[k];
    const ph = phases.find((x) => p >= x.a && p < x.b) || phases[phases.length - 1];
    const lq = (p - ph.a) / (ph.b - ph.a);
    ph.path(lq, outP, outL);
    if (ph === phases[0] && k >= 1) {
      const wgt = 1 - sstep(0, 0.5, lq);
      if (wgt > 0) {
        outP.add(tmp.fromArray(at(k, S.L[k])[0]).sub(tmp2.fromArray(at(k, 1)[0])).multiplyScalar(wgt));
        outL.add(tmp.fromArray(at(k, S.L[k])[1]).sub(tmp2.fromArray(at(k, 1)[1])).multiplyScalar(wgt));
      }
    }
    if (ph === phases[phases.length - 1]) {
      const wgt = sstep(0.5, 1, lq);
      if (wgt > 0) {
        outP.add(tmp.fromArray(at(k + 1, S.L[k + 1])[0]).sub(tmp2.fromArray(at(k + 1, 0)[0])).multiplyScalar(wgt));
        outL.add(tmp.fromArray(at(k + 1, S.L[k + 1])[1]).sub(tmp2.fromArray(at(k + 1, 0)[1])).multiplyScalar(wgt));
      }
    }
    return { w: ph.w, k, p };
  }

  // world position of a named source
  function sourcePos(name, out) {
    if (name === 'die') return out.set(0, 0.25, 0);
    if (name === 'router') return out.set(ROUTER[0], 6, ROUTER[2]);
    if (name.startsWith('ant')) return out.copy(antTips[+name[3]]);
    if (name === 'dimm') return out.set(OFF.mem + 8.5, 4.9, CHIP_Z[0]);
    if (name.startsWith('chip')) return out.copy(chipPos(+name[4]));
    if (name === 'tower') return out.set(OFF.tower, 4, 5.2);
    if (name.startsWith('drawer')) return out.copy(drawerPos(+name[6]));
    if (name === 'beacon') return out.copy(beacon.position).add(tmp2.set(OFF.tower, 0, 0));
    if (name === 'screen') return out.copy(SCREEN.c);
    return out.set(0, 0, 0);
  }

  /* ---------------- theme ---------------- */
  let dark = true;
  const themeOpts = { glowRest: 0.55, fogK: 1 };
  const theme = { t: 1, dur: 0.4, start: 0, from: null, to: null };
  const additive = [sparkMat, pulseMat, beaconMat, ...tips.map((t) => t.material)];
  function applyBlend() {
    additive.forEach((m) => {
      m.blending = dark ? AdditiveBlending : NormalBlending;
      m.needsUpdate = true;
    });
  }
  function stepTheme(now) {
    if (!theme.to || theme.t >= 1) return;
    theme.t = theme.dur > 0 ? Math.min(1, (now - theme.start) / (theme.dur * 1000)) : 1;
    const e = ease(theme.t);
    KEYS.forEach((key) => U[key].value.copy(theme.from[key]).lerp(theme.to[key], e));
    U.edgeAmt.value = lerp(theme.edgeFrom, theme.edgeTo, e);
    if (theme.t < 1) anim = Math.max(anim, 0.05);
  }

  const qv = new Vector3();
  function quadRect(q) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    q.forEach((c) => {
      qv.copy(c).project(camera);
      const x = (qv.x * 0.5 + 0.5) * view.w;
      const y = (-qv.y * 0.5 + 0.5) * view.h;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    });
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: Math.max(2, (x1 - x0) / 2), hh: Math.max(2, (y1 - y0) / 2) };
  }

  /* ================================================================ update */
  function update(dt) {
    const T = S.T;
    const cam = cameraFor(T, P, Lk);
    const { k, p, w } = cam;
    place_ = w;
    Object.entries(W).forEach(([key, g]) => (g.visible = key === w));
    clock += dt;

    // ---------- room ----------
    const pulsesOn = !S.calm && T < 0.9;
    pulseLayer.visible = pulsesOn && w === 'room';
    if (pulsesOn && dt > 0) placePulses(dt);
    // the lid lifts away as we dive into the chip, and is back once we've left
    const lidA = T < 1.2 ? 1 - sstep(0.45, 0.8, T) : sstep(1.2, 1.45, T);
    lidMat.uniforms.uOpacity.value = lidTopMat.uniforms.uOpacity.value = lidA;
    lid.visible = lidTop.visible = lidA > 0.01;
    lidMat.depthWrite = lidTopMat.depthWrite = lidA > 0.99;
    dieMat.uniforms.uK.value.set(1 + level.die * 0.6, 1 + level.die, 0.8);
    // the deck and screen close over the board once we're out of the laptop
    const out = T < 1.1 ? 0 : sstep(1.1, 1.45, T);
    deckMat.uniforms.uOpacity.value = out;
    deck.visible = out > 0.01;
    deckMat.depthWrite = out > 0.99;
    screenBackMat.uniforms.uOpacity.value = displayMat.uniforms.uOpacity.value = out;
    // the screen clears while the contact card sits on it
    displayMat.uniforms.uK.value.setScalar(0.9 * (1 - level.screen));
    screen.visible = out > 0.01;
    screenBackMat.depthWrite = displayMat.depthWrite = out > 0.99;
    // router: rings roll out, each antenna glows while a skill leaves it
    const atRouter = w === 'room' && T > 1.4 && T < 2.6;
    ledMat.uniforms.uEmitAmt.value = atRouter ? 0.7 : 0.2;
    rings.forEach((m, i) => {
      m.visible = atRouter && !S.calm;
      if (!m.visible) return;
      const f = (clock * 0.35 + i / 3) % 1;
      m.scale.setScalar(1.5 + f * 9);
      m.material.uniforms.uOpacity.value = (1 - f) * 0.6 * sstep(1.4, 1.8, T);
      m.lookAt(camera.position);
    });
    if (atRouter && !S.calm) anim = Math.max(anim, 0.05);
    tips.forEach((s, i) => {
      const v = level[`ant${i}`];
      s.visible = atRouter;
      s.material.opacity = 0.35 + 0.65 * v;
      s.scale.setScalar(1.6 + v * 2.4);
      s.material.color.copy(U.hot.value);
    });

    // ---------- memory: the chip lights and a plate lifts out of it ----------
    let plateOn = -1;
    for (let i = 0; i < 8; i++) {
      const pi = PROJECT_CHIP.indexOf(i);
      const v = pi >= 0 ? level[`chip${pi}`] : 0;
      if (v > 0.02 && (plateOn < 0 || v > level[`chip${plateOn}`])) plateOn = pi;
      decalCol.copy(U.trace.value).multiplyScalar(0.35 + 0.25 * U.glow.value).lerp(U.hot.value, clamp(v, 0, 1));
      decals.setColorAt(i, decalCol);
    }
    decals.instanceColor.needsUpdate = true;
    plate.visible = plateOn >= 0 && !S.calm;
    if (plate.visible) {
      const v = level[`chip${plateOn}`];
      plate.position.set(8.5 - 0.24, 2.7 + v * 2.6, CHIP_Z[PROJECT_CHIP[plateOn]]);
      plateMat.uniforms.uOpacity.value = clamp(v * (1 - v) * 4, 0, 1) * 0.6;
    }

    // ---------- tower: the drawer slides out ----------
    drawers.forEach((g, i) => {
      const v = level[`drawer${i}`];
      g.position.z = v * 4.5;
      drawerMats[i].uniforms.uEmitAmt.value = v * 0.3;
      g.userData.front.material.color.copy(U.trace.value).multiplyScalar(0.4).lerp(U.hot.value, v);
    });
    for (let i = 0; i < UNITS; i++) {
      decalCol.copy(U.trace.value).multiplyScalar(0.3 + 0.2 * U.glow.value);
      unitDecals.setColorAt(i, decalCol);
    }
    unitDecals.instanceColor.needsUpdate = true;
    beaconMat.color.copy(U.hot.value);
    beacon.scale.setScalar(3 + level.beacon * 5);
    beaconMat.opacity = 0.5 + 0.5 * level.beacon;

    // ---------- the spark: it sits on whatever is giving out content right now ----------
    let best = null;
    let bv = 0.04;
    SOURCES.forEach((s) => {
      const v = level[s];
      const glow = v * (1 - v) * 4; // brightest mid-way out
      if (glow > bv) {
        bv = glow;
        best = s;
      }
    });
    if (S.sendBack != null) {
      // a sent message: out of the screen, back into the laptop
      const f = S.sendBack;
      spark.position.copy(SCREEN.c).lerp(tmp.set(0, 3, 0), ease(f));
      sparkMat.opacity = Math.sin(Math.PI * f);
      spark.scale.setScalar(3);
      spark.visible = true;
    } else if (best && !S.calm) {
      sourcePos(best, spark.position);
      sparkMat.opacity = bv;
      spark.scale.setScalar(P.distanceTo(spark.position) * 0.06);
      spark.visible = true;
    } else spark.visible = false;
    sparkMat.color.copy(U.hot.value);
    pulseMat.color.copy(U.trace.value);

    // ---------- camera ----------
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4 || 1);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4 || 1);
    if (Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.002) anim = Math.max(anim, 0.05);
    const dist = P.distanceTo(Lk);
    camera.position.copy(P);
    camera.lookAt(Lk);
    camera.updateMatrixWorld();
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(pointer.x * 0.02 * dist);
    tmp2.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-pointer.y * 0.015 * dist);
    camera.position.add(tmp).add(tmp2);
    camera.lookAt(Lk);
    camera.near = Math.max(0.02, dist * 0.01);
    camera.far = 3000;
    // hero: chip a little right of the name; after that the scene is centred (mobile: raised)
    const heroShift = 1 - sstep(0.25, 0.85, T);
    if (mobile) camera.setViewOffset(view.w, view.h, 0, view.h * 0.18 * (1 - heroShift), view.w, view.h);
    else camera.setViewOffset(view.w, view.h, -view.w * 0.046 * heroShift, 0, view.w, view.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const fk = themeOpts.fogK;
    const fog = w === 'room' ? [dist * 1.2, dist * 4.2] : w === 'mem' ? [dist * 0.9, dist * 3.2] : [32, 150];
    scene.fog.near = fog[0] * fk;
    scene.fog.far = fog[1] * fk;
    scene.fog.color.copy(U.bg.value);
    // iris through matching parts on a change of place; a plain fade for jumps
    const vu = veilMat.uniforms;
    vu.uOpacity.value = S.jumpVeil;
    vu.uIris.value = 0;
    // timed on the move's clock, not the camera's position: the camera brakes to a stop at the
    // swap, but the opening shouldn't wait for it
    const fi = S.irisF;
    if (IRIS[k] && fi != null && fi > 0.18 && fi < 0.82 && S.jumpVeil < 0.99) {
      const cover = p < 0.5;
      const amt = cover ? sstep(0.2, 0.48, fi) ** 2 : 1 - (1 - sstep(0.52, 0.8, fi)) ** 3;
      const r = quadRect(IRIS[k][cover ? 0 : 1]);
      const fw = (view.w / 2) * 1.08;
      const fh = (view.h / 2) * 1.08;
      const cx = lerp(r.cx, view.w / 2, amt);
      const cy = lerp(r.cy, view.h / 2, amt);
      const d = renderer.getPixelRatio();
      vu.uRect.value.set(cx * d, (view.h - cy) * d, lerp(r.hw, fw, amt) * d, lerp(r.hh, fh, amt) * d);
      vu.uR.value = lerp(6, 0, amt) * d;
      vu.uMode.value = cover ? 0 : 1;
      vu.uRimAmt.value = 0.7 * (1 - amt);
      vu.uIris.value = cover && amt <= 0 ? 0 : 1;
    }
    veil.visible = vu.uOpacity.value > 0.001 || vu.uIris.value > 0.5;
  }

  /* ---------------- render loop (driven by gsap.ticker from main) ---------------- */
  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.85 ? 70 : 48;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  resize();

  function render(now) {
    // real time (up to 0.1 s a frame), so a slow frame doesn't stretch a move
    const dt = lastRender ? clamp((now - lastRender) / 1000, 0, 0.1) : 0;
    lastRender = now;
    const glowTarget = S.T < 0.45 ? 0.9 : themeOpts.glowRest + 0.15;
    U.glow.value += (glowTarget - U.glow.value) * Math.min(1, dt * 6 || 1);
    if (Math.abs(glowTarget - U.glow.value) > 0.004) anim = Math.max(anim, 0.05);
    stepTheme(now);
    update(dt);
    renderer.render(scene, camera);
    // Resolution governor. It watches the time between frames while the scene is animating
    // continuously; that includes the GPU's work (a busy GPU delays the next frame), which the
    // time spent inside render() does not. Below ~55 fps it steps down, and back up when there's
    // clearly room again.
    if (prevFrame && now - prevFrame < 70) {
      costs.push(now - prevFrame);
      if (costs.length >= 30) {
        const med = [...costs].sort((a, b) => a - b)[15];
        const next = med > 18.5 && dpr > dprMin ? Math.max(dprMin, dpr - 0.25) : med < 14 && costs.length >= 120 && dpr < dprMax ? Math.min(dprMax, dpr + 0.25) : dpr;
        if (next !== dpr) {
          dpr = next;
          renderer.setPixelRatio(dpr);
          resize();
          costs.length = 0;
        } else if (costs.length >= 120 || med > 18.5) costs.length = 0;
      }
    }
    prevFrame = now;
  }

  function tick(now) {
    if (!running) return false;
    const ambient = !S.calm && S.T < 0.9 && place_ === 'room';
    if (dirty || anim > 0) {
      dirty = false;
      anim = Math.max(0, anim - (lastRender ? (now - lastRender) / 1000 : 0));
      render(now);
      return true;
    }
    if (ambient && now - lastRender > 33) {
      render(now);
      return true;
    }
    if (lastRender && now - lastRender > 100) lastRender = 0;
    return false;
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    canvas.classList.remove('is-on');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    running = true;
    dirty = true;
    canvas.classList.add('is-on');
  });

  const proj = new Vector3();
  /* ---------------- public API ---------------- */
  return {
    // the player's state for this frame
    setView({ T, L, irisF, veil }) {
      if (T === S.T && irisF === S.irisF && veil === S.jumpVeil && L.every((v, i) => v === S.L[i])) return;
      S.T = T;
      for (let i = 0; i < 6; i++) S.L[i] = L[i];
      S.irisF = irisF;
      S.jumpVeil = veil;
      dirty = true;
    },
    // screen position (CSS px) of a named source; visible = in front of the camera
    project(name) {
      sourcePos(name, proj).project(camera);
      return { x: (proj.x * 0.5 + 0.5) * view.w, y: (-proj.y * 0.5 + 0.5) * view.h, visible: proj.z < 1 };
    },
    // the laptop screen's rectangle on the page, for the contact card
    screenRect() {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      SCREEN.corners.forEach((c) => {
        proj.copy(c).project(camera);
        const x = (proj.x * 0.5 + 0.5) * view.w;
        const y = (-proj.y * 0.5 + 0.5) * view.h;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      });
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    setLevel(name, v) {
      if (Math.abs(level[name] - v) < 1e-4) return;
      level[name] = v;
      dirty = true;
    },
    setCalm(on) {
      S.calm = on;
      dirty = true;
    },
    setSendBack(v) {
      S.sendBack = v;
      dirty = true;
    },
    setPointer(x, y) {
      pointer.tx = clamp(x, -1, 1);
      pointer.ty = clamp(y, -1, 1);
      anim = Math.max(anim, 0.05);
    },
    setMobile(m) {
      mobile = m;
      resize();
    },
    setTheme(colors, isDark, duration = 0.4) {
      theme.from = Object.fromEntries(KEYS.map((key) => [key, U[key].value.clone()]));
      theme.to = Object.fromEntries(KEYS.map((key) => [key, new Color(colors[key] || '#000')]));
      theme.edgeFrom = U.edgeAmt.value;
      theme.edgeTo = colors.edgeAmt ?? U.edgeAmt.value;
      themeOpts.glowRest = colors.glowRest ?? 0.55;
      themeOpts.fogK = colors.fogK ?? 1;
      theme.t = 0;
      theme.dur = duration;
      theme.start = performance.now();
      if (dark !== isDark) {
        dark = isDark;
        applyBlend();
      }
      stepTheme(performance.now());
      dirty = true;
    },
    compileAll() {
      const vis = Object.values(W).map((g) => g.visible);
      Object.values(W).forEach((g) => (g.visible = true));
      renderer.compile(scene, camera);
      Object.values(W).forEach((g, i) => (g.visible = vis[i]));
    },
    resize,
    tick,
    setRunning(on) {
      running = on;
      if (on) {
        lastRender = 0;
        dirty = true;
      }
    },
    renderNow() {
      dirty = false;
      render(performance.now());
    },
    stats() {
      const d = camera.getWorldDirection(new Vector3());
      return { T: S.T, place: place_, dpr: renderer.getPixelRatio(), calls: renderer.info.render.calls, dir: [d.x, d.y, d.z], veil: veilMat.uniforms.uIris.value > 0.5 && veilMat.uniforms.uMode.value < 0.5 ? 1 : veilMat.uniforms.uOpacity.value, p: S.T % 1 };
    },
  };
}
