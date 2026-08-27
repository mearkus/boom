/**
 * Pooled falling bombs: a dark metal sphere with a glowing band, a sputtering
 * fuse spark and a particle trail.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildGlowTexture } from './world.js';

const POOL = 40;

export class Bombs {
  constructor(scene, particles) {
    this.particles = particles;
    this.scene = scene;
    this.active = [];
    this.pool = [];
    this.accent = new THREE.Color(0xff8a3c);

    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0x0e1226, metalness: 0.9, roughness: 0.22, envMapIntensity: 2.2,
    });
    this.bandMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff8a3c, emissiveIntensity: 4.2, roughness: 0.5, metalness: 0.1,
    });
    this.sparkTex = buildGlowTexture(64);

    const shellGeo = new THREE.SphereGeometry(CONFIG.bombRadius, 20, 16);
    const bandGeo = new THREE.TorusGeometry(CONFIG.bombRadius * 1.02, 0.045, 8, 26);
    const capGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.14, 10);

    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(shellGeo, this.shellMat);
      g.add(shell);
      const band = new THREE.Mesh(bandGeo, this.bandMat);
      band.rotation.x = Math.PI / 2.4;
      g.add(band);
      const cap = new THREE.Mesh(capGeo, this.shellMat);
      cap.position.y = CONFIG.bombRadius * 0.95;
      g.add(cap);

      // Soft halo so a bomb reads as a glowing object, not a thin ring.
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.sparkTex, color: 0xff8a3c, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55,
      }));
      halo.scale.setScalar(CONFIG.bombRadius * 6.0);
      halo.position.z = -0.05;
      g.add(halo);

      const spark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.sparkTex, color: 0xffd08a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      }));
      spark.scale.setScalar(0.8);
      spark.position.y = CONFIG.bombRadius + 0.16;
      g.add(spark);

      g.visible = false;
      this.scene.add(g);
      this.pool.push({
        root: g, shell, band, spark, halo,
        x: 0, y: 0, prevY: 0, vy: 0, spin: 0, t: 0, trail: 0, alive: false,
      });
    }
  }

  setAccent(color) {
    this.accent.copy(color);
    this.bandMat.emissive.copy(color);
    for (const b of this.pool) b.halo.material.color.copy(color);
  }

  get count() { return this.active.length; }

  spawn(x, y, fallDistance, fallTime) {
    const b = this.pool.find((p) => !p.alive);
    if (!b) return null;
    b.alive = true;
    b.x = x; b.y = y; b.prevY = y;
    b.vy = -fallDistance / fallTime;
    b.spin = (Math.random() - 0.5) * 7;
    b.t = 0;
    b.trail = 0;
    b.root.visible = true;
    b.root.position.set(x, y, 0);
    b.root.rotation.set(0, 0, 0);
    b.root.scale.setScalar(0.1);
    this.active.push(b);
    return b;
  }

  _retire(b) {
    b.alive = false;
    b.root.visible = false;
    const i = this.active.indexOf(b);
    if (i >= 0) this.active.splice(i, 1);
  }

  /** Remove one bomb with a small pop (used when caught). */
  consume(b) { this._retire(b); }

  /** Blow every live bomb up, staggered outward from `fromX`. */
  detonateAll(onEach) {
    const list = this.active.slice();
    list.sort((a, b) => a.y - b.y);
    list.forEach((b, i) => {
      if (onEach) onEach(b, i * 0.045);
      this._retire(b);
    });
    return list.length;
  }

  clear() {
    for (const b of this.active.slice()) this._retire(b);
  }

  update(dt, timeScale = 1) {
    const step = dt * timeScale;
    for (const b of this.active) {
      b.t += step;
      b.prevY = b.y;
      b.y += b.vy * step;
      b.root.position.set(b.x, b.y, 0);
      b.root.rotation.z += b.spin * step;
      b.root.rotation.x += b.spin * 0.4 * step;

      if (b.root.scale.x < 1) {
        b.root.scale.setScalar(Math.min(1, b.root.scale.x + step * 6));
      }

      // Fuse spark flicker.
      const f = 0.62 + Math.sin(b.t * 40 + b.spin) * 0.18 + Math.random() * 0.12;
      b.spark.scale.setScalar(f);
      b.spark.material.opacity = 0.75 + Math.random() * 0.25;
      b.halo.material.opacity = 0.42 + 0.14 * Math.sin(b.t * 9 + b.spin);

      // Comet trail.
      b.trail += step * CONFIG.trailPerSecond;
      while (b.trail >= 1) {
        b.trail -= 1;
        this.particles.emit({
          x: b.x + (Math.random() - 0.5) * 0.12,
          y: b.y + CONFIG.bombRadius * 0.9,
          z: (Math.random() - 0.5) * 0.1,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.6 + Math.random() * 0.8,
          color: this.accent,
          size: 0.62,
          ttl: 0.34,
          gravity: 0.4,
          drag: 2.4,
        });
      }
    }
  }
}
