// 3D engine: globe.gl Earth + ONE THREE.Points object (custom ShaderMaterial) for every satellite.
// The date filter, the highlight and the dimming run in the vertex shader, so dragging the slider
// only updates two uniforms – no geometry or buffers are rebuilt.
import Globe from "globe.gl";
import * as THREE from "three";

export const GLOBE_R = 100; // three-globe's globe radius; satellite xyz in the parquet are in Earth radii

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aLaunch;
  attribute float aDecay;
  attribute float aHL;
  uniform float uStart;
  uniform float uEnd;
  uniform float uHLOn;      // 1 when a country/operator highlight is active
  uniform float uSize;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform float uPulse;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    bool shown = aLaunch >= uStart && aLaunch <= uEnd && aDecay > uEnd;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float hl = uHLOn > 0.5 ? aHL : 0.0;
    float dim = uHLOn > 0.5 ? (aHL > 0.5 ? 1.0 : 0.15) : 1.0;
    float size = uSize * (1.0 + 1.6 * hl) * (1.0 + 0.25 * hl * uPulse);
    // perspective attenuation, clamped so far dots stay visible and near dots don't blob
    float px = clamp(size * uScale / -mv.z, 1.4, 14.0) * uPixelRatio;
    gl_PointSize = shown ? px : 0.0;
    if (!shown) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clip away
    vColor = aColor * (1.0 + 0.6 * hl);
    vAlpha = dim;
    vGlow = hl;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGlow;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.15, d);
    float halo = vGlow * smoothstep(0.5, 0.0, d) * 0.6;
    gl_FragColor = vec4(vColor, (core * 0.95 + halo) * vAlpha);
  }`;

// Earth: day/night blend around a fixed sun direction (subsolar point at the snapshot time).
const EARTH_VERT = /* glsl */ `
  varying vec3 vNormalW; varying vec2 vUv;
  void main() {
    vUv = uv; vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayTex; uniform sampler2D nightTex; uniform vec3 sunDir;
  varying vec3 vNormalW; varying vec2 vUv;
  void main() {
    float ndl = dot(normalize(vNormalW), normalize(sunDir));
    float t = smoothstep(-0.15, 0.2, ndl);
    vec3 day = texture2D(dayTex, vUv).rgb * (0.55 + 0.6 * max(ndl, 0.0));
    vec3 night = texture2D(nightTex, vUv).rgb * 1.25;
    gl_FragColor = vec4(mix(night, day, t), 1.0);
  }`;

/** Subsolar point -> direction vector in three-globe coordinates. */
function sunDirection(date) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = 23.439 * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * rad;
  const lon = (((ra - gmst) / rad + 540) % 360) - 180;
  const lat = dec / rad;
  const phi = (90 - lat) * rad, theta = (90 - lon) * rad; // three-globe polar2Cartesian
  return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
}

export function createGlobe(container, {positions, colors, launch, decay, textures, snapshot}) {
  const n = launch.length;
  const globe = new Globe(container, {animateIn: false})
    .backgroundColor("rgba(0,0,0,0)")
    .showAtmosphere(true)
    .atmosphereColor("#4cc9f0")
    .atmosphereAltitude(0.22);

  // --- Earth material (day/night)
  const loader = new THREE.TextureLoader();
  const dayTex = loader.load(textures.day), nightTex = loader.load(textures.night);
  for (const t of [dayTex, nightTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {dayTex: {value: dayTex}, nightTex: {value: nightTex}, sunDir: {value: sunDirection(snapshot)}},
    vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG
  });
  globe.globeMaterial(earthMat);

  // --- satellites
  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n * 3; i++) posAttr.array[i] = positions[i] * GLOBE_R;
  const colAttr = new THREE.BufferAttribute(new Float32Array(colors), 3);
  const hlAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
  geom.setAttribute("position", posAttr);
  geom.setAttribute("aColor", colAttr);
  geom.setAttribute("aLaunch", new THREE.BufferAttribute(Float32Array.from(launch), 1));
  geom.setAttribute("aDecay", new THREE.BufferAttribute(Float32Array.from(decay), 1));
  geom.setAttribute("aHL", hlAttr);
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), GLOBE_R * 3); // never frustum-culled

  const uniforms = {
    uStart: {value: 0}, uEnd: {value: 1e9}, uHLOn: {value: 0}, uSize: {value: 1.0},
    uScale: {value: 160}, uPixelRatio: {value: Math.min(devicePixelRatio, 2)}, uPulse: {value: 0}
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  globe.scene().add(points);

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  controls.minDistance = 130;
  controls.maxDistance = 900;
  globe.pointOfView({lat: 20, lng: 10, altitude: 2.4}, 0);

  // pulse highlighted dots gently; keep point size tied to viewport height
  const clock = performance.now();
  const renderer = globe.renderer();
  const tick = () => { uniforms.uPulse.value = 0.5 + 0.5 * Math.sin((performance.now() - clock) / 350); raf = requestAnimationFrame(tick); };
  let raf = requestAnimationFrame(tick);

  // ---------------------------------------------------------------- API
  const api = {
    globe, points, uniforms, controls,
    setRange(start, end) { uniforms.uStart.value = start; uniforms.uEnd.value = end; },
    setHighlight(flags) { // Uint8Array|null
      if (!flags) { uniforms.uHLOn.value = 0; return; }
      const a = hlAttr.array;
      for (let i = 0; i < n; i++) a[i] = flags[i];
      hlAttr.needsUpdate = true;
      uniforms.uHLOn.value = 1;
    },
    setColors(arr) { colAttr.array.set(arr); colAttr.needsUpdate = true; },
    setPositions(arr) { // arr in Earth radii, length 3n
      const a = posAttr.array;
      for (let i = 0; i < a.length; i++) a[i] = arr[i] * GLOBE_R;
      posAttr.needsUpdate = true;
    },
    positionArray: posAttr.array,
    setAutoRotate(on) { controls.autoRotate = on; },
    resize(w, h) {
      globe.width(w).height(h);
      uniforms.uScale.value = h * 0.33;
    },
    /** Nearest visible satellite to a screen point, ignoring the ones hidden by the Earth. */
    pick(px, py, isVisible, radiusPx = 10) {
      const cam = globe.camera();
      const el = renderer.domElement;
      const w = el.clientWidth, h = el.clientHeight;
      cam.updateMatrixWorld();
      const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
      const c = cam.position;
      const a = posAttr.array;
      let best = -1, bestD = radiusPx * radiusPx;
      for (let i = 0; i < n; i++) {
        if (!isVisible(i)) continue;
        const x = a[3 * i], y = a[3 * i + 1], z = a[3 * i + 2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0) continue;
        const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * w;
        const sy = (1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5 + 0.5)) * h;
        const dx = sx - px, dy = sy - py, d = dx * dx + dy * dy;
        if (d >= bestD) continue;
        // occluded if the camera->point segment crosses the Earth sphere
        const vx = x - c.x, vy = y - c.y, vz = z - c.z;
        const A = vx * vx + vy * vy + vz * vz;
        const B = 2 * (vx * c.x + vy * c.y + vz * c.z);
        const C = c.x * c.x + c.y * c.y + c.z * c.z - GLOBE_R * GLOBE_R;
        const disc = B * B - 4 * A * C;
        if (disc > 0) {
          const t = (-B - Math.sqrt(disc)) / (2 * A);
          if (t > 0 && t < 1) continue;
        }
        best = i; bestD = d;
      }
      return best;
    },
    dispose() {
      cancelAnimationFrame(raf);
      geom.dispose(); mat.dispose(); earthMat.dispose();
      globe._destructor?.();
      renderer.dispose();
    }
  };
  return api;
}
