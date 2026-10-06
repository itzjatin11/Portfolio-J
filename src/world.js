// One persistent three.js world behind the whole page.
//
// The visit is a request to Jatin's machine: his profile is read off the SSD and carried to
// the CPU core along the real load path, and the camera travels with the data:
//   SSD → PCIe bus → DRAM → (lid) die caches → core register → FinFET → silicon lattice.
// Hardware on the board is side by side, so travel there is sideways. Only at the CPU lid do
// we change scale: the die lives in its own place (y = −120) and the transistor in another
// (y = −240). The camera swaps between them while fog briefly fills the screen with --bg.
//
// One number drives everything: T (0 hero … 1 storage … 5 core … 6 back on the board).
// Rendering is on demand: a frame is drawn only when T, the pointer, the theme or an in-scene
// animation changes.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Fog,
  Color,
  Vector3,
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
  TubeGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  CurvePath,
  LineCurve3,
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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const { clamp, lerp, smoothstep } = MathUtils;
const sstep = (a, b, x) => smoothstep(x, a, b);
const ease = (x) => x * x * (3 - 2 * x);
const bump = (x, a, b, c, d) => Math.min(sstep(a, b, x), 1 - sstep(c, d, x));
const V = (a) => new Vector3(a[0], a[1], a[2]);

const DIE_Y = -120;
const FIN_Y = -240;

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
  c = mix(c, uC1, clamp(t.r * uK.x * uGlow, 0.0, 1.0));
  c = mix(c, uC2, clamp(t.g * uK.y * uGlow, 0.0, 1.0));
  c = mix(c, uC3, clamp(t.b * uK.z, 0.0, 1.0));
${FS_TAIL}`;

// Copper traces drawn as tubes; uv.x runs along the wire so a band of light can ride it.
const VS_WIRE = /* glsl */ `
attribute float aPair; varying float vP; varying float vU;
#include <common>
#include <fog_pars_vertex>
void main() {
  vP = aPair; vU = uv.x;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS_WIRE = /* glsl */ `
varying float vP; varying float vU;
uniform vec3 uBoard, uTrace, uHot; uniform float uGlow; uniform float uS[8]; uniform float uBand; uniform float uOpacity;
#include <common>
#include <fog_pars_fragment>
void main() {
  int i = int(vP + 0.5);
  float s = uS[i];
  float g = s > -0.5 ? exp(-pow((vU - s) * uBand, 2.0)) : 0.0;
  vec3 c = mix(uBoard, uTrace, 0.32 + 0.5 * uGlow);
  c = mix(c, uHot, clamp(g, 0.0, 1.0));
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const fogU = () => UniformsUtils.clone(UniformsLib.fog);

function solid(key, { edge = 1, opacity = 1, transparent = false, emit = 'accent', depthWrite = true } = {}) {
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
    depthWrite,
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

function wireMaterial() {
  return new ShaderMaterial({
    uniforms: {
      ...fogU(),
      uBoard: U.board,
      uTrace: U.trace,
      uHot: U.hot,
      uGlow: U.glow,
      uS: { value: new Array(8).fill(-1) },
      uBand: { value: 30 },
      uOpacity: { value: 1 },
    },
    vertexShader: VS_WIRE,
    fragmentShader: FS_WIRE,
    fog: true,
  });
}

/* ------------------------------------------------------------------ helpers */
const dummy = new Object3D();
function place(mesh, i, pos, scale, rotY = 0) {
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

// Polyline with 45° chamfers, as a curve path (traces on a PCB never curve smoothly).
function polyPath(pts) {
  const path = new CurvePath();
  for (let i = 1; i < pts.length; i++) path.add(new LineCurve3(V(pts[i - 1]), V(pts[i])));
  return path;
}

/* Camera paths: one CatmullRom for position and one for the look target. The table remaps
   progress so perceived speed is constant: a step counts as (distance moved ÷ distance to
   subject) + |Δ log distance|, which is "log of view width" when diving straight in. */
function camPath(pos, look) {
  const pc = new CatmullRomCurve3(pos.map(V), false, 'centripetal');
  const lc = new CatmullRomCurve3(look.map(V), false, 'centripetal');
  const N = 240;
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
  return {
    atU(u, outP, outL) {
      pc.getPoint(clamp(u, 0, 1), outP);
      lc.getPoint(clamp(u, 0, 1), outL);
    },
    at(p, outP, outL) {
      p = clamp(p, 0, 1);
      let lo = 0;
      let hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < p) lo = mid;
        else hi = mid;
      }
      const f = (p - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
      const u = (lo + f) / N;
      pc.getPoint(u, outP);
      lc.getPoint(u, outL);
    },
  };
}

function piecewise(pts, x) {
  for (let i = 1; i < pts.length; i++)
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + (y1 - y0) * ease(clamp((x - x0) / (x1 - x0), 0, 1));
    }
  return pts[pts.length - 1][1];
}

/* ================================================================== WORLD */
export function createWorld(canvas, { mobile = false, still = false, tagLayer = null } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  let dprCap = mobile ? 1 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));

  const scene = new Scene();
  scene.fog = new Fog(0x000000, 10, 50);
  scene.background = U.bg.value;
  const camera = new PerspectiveCamera(mobile ? 72 : 48, 1, 0.05, 2000);

  const half = mobile ? 0.5 : 1;
  const boardW = new Group();
  const dieW = new Group();
  const finW = new Group();
  scene.add(boardW, dieW, finW);
  dieW.visible = finW.visible = false;

  const solids = []; // instanced meshes with per-key instance colours (none for now)

  /* ---------------- board ---------------- */
  const traces = TX.makeTraces(mobile ? 80 : 140);
  const board = new Mesh(new PlaneGeometry(TX.BOARD, TX.BOARD), channel(TX.boardTexture(traces, mobile ? 1024 : 2048), 'board', { k: [1, 1, 0.55] }));
  board.rotation.x = -Math.PI / 2;
  boardW.add(board);

  // CPU package: substrate, a small die preview, IHS lid (fades as we dive in) + its marking.
  const substrate = new Mesh(new BoxGeometry(6, 0.18, 6), solid('pcb'));
  substrate.position.y = 0.09;
  const dieTex = TX.dieTexture(mobile ? 1024 : 2048);
  const diePreview = new Mesh(new PlaneGeometry(4.4, 4.4), channel(dieTex, 'die', { k: [1, 1, 0.8] }));
  diePreview.rotation.x = -Math.PI / 2;
  diePreview.position.y = 0.185;
  const lidMat = solid('body', { transparent: true });
  const lid = new Mesh(new BoxGeometry(5.2, 0.15, 5.2), lidMat);
  lid.position.y = 0.255;
  const lidTopMat = channel(TX.lidTexture(), 'body', { transparent: true, k: [0.8, 1, 0.9] });
  const lidTop = new Mesh(new PlaneGeometry(5.2, 5.2), lidTopMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.3315;
  boardW.add(substrate, diePreview, lid, lidTop);

  // LGA: the package sits flat in a socket; a thin load frame around it, no leads
  const frame = boxes(
    [
      [[0, 0.05, -3.25], [6.9, 0.1, 0.35]],
      [[0, 0.05, 3.25], [6.9, 0.1, 0.35]],
      [[-3.25, 0.05, 0], [0.35, 0.1, 6.15]],
      [[3.25, 0.05, 0], [0.35, 0.1, 6.15]],
    ],
    solid('metal', { edge: 1 }),
  );
  boardW.add(frame);

  // Dark parts: SSD controller, NAND, connectors, DIMM chips, caps, VRM chokes, NIC …
  const NAND1 = [-12.0, 0.27, 10];
  const NAND2 = [-15.0, 0.27, 10];
  const parts = [
    [[-7.25, 0.17, 10], [0.7, 0.34, 3.2]], // M.2 connector
    [[-9.4, 0.24, 10], [1.5, 0.12, 1.5]], // controller
    [NAND1, [2.0, 0.18, 2.2]],
    [[-15.5, 0.27, 10], [1.0, 0.18, 2.2]], // NAND2, minus its cutaway corner
    [[-14.5, 0.27, 9.45], [1.0, 0.18, 1.1]],
    [[18, 0.8, -18], [2.0, 1.6, 2.4]], // NIC / RJ45
    [[8.5, 0.3, 0], [0.5, 0.6, 20.4]], // DIMM slots
    [[10, 0.3, 0], [0.5, 0.6, 20.4]],
  ];
  // VRM chokes + caps around the package
  for (let i = 0; i < 6; i++) parts.push([[-3.75 + i * 1.5, 0.35, -5.2], [1.1, 0.7, 1.1]]);
  const capR = TX.rng(5);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 4.3 + capR() * 0.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (x < -2.8 && z > -1.5) continue; // keep the PCIe entry clear
    if (x > 2.6 && z < 0.8) continue; // and the memory channel
    parts.push([[x, 0.08, z], [0.3, 0.16, 0.18]]);
  }
  const DIMM_X = [8.5, 10];
  const CHIP_Z = Array.from({ length: 8 }, (_, i) => -7.7 + i * 2.2);
  const chipList = [];
  DIMM_X.forEach((x) => [-1, 1].forEach((s) => CHIP_Z.forEach((z) => chipList.push([[x + s * 0.125, 2.7, z], [0.15, 1.2, 1.6]]))));
  const partsMesh = boxes(parts.concat(chipList), solid('body'));
  boardW.add(partsMesh);

  // controller label
  const ctrlLabel = new Mesh(new PlaneGeometry(1.4, 1.4), channel(TX.labelTexture(['nvme0n1', 'NVMe 2.0', 'ctrl · 4 ch']), 'body', { k: [0.8, 1, 0.9] }));
  ctrlLabel.rotation.x = -Math.PI / 2;
  ctrlLabel.position.set(-9.4, 0.302, 10);
  boardW.add(ctrlLabel);

  // M.2 SSD board
  const ssd = new Mesh(new BoxGeometry(10.7, 0.12, 2.9), channel(TX.ssdTexture(), 'pcb', { c3: 'gold', k: [1, 1, 1], edge: 0.6 }));
  ssd.position.set(-13, 0.12, 10);
  boardW.add(ssd);

  // NAND cutaway: 24 word-line plates pierced by channel holes (magnified, not to scale)
  const stack = new Group();
  stack.position.set(-14.5, 0.18, 10.55);
  const plateN = 24;
  const plates = new InstancedMesh(new BoxGeometry(0.92, 0.016, 1.02), solid('metal', { edge: 0.6 }), plateN);
  for (let i = 0; i < plateN; i++) place(plates, i, [0, 0.02 + i * 0.026, 0], [1, 1, 1]);
  const holeGrid = 5;
  const holes = new InstancedMesh(new CylinderGeometry(0.02, 0.02, 1, 6), solid('trace', { edge: 0 }), holeGrid * holeGrid);
  for (let i = 0; i < holeGrid * holeGrid; i++) {
    const x = ((i % holeGrid) - 2) * 0.17;
    const z = (((i / holeGrid) | 0) - 2) * 0.19;
    place(holes, i, [x, 0.33, z], [1, 0.68, 1]);
  }
  stack.add(plates, holes);
  boardW.add(stack);

  /* ---------------- PCIe ×4: 8 differential pairs = 16 wires ---------------- */
  const pcieWires = [];
  const pcieGeos = [];
  const vias = [];
  for (let p = 0; p < 8; p++)
    for (let w = 0; w < 2; w++) {
      const o = (p - 3.5) * 0.32 + (w - 0.5) * 0.1;
      const z0 = 10 + o;
      const xc = -5.0 + o;
      const ze = 0.6 + o;
      const c = 0.3;
      const pts = [[-6.85, 0.03, z0], [xc - c, 0.03, z0], [xc, 0.03, z0 - c]];
      // serpentine length matching on the long run
      const n = p % 3 === 1 ? 0 : 2 + (p % 2);
      for (let j = 0; j < n; j++) {
        const zb = 7.6 - p * 0.28 - j * 0.9;
        pts.push([xc, 0.03, zb + 0.18], [xc + 0.1, 0.03, zb + 0.1], [xc + 0.1, 0.03, zb - 0.1], [xc, 0.03, zb - 0.18]);
      }
      pts.push([xc, 0.03, ze + c], [xc + c, 0.03, ze], [-3.15, 0.03, ze]);
      const path = polyPath(pts);
      const geo = new TubeGeometry(path, 200, 0.03, 4, false);
      geo.setAttribute('aPair', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(p), 1));
      pcieGeos.push(geo);
      // z → u lookup on the long run, so a spark can be placed under the camera
      const samples = [];
      const tmp = new Vector3();
      for (let i = 0; i <= 400; i++) {
        path.getPointAt(i / 400, tmp);
        samples.push([i / 400, tmp.z]);
      }
      pcieWires.push({ path, pair: p, samples });
      vias.push([-6.85, z0], [-3.15, ze]);
    }
  const pcieMat = wireMaterial();
  const pcie = new Mesh(mergeGeometries(pcieGeos), pcieMat);
  pcieGeos.forEach((g) => g.dispose());
  boardW.add(pcie);
  const viaMesh = new InstancedMesh(new CylinderGeometry(0.075, 0.075, 0.02, 10), solid('gold', { edge: 0 }), vias.length);
  vias.forEach(([x, z], i) => place(viaMesh, i, [x, 0.03, z], [1, 1, 1]));
  boardW.add(viaMesh);
  function uAtZ(wire, z) {
    const s = wire.samples;
    for (let i = 60; i < s.length - 40; i++) if (s[i][1] <= z) return s[i][0];
    return s[s.length - 41][0];
  }

  /* ---------------- memory channel: 32 wires to DIMM A1 ---------------- */
  const memGeos = [];
  const memPaths = [];
  for (let i = 0; i < 24; i++) {
    const zs = -1 + (i - 11.5) * 0.09;
    const xc = 5.0 + i * 0.09;
    const ze = -9.6 + (i - 11.5) * 0.09;
    const c = 0.25;
    const path = polyPath([
      [3.05, 0.025, zs],
      [xc - c, 0.025, zs],
      [xc, 0.025, zs - c],
      [xc, 0.025, ze + c],
      [xc + c, 0.025, ze],
      [8.1, 0.025, ze],
    ]);
    memPaths.push(path);
    const geo = new TubeGeometry(path, 60, 0.024, 3, false);
    geo.setAttribute('aPair', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(0), 1));
    memGeos.push(geo);
  }
  const memMat = wireMaterial();
  memMat.uniforms.uBand.value = 14;
  const mem = new Mesh(mergeGeometries(memGeos), memMat);
  memGeos.forEach((g) => g.dispose());
  boardW.add(mem);

  /* ---------------- DIMMs ---------------- */
  const dimmMat = channel(TX.dimmTexture(), 'pcb', { c3: 'gold', edge: 0.7 });
  DIMM_X.forEach((x) => {
    const pcb = new Mesh(new BoxGeometry(0.1, 4.5, 19.5), dimmMat);
    pcb.position.set(x, 2.6, 0);
    boardW.add(pcb);
  });
  // DRAM decals: word/bit-line crossbar with capacitor dots; one row lights when the page lands
  const decalMat = new MeshBasicMaterial({ map: TX.dramDecal(), transparent: true, depthWrite: false, fog: true });
  const decals = new InstancedMesh(new PlaneGeometry(1.42, 1.04), decalMat, chipList.length);
  const decalSides = [];
  DIMM_X.forEach((x) =>
    [-1, 1].forEach((s) =>
      CHIP_Z.forEach((z) => {
        const i = decalSides.length;
        place(decals, i, [x + s * 0.202, 2.7, z], [1, 1, 1], s * (Math.PI / 2));
        decalSides.push({ dimm: x, side: s, z });
      }),
    ),
  );
  const decalLevel = new Float32Array(chipList.length);
  const decalCol = new Color();
  function paintDecals() {
    for (let i = 0; i < decalLevel.length; i++) {
      const lv = decalLevel[i];
      decalCol.copy(U.trace.value).multiplyScalar(0.35 + 0.25 * U.glow.value).lerp(U.hot.value, clamp(lv, 0, 1));
      decals.setColorAt(i, decalCol);
    }
    decals.instanceColor.needsUpdate = true;
  }
  decals.setColorAt(0, decalCol);
  boardW.add(decals);

  /* ---------------- board pulses (hero ambience) ---------------- */
  const pulseCount = mobile ? 120 : 260;
  const pulseGeo = new BufferGeometry();
  const pulsePos = new Float32Array(pulseCount * 3);
  pulseGeo.setAttribute('position', new BufferAttribute(pulsePos, 3).setUsage(DynamicDrawUsage));
  const glowTex = TX.glowTexture();
  const pulseMat = new PointsMaterial({ size: mobile ? 0.36 : 0.26, map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true });
  const pulseLayer = new Points(pulseGeo, pulseMat);
  boardW.add(pulseLayer);
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

  /* ---------------- data in flight: packet, 16 sparks, the 64-byte line ---------------- */
  const packetMat = new SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, fog: false });
  const packet = new Sprite(packetMat);
  packet.scale.setScalar(0.9);
  scene.add(packet);
  const sparkGeo = new BufferGeometry();
  const sparkPos = new Float32Array(16 * 3);
  sparkGeo.setAttribute('position', new BufferAttribute(sparkPos, 3).setUsage(DynamicDrawUsage));
  const sparkMat = new PointsMaterial({ size: 0.42, map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const sparks = new Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  boardW.add(sparks);
  const lineMat = solid('hot', { edge: 0 });
  lineMat.uniforms.uEmitAmt.value = 0.6;
  const line = new Mesh(new BoxGeometry(1, 1, 1), lineMat);
  scene.add(line);

  /* ---------------- die world (built lazily) ---------------- */
  let dieBuilt = false;
  const D = {};
  function buildDie() {
    if (dieBuilt) return;
    dieBuilt = true;
    dieW.position.y = DIE_Y;
    const plane = new Mesh(new PlaneGeometry(TX.DIE.size, TX.DIE.size), channel(dieTex, 'die', { k: [1, 1, 0.8] }));
    plane.rotation.x = -Math.PI / 2;
    dieW.add(plane);
    // raised blocks: core outlines, L2 strips, L1 caches, ALU
    const blk = [];
    TX.DIE.coreX.forEach((cx) =>
      [1, -1].forEach((sgn) => {
        const near = sgn > 0 ? -3.1 : 3.1;
        const zL2 = near - sgn * 0.95;
        blk.push([[cx, 0.05, zL2], [5.4, 0.1, 1.5]]);
        blk.push([[cx - 1.4, 0.08, near - sgn * 2.8], [2.4, 0.16, 1.55]]);
        blk.push([[cx + 1.4, 0.08, near - sgn * 2.8], [2.4, 0.16, 1.55]]);
      }),
    );
    D.alu = blk.length;
    blk.push([[3.25, 0.12, -12.4], [3.0, 0.24, 1.2]]);
    D.blocks = boxes(blk, solid('die', { edge: 1, transparent: false }));
    D.blocks.material.uniforms.uEdgeK.value = 1.6;
    dieW.add(D.blocks);
    // the ALU gets its own instance colour so it can pulse
    D.aluMat = solid('body', { edge: 1.5 });
    D.aluMesh = new Mesh(new BoxGeometry(3.0, 0.24, 1.2), D.aluMat);
    D.aluMesh.position.set(3.25, 0.13, -12.4);
    dieW.add(D.aluMesh);
    // L3: instanced SRAM cells
    const cols = mobile ? 40 : 64;
    const rows = mobile ? 8 : 12;
    D.cells = new InstancedMesh(new BoxGeometry(1, 1, 1), solid('pcb', { edge: 1.6 }), cols * rows);
    let n = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        place(D.cells, n++, [-12.6 + (c + 0.5) * (25.2 / cols), 0.03, -2.2 + (r + 0.5) * (4.4 / rows)], [(25.2 / cols) * 0.7, 0.06, (4.4 / rows) * 0.6]);
    D.cells.material.uniforms.uOpacity.value = 1;
    D.cellsMat = D.cells.material;
    dieW.add(D.cells);
    // register file in core 0: 64 bars; bar #0 is R0
    D.regs = new InstancedMesh(new BoxGeometry(1, 1, 1), solid('metal', { edge: 1 }), 64);
    for (let i = 0; i < 64; i++) place(D.regs, i, [3.25, 0.05, -8.36 - i * 0.045], [4.0, 0.1, 0.03]);
    dieW.add(D.regs);
    D.r0Mat = solid('hot', { edge: 0 });
    D.r0 = new Mesh(new BoxGeometry(4.02, 0.104, 0.034), D.r0Mat);
    D.r0.position.set(3.25, 0.05, -8.36);
    dieW.add(D.r0);
    // 8 bytes heading for R0
    D.bytes = new InstancedMesh(new BoxGeometry(0.42, 0.06, 0.06), solid('hot', { edge: 0 }), 8);
    D.bytes.material.uniforms.uEmitAmt.value = 0.5;
    dieW.add(D.bytes);
  }

  /* ---------------- FinFET world (built lazily) ---------------- */
  let finBuilt = false;
  const F = {};
  function buildFin() {
    if (finBuilt) return;
    finBuilt = true;
    finW.position.y = FIN_Y;
    const floor = new Mesh(new PlaneGeometry(40, 40), channel(TX.gridTexture(), 'die', { k: [1, 1, 1] }));
    floor.rotation.x = -Math.PI / 2;
    finW.add(floor);
    F.finMat = solid('metal', { edge: 1, transparent: true });
    F.fins = new InstancedMesh(new BoxGeometry(12, 0.9, 0.3), F.finMat, 6);
    for (let i = 0; i < 6; i++) place(F.fins, i, [0, 0.45, (i - 2.5) * 1.6], [1, 1, 1]);
    F.gateMat = solid('body', { edge: 1.4, transparent: true });
    F.gates = new InstancedMesh(new BoxGeometry(0.6, 1.4, 12), F.gateMat, 4);
    [-6.6, -4.4, 2.2, 4.4].forEach((x, i) => place(F.gates, i, [x, 0.7, 0], [1, 1, 1]));
    F.litMat = solid('body', { edge: 1.4, transparent: true });
    F.lit = new Mesh(new BoxGeometry(0.6, 1.4, 12), F.litMat); // gate that the bit switches on
    F.lit.position.set(-2.2 + 2.2, 0.7, 0);
    finW.add(F.fins, F.gates, F.lit);
    // a current pulse running along one fin
    F.pulse = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }));
    F.pulse.scale.setScalar(1.4);
    finW.add(F.pulse);
    // diamond-cubic silicon lattice + bonds, magnified at the gate/fin crossing
    const cells = mobile ? 4 : 6;
    const a = 0.55;
    const basis = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0], [0.25, 0.25, 0.25], [0.25, 0.75, 0.75], [0.75, 0.25, 0.75], [0.75, 0.75, 0.25]];
    const atoms = [];
    for (let x = 0; x < cells; x++) for (let y = 0; y < cells; y++) for (let z = 0; z < cells; z++) basis.forEach((b) => atoms.push([(x + b[0]) * a, (y + b[1]) * a, (z + b[2]) * a]));
    const size = cells * a;
    const off = [-size / 2, 0.2, -size / 2];
    F.atoms = atoms.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
    F.atomR = F.atoms.map((p) => Math.hypot(p[0], p[1] - size / 2, p[2]));
    F.atomMax = Math.max(...F.atomR);
    F.lattice = new InstancedMesh(new SphereGeometry(0.06, mobile ? 8 : 10, mobile ? 6 : 8), solid('trace', { edge: 0, emit: 'die' }), F.atoms.length);
    F.lattice.material.uniforms.uEmitAmt.value = dark ? 0.35 : 0.05;
    F.lattice.instanceMatrix.setUsage(DynamicDrawUsage);
    finW.add(F.lattice);
    const bonds = [];
    const nn = a * Math.sqrt(3) * 0.25 + 0.01;
    for (let i = 0; i < atoms.length; i++)
      for (let j = i + 1; j < atoms.length; j++) {
        const d = Math.hypot(atoms[i][0] - atoms[j][0], atoms[i][1] - atoms[j][1], atoms[i][2] - atoms[j][2]);
        if (d < nn) bonds.push(...F.atoms[i], ...F.atoms[j]);
      }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new Float32BufferAttribute(bonds, 3));
    F.bondMat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: true });
    F.bonds = new LineSegments(bg, F.bondMat);
    finW.add(F.bonds);
    F.latticeShown = -1;
  }

  /* ================================================================ camera rig */
  // Station poses, each as a function of that station's local progress L (0..1).
  const ST = [
    () => [[1.5, 21, 25], [0.5, 0, -1]],
    (L) => [[lerp(-6.8, -7.3, L), lerp(5.4, 5.0, L), lerp(16.4, 16.0, L)], [-12.6, 0.2, 10.3]],
    (L) => {
      const z = lerp(8.6, 1.6, L);
      return [[-0.2, 4.6, z], [-5.0, 0, z - 0.3]];
    },
    (L) => {
      const z = chipZ(L * 4);
      return [[4.4, 3.5, z - 1.0], [8.4, 2.5, z]];
    },
    (L) => [[lerp(6.2, 4.6, L), DIE_Y + lerp(9.8, 7.4, L), lerp(6.4, -1.4, L)], [lerp(3.0, 2.5, L), DIE_Y, lerp(0.2, -5.4, L)]],
    (L) => [[lerp(6.4, 5.8, L), FIN_Y + lerp(4.8, 4.3, L), lerp(7.6, 7.0, L)], [0, FIN_Y + 1.5, 0]],
  ];
  const PROJECT_CHIP = [0, 2, 3, 5, 7];
  function chipZ(pf) {
    const i = clamp(Math.floor(pf), 0, 3);
    const f = ease(clamp(pf - i, 0, 1));
    return lerp(CHIP_Z[PROJECT_CHIP[i]], CHIP_Z[PROJECT_CHIP[i + 1]], f);
  }
  const at = (k, L) => ST[k](L);

  // Seams: one or two phases. A phase spans part of the seam's progress in one place (world).
  const SEAMS = [
    // 0 · hero: wide on the board → past the CPU lid → across to the SSD
    [
      {
        a: 0, b: 1, w: 'board',
        path: camPath(
          [[1.5, 21, 25], [1.6, 12, 14.5], [2.6, 4.4, 5.4], [-1.5, 5.2, 11.5], [-5.4, 5.6, 16.0], at(1, 0)[0]],
          [[0.5, 0, -1], [0.2, 0, -0.4], [0, 0.3, 0], [-6, 0.3, 7], [-11.4, 0.3, 9.8], at(1, 0)[1]],
        ),
      },
    ],
    // 1 · storage → PCIe: chase the page low along the SSD, then rise over the pairs
    [
      {
        a: 0, b: 1, w: 'board',
        path: camPath(
          [at(1, 1)[0], [-11.6, 1.6, 13.4], [-10.4, 0.8, 11.9], [-7.4, 0.85, 11.4], [-4.4, 2.0, 10.2], at(2, 0)[0]],
          [at(1, 1)[1], [-12.2, 0.3, 10.1], [-8.4, 0.25, 10.0], [-6.0, 0.1, 9.4], [-5.0, 0, 8.6], at(2, 0)[1]],
        ),
      },
    ],
    // 2 · PCIe → DRAM: rise over the package, across the memory channel, drop beside the DIMM
    [
      {
        a: 0, b: 1, w: 'board',
        path: camPath(
          [at(2, 1)[0], [1.0, 6.2, 0.8], [4.6, 5.6, -6.4], [6.3, 4.1, -12.0], at(3, 0)[0]],
          [at(2, 1)[1], [1.5, 0.3, -1.5], [7.0, 1.0, -9.0], [8.4, 1.8, -9.2], at(3, 0)[1]],
        ),
      },
    ],
    // 3 · DRAM → cache: back over the board, dive at the lid; fog swap; arrive above the die
    [
      {
        a: 0, b: 0.62, w: 'board',
        path: camPath(
          [at(3, 1)[0], [5.8, 6.6, 2.6], [3.0, 4.0, 1.8], [1.0, 1.6, 0.9], [0.1, 0.55, 0.15]],
          [at(3, 1)[1], [5.5, 0.5, -4.0], [0.8, 0.3, -0.5], [0.1, 0.33, 0], [0, 0.33, 0]],
        ),
      },
      {
        a: 0.62, b: 1, w: 'die',
        path: camPath(
          [[4.4, DIE_Y + 30, 15], [5.6, DIE_Y + 18, 9], at(4, 0)[0]],
          [[2.0, DIE_Y, -2.0], [2.6, DIE_Y, -3.4], at(4, 0)[1]],
        ),
      },
    ],
    // 4 · cache → core → transistor: down into core 0, into register R0; fog swap; FinFETs
    [
      {
        a: 0, b: 0.58, w: 'die',
        // the register beat: arrive over the register file, linger while R0 fills, then dive into it
        warpU: [[0, 0], [0.3, 0.5], [0.8, 0.6], [1, 1]],
        path: camPath(
          [at(4, 1)[0], [4.8, DIE_Y + 4.2, -4.4], [4.4, DIE_Y + 1.9, -6.3], [3.7, DIE_Y + 0.8, -7.4], [3.27, DIE_Y + 0.17, -8.27]],
          [at(4, 1)[1], [3.1, DIE_Y, -7.6], [3.25, DIE_Y, -9.0], [3.25, DIE_Y + 0.05, -8.6], [3.25, DIE_Y + 0.1, -8.36]],
        ),
      },
      {
        a: 0.58, b: 1, w: 'fin',
        path: camPath(
          [[11, FIN_Y + 10, 14], [8, FIN_Y + 6, 10], at(5, 0)[0]],
          [[0, FIN_Y, 0], [0.2, FIN_Y + 0.8, 0.3], at(5, 0)[1]],
        ),
      },
    ],
    // 5 · outro: calm pull-back to the opening wide shot of the board
    [
      {
        a: 0, b: 0.22, w: 'fin',
        path: camPath([at(5, 1)[0], [7.4, FIN_Y + 5.6, 9.2]], [at(5, 1)[1], [0, FIN_Y + 1.2, 0]]),
      },
      {
        a: 0.22, b: 1, w: 'board',
        path: camPath([[1.4, 3.4, 4.6], [1.0, 10, 13.5], [1.5, 21, 25]], [[0, 0.3, 0], [0.2, 0.1, -0.5], [0.5, 0, -1]]),
      },
    ],
  ];
  // Fog closure (1 = screen is pure --bg) around each place swap.
  function fogClose(k, p) {
    if (k === 3) return Math.max(sstep(0.53, 0.615, p) * (p < 0.62 ? 1 : 0), p >= 0.62 ? 1 - sstep(0.62, 0.7, p) : 0);
    if (k === 4) return Math.max(sstep(0.5, 0.575, p) * (p < 0.58 ? 1 : 0), p >= 0.58 ? 1 - sstep(0.58, 0.65, p) : 0);
    if (k === 5) return Math.max(sstep(0.04, 0.215, p) * (p < 0.22 ? 1 : 0), p >= 0.22 ? 1 - sstep(0.22, 0.42, p) : 0);
    return 0;
  }

  /* ================================================================ state */
  const S = {
    T: 0,
    L: [0, 0, 0, 0, 0, 0],
    level: 1, // cache level of the current commit (1..3)
    pair: new Float32Array(8).fill(-9), // spark phase per PCIe pair (-1 → 1 crosses the view), -9 = none
    gatePulse: 0,
    override: null, // T used by the on-submit round trip
    tagBand: null,
    bandKey: '',
  };
  const lineHop = { cur: new Vector3(), target: new Vector3(), init: false };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const view = { w: 1, h: 1, shift: 0 };
  const P = new Vector3();
  const Lk = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  let place_ = 'board';
  let fogF = 0;
  let glowTarget = 0.8;
  let lastTChange = 0;
  let dirty = true;
  let running = true;
  let lastRender = 0;
  let anim = 0; // seconds of "keep rendering" left for short in-scene animations
  const frameTimes = [];
  let dprDropped = false;

  function stationOf(T) {
    return T >= 6 ? 6 : Math.floor(T + 1e-6);
  }

  // Camera pose for a given T (pure, so the round trip can replay it backwards).
  function cameraFor(T, outP, outL) {
    if (T >= 6) {
      outP.set(1.5, 21, 25);
      outL.set(0.5, 0, -1);
      return { w: 'board', f: 0, k: 6, p: 0 };
    }
    const k = Math.floor(T);
    const p = T - k;
    if (p < 1e-6 && k > 0) {
      const [a, b] = at(k, S.L[k]);
      outP.fromArray(a);
      outL.fromArray(b);
      const w = k <= 3 ? 'board' : k === 4 ? 'die' : 'fin';
      return { w, f: 0, k, p: 0, station: true };
    }
    const q = p;
    const phases = SEAMS[k];
    const ph = phases.find((x) => q >= x.a && q <= x.b) || phases[phases.length - 1];
    const lq = (q - ph.a) / (ph.b - ph.a);
    if (ph.warpU) ph.path.atU(piecewise(ph.warpU, lq), outP, outL);
    else ph.path.at(lq, outP, outL);
    // carry the stations' live local progress in and out of the seam (no jumps)
    if (ph === phases[0] && k >= 1) {
      const wgt = 1 - sstep(0, 0.4, lq);
      if (wgt > 0) {
        const [ra, rb] = at(k, 1);
        const [la, lb] = at(k, S.L[k]);
        outP.add(tmp.fromArray(la).sub(tmp2.fromArray(ra)).multiplyScalar(wgt));
        outL.add(tmp.fromArray(lb).sub(tmp2.fromArray(rb)).multiplyScalar(wgt));
      }
    }
    if (ph === phases[phases.length - 1] && k + 1 <= 5) {
      const wgt = sstep(0.6, 1, lq);
      if (wgt > 0) {
        const [ra, rb] = at(k + 1, 0);
        const [la, lb] = at(k + 1, S.L[k + 1]);
        outP.add(tmp.fromArray(la).sub(tmp2.fromArray(ra)).multiplyScalar(wgt));
        outL.add(tmp.fromArray(lb).sub(tmp2.fromArray(rb)).multiplyScalar(wgt));
      }
    }
    return { w: ph.w, f: fogClose(k, q), k, p: q };
  }

  /* ---------------- tags (HTML labels anchored in the scene) ---------------- */
  const tags = [];
  function tag(text, { cls = '', w = 'board' } = {}) {
    if (!tagLayer) return null;
    const el = document.createElement('span');
    el.className = `tag mono ${cls}`;
    el.textContent = text;
    tagLayer.appendChild(el);
    const t = { el, pos: new Vector3(), alpha: 0, w, shown: -1 };
    tags.push(t);
    return t;
  }
  const TG = {
    cpu: tag("CPU · where we're going"),
    cut: tag('cutaway · not to scale'),
    page: tag('LBA 4 KiB', { cls: 'tag--hot' }),
    land: tag('4 KiB @ 0x7F3A…', { cls: 'tag--hot' }),
    line: tag('JATIN SINGH TAADIYAL|FULL-STACK DEV|C#/.NET SQL NODE|AKL NZ 2026', { cls: 'tag--line' }),
    l1: tag('L1 · 1 ns', { w: 'die' }),
    l2: tag('L2 · 3 ns', { w: 'die' }),
    l3: tag('L3 · 10 ns', { w: 'die' }),
    r0: tag('register · r0 = JATIN SI · 4A 41 54 49 4E 20 53 49', { w: 'die', cls: 'tag--hot' }),
    u: [1, 2, 3, 4, 5].map((n) => tag(`U${n}`, { cls: 'tag--chip' })),
    alu: tag('ALU', { w: 'die' }),
    gate: tag('gate · bit = 1', { w: 'fin', cls: 'tag--hot' }),
    lat: tag('silicon lattice · not to scale', { w: 'fin' }),
    trip: tag('', { cls: 'tag--hot' }),
  };
  if (TG.l1) {
    TG.l1.pos.set(1.0, DIE_Y + 0.2, -5.9);
    TG.l2.pos.set(-0.6, DIE_Y + 0.2, -4.0);
    TG.l3.pos.set(-1.2, DIE_Y + 0.2, 0.2);
    TG.r0.pos.set(2.2, DIE_Y + 0.14, -8.36);
    TG.alu.pos.set(4.9, DIE_Y + 0.25, -12.4);
    TG.gate.pos.set(0, FIN_Y + 1.5, -4.2);
    TG.lat.pos.set(-1.7, FIN_Y + 3.2, 1.0);
    TG.cpu.pos.set(0, 0.5, -1.2);
    TG.cut.pos.set(-14.3, 1.2, 10.9);
  }

  /* ---------------- theme ---------------- */
  let dark = true;
  function applyBlend() {
    const b = dark ? AdditiveBlending : NormalBlending;
    [packetMat, sparkMat, pulseMat].forEach((m) => {
      m.blending = b;
      m.needsUpdate = true;
    });
    if (F.pulse) F.pulse.material.blending = b;
  }

  const theme = { t: 1, dur: 0.4, start: 0, from: null, to: null };
  const themeOpts = { glowRest: 0.55, fogK: 1 };
  function stepTheme(now) {
    if (!theme.to || theme.t >= 1) return;
    theme.t = theme.dur > 0 ? Math.min(1, (now - theme.start) / (theme.dur * 1000)) : 1;
    const e = ease(theme.t);
    KEYS.forEach((key) => U[key].value.copy(theme.from[key]).lerp(theme.to[key], e));
    U.edgeAmt.value = lerp(theme.edgeFrom, theme.edgeTo, e);
    decals.userData.glow = -1; // force a decal repaint
    if (theme.t < 1) anim = Math.max(anim, 0.05);
  }

  /* ================================================================ update */
  const lidBase = new Vector3();
  function update(dt) {
    const T = S.override ?? S.T;
    const cam = cameraFor(T, P, Lk);
    const k = cam.k;
    const p = cam.p;
    const w = cam.w;
    place_ = w;

    // places: only the one the camera is in is drawn
    boardW.visible = w === 'board';
    if (w === 'die') buildDie();
    if (w === 'fin') buildFin();
    dieW.visible = w === 'die';
    finW.visible = w === 'fin';

    // board sub-visibility: current station ± neighbours
    const nearSSD = T < 2.7 || T > 5;
    stack.visible = nearSSD;
    pcie.visible = viaMesh.visible = T > 0.3 && T < 3.4 || T > 5;
    decals.visible = T > 1.4 || T < 0.4;
    mem.visible = T > 1.5 || T < 0.4;
    const pulsesOn = !still && (T < 0.95 || T > 5.5);
    pulseLayer.visible = pulsesOn;
    if (pulsesOn && dt > 0) placePulses(dt);

    // NAND stack rises out of its package as we arrive at storage
    stack.scale.y = lerp(0.2, 1, sstep(0.68, 0.98, Math.min(T, 1.0)) * (T > 5 ? 0.2 : 1));

    // lid: opaque except while we're inside the package
    let lidA = 1;
    if (k === 3) lidA = 1 - sstep(0.42, 0.56, p);
    if (k === 4 || (k === 5 && T < 5.22) || (k === 3 && p >= 0.62)) lidA = 0;
    if (T >= 5.22) lidA = 1;
    lidMat.uniforms.uOpacity.value = lidA;
    lidTopMat.uniforms.uOpacity.value = lidA;
    lid.visible = lidTop.visible = lidA > 0.01;
    lidMat.depthWrite = lidTopMat.depthWrite = lidA > 0.99;

    // ---------- the data ----------
    packet.visible = false;
    sparks.visible = false;
    line.visible = false;
    pcieMat.uniforms.uS.value.fill(-1);
    memMat.uniforms.uS.value[0] = -1;
    decalLevel.fill(0);
    const setTag = (t, a, pos) => {
      if (!t) return;
      t.alpha = a;
      if (pos) t.pos.copy(pos);
    };
    Object.values(TG).flat().forEach((t) => t && (t.alpha = 0));

    if (S.override == null) {
      setTag(TG.cpu, bump(T, 0.12, 0.22, 0.48, 0.6));
      setTag(TG.cut, bump(T, 0.82, 0.95, 1.12, 1.28));
    }
    const ssdPath = [V([-14.5, 0.55, 10.4]), V([-12.0, 0.5, 10.0]), V([-9.4, 0.48, 10.0]), V([-7.25, 0.42, 10.0])];
    const along = (pts, f, out) => {
      const n = pts.length - 1;
      const i = clamp(Math.floor(f * n), 0, n - 1);
      return out.copy(pts[i]).lerp(pts[i + 1], f * n - i);
    };
    const sparkTo = (fn) => {
      for (let i = 0; i < 16; i++) {
        const wire = pcieWires[i];
        const u = fn(wire, i);
        if (u < 0) {
          sparkPos[i * 3 + 1] = -999;
          continue;
        }
        wire.path.getPointAt(clamp(u, 0, 1), tmp);
        sparkPos[i * 3] = tmp.x;
        sparkPos[i * 3 + 1] = 0.12;
        sparkPos[i * 3 + 2] = tmp.z;
        pcieMat.uniforms.uS.value[wire.pair] = u;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.visible = true;
    };

    if (S.override != null) {
      // on-submit round trip: the reply rides back out, past the network card
      packet.visible = true;
      packet.scale.setScalar(Math.max(0.15, P.distanceTo(Lk) * 0.12));
      if (T < 0.7) {
        const f = 1 - T / 0.7;
        packet.position.set(lerp(0, 18, Math.min(1, f * 1.4)), 0.9, lerp(0, -18, Math.min(1, f * 1.4)));
        if (f > 0.72) packet.position.x += (f - 0.72) * 40;
        setTag(TG.trip, bump(f, 0.1, 0.25, 0.85, 1), tmp.set(18, 2.0, -18));
      } else packet.position.copy(Lk);
    } else if (k === 1 && p > 0) {
      // the page leaves the NAND, rides the SSD to the connector, then splits into 16 sparks
      if (p < 0.47) {
        packet.visible = true;
        along(ssdPath, sstep(0.02, 0.45, p), packet.position);
        packet.scale.setScalar(0.85);
        setTag(TG.page, bump(p, 0.0, 0.06, 0.38, 0.46), tmp.copy(packet.position).add(tmp2.set(0, 0.35, 0)));
      }
      if (p > 0.42) {
        const f = sstep(0.42, 1, p);
        sparkTo((wire) => lerp(0, uAtZ(wire, 9.0), f));
      }
    } else if (k === 2 && p < 1e-6) {
      // skills station: one spark per pair, driven by the cards; it crosses the view as its card does
      const zt = lerp(8.6, 1.6, S.L[2]);
      sparkTo((wire) => {
        const s = S.pair[wire.pair];
        return s < -1.5 ? -1 : uAtZ(wire, zt + 2.8 - (s + 1) * 2.8);
      });
    } else if (k === 2) {
      if (p < 0.29) sparkTo((wire) => lerp(uAtZ(wire, 1.6), 1, sstep(0, 0.28, p)));
      if (p > 0.25 && p < 0.78) {
        const f = sstep(0.27, 0.76, p);
        memMat.uniforms.uS.value[0] = f;
        packet.visible = true;
        memPaths[12].getPointAt(f, packet.position);
        packet.position.y = 0.2;
        packet.scale.setScalar(1.1);
      }
      if (p >= 0.76) {
        const f = sstep(0.76, 0.95, p);
        packet.visible = f < 1;
        packet.position.set(8.25, lerp(0.3, 2.7, f), lerp(-9.6, CHIP_Z[0], f));
        packet.scale.setScalar(0.9);
        const lit = sstep(0.86, 1, p);
        for (let i = 0; i < 8; i++) decalLevel[i] = lit;
        setTag(TG.land, sstep(0.8, 0.92, p), tmp.set(8.3, 3.55, CHIP_Z[0]));
      }
    } else if (k === 3 && p < 1e-6) {
      // work station: the current project's chip is lit
      const pf = S.L[3] * 4;
      for (let i = 0; i < 5; i++) decalLevel[PROJECT_CHIP[i]] = clamp(1 - Math.abs(pf - i) * 1.4, 0, 1);
      // a read strobe runs along the DIMM bus from one chip to the next between projects
      const i0 = Math.min(3, Math.floor(pf));
      const f = pf - i0;
      if (f > 0.02 && f < 0.98) {
        packet.visible = true;
        const zz = lerp(CHIP_Z[PROJECT_CHIP[i0]], CHIP_Z[PROJECT_CHIP[i0 + 1]], sstep(0.05, 0.95, f));
        const up = Math.min(sstep(0, 0.15, f), 1 - sstep(0.85, 1, f));
        packet.position.set(8.32, lerp(2.7, 0.95, up), zz);
        packet.scale.setScalar(0.7);
      }
      TG.u?.forEach((t, n) => setTag(t, n === Math.round(pf) ? 1 : 0.55, tmp.set(8.3, 1.9, CHIP_Z[PROJECT_CHIP[n]])));
    } else if (k === 3) {
      // a 64-byte line rides back to the package, then on into the die
      for (let i = 0; i < 5; i++) decalLevel[PROJECT_CHIP[i]] = Math.max(0, (1 - Math.abs(4 - i) * 1.4) * (1 - sstep(0, 0.1, p)));
      line.visible = p < 0.48 || p > 0.66;
      if (p < 0.48) {
        line.scale.set(0.12, 0.08, 1.4);
        const z0 = chipZ(4);
        if (p < 0.18) line.position.set(8.25, lerp(2.7, 0.2, sstep(0, 0.18, p)), lerp(z0, -9.6, sstep(0.0, 0.18, p)));
        else {
          const f = 1 - sstep(0.18, 0.44, p);
          memPaths[12].getPointAt(f, line.position);
          line.position.y = 0.2;
          memMat.uniforms.uS.value[0] = f;
        }
        setTag(TG.line, bump(p, 0.02, 0.08, 0.4, 0.47), tmp.copy(line.position).add(tmp2.set(0, 0.5, 0)));
      } else if (p > 0.66) {
        line.scale.set(1.6, 0.1, 0.22);
        const f = sstep(0.68, 1, p);
        const pts = [V([13.6, DIE_Y + 0.2, 0.4]), V([8.4, DIE_Y + 0.2, 0.4]), V([3.25, DIE_Y + 0.2, 0.4])];
        along(pts, f, line.position);
        lineHop.cur.copy(line.position);
        setTag(TG.line, sstep(0.72, 0.8, p), tmp.copy(line.position).add(tmp2.set(0, 0.6, 0)));
        const lv = 0.5 * sstep(0.85, 1, p);
        setTag(TG.l1, lv);
        setTag(TG.l2, lv);
        setTag(TG.l3, lv);
      }
    } else if (k === 4 && p < 1e-6) {
      // experience station: the line hops to the cache level of the commit being read
      line.visible = true;
      line.scale.set(1.6, 0.1, 0.22);
      const band = { 1: [1.8, 0.3, -5.9], 2: [3.25, 0.25, -4.0], 3: [3.25, 0.2, 0.4] }[S.level];
      lineHop.target.set(band[0], DIE_Y + band[1], band[2]);
      if (!lineHop.init) {
        lineHop.cur.copy(lineHop.target);
        lineHop.init = true;
      }
      const d = lineHop.cur.distanceTo(lineHop.target);
      if (d > 0.002) {
        lineHop.cur.lerp(lineHop.target, Math.min(1, dt * 6 || 1));
        anim = Math.max(anim, 0.05);
      }
      line.position.copy(lineHop.cur);
      setTag(TG.line, 1, tmp.copy(line.position).add(tmp2.set(0, 0.6, 0)));
      setTag(TG.l1, S.level === 1 ? 1 : 0.45);
      setTag(TG.l2, S.level === 2 ? 1 : 0.45);
      setTag(TG.l3, S.level === 3 ? 1 : 0.45);
    }

    // ---------- die: bytes into R0, ALU pulse ----------
    if (dieBuilt) {
      const inS4 = k === 4 && p > 0;
      const bp = inS4 ? sstep(0.06, 0.3, p) : 0;
      D.bytes.visible = inS4 && p < 0.58;
      for (let i = 0; i < 8; i++) {
        const f = clamp(bp * 1.6 - i * 0.075, 0, 1);
        place(D.bytes, i, [lerp(1.8, 1.5 + i * 0.5, f), 0.12, lerp(-5.9, -8.36, f)], [1, 1, 1]);
      }
      D.bytes.instanceMatrix.needsUpdate = true;
      D.r0Mat.uniforms.uEmitAmt.value = inS4 ? 0.15 + 0.35 * sstep(0.22, 0.32, p) : 0;
      D.r0.visible = inS4 || k >= 5;
      const alu = inS4 ? bump(p, 0.26, 0.3, 0.42, 0.48) * (0.6 + 0.4 * Math.sin((p - 0.26) * 120)) : 0;
      D.aluMat.uniforms.uEmitAmt.value = clamp(alu, 0, 1) * 0.85;
      if (inS4) {
        setTag(TG.r0, bump(p, 0.12, 0.18, 0.46, 0.5));
        setTag(TG.alu, bump(p, 0.28, 0.32, 0.44, 0.48));
        setTag(TG.l1, 0.45 * (1 - sstep(0, 0.12, p)));
        setTag(TG.l2, 0.45 * (1 - sstep(0, 0.12, p)));
        setTag(TG.l3, 0.45 * (1 - sstep(0, 0.12, p)));
        if (p < 0.12) {
          line.visible = true;
          line.position.copy(lineHop.cur);
        }
      }
    }

    // ---------- FinFET: one bit lights a gate, then the lattice resolves ----------
    if (finBuilt) {
      const T5 = k === 4 ? p : k >= 5 ? 1 : 0;
      const outro = k === 5 && p > 0 ? 1 - sstep(0.0, 0.2, p) : 1;
      const gateOn = sstep(0.7, 0.8, T5);
      F.litMat.uniforms.uEmitAmt.value = clamp(gateOn * 0.45 + S.gatePulse * 0.4, 0, 1);
      const lat = sstep(0.74, 1, T5);
      const fade = lerp(1, 0.28, sstep(0.8, 1, T5));
      F.finMat.uniforms.uOpacity.value = fade;
      F.gateMat.uniforms.uOpacity.value = fade;
      F.litMat.uniforms.uOpacity.value = lerp(1, 0.45, sstep(0.8, 1, T5));
      F.finMat.depthWrite = F.gateMat.depthWrite = F.litMat.depthWrite = fade > 0.99;
      if (Math.abs(lat - F.latticeShown) > 1e-4) {
        F.latticeShown = lat;
        for (let i = 0; i < F.atoms.length; i++) {
          const s = clamp(lat * 1.6 - (F.atomR[i] / F.atomMax) * 0.6, 0, 1);
          const a = F.atoms[i];
          place(F.lattice, i, a, [s, s, s]);
        }
        F.lattice.instanceMatrix.needsUpdate = true;
      }
      F.lattice.visible = lat > 0.001;
      F.bondMat.opacity = sstep(0.88, 1, T5) * 0.55 * outro;
      F.bonds.visible = F.bondMat.opacity > 0.01;
      const gp = S.gatePulse;
      F.pulse.visible = gp > 0.01 || (T5 > 0.72 && T5 < 0.86);
      const pf = gp > 0.01 ? 1 - gp : sstep(0.72, 0.86, T5);
      F.pulse.position.set(lerp(-6, 6, pf), 0.95, -0.8);
      F.pulse.material.opacity = gp > 0.01 ? gp : bump(T5, 0.72, 0.75, 0.83, 0.86);
      if (k === 4 && p > 0.58) setTag(TG.gate, bump(p, 0.72, 0.78, 0.9, 0.96));
      if (S.override == null && ((k === 4 && p > 0.85) || (k === 5 && p < 1e-6))) setTag(TG.lat, k === 5 ? 1 : sstep(0.88, 0.98, p));
    }

    // decals: only repaint when a level changed
    let changed = false;
    for (let i = 0; i < decalLevel.length; i++) if (Math.abs(decalLevel[i] - (decals.userData.prev?.[i] ?? -1)) > 1e-3) changed = true;
    if (changed || decals.userData.glow !== U.glow.value) {
      decals.userData.prev = Float32Array.from(decalLevel);
      decals.userData.glow = U.glow.value;
      paintDecals();
    }

    // ---------- camera ----------
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 5 || 1);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 5 || 1);
    if (Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.002) anim = Math.max(anim, 0.05);
    const dist = P.distanceTo(Lk);
    camera.position.copy(P);
    camera.lookAt(Lk);
    camera.updateMatrixWorld();
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(pointer.x * 0.05 * dist);
    tmp2.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-pointer.y * 0.035 * dist);
    camera.position.add(tmp).add(tmp2);
    camera.lookAt(Lk);
    camera.near = Math.max(0.004, dist * 0.02);
    camera.far = Math.max(60, dist * 40);

    // subject to the right (desktop) / top (mobile) once the text panel is in play
    const H0 = 0.24; // hero: chip a little right of centre, clear of the name
    const shift = T < 0.4 ? H0 : T < 0.92 ? lerp(H0, 1, ease((T - 0.4) / 0.52)) : T > 5.3 ? lerp(1, H0, ease(clamp((T - 5.3) / 0.6, 0, 1))) : 1;
    view.shift = shift;
    if (mobile) camera.setViewOffset(view.w, view.h, 0, view.h * 0.2 * shift, view.w, view.h);
    else camera.setViewOffset(view.w, view.h, -view.w * 0.19 * shift, 0, view.w, view.h);
    camera.updateProjectionMatrix();

    // fog: tighter the deeper we go, closed fully across each place swap
    const fk = themeOpts.fogK;
    const fo0 = w === 'board' ? (T < 3 || T > 5 ? [0.55, 2.1] : [0.5, 1.7]) : w === 'die' ? [0.7, 2.6] : [0.8, 3.2];
    const fo = [fo0[0] * fk, fo0[1] * fk];
    fogF = cam.f;
    const fnear = dist * fo[0] * (1 - fogF);
    const ffar = lerp(dist * fo[1], dist * 0.01 + 0.001, ease(fogF));
    scene.fog.near = Math.min(fnear, ffar * 0.98);
    scene.fog.far = ffar;
    scene.fog.color.copy(U.bg.value);

    // sizes of in-flight things follow the scale of the place
    if (w !== 'board') {
      packet.visible = packet.visible && S.override != null;
    }
    sparkMat.size = 0.42;
    packetMat.color.copy(U.hot.value);
    sparkMat.color.copy(U.hot.value);
    pulseMat.color.copy(U.trace.value);
  }

  function projectTags() {
    if (!tagLayer) return;
    const vw = view.w;
    const vh = view.h;
    for (const t of tags) {
      let a = t.alpha;
      if (a > 0.01 && t.w !== place_ && !(t === TG.trip)) a = 0;
      if (a > 0.01) {
        tmp.copy(t.pos).project(camera);
        if (tmp.z > 1 || tmp.z < -1) a = 0;
        else {
          const x = (tmp.x * 0.5 + 0.5) * vw;
          const y = (-tmp.y * 0.5 + 0.5) * vh;
          if (x < 8 || x > vw - 8 || y < 60 || y > (mobile ? vh * 0.46 : vh - 20)) a = 0;
          if (S.tagBand && (y < S.tagBand[0] + 14 || y > S.tagBand[1] - 14)) a = 0;
          if (!mobile && x > vw - Math.min(360, vw * 0.3) - 90 && y < 250) a = 0; // keep clear of the legend
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

  /* ---------------- render loop (driven by gsap.ticker from main.js) ---------------- */
  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.85 ? 72 : 48;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  resize();

  function render(now) {
    const dt = lastRender ? Math.min(0.05, (now - lastRender) / 1000) : 0;
    lastRender = now;
    // exposure: brighter only while T is changing, back to rest 300 ms after it stops
    const moving = now - lastTChange < 300 && S.override == null ? 1 : S.override != null ? 1 : 0;
    const T = S.override ?? S.T;
    const rest = T < 0.45 ? 0.9 : T > 5.6 ? 0.85 : themeOpts.glowRest;
    glowTarget = moving ? 1 : rest;
    U.glow.value += (glowTarget - U.glow.value) * Math.min(1, dt * 8 || 1);
    if (Math.abs(glowTarget - U.glow.value) > 0.004) anim = Math.max(anim, 0.05);
    stepTheme(now);
    update(dt);
    const t0 = performance.now();
    renderer.render(scene, camera);
    const cost = performance.now() - t0;
    projectTags();
    // auto-drop resolution if frames are consistently slow
    if (!dprDropped && dt > 0) {
      frameTimes.push(Math.max(cost, dt * 1000));
      if (frameTimes.length > 30) frameTimes.shift();
      if (frameTimes.length === 30) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        if (sorted[15] > 20 && !location.search.includes('debug')) {
          dprDropped = true;
          renderer.setPixelRatio(0.75);
          resize();
        }
      }
    }
  }

  function tick(now) {
    if (!running) return;
    const T = S.override ?? S.T;
    const ambient = !still && (T < 0.95 || T > 5.5) && boardW.visible;
    if (dirty || anim > 0) {
      dirty = false;
      anim = Math.max(0, anim - (lastRender ? (now - lastRender) / 1000 : 0));
      render(now);
    } else if (ambient && now - lastRender > 33) {
      render(now); // ambient pulses capped at 30 fps
    } else if (lastRender && now - lastRender > 100) {
      lastRender = 0; // so dt doesn't jump after idling
    }
  }

  /* ---------------- public API ---------------- */
  return {
    renderer,
    setT(T) {
      if (Math.abs(T - S.T) < 1e-5) return;
      S.T = T;
      lastTChange = performance.now();
      if (T > 2.4) requestIdle(buildDie);
      if (T > 3.6) requestIdle(buildFin);
      dirty = true;
    },
    setLocal(k, v) {
      if (Math.abs(S.L[k] - v) < 1e-5) return;
      S.L[k] = v;
      lastTChange = performance.now();
      dirty = true;
    },
    setLevel(lv) {
      if (S.level === lv) return;
      S.level = lv;
      dirty = true;
      anim = Math.max(anim, 0.8);
    },
    setPairSpark(i, u) {
      if (S.pair[i] === u) return;
      S.pair[i] = u;
      dirty = true;
    },
    setOverride(T) {
      S.override = T;
      dirty = true;
    },
    setGatePulse(v) {
      buildFin();
      S.gatePulse = v;
      dirty = true;
    },
    setPointer(x, y) {
      pointer.tx = clamp(x, -1, 1);
      pointer.ty = clamp(y, -1, 1);
      anim = Math.max(anim, 0.05);
    },
    // colours: { key: css colour string }, tweened over `duration` seconds
    setTheme(colors, isDark, duration = 0.4) {
      theme.from = Object.fromEntries(KEYS.map((key) => [key, U[key].value.clone()]));
      theme.to = Object.fromEntries(KEYS.map((key) => [key, new Color(colors[key] || '#000')]));
      theme.edgeFrom = U.edgeAmt.value;
      theme.edgeTo = colors.edgeAmt ?? U.edgeAmt.value;
      themeOpts.glowRest = colors.glowRest ?? 0.55;
      themeOpts.fogK = colors.fogK ?? 1;
      if (F.lattice) F.lattice.material.uniforms.uEmitAmt.value = isDark ? 0.35 : 0.05;
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
    // [top, bottom] screen band the tags may use (mobile: a scene-only beat), or null
    setTagBand(band) {
      const key = band ? `${band[0] | 0},${band[1] | 0}` : '';
      if (S.bandKey === key) return;
      S.bandKey = key;
      S.tagBand = band;
      dirty = true;
    },
    setTagText(name, text) {
      if (TG[name]) TG[name].el.textContent = text;
    },
    buildAll() {
      requestIdle(buildDie);
      requestIdle(() => {
        buildFin();
        renderer.compile(scene, camera);
      });
    },
    resize,
    tick,
    invalidate() {
      dirty = true;
    },
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
      return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, place: place_, dpr: renderer.getPixelRatio() };
    },
    get place() {
      return place_;
    },
  };
}

function requestIdle(fn) {
  if ('requestIdleCallback' in window) requestIdleCallback(() => fn(), { timeout: 600 });
  else setTimeout(fn, 60);
}
