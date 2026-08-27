/**
 * One pooled additive point-sprite system for every spark in the game:
 * bomb trails, catch confetti and explosion debris.
 */
import * as THREE from 'three';
import { buildGlowTexture } from './world.js';

const VERT = /* glsl */`
attribute float aSize;
attribute float aLife;      // 0 -> 1 over the particle's lifetime
attribute vec3  aColor;
uniform float uScale;
varying float vLife;
varying vec3  vColor;
void main() {
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float fade = 1.0 - aLife;
  gl_PointSize = aSize * uScale * (0.35 + fade * 0.85) / max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying float vLife;
varying vec3  vColor;
void main() {
  if (vLife >= 1.0) discard;
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float fade = 1.0 - vLife;
  float alpha = tex.a * fade * fade;
  gl_FragColor = vec4(vColor * (0.6 + fade * 1.9), alpha);
}`;

export class Particles {
  constructor(scene, max) {
    this.max = max;
    this.cursor = 0;
    this.active = 0;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);      // normalised 0..1
    this.age = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);

    this.life.fill(1);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 2] = -999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: buildGlowTexture(64, true) }, uScale: { value: 260 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
  }

  setScale(px) { this.material.uniforms.uScale.value = px; }

  /**
   * Emit one particle.
   * opts: { x, y, z, vx, vy, vz, color(THREE.Color), size, ttl, drag, gravity }
   */
  emit(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z || 0;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    const c = o.color;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.size[i] = o.size || 1;
    this.ttl[i] = o.ttl || 0.6;
    this.age[i] = 0;
    this.life[i] = 0;
    this.drag[i] = o.drag !== undefined ? o.drag : 1.6;
    this.grav[i] = o.gravity !== undefined ? o.gravity : -6;
  }

  /** Radial burst used for explosions and catches. */
  burst(x, y, count, opts = {}) {
    const {
      color = new THREE.Color(1, 0.6, 0.2),
      color2 = null,
      speed = 6,
      spread = Math.PI * 2,
      angle = 0,
      size = 1.4,
      ttl = 0.75,
      gravity = -6,
      drag = 1.8,
      z = 0,
    } = opts;
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.25 + Math.random() * 0.95);
      tmp.copy(color);
      if (color2) tmp.lerp(color2, Math.random());
      this.emit({
        x: x + (Math.random() - 0.5) * 0.2,
        y: y + (Math.random() - 0.5) * 0.2,
        z: z + (Math.random() - 0.5) * 0.5,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: (Math.random() - 0.5) * s * 0.35,
        color: tmp,
        size: size * (0.55 + Math.random() * 0.9),
        ttl: ttl * (0.6 + Math.random() * 0.8),
        gravity,
        drag,
      });
    }
  }

  update(dt) {
    const { pos, vel, life, age, ttl, drag, grav, max } = this;
    let alive = 0;
    for (let i = 0; i < max; i++) {
      if (life[i] >= 1) continue;
      const a = age[i] + dt;
      if (a >= ttl[i]) {
        life[i] = 1;
        pos[i * 3 + 2] = -999;
        continue;
      }
      age[i] = a;
      life[i] = a / ttl[i];
      const i3 = i * 3;
      const d = Math.exp(-drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d + grav[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      alive++;
    }
    this.active = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(1);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 2] = -999;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }
}

/** Expanding additive ring — the shockwave of an explosion. */
export class Shockwaves {
  constructor(scene, count = 8) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.93, 1.0, 64, 1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.items.push({ mesh, t: 0, dur: 1, scale: 1, active: false });
    }
    this.cursor = 0;
  }

  spawn(x, y, scale = 1.35, color = 0xffffff, dur = 0.22) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.mesh.position.set(x, y, 0.6);
    it.mesh.material.color.set(color);
    it.mesh.visible = true;
    it.t = 0; it.dur = dur; it.scale = scale; it.active = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) { it.active = false; it.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      const s = 0.25 + e * it.scale;
      it.mesh.scale.set(s, s, 1);
      it.mesh.material.opacity = Math.min(1, Math.pow(1 - k, 3.0) * 1.4);
    }
  }

  clear() {
    for (const it of this.items) { it.active = false; it.mesh.visible = false; }
  }
}
