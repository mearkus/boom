/**
 * The stage: camera framing, lighting, procedural backdrop, parallax skyline,
 * starfield, floor and screen shake. Everything is generated at runtime so the
 * game ships with no texture assets.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';

const FOV = 42;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(canvas, { srgb = true, repeat = null } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** Deep-space gradient with a horizon bloom and drifting nebula blobs. */
function buildSkyCanvas() {
  const c = makeCanvas(512, 1024);
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0.00, '#05060f');
  grad.addColorStop(0.35, '#0a0d24');
  grad.addColorStop(0.62, '#1a1040');
  grad.addColorStop(0.82, '#3d1350');
  grad.addColorStop(1.00, '#75184f');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);

  // Nebula puffs.
  const puffs = [
    [0.22, 0.30, 0.34, 'rgba(52,229,255,0.20)'],
    [0.78, 0.22, 0.28, 'rgba(150,90,255,0.22)'],
    [0.50, 0.58, 0.45, 'rgba(255,61,110,0.14)'],
    [0.12, 0.72, 0.30, 'rgba(255,150,60,0.14)'],
  ];
  for (const [x, y, r, color] of puffs) {
    const rg = g.createRadialGradient(x * c.width, y * c.height, 0, x * c.width, y * c.height, r * c.width);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, c.width, c.height);
  }

  // Horizon glow near the floor line.
  const hz = g.createLinearGradient(0, c.height * 0.74, 0, c.height);
  hz.addColorStop(0, 'rgba(255,90,160,0)');
  hz.addColorStop(1, 'rgba(255,120,190,0.5)');
  g.fillStyle = hz;
  g.fillRect(0, c.height * 0.74, c.width, c.height * 0.26);

  return c;
}

/** Silhouette skyline with lit windows, transparent above the roofline. */
function buildSkylineCanvas(seed, tint, density) {
  const c = makeCanvas(1024, 320);
  const g = c.getContext('2d');
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

  g.clearRect(0, 0, c.width, c.height);
  let x = -20;
  while (x < c.width + 20) {
    const w = 34 + rnd() * 70 * density;
    const h = 60 + rnd() * 210;
    const y = c.height - h;
    g.fillStyle = tint;
    g.fillRect(x, y, w, h);

    // Antenna.
    if (rnd() > 0.72) {
      g.fillRect(x + w * 0.45, y - 26 - rnd() * 26, 3, 30);
    }
    // Windows.
    const cols = Math.max(1, Math.floor(w / 13));
    const rows = Math.max(1, Math.floor(h / 17));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (rnd() > 0.88) {
          g.fillStyle = rnd() > 0.5 ? 'rgba(120,235,255,0.42)' : 'rgba(255,140,190,0.36)';
          g.fillRect(x + 5 + i * 13, y + 7 + j * 17, 4, 6);
        }
      }
    }
    x += w + 5 + rnd() * 16;
  }
  return c;
}

/** Perspective floor grid that fades out with distance. */
function buildFloorCanvas() {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#05060f';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(90,200,255,0.55)';
  g.lineWidth = 2;
  const step = 64;
  for (let i = 0; i <= c.width; i += step) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, c.height); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(c.width, i); g.stroke();
  }
  return c;
}

/** Vertical gradient strip: bright at the bottom, gone by the top. */
export function buildBeamTexture() {
  const c = makeCanvas(32, 256);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.30)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 256);
  // Soften the vertical edges.
  const edge = g.createLinearGradient(0, 0, 32, 0);
  edge.addColorStop(0.0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.5, 'rgba(0,0,0,0)');
  edge.addColorStop(1.0, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = edge;
  g.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Soft round sprite used for glows, sparks and particles.
 * `sharp` gives a tight core with a long tail — reads as a spark rather than
 * a bokeh ball when there are hundreds on screen.
 */
export function buildGlowTexture(size = 128, sharp = false) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rg.addColorStop(0.0, 'rgba(255,255,255,1)');
  if (sharp) {
    rg.addColorStop(0.12, 'rgba(255,255,255,0.75)');
    rg.addColorStop(0.30, 'rgba(255,255,255,0.18)');
    rg.addColorStop(0.62, 'rgba(255,255,255,0.04)');
  } else {
    rg.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    rg.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  }
  rg.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 260);

    this.bounds = { halfW: 6, halfH: 10, playHalfW: 5.5, top: 8, bottom: -8 };
    // Vertical layout is derived from the framing so the game reads the same
    // on a tall phone and a wide laptop.
    this.layout = { bomberY: CONFIG.bomberY, bucketLineY: CONFIG.bucketLineY, floorY: CONFIG.floorY };
    this.shakeAmp = 0;
    this.shakeSeed = Math.random() * 100;
    this.parallax = 0;
    this.time = 0;

    this._buildEnvironment();
    this._buildLights();
    this._buildBackdrop();
    this._buildStars(quality.stars);
    this._buildFloor();
  }

  /* ── Environment map (procedural studio, for metal reflections) ────── */
  _buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (color, intensity, pos, scale) => {
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
      m.material.color.multiplyScalar(intensity);
      m.position.set(...pos);
      m.scale.set(...scale);
      envScene.add(m);
    };
    add(0x0a0d1e, 1.0, [0, 0, 0], [40, 40, 40]);          // room
    add(0x34e5ff, 3.2, [-8, 6, 4], [10, 10, 1]);          // cyan key
    add(0xff3d6e, 2.6, [9, 3, 3], [10, 12, 1]);           // magenta rim
    add(0xffcf4d, 1.6, [0, -9, 6], [16, 4, 1]);           // warm bounce
    add(0x7ba8ff, 1.2, [0, 12, -6], [18, 6, 1]);          // cool top
    const rt = pmrem.fromScene(envScene, 0.03);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 1.0;
    this.envRT = rt;
    pmrem.dispose();
    box.dispose();
    envScene.traverse((o) => { if (o.material) o.material.dispose(); });
  }

  _buildLights() {
    this.ambient = new THREE.AmbientLight(0x2a3560, 1.1);
    this.scene.add(this.ambient);

    this.key = new THREE.DirectionalLight(0x9fd8ff, 2.2);
    this.key.position.set(-6, 9, 8);
    this.scene.add(this.key);

    this.rim = new THREE.DirectionalLight(0xff5c8a, 1.5);
    this.rim.position.set(7, -4, 5);
    this.scene.add(this.rim);

    this.hemi = new THREE.HemisphereLight(0x66ccff, 0x2b0f3a, 0.9);
    this.scene.add(this.hemi);

    // Follows the action so catches and blasts light the stage.
    this.actionLight = new THREE.PointLight(0xffaa55, 0, 26, 2);
    this.actionLight.position.set(0, 0, 5);
    this.scene.add(this.actionLight);
  }

  _buildBackdrop() {
    this.backGroup = new THREE.Group();
    this.scene.add(this.backGroup);

    const skyMat = new THREE.MeshBasicMaterial({
      map: canvasTexture(buildSkyCanvas()),
      color: new THREE.Color(1.75, 1.75, 1.75),   // lift it out of tone-mapped mud
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), skyMat);
    this.sky.position.z = -46;
    this.sky.renderOrder = -10;
    this.backGroup.add(this.sky);

    this.skylines = [];
    const layers = [
      { z: -34, seed: 7, tint: 'rgba(18,16,48,0.96)', density: 1.25, factor: 0.06, scale: 1.0, y: 0 },
      { z: -24, seed: 91, tint: 'rgba(9,8,26,0.98)', density: 0.9, factor: 0.13, scale: 0.78, y: -0.6 },
    ];
    for (const L of layers) {
      const mat = new THREE.MeshBasicMaterial({
        map: canvasTexture(buildSkylineCanvas(L.seed, L.tint, L.density)),
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.position.z = L.z;
      mesh.renderOrder = -9;
      mesh.userData = L;
      this.backGroup.add(mesh);
      this.skylines.push(mesh);
    }
  }

  _buildStars(count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 130;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 110;
      positions[i * 3 + 2] = -42 + Math.random() * 8;
      sizes[i] = 0.35 + Math.random() * 1.15;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uScale;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.55 + 0.45 * sin(uTime * 1.7 + aPhase);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vTwinkle;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vec3(0.75, 0.88, 1.0) * vTwinkle * 1.15, a * vTwinkle);
        }`,
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -8;
    this.scene.add(this.stars);
  }

  _buildFloor() {
    const mat = new THREE.MeshBasicMaterial({
      map: canvasTexture(buildFloorCanvas(), { repeat: [14, 26] }),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 150, 1, 1), mat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, CONFIG.floorY, -55);
    this.floor.renderOrder = -7;
    this.scene.add(this.floor);

    // Neon danger line the bombs must never cross.
    const lineGeo = new THREE.PlaneGeometry(1, 0.09);
    this.dangerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff3d6e).multiplyScalar(2.4),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dangerLine = new THREE.Mesh(lineGeo, this.dangerMat);
    this.dangerLine.position.set(0, CONFIG.floorY + 0.35, 0.2);
    this.scene.add(this.dangerLine);
  }

  /* ── Framing ───────────────────────────────────────────────────────── */

  visibleHeightAt(distance) {
    return 2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * distance;
  }

  resize(width, height) {
    const aspect = width / height;
    this.camera.aspect = aspect;

    // Fit a fixed play area: tall enough for the drop, wide enough to run.
    const desiredH = 17.6;
    const desiredW = 11.0;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const distForH = desiredH / 2 / tanHalf;
    const distForW = desiredW / 2 / (tanHalf * aspect);
    const dist = Math.max(distForH, distForW);

    this.camera.position.set(0, -0.35, dist);
    this.camera.lookAt(0, 0.15, 0);
    this.camera.updateProjectionMatrix();

    const halfH = this.visibleHeightAt(dist) / 2;
    const halfW = halfH * aspect;
    this.bounds.halfH = halfH;
    this.bounds.halfW = halfW;
    this.bounds.playHalfW = THREE.MathUtils.clamp(
      halfW - 0.55, CONFIG.playWidthMin / 2, CONFIG.playWidthMax / 2);
    this.bounds.top = halfH;
    this.bounds.bottom = -halfH;

    this.layout.bomberY = halfH * 0.60;
    this.layout.bucketLineY = -halfH * 0.70;
    this.layout.floorY = -halfH * 0.93;
    this.floor.position.y = this.layout.floorY;
    this.dangerLine.position.y = this.layout.bucketLineY - 0.95;

    // Scale backdrop layers to cover the frame at their own depth.
    const cover = (mesh, extra = 1.12) => {
      const d = this.camera.position.z - mesh.position.z;
      const h = this.visibleHeightAt(d) * extra;
      const w = h * aspect * extra;
      mesh.scale.set(w, h, 1);
      return { w, h };
    };
    cover(this.sky, 1.06);
    for (const s of this.skylines) {
      const d = this.camera.position.z - s.position.z;
      const vh = this.visibleHeightAt(d);
      const vw = vh * aspect;
      const w = vw * 1.35;
      const h = Math.min(w * (320 / 1024) * 1.5, vh * 0.42) * s.userData.scale;
      s.scale.set(w, h, 1);
      s.position.y = -vh / 2 + h / 2 + s.userData.y;
    }
    this.dangerLine.scale.x = this.bounds.playHalfW * 2 + 1.6;
  }

  /* ── Per-frame ─────────────────────────────────────────────────────── */

  shake(amount) {
    this.shakeAmp = Math.min(1.6, this.shakeAmp + amount);
  }

  pulseLight(color, intensity, position) {
    this.actionLight.color.copy(color);
    this.actionLight.intensity = Math.max(this.actionLight.intensity, intensity);
    if (position) this.actionLight.position.set(position.x, position.y, 4);
  }

  /** Drift the palette so every wave has its own colour signature. */
  setHue(hue) {
    const keyC = new THREE.Color().setHSL((hue + 0.52) % 1, 0.75, 0.72);
    const rimC = new THREE.Color().setHSL(hue % 1, 0.85, 0.62);
    this.key.color.lerp(keyC, 0.6);
    this.rim.color.lerp(rimC, 0.6);
    this.hemi.color.lerp(keyC, 0.4);
    this.dangerMat.color.copy(rimC).multiplyScalar(2.4);
  }

  update(dt, focusX) {
    this.time += dt;
    this.stars.material.uniforms.uTime.value = this.time;

    // Parallax follows the player's horizontal position.
    this.parallax += (focusX - this.parallax) * (1 - Math.exp(-dt * 4));
    for (const s of this.skylines) s.position.x = -this.parallax * s.userData.factor * 3.2;
    this.stars.position.x = -this.parallax * 0.22;

    this.floor.material.map.offset.y = (this.floor.material.map.offset.y - dt * 0.045) % 1;
    this.dangerMat.opacity = 0.6 + 0.25 * Math.sin(this.time * 3.4);

    this.actionLight.intensity *= Math.pow(0.0016, dt);
    if (this.actionLight.intensity < 0.02) this.actionLight.intensity = 0;

    // Screen shake: decaying pseudo-random offset + roll.
    this.shakeAmp *= Math.pow(0.0009, dt);
    if (this.shakeAmp < 0.001) this.shakeAmp = 0;
    const t = this.time * 34 + this.shakeSeed;
    const a = this.shakeAmp;
    this.camera.position.x = Math.sin(t * 1.13) * a * 0.42;
    this.camera.position.y = -0.35 + Math.sin(t * 0.87 + 1.7) * a * 0.42;
    this.camera.rotation.z = Math.sin(t * 0.71) * a * 0.02;
  }
}
