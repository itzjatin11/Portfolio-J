// The hero's 3D motherboard: only the board, the chip and its traces, with pulses running along
// them. It renders only while the hero is on screen, and only on devices that can afford it
// (phones, reduced motion and devices without WebGL 2 get a still image instead; see main.js).
//
// On load the camera settles onto the board as the name rises. Afterwards it drifts a little
// with the pointer, and scrolling the hero dives the camera down into the chip.
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Fog,
  Color,
  Vector3,
  Object3D,
  Mesh,
  InstancedMesh,
  Points,
  PlaneGeometry,
  BoxGeometry,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  PointsMaterial,
  UniformsUtils,
  UniformsLib,
  AdditiveBlending,
  DynamicDrawUsage,
  MathUtils,
} from 'three';
import * as TX from '../textures.js';

const { clamp, lerp } = MathUtils;
const easeOut = (t) => 1 - (1 - t) ** 3;

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

// The hero is always a dark plate, so the scene uses the dark palette whatever the page theme.
const PALETTE = {
  bg: '#050505', board: '#070b0d', pcb: '#0c1315', body: '#1b1f23', slot: '#090a0b', metal: '#6f767c', gold: '#a8863c',
  trace: '#3be8d8', hot: '#ff4d2e', accent: '#ff4d2e', silk: '#d8d6cf', edge: '#3a4146', die: '#0a0e10',
};
KEYS.forEach((k) => U[k].value.set(PALETTE[k]));
U.edgeAmt.value = 0.6;

const HOME = { p: new Vector3(1.5, 21, 25), l: new Vector3(0.5, 0, -1) }; // the opening view
const START = { p: new Vector3(2.4, 31, 37), l: new Vector3(0.6, 0, -2) }; // a little further out, before it settles
const DIVE = { p: new Vector3(0.1, 2.5, 0.5), l: new Vector3(0, 0.33, 0) }; // right over the chip's lid, where the scroll dive ends
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function createHero(canvas, { poster = false } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, poster ? 2 : 1.5);
  const renderer = new WebGLRenderer({ canvas, antialias: dpr < 1.5 || poster, powerPreference: 'default', preserveDrawingBuffer: poster });
  renderer.setPixelRatio(dpr);
  renderer.debug.checkShaderErrors = false;

  const scene = new Scene();
  scene.background = U.bg.value;
  scene.fog = new Fog(PALETTE.bg, 30, 120);
  const camera = new PerspectiveCamera(48, 1, 0.1, 400);

  /* ---------------- the board ---------------- */
  const traces = TX.makeTraces(140);
  const board = new Mesh(new PlaneGeometry(TX.BOARD, TX.BOARD), channel(TX.boardTexture(traces, 2048), 'board', { k: [1, 1, 0.55] }));
  board.rotation.x = -Math.PI / 2;
  scene.add(board);
  const substrate = new Mesh(new BoxGeometry(6, 0.18, 6), solid('pcb'));
  substrate.position.y = 0.09;
  const lid = new Mesh(new BoxGeometry(5.2, 0.15, 5.2), solid('body'));
  lid.position.y = 0.255;
  const lidTopMat = channel(TX.lidTexture(), 'body', { k: [0.8, 1, 0.9] });
  const lidTop = new Mesh(new PlaneGeometry(5.2, 5.2), lidTopMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.3315;
  scene.add(substrate, lid, lidTop);
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
  scene.add(boxes(parts, solid('body')));
  const ssd = new Mesh(new BoxGeometry(10.7, 0.12, 2.9), channel(TX.ssdTexture(), 'pcb', { c3: 'gold', edge: 0.6 }));
  ssd.position.set(-13, 0.12, 10);
  scene.add(ssd);

  /* ---------------- signals running along the traces ---------------- */
  const pulseCount = 240;
  const pulseGeo = new BufferGeometry();
  const pulsePos = new Float32Array(pulseCount * 3);
  pulseGeo.setAttribute('position', new BufferAttribute(pulsePos, 3).setUsage(DynamicDrawUsage));
  const pulseMat = new PointsMaterial({ size: 0.26, map: TX.glowTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true, color: PALETTE.trace, opacity: 0 });
  scene.add(new Points(pulseGeo, pulseMat));
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

  /* ---------------- camera ---------------- */
  const view = { w: 1, h: 1, side: 0 };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const P = new Vector3();
  const L = new Vector3();
  const tmp = new Vector3();
  let intro = poster ? 1 : 0; // 0 → 1 over the opening
  let held = !poster; // the opening waits for play(), so it lands as the boot intro opens onto it
  let dive = 0; // 0 → 1 as you scroll down into the chip (eased towards diveTo)
  let diveTo = 0;
  let running = false;
  let last = 0;
  let raf = 0;

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    if (w === view.w && h === view.h) return;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.85 ? 62 : 48;
    // wide screens: the chip sits to the right of the name; narrow ones: centred
    view.side = poster ? -0.12 : w / h > 1.2 ? -0.14 : 0;
    camera.updateProjectionMatrix();
  }

  function frame(dt) {
    const e = easeOut(clamp(intro, 0, 1));
    dive += (diveTo - dive) * (dt > 0 ? Math.min(1, dt * 7) : 1);
    const k = easeInOut(dive);
    P.lerpVectors(START.p, HOME.p, e).lerp(DIVE.p, k);
    L.lerpVectors(START.l, HOME.l, e).lerp(DIVE.l, k);
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
    camera.position.copy(P);
    camera.lookAt(L);
    camera.updateMatrixWorld();
    const dist = P.distanceTo(L) * (1 - k);
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(pointer.x * 0.03 * dist);
    camera.position.add(tmp);
    tmp.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-pointer.y * 0.02 * dist);
    camera.position.add(tmp);
    camera.lookAt(L);
    // the chip sits beside the name, and comes to the centre as you dive in
    camera.setViewOffset(view.w, view.h, view.w * view.side * (1 - k), 0, view.w, view.h);
    camera.updateProjectionMatrix();
    // the board powers on: signals fade in, the chip's marking brightens
    pulseMat.opacity = clamp((intro - 0.25) / 0.6, 0, 1);
    U.glow.value = lerp(0.35, 0.9, e);
    if (dt > 0) placePulses(dt);
    renderer.render(scene, camera);
  }

  function loop(now) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    // the opening plays at full rate; after that, ambient signals at ~30 fps are plenty
    const opening = !held && intro < 1;
    // the opening and the dive play at full rate; otherwise ambient signals at ~30 fps are plenty
    const diving = Math.abs(diveTo - dive) > 0.0005;
    if (opening || diving || now - last > 32 || !last) {
      if (opening) intro = Math.min(1, intro + dt / 2.4);
      last = now;
      frame(dt);
    }
    raf = requestAnimationFrame(loop);
  }

  resize();
  return {
    // first frame (and the poster): render once, synchronously
    renderNow() {
      resize();
      frame(0);
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    // run the opening: the camera settles onto the board and it powers on
    play() {
      held = false;
    },
    setDive(v) {
      diveTo = clamp(v, 0, 1);
    },
    setPointer(x, y) {
      pointer.tx = clamp(x, -1, 1);
      pointer.ty = clamp(y, -1, 1);
    },
    resize,
    // compile everything before the first visible frame, so the opening doesn't stutter
    prepare() {
      resize();
      return renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve();
    },
    dispose() {
      this.stop();
      renderer.dispose();
    },
  };
}
