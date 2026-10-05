import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  IcosahedronGeometry,
  ShaderMaterial,
  Mesh,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Color,
} from 'three';

// Ashima 3D simplex noise (MIT).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
varying vec3 vPos;
varying float vNoise;
${NOISE}
void main(){
  float n = snoise(position * uFreq + vec3(0., 0., uTime * .22));
  n += .5 * snoise(position * uFreq * 2.3 - vec3(uTime * .15));
  vNoise = n;
  vec3 p = position + normal * n * uAmp;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uBase;
varying vec3 vPos;
varying float vNoise;
void main(){
  // faceted normal from screen-space derivatives: a crisp, technical look
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 v = normalize(-vPos);
  float light = clamp(dot(n, normalize(vec3(.5, .8, .6))), 0., 1.);
  float rim = pow(1. - clamp(dot(n, v), 0., 1.), 2.2);
  vec3 col = mix(uA, uB, smoothstep(-.45, .75, vNoise));
  col = mix(uBase, col, .25 + .75 * light);
  col += rim * mix(uB, uA, .5) * .9;
  // fine scan lines
  col *= .9 + .1 * step(.5, fract(gl_FragCoord.y * .25));
  gl_FragColor = vec4(col, 1.);
}`;

export function createBlob(canvas, { reduced = false } = {}) {
  const small = window.matchMedia('(max-width: 760px)').matches;
  const renderer = new WebGLRenderer({ canvas, antialias: !small, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.25 : 1.5));

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.z = 7;

  const group = new Group();
  scene.add(group);

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.32 },
    uFreq: { value: 0.9 },
    uA: { value: new Color('#ff4d2e') },
    uB: { value: new Color('#5cf2e8') },
    uBase: { value: new Color('#050505') },
  };
  const mesh = new Mesh(
    new IcosahedronGeometry(1.35, small ? 28 : 56),
    new ShaderMaterial({ uniforms, vertexShader, fragmentShader }),
  );
  group.add(mesh);

  // orbiting particle shell
  const count = small ? 500 : 1100;
  const pos = [];
  for (let i = 0; i < count; i++) {
    const r = 2.1 + Math.random() * 0.9;
    const t = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 0.5;
    pos.push(Math.cos(t) * r, y + Math.sin(t * 3) * 0.05, Math.sin(t) * r);
  }
  const pgeo = new BufferGeometry();
  pgeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const pmat = new PointsMaterial({ size: small ? 0.022 : 0.016, color: 0xf2f0eb, transparent: true, opacity: 0.55 });
  const ring = new Points(pgeo, pmat);
  ring.rotation.x = 0.35;
  ring.rotation.z = -0.18;
  group.add(ring);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let progress = 0;
  let running = true;
  let raf = 0;

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // keep the object a sensible size on tall phones
    group.scale.setScalar(w / h < 0.8 ? 0.56 : 1);
  }
  resize();
  window.addEventListener('resize', resize);

  function frame(t) {
    uniforms.uTime.value = t / 1000;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    mesh.rotation.y = t / 9000 + pointer.x * 0.5;
    mesh.rotation.x = pointer.y * 0.35;
    ring.rotation.y = -t / 14000;
    uniforms.uAmp.value = 0.32 + progress * 0.45 + Math.hypot(pointer.x, pointer.y) * 0.08;
    group.position.y = progress * 1.4;
    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  if (reduced) {
    running = false;
    frame(0);
  } else {
    raf = requestAnimationFrame(frame);
  }

  return {
    setPointer(x, y) {
      pointer.tx = x;
      pointer.ty = y;
    },
    setProgress(p) {
      progress = p;
    },
    setRunning(on) {
      if (reduced || on === running) return;
      running = on;
      if (on) raf = requestAnimationFrame(frame);
      else cancelAnimationFrame(raf);
    },
    setTheme(dark) {
      uniforms.uBase.value.set(dark ? '#050505' : '#f2f0eb');
      uniforms.uB.value.set(dark ? '#5cf2e8' : '#0e9e95');
      pmat.color.set(dark ? 0xf2f0eb : 0x0a0a0a);
      if (!running) renderer.render(scene, camera);
    },
  };
}
