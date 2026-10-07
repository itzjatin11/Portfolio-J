// "Hello from Auckland": one three.js world behind the page.
//
// A hello leaves Jatin's laptop in Auckland and travels to the visitor:
//   chip (hero) → laptop on a desk → Wi-Fi router → data centre → ocean cable → your screen.
// The first three stops share one room, so the camera simply pulls back and slides across.
// The data centre, the ocean and the globe are separate places; the camera only changes place
// while it is still, behind a short fade to the page colour.
//
// One number drives everything: T (0 hero, 1 About … 5 Contact). main.js sets a target from the
// scroll position and the world eases towards it at a capped speed, so a fast flick of the wheel
// can't spin the view. Skipping more than one stop fades straight there instead of flying.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Fog,
  Color,
  Vector3,
  Matrix4,
  Object3D,
  Group,
  Mesh,
  InstancedMesh,
  Points,
  Sprite,
  PlaneGeometry,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  BufferAttribute,
  CatmullRomCurve3,
  QuadraticBezierCurve3,
  ShaderMaterial,
  MeshBasicMaterial,
  PointsMaterial,
  SpriteMaterial,
  UniformsUtils,
  UniformsLib,
  AdditiveBlending,
  NormalBlending,
  DynamicDrawUsage,
  DoubleSide,
  MathUtils,
} from 'three';
import * as TX from '../textures.js';
import * as HX from './textures.js';
import { LAND, LAND_W, LAND_H } from './land.js';

const { clamp, lerp, smoothstep } = MathUtils;
const sstep = (a, b, x) => smoothstep(x, a, b);
const ease = (x) => x * x * (3 - 2 * x);
const bump = (x, a, b, c, d) => Math.min(sstep(a, b, x), 1 - sstep(c, d, x));
const V = (a) => new Vector3(a[0], a[1], a[2]);

// Places sit far apart; only the one the camera is in is drawn.
const OFF = { room: 0, dc: 1000, ocean: 2000, globe: 3000 };
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
// A cable or wire as a tube; uv.x runs along it so a band of light can ride it.
const VS_WIRE = /* glsl */ `
varying float vU;
#include <common>
#include <fog_pars_vertex>
void main() {
  vU = uv.x;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS_WIRE = /* glsl */ `
varying float vU;
uniform vec3 uBase, uTrace, uHot; uniform float uS; uniform float uBand; uniform float uMix; uniform float uOpacity;
#include <common>
#include <fog_pars_fragment>
void main() {
  float g = uS > -0.5 ? exp(-pow((vU - uS) * uBand, 2.0)) : 0.0;
  vec3 c = mix(uBase, uTrace, uMix);
  c = mix(c, uHot, clamp(g, 0.0, 1.0));
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
// Full-screen veil in the page colour, used for the place changes and jumps.
const VS_VEIL = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FS_VEIL = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
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
function wireMaterial(base = 'body', mix = 0.25) {
  return new ShaderMaterial({
    uniforms: { ...fogU(), uBase: U[base], uTrace: U.trace, uHot: U.hot, uS: { value: -1 }, uBand: { value: 30 }, uMix: { value: mix }, uOpacity: { value: 1 } },
    vertexShader: VS_WIRE,
    fragmentShader: FS_WIRE,
    fog: true,
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
export function createWorld(canvas, { mobile = false, still = false, tagLayer = null, projects = [], stops = [] } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const dprMax = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  let dpr = dprMax;
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  scene.fog = new Fog(0x000000, 10, 50);
  scene.background = U.bg.value;
  const camera = new PerspectiveCamera(48, 1, 0.1, 3000);

  const W = { room: new Group(), dc: new Group(), ocean: new Group(), globe: new Group() };
  Object.entries(W).forEach(([k, g]) => {
    g.position.x = OFF[k];
    scene.add(g);
  });

  const glowTex = TX.glowTexture();

  /* ================================================================ ROOM */
  // The motherboard (as in the hero of the main site), inside a laptop on a desk in Auckland.
  const R = W.room;
  const traces = TX.makeTraces(mobile ? 80 : 140);
  const board = new Mesh(new PlaneGeometry(TX.BOARD, TX.BOARD), channel(TX.boardTexture(traces, mobile ? 1024 : 2048), 'board', { k: [1, 1, 0.55] }));
  board.rotation.x = -Math.PI / 2;
  R.add(board);
  const substrate = new Mesh(new BoxGeometry(6, 0.18, 6), solid('pcb'));
  substrate.position.y = 0.09;
  const lid = new Mesh(new BoxGeometry(5.2, 0.15, 5.2), solid('body'));
  lid.position.y = 0.255;
  const lidTop = new Mesh(new PlaneGeometry(5.2, 5.2), channel(TX.lidTexture(), 'body', { k: [0.8, 1, 0.9] }));
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.3315;
  R.add(substrate, lid, lidTop);
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
    [[9.2, 0.25, 0], [3.4, 0.3, 19.5]], // SO-DIMMs lie flat in a laptop
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

  // ambient pulses on the board traces (hero only)
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

  // laptop: open-topped shell around the board; the keyboard deck closes over it as we pull back
  const shellMat = solid('body', { edge: 1.2 });
  R.add(
    boxes(
      [
        [[0, -0.6, 0], [64, 0.8, 46]],
        [[0, 0.8, -23], [64, 2.8, 0.6]],
        [[0, 0.8, 23], [64, 2.8, 0.6]],
        [[-32, 0.8, 0], [0.6, 2.8, 46]],
        [[32, 0.8, 0], [0.6, 2.8, 46]],
      ],
      shellMat,
    ),
  );
  const deckMat = channel(HX.keyboardTexture(), 'body', { c1: 'edge', c2: 'trace', k: [0.9, 1, 1], edge: 1.2, transparent: true });
  const deck = new Mesh(new PlaneGeometry(64, 46), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 2.22;
  R.add(deck);
  // screen: hinged at the back edge, tilted 14° back
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

  // desk, back wall and the window onto the city
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

  // Wi-Fi router on the desk, with three rings that roll out from it
  const ROUTER = [60, 0, -12];
  const router = new Group();
  router.position.set(...ROUTER);
  const routerBody = new Mesh(new BoxGeometry(22, 3.6, 13), solid('body', { edge: 1.4 }));
  routerBody.position.y = 0.8;
  router.add(routerBody);
  const antennaMat = solid('body', { edge: 1 });
  [-8, 0, 8].forEach((x, i) => {
    const a = new Mesh(new CylinderGeometry(0.55, 0.7, 13, 10), antennaMat);
    a.position.set(x, 8.5, -5.6);
    a.rotation.z = (i - 1) * 0.16;
    router.add(a);
  });
  const ledMat = solid('trace', { edge: 0 });
  ledMat.uniforms.uEmitAmt.value = 0;
  const leds = boxes(
    Array.from({ length: 6 }, (_, i) => [[-6 + i * 2.4, 1.2, 6.55], [0.9, 0.5, 0.1]]),
    ledMat,
  );
  router.add(leds);
  R.add(router);
  const ringMat = solid('trace', { edge: 0, transparent: true });
  ringMat.depthWrite = false;
  const rings = [0, 1, 2].map(() => {
    const m = new Mesh(new TorusGeometry(1, 0.045, 6, 64), ringMat.clone());
    m.material.uniforms.uColor = U.trace;
    m.position.set(ROUTER[0], 10, ROUTER[2]);
    R.add(m);
    return m;
  });

  /* ================================================================ DATA CENTRE */
  const D = W.dc;
  const floorTex = HX.floorTexture();
  floorTex.repeat.set(16, 60);
  const floor = new Mesh(new PlaneGeometry(80, 300), channel(floorTex, 'board', { c1: 'edge', k: [0.8, 0, 0] }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -110;
  D.add(floor);
  const RACKS = 40;
  const rackZ = (i) => 10 - i * 6;
  const PROJECT_RACK = [3, 8, 13, 18, 23];
  const rackList = [];
  [-1, 1].forEach((s) => {
    for (let i = 0; i < RACKS; i++) rackList.push([[s * 8.2, 10, rackZ(i)], [6, 20, 5.6]]);
  });
  D.add(boxes(rackList, solid('body', { edge: 1.3 })));
  const rackDecalMat = new MeshBasicMaterial({ map: HX.rackDecal(), transparent: true, depthWrite: false, fog: true });
  const decals = new InstancedMesh(new PlaneGeometry(4.6, 18.6), rackDecalMat, RACKS * 2);
  let n = 0;
  [-1, 1].forEach((s) => {
    for (let i = 0; i < RACKS; i++) place(decals, n++, [s * 5.18, 10, rackZ(i)], [1, 1, 1], -s * (Math.PI / 2));
  });
  const decalLevel = new Float32Array(RACKS * 2);
  const decalCol = new Color();
  function paintDecals() {
    for (let i = 0; i < decalLevel.length; i++) {
      decalCol.copy(U.trace.value).multiplyScalar(0.3 + 0.2 * U.glow.value).lerp(U.hot.value, clamp(decalLevel[i], 0, 1));
      decals.setColorAt(i, decalCol);
    }
    decals.instanceColor.needsUpdate = true;
  }
  decals.setColorAt(0, decalCol);
  D.add(decals);
  // overhead cable tray down the aisle
  D.add(boxes([[[0, 23, -110], [3, 0.4, 260]], [[-8.2, 21.5, -110], [6, 1.2, 260]], [[8.2, 21.5, -110], [6, 1.2, 260]]], solid('metal', { edge: 0.8 })));

  /* ================================================================ OCEAN */
  const O = W.ocean;
  const sandTex = HX.sandTexture();
  sandTex.repeat.set(14, 5);
  const seabed = new Mesh(new PlaneGeometry(700, 240), channel(sandTex, 'pcb', { c1: 'edge', k: [1.6, 0, 0] }));
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.set(100, 0, -40);
  O.add(seabed);
  const cablePts = [];
  for (let x = -160; x <= 380; x += 20) cablePts.push(new Vector3(x, 0.7 + 0.3 * Math.sin(x * 0.05), 3 * Math.sin(x * 0.021)));
  const cableCurve = new CatmullRomCurve3(cablePts);
  const cableMat = wireMaterial('body', 0.45);
  cableMat.uniforms.uBand.value = 160;
  const cable = new Mesh(new TubeGeometry(cableCurve, 400, 0.38, 8, false), cableMat);
  O.add(cable);
  const REP_X = [0, 42, 84, 126, 168];
  const xToU = (x) => (x + 160) / 540; // the curve is near-uniform in x
  const repMats = REP_X.map(() => solid('body', { edge: 1.4 }));
  REP_X.forEach((x, i) => {
    const m = new Mesh(new CylinderGeometry(0.85, 0.85, 4.2, 16), repMats[i]);
    m.rotation.z = Math.PI / 2;
    const p = cableCurve.getPointAt(xToU(x));
    m.position.copy(p);
    O.add(m);
  });
  // rocks on the sea floor, so there's something to pass
  const rockR = TX.rng(23);
  const rocks = new InstancedMesh(new SphereGeometry(1, 7, 5), solid('body', { edge: 0 }), 70);
  for (let i = 0; i < 70; i++) {
    const x = -120 + rockR() * 380;
    const z = -50 + rockR() * 80;
    if (Math.abs(z - 3 * Math.sin(x * 0.021)) < 4) {
      i--;
      continue;
    }
    const sc = 0.6 + rockR() * 2.4;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rockR() * 6, 0);
    dummy.scale.set(sc * (1 + rockR()), sc * 0.55, sc);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  O.add(rocks);
  // light from far above and a slow drift of particles
  const shaftTex = HX.shaftTexture();
  const shaftMat = new MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, opacity: 0.22, blending: AdditiveBlending, fog: false, side: DoubleSide });
  const shafts = new Group();
  [-40, 10, 70, 130, 200].forEach((x, i) => {
    const s = new Mesh(new PlaneGeometry(26, 90), shaftMat);
    s.position.set(x, 40, -30 - i * 6);
    s.rotation.z = -0.25;
    shafts.add(s);
  });
  O.add(shafts);
  const snowN = mobile ? 300 : 700;
  const snowGeo = new BufferGeometry();
  const snowPos = new Float32Array(snowN * 3);
  const sr = TX.rng(17);
  for (let i = 0; i < snowN; i++) {
    snowPos[i * 3] = -120 + sr() * 360;
    snowPos[i * 3 + 1] = sr() * 40;
    snowPos[i * 3 + 2] = -60 + sr() * 90;
  }
  snowGeo.setAttribute('position', new BufferAttribute(snowPos, 3).setUsage(DynamicDrawUsage));
  const snowMat = new PointsMaterial({ size: 0.35, map: glowTex, transparent: true, depthWrite: false, opacity: 0.5, blending: AdditiveBlending, fog: true });
  const snow = new Points(snowGeo, snowMat);
  O.add(snow);

  /* ================================================================ GLOBE */
  const G = W.globe;
  const GR = 20;
  const globe = new Group(); // the planet, turned so Auckland faces us
  G.add(globe);
  globe.add(new Mesh(new SphereGeometry(GR * 0.985, 48, 32), solid('die', { edge: 0 })));
  const latLon = (lat, lon, r = 1) => {
    const a = MathUtils.degToRad(lat);
    const o = MathUtils.degToRad(lon);
    return new Vector3(Math.cos(a) * Math.cos(o) * r, Math.sin(a) * r, -Math.cos(a) * Math.sin(o) * r);
  };
  const landBits = Uint8Array.from(atob(LAND), (c) => c.charCodeAt(0));
  const isLand = (lat, lon) => {
    const x = clamp(Math.floor(lon + 180), 0, LAND_W - 1);
    const y = clamp(Math.floor(90 - lat), 0, LAND_H - 1);
    const i = y * LAND_W + x;
    return (landBits[i >> 3] >> (i & 7)) & 1;
  };
  const dotN = mobile ? 9000 : 16000;
  const land = [];
  const sea = [];
  for (let i = 0; i < dotN; i++) {
    // Fibonacci sphere: even spacing
    const y = 1 - (i / (dotN - 1)) * 2;
    const lat = MathUtils.radToDeg(Math.asin(y));
    const lon = ((MathUtils.radToDeg(i * 2.399963) % 360) + 540) % 360 - 180;
    const v = latLon(lat, lon, GR);
    if (isLand(lat, lon)) land.push(v.x, v.y, v.z);
    else if (i % 4 === 0) sea.push(v.x, v.y, v.z);
  }
  const dotsOf = (arr, size, opacity) => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(arr, 3));
    const mat = new PointsMaterial({ size, transparent: true, opacity, depthWrite: false, fog: true });
    globe.add(new Points(geo, mat));
    return mat;
  };
  const dotMat = dotsOf(land, 0.42, 1);
  const seaMat = dotsOf(sea, 0.16, 0.35);
  const AKL = latLon(-36.85, 174.76).normalize();
  {
    // turn the planet so Auckland faces us (lower right) with north still up
    const t = new Vector3(0.42, -0.24, 0.87).normalize();
    const up = new Vector3(0, 1, 0);
    const n1 = up.clone().sub(AKL.clone().multiplyScalar(up.dot(AKL))).normalize();
    const n2 = up.clone().sub(t.clone().multiplyScalar(up.dot(t))).normalize();
    const m1 = new Matrix4().makeBasis(AKL, n1, AKL.clone().cross(n1));
    const m2 = new Matrix4().makeBasis(t, n2, t.clone().cross(n2));
    globe.quaternion.setFromRotationMatrix(m2.multiply(m1.transpose()));
  }
  globe.updateMatrixWorld();
  const aklPos = AKL.clone().multiplyScalar(GR * 1.01).applyQuaternion(globe.quaternion);
  // the hello lifts off Auckland and comes out of the globe towards the viewer: to you
  const YOU_POS = new Vector3(12, 15, 38);
  const arcCurve = new QuadraticBezierCurve3(aklPos.clone(), aklPos.clone().multiplyScalar(1.45).add(new Vector3(-10, 16, 6)), YOU_POS.clone());
  const arcMat = wireMaterial('trace', 0.35);
  arcMat.uniforms.uBand.value = 9;
  G.add(new Mesh(new TubeGeometry(arcCurve, 160, 0.14, 6, false), arcMat));
  const markMat = new SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const aklMark = new Sprite(markMat);
  aklMark.position.copy(aklPos);
  aklMark.scale.setScalar(2.4);
  G.add(aklMark);

  /* ================================================================ the hello itself */
  const sparkMat = new SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, fog: false });
  const spark = new Sprite(sparkMat);
  spark.renderOrder = 10;
  scene.add(spark);

  const veilMat = new ShaderMaterial({ uniforms: { uColor: U.bg, uOpacity: { value: 0 } }, vertexShader: VS_VEIL, fragmentShader: FS_VEIL, transparent: true, depthTest: false, depthWrite: false });
  const veil = new Mesh(new PlaneGeometry(2, 2), veilMat);
  veil.frustumCulled = false;
  veil.renderOrder = 100;
  scene.add(veil);

  /* ================================================================ camera rig */
  // Station poses as a function of that station's local progress L (0..1).
  const repAt = (pf) => {
    const i = clamp(Math.floor(pf), 0, 3);
    return lerp(REP_X[i], REP_X[i + 1], ease(sstep(0.2, 0.8, clamp(pf - i, 0, 1))));
  };
  const rackAt = (pf) => {
    const i = clamp(Math.floor(pf), 0, 3);
    return lerp(rackZ(PROJECT_RACK[i]), rackZ(PROJECT_RACK[i + 1]), ease(sstep(0.2, 0.8, clamp(pf - i, 0, 1))));
  };
  const ST = [
    () => [[1.5, 21, 25], [0.5, 0, -1]],
    (L) => [[lerp(-4, -1, L), lerp(40, 37, L), lerp(112, 104, L)], [2, 13, -8]],
    (L) => [[lerp(43, 46, L), lerp(21, 19, L), lerp(46, 40, L)], [58, lerp(6, 7, L), -12]],
    (L) => {
      const z = rackAt(L * 4);
      return [at3('dc', 4.2, 11.5, z + 30), at3('dc', -5.5, 9, z - 2)];
    },
    (L) => {
      const x = repAt(L * 4);
      return [at3('ocean', x - 12, 13, 40), at3('ocean', x + 4, 0.5, -2)];
    },
    (L) => [at3('globe', lerp(2, 1, L), lerp(5, 3.5, L), lerp(70, 63, L)), at3('globe', 0, 0, 0)],
  ];
  const at = (k, L) => ST[k](L);

  // Seams between stations. Within the room the camera flies; across places it settles,
  // the veil closes and opens, and it settles again on the other side.
  const SEAMS = [
    [{ a: 0, b: 1, w: 'room', path: camPath([[1.5, 21, 25], [1.8, 27, 42], [-1, 35, 76], at(1, 0)[0]], [[0.5, 0, -1], [0.4, 2, -3], [1, 7, -6], at(1, 0)[1]]) }],
    [{ a: 0, b: 1, w: 'room', path: camPath([at(1, 1)[0], [14, 34, 86], [32, 26, 60], at(2, 0)[0]], [at(1, 1)[1], [20, 11, -8], [44, 7, -11], at(2, 0)[1]]) }],
    [
      { a: 0, b: 0.5, w: 'room', path: camPath([at(2, 1)[0], [47.5, 18.5, 37]], [at(2, 1)[1], [64, 9, -14]]) },
      { a: 0.5, b: 1, w: 'dc', path: camPath([at3('dc', 2, 13, 56), at3('dc', 3, 11.5, 40), at(3, 0)[0]], [at3('dc', -3, 9, 6), at3('dc', -4.5, 8.8, 0), at(3, 0)[1]]) },
    ],
    [
      { a: 0, b: 0.5, w: 'dc', path: camPath([at(3, 1)[0], at3('dc', 3.5, 10.5, rackZ(PROJECT_RACK[4]) + 16)], [at(3, 1)[1], at3('dc', -5, 8.5, rackZ(PROJECT_RACK[4]) - 6)]) },
      { a: 0.5, b: 1, w: 'ocean', path: camPath([at3('ocean', -40, 17, 52), at3('ocean', -26, 15, 45), at(4, 0)[0]], [at3('ocean', -22, 1, -2), at3('ocean', -14, 0.8, -2), at(4, 0)[1]]) },
    ],
    [
      { a: 0, b: 0.5, w: 'ocean', path: camPath([at(4, 1)[0], at3('ocean', REP_X[4] + 2, 13, 40)], [at(4, 1)[1], at3('ocean', REP_X[4] + 18, 0.5, -2)]) },
      { a: 0.5, b: 1, w: 'globe', path: camPath([at3('globe', 6, 9, 96), at3('globe', 3, 6, 80), at(5, 0)[0]], [at3('globe', 0, 0, 0), at3('globe', 0, 0, 0), at(5, 0)[1]]) },
    ],
  ];
  const veilFor = (k, p) => (SEAMS[k] && SEAMS[k].length > 1 ? 1 - sstep(0.12, 0.2, Math.abs(p - 0.5)) : 0);

  /* ================================================================ state */
  const S = {
    T: 0, // eased
    Tt: 0, // target from scroll
    L: [0, 0, 0, 0, 0, 0],
    Lt: [0, 0, 0, 0, 0, 0],
    override: null, // send-back animation on the globe (0..1)
    jump: null, // { phase, t, to }
    jumpVeil: 0,
    calm: still,
  };
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

  function cameraFor(T, outP, outL) {
    const k = Math.min(5, Math.floor(T));
    const p = T - k;
    if (k >= 5 || p < 1e-6) {
      const [a, b] = at(k, S.L[k]);
      outP.fromArray(a);
      outL.fromArray(b);
      return { w: ['room', 'room', 'room', 'dc', 'ocean', 'globe'][k], veil: 0, k, p: 0 };
    }
    const phases = SEAMS[k];
    const ph = phases.find((x) => p >= x.a && p <= x.b) || phases[phases.length - 1];
    const lq = (p - ph.a) / (ph.b - ph.a);
    ph.path(lq, outP, outL);
    // carry the stations' live local progress in and out of the seam (no jumps)
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
    return { w: ph.w, veil: veilFor(k, p), k, p };
  }

  /* ---------------- labels anchored in the scene (plain words only) ---------------- */
  const tags = [];
  function tag(text, w) {
    if (!tagLayer) return null;
    const el = document.createElement('span');
    el.className = 'tag mono';
    el.textContent = text;
    tagLayer.appendChild(el);
    const t = { el, pos: new Vector3(), alpha: 0, w, shown: -1 };
    tags.push(t);
    return t;
  }
  const TG = {
    projects: projects.map((name, i) => {
      const t = tag(name, 'dc');
      t?.pos.set(...at3('dc', -5.4, 17.5, rackZ(PROJECT_RACK[i])));
      return t;
    }),
    stops: stops.map((name, i) => {
      const t = tag(name, 'ocean');
      t?.pos.copy(cableCurve.getPointAt(xToU(REP_X[i]))).add(tmp.set(OFF.ocean, 2.2, 0));
      return t;
    }),
    akl: tag('Auckland', 'globe'),
    you: tag('You', 'globe'),
  };
  TG.akl?.pos.copy(aklPos).multiplyScalar(1.03).add(tmp.set(OFF.globe, 0, 0));
  TG.you?.pos.copy(YOU_POS).add(tmp.set(OFF.globe, 0, 1.5));
  const allTags = () => [...TG.projects, ...TG.stops, TG.akl, TG.you].filter(Boolean);

  /* ---------------- theme ---------------- */
  let dark = true;
  const themeOpts = { glowRest: 0.55, fogK: 1 };
  const theme = { t: 1, dur: 0.4, start: 0, from: null, to: null };
  function applyBlend() {
    const b = dark ? AdditiveBlending : NormalBlending;
    [sparkMat, pulseMat, snowMat, shaftMat, markMat].forEach((m) => {
      m.blending = b;
      m.needsUpdate = true;
    });
    shaftMat.opacity = dark ? 0.22 : 0.12;
    snowMat.opacity = dark ? 0.5 : 0.35;
  }
  function stepTheme(now) {
    if (!theme.to || theme.t >= 1) return;
    theme.t = theme.dur > 0 ? Math.min(1, (now - theme.start) / (theme.dur * 1000)) : 1;
    const e = ease(theme.t);
    KEYS.forEach((key) => U[key].value.copy(theme.from[key]).lerp(theme.to[key], e));
    U.edgeAmt.value = lerp(theme.edgeFrom, theme.edgeTo, e);
    decals.userData.glow = -1;
    if (theme.t < 1) anim = Math.max(anim, 0.05);
  }

  /* ================================================================ easing towards the target */
  const VMAX = 0.75; // stops per second, at most
  function follow(dt) {
    if (S.calm) {
      // calm view: no flying at all; a fade to the nearest stop
      const goal = Math.min(5, Math.round(S.Tt));
      if (!S.jump && goal !== Math.round(S.T)) S.jump = { phase: 0, t: 0, to: goal };
      S.L.forEach((_, i) => (S.L[i] = 0.5));
    } else if (!S.jump && Math.abs(S.Tt - S.T) > 1.6) {
      // skipping more than one stop (nav, keyboard, a big drag): fade straight there
      S.jump = { phase: 0, t: 0, to: S.Tt };
    }
    if (S.jump) {
      const j = S.jump;
      j.t += dt;
      if (j.phase === 0) {
        S.jumpVeil = Math.min(1, j.t / 0.28);
        if (S.jumpVeil >= 1) {
          S.T = S.calm ? j.to : S.Tt;
          for (let i = 0; i < 6; i++) S.L[i] = S.calm ? 0.5 : S.Lt[i];
          j.phase = 1;
          j.t = 0;
        }
      } else {
        S.jumpVeil = Math.max(0, 1 - Math.max(0, j.t - 0.12) / 0.4);
        if (S.jumpVeil <= 0) S.jump = null;
      }
      return true;
    }
    let moving = false;
    const d = S.Tt - S.T;
    if (Math.abs(d) > 1e-4) {
      const step = d * (1 - Math.exp(-dt * 3.2));
      S.T += clamp(step, -VMAX * dt, VMAX * dt);
      moving = true;
    } else S.T = S.Tt;
    for (let i = 0; i < 6; i++) {
      const e = S.Lt[i] - S.L[i];
      if (Math.abs(e) > 1e-4) {
        S.L[i] += e * (1 - Math.exp(-dt * 4));
        moving = true;
      } else S.L[i] = S.Lt[i];
    }
    return moving;
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
    // the deck closes over the board and the screen lights as we pull out of the laptop
    const out = T >= 1 ? 1 : sstep(0.3, 0.75, T);
    deckMat.uniforms.uOpacity.value = out;
    deck.visible = out > 0.01;
    deckMat.depthWrite = out > 0.99;
    screenBackMat.uniforms.uOpacity.value = out;
    displayMat.uniforms.uOpacity.value = out;
    screen.visible = out > 0.01;
    screenBackMat.depthWrite = displayMat.depthWrite = out > 0.99;
    // Wi-Fi rings roll out while we're at the router
    const atRouter = w === 'room' && T > 1.4;
    ledMat.uniforms.uEmitAmt.value = atRouter ? 0.7 : 0.2;
    rings.forEach((m, i) => {
      m.visible = atRouter && !S.calm;
      if (!m.visible) return;
      const f = (clock * 0.35 + i / 3) % 1;
      m.scale.setScalar(1.5 + f * 9);
      m.material.uniforms.uOpacity.value = (1 - f) * 0.7 * sstep(1.4, 1.8, T);
      m.lookAt(camera.position);
    });
    if (atRouter && !S.calm) anim = Math.max(anim, 0.05);

    // ---------- data centre: the current project's rack is lit ----------
    const pfW = S.L[3] * 4;
    decalLevel.fill(0);
    if (w === 'dc') {
      PROJECT_RACK.forEach((r, i) => (decalLevel[r] = clamp(1 - Math.abs(pfW - i) * 1.6, 0, 1) * (k === 2 ? sstep(0.6, 1, p) : 1)));
    }
    let changed = false;
    for (let i = 0; i < decalLevel.length; i++) if (Math.abs(decalLevel[i] - (decals.userData.prev?.[i] ?? -1)) > 1e-3) changed = true;
    if (changed || decals.userData.glow !== U.glow.value) {
      decals.userData.prev = Float32Array.from(decalLevel);
      decals.userData.glow = U.glow.value;
      paintDecals();
    }

    // ---------- ocean: drift ----------
    const pfO = S.L[4] * 4;
    repMats.forEach((m, i) => (m.uniforms.uEmitAmt.value = w === 'ocean' ? clamp(1 - Math.abs(pfO - i) * 1.6, 0, 1) * 0.6 : 0));
    if (w === 'ocean' && !S.calm && dt > 0) {
      for (let i = 0; i < snowN; i++) {
        snowPos[i * 3 + 1] -= dt * (0.6 + (i % 5) * 0.12);
        if (snowPos[i * 3 + 1] < 0) snowPos[i * 3 + 1] += 40;
      }
      snowGeo.attributes.position.needsUpdate = true;
      anim = Math.max(anim, 0.05);
    }

    // ---------- the hello ----------
    spark.visible = true;
    let sparkScale = 1;
    let sparkA = 1;
    cableMat.uniforms.uS.value = -1;
    arcMat.uniforms.uS.value = -1;
    const roomSpark = (q, out) => {
      // laptop (q=0) → router (q=1), arcing over the desk
      const a = tmp.set(0, 9, 2);
      const b = tmp2.set(ROUTER[0], 10, ROUTER[2]);
      out.copy(a).lerp(b, q);
      out.y += Math.sin(Math.PI * q) * 12;
      return out;
    };
    if (S.override != null) {
      // sending a reply: it rides the arc back to Auckland
      const f = S.override;
      spark.position.copy(arcCurve.getPointAt(1 - f)).add(tmp.set(OFF.globe, 0, 0));
      arcMat.uniforms.uS.value = 1 - f;
      sparkScale = 2.2;
    } else if (k === 0) {
      spark.position.set(0, lerp(0.5, 9, sstep(0.45, 1, p)), lerp(0, 2, sstep(0.45, 1, p)));
      sparkA = sstep(0.35, 0.6, p);
      sparkScale = lerp(0.8, 2.6, sstep(0.4, 1, p));
    } else if (k === 1 && p === 0) {
      spark.position.set(0, 9, 2);
      sparkScale = 2.6;
    } else if (k === 1) {
      roomSpark(ease(sstep(0.1, 0.9, p)), spark.position);
      sparkScale = 2.6;
    } else if (k === 2 && p === 0) {
      spark.position.set(ROUTER[0], 10, ROUTER[2]);
      sparkScale = 2.2;
    } else if (k === 2) {
      if (p < 0.5) {
        const f = sstep(0, 0.42, p);
        spark.position.set(ROUTER[0] + f * 40, 10 + f * 22, ROUTER[2] - f * 50);
        sparkA = 1 - sstep(0.25, 0.42, p);
        sparkScale = 2.2;
      } else {
        const f = sstep(0.55, 1, p);
        tmp.set(0, 23.5, lerp(40, rackZ(PROJECT_RACK[0]) + 2, f));
        if (f > 0.7) tmp.lerp(tmp2.set(-5, 13, rackZ(PROJECT_RACK[0])), sstep(0.7, 1, f));
        spark.position.copy(tmp).add(tmp2.set(OFF.dc, 0, 0));
        sparkA = sstep(0.55, 0.7, p);
        sparkScale = 1.4;
      }
    } else if (k === 3 && p === 0) {
      // between racks, the hello rides the tray overhead
      const i = clamp(Math.floor(pfW), 0, 3);
      const f = ease(sstep(0.2, 0.8, clamp(pfW - i, 0, 1)));
      const z = lerp(rackZ(PROJECT_RACK[i]), rackZ(PROJECT_RACK[i + 1]), f);
      spark.position.set(OFF.dc - 5 + Math.sin(Math.PI * f) * 5, 13 + Math.sin(Math.PI * f) * 10, z);
      sparkScale = 1.4;
    } else if (k === 3) {
      if (p < 0.5) {
        const f = sstep(0, 0.42, p);
        const z0 = rackZ(PROJECT_RACK[4]);
        spark.position.set(OFF.dc - 5 + f * 5, 13 + f * 10, z0 - f * 60);
        sparkA = 1 - sstep(0.25, 0.42, p);
        sparkScale = 1.4;
      } else {
        const f = sstep(0.55, 1, p);
        spark.position.copy(cableCurve.getPointAt(lerp(xToU(-60), xToU(REP_X[0]), f))).add(tmp.set(OFF.ocean, 0.9, 0));
        cableMat.uniforms.uS.value = lerp(xToU(-60), xToU(REP_X[0]), f);
        sparkA = sstep(0.55, 0.7, p);
        sparkScale = 1.6;
      }
    } else if (k === 4 && p === 0) {
      const u = xToU(repAt(pfO));
      spark.position.copy(cableCurve.getPointAt(u)).add(tmp.set(OFF.ocean, 0.9, 0));
      cableMat.uniforms.uS.value = u;
      sparkScale = 1.6;
    } else if (k === 4) {
      if (p < 0.5) {
        const u = lerp(xToU(REP_X[4]), xToU(REP_X[4] + 60), sstep(0, 0.42, p));
        spark.position.copy(cableCurve.getPointAt(u)).add(tmp.set(OFF.ocean, 0.9, 0));
        cableMat.uniforms.uS.value = u;
        sparkA = 1 - sstep(0.3, 0.42, p);
        sparkScale = 1.6;
      } else {
        // the signature moment: across the world, Auckland → you
        const f = sstep(0.58, 1, p);
        spark.position.copy(arcCurve.getPointAt(f)).add(tmp.set(OFF.globe, 0, 0));
        arcMat.uniforms.uS.value = f;
        sparkA = sstep(0.55, 0.65, p);
        sparkScale = 2.2;
      }
    } else {
      spark.position.copy(YOU_POS).add(tmp.set(OFF.globe, 0, 0));
      arcMat.uniforms.uS.value = 1;
      sparkScale = 2;
    }
    sparkMat.opacity = sparkA;
    spark.visible = sparkA > 0.01;
    sparkMat.color.copy(U.hot.value);
    markMat.color.copy(U.hot.value);
    dotMat.color.copy(U.trace.value);
    seaMat.color.copy(U.silk.value);
    pulseMat.color.copy(U.trace.value);
    snowMat.color.copy(U.silk.value);
    shaftMat.color.copy(U.trace.value);

    // ---------- labels ----------
    allTags().forEach((t) => (t.alpha = 0));
    if (w === 'dc' && k === 3 && p === 0) TG.projects[Math.round(pfW)] && (TG.projects[Math.round(pfW)].alpha = 1 - Math.min(1, Math.abs(pfW - Math.round(pfW)) * 3));
    if (w === 'ocean' && k === 4 && p === 0) TG.stops[Math.round(pfO)] && (TG.stops[Math.round(pfO)].alpha = 1 - Math.min(1, Math.abs(pfO - Math.round(pfO)) * 3));
    if (w === 'globe') {
      const a = k >= 5 ? 1 : sstep(0.66, 0.8, p);
      if (TG.akl) TG.akl.alpha = a;
      if (TG.you) TG.you.alpha = k >= 5 || S.override != null ? 1 : sstep(0.9, 1, p);
    }

    // ---------- camera ----------
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 4 || 1);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 4 || 1);
    if (Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.002) anim = Math.max(anim, 0.05);
    const dist = P.distanceTo(Lk);
    camera.position.copy(P);
    camera.lookAt(Lk);
    camera.updateMatrixWorld();
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(pointer.x * 0.025 * dist);
    tmp2.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-pointer.y * 0.018 * dist);
    camera.position.add(tmp).add(tmp2);
    camera.lookAt(Lk);
    camera.near = Math.max(0.05, dist * 0.01);
    camera.far = 3000;
    // the subject sits right of the text column (desktop) / above the text (mobile)
    const shift = T < 0.4 ? 0.24 : T < 0.92 ? lerp(0.24, 1, ease((T - 0.4) / 0.52)) : 1;
    if (mobile) camera.setViewOffset(view.w, view.h, 0, view.h * 0.2 * shift, view.w, view.h);
    else camera.setViewOffset(view.w, view.h, -view.w * 0.19 * shift, 0, view.w, view.h);
    camera.updateProjectionMatrix();

    // fog per place
    const fk = themeOpts.fogK;
    const fog = w === 'room' ? [dist * 1.2, dist * 4.2] : w === 'dc' ? [26, 150] : w === 'ocean' ? [18, 95] : [dist * 1.6, dist * 3];
    scene.fog.near = fog[0] * fk;
    scene.fog.far = fog[1] * fk;
    scene.fog.color.copy(U.bg.value);

    veilMat.uniforms.uOpacity.value = Math.max(cam.veil, S.jumpVeil);
    veil.visible = veilMat.uniforms.uOpacity.value > 0.001;
    spark.scale.setScalar(sparkScale * (0.6 + 0.4 * sstep(0, 1, U.glow.value)));
  }

  function projectTags() {
    if (!tagLayer) return;
    for (const t of allTags()) {
      let a = t.w === place_ ? t.alpha : 0;
      if (a > 0.01) {
        tmp.copy(t.pos).project(camera);
        if (tmp.z > 1 || tmp.z < -1) a = 0;
        else {
          const x = (tmp.x * 0.5 + 0.5) * view.w;
          const y = (-tmp.y * 0.5 + 0.5) * view.h;
          if (x < 8 || x > view.w - 8 || y < 90 || y > (mobile ? view.h * 0.5 : view.h - 20)) a = 0;
          t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
      }
      a = Math.round(a * 100) / 100;
      if (a !== t.shown) {
        t.el.style.opacity = a;
        t.el.style.visibility = a > 0.01 ? 'visible' : 'hidden';
        t.shown = a;
      }
    }
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
    const dt = lastRender ? Math.min(0.05, (now - lastRender) / 1000) : 0;
    lastRender = now;
    if (follow(dt)) anim = Math.max(anim, 0.05);
    const T = S.T;
    const glowTarget = T < 0.45 ? 0.9 : themeOpts.glowRest + 0.15;
    U.glow.value += (glowTarget - U.glow.value) * Math.min(1, dt * 6 || 1);
    if (Math.abs(glowTarget - U.glow.value) > 0.004) anim = Math.max(anim, 0.05);
    stepTheme(now);
    update(dt);
    const t0 = performance.now();
    renderer.render(scene, camera);
    const cost = performance.now() - t0;
    projectTags();
    // resolution governor: measures the draw itself (not idle gaps), steps down to 1× at most
    // and back up when there's room again.
    costs.push(cost);
    if (costs.length > 40) costs.shift();
    if (costs.length === 40) {
      const med = [...costs].sort((a, b) => a - b)[20];
      const next = med > 14 && dpr > 1 ? Math.max(1, dpr - 0.25) : med < 5 && dpr < dprMax ? Math.min(dprMax, dpr + 0.25) : dpr;
      if (next !== dpr) {
        dpr = next;
        renderer.setPixelRatio(dpr);
        resize();
        costs.length = 0;
      }
    }
  }

  function tick(now) {
    if (!running) return;
    const ambient = !S.calm && S.T < 0.9 && place_ === 'room';
    if (dirty || anim > 0) {
      dirty = false;
      anim = Math.max(0, anim - (lastRender ? (now - lastRender) / 1000 : 0));
      render(now);
    } else if (ambient && now - lastRender > 33) {
      render(now);
    } else if (lastRender && now - lastRender > 100) {
      lastRender = 0;
    }
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

  /* ---------------- public API ---------------- */
  return {
    setT(T) {
      if (Math.abs(T - S.Tt) < 1e-5) return;
      S.Tt = T;
      dirty = true;
    },
    // jump the eased state to the target (first frame, theme switch)
    settle() {
      S.T = S.calm ? Math.round(S.Tt) : S.Tt;
      for (let i = 0; i < 6; i++) S.L[i] = S.calm ? 0.5 : S.Lt[i];
      dirty = true;
    },
    setLocal(k, v) {
      if (Math.abs(S.Lt[k] - v) < 1e-5) return;
      S.Lt[k] = v;
      dirty = true;
    },
    setCalm(on) {
      S.calm = on;
      dirty = true;
    },
    setOverride(v) {
      S.override = v;
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
    // compile every place's shaders up front so the first visit to each doesn't hitch
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
      return { T: S.T, Tt: S.Tt, place: place_, dpr: renderer.getPixelRatio(), calls: renderer.info.render.calls };
    },
  };
}
