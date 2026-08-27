/**
 * The player's stack of buckets. The top bucket is the one that catches.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildGlowTexture, buildBeamTexture } from './world.js';

const SPACING = 0.58;

export class Buckets {
  constructor(scene, particles) {
    this.particles = particles;
    this.group = new THREE.Group();
    this.baseY = CONFIG.bucketLineY;
    this.group.position.set(0, this.baseY, 0);
    scene.add(this.group);

    this.x = 0;
    this.prevX = 0;       // start-of-frame x, so catches can be resolved sub-frame
    this.targetX = 0;
    this.vx = 0;
    this.count = CONFIG.startBuckets;
    this.time = 0;
    this.flash = 0;

    this._build();
    this.setCount(CONFIG.startBuckets, true);
  }

  _build() {
    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0x9fb6d8, metalness: 0.95, roughness: 0.18, envMapIntensity: 2.0,
      side: THREE.DoubleSide,
    });
    this.rimMat = new THREE.MeshStandardMaterial({
      color: 0x08101e, emissive: 0x34e5ff, emissiveIntensity: 3.6, roughness: 0.35, metalness: 0.4,
    });
    this.innerMat = new THREE.MeshStandardMaterial({
      color: 0x0a1424, metalness: 0.6, roughness: 0.5, envMapIntensity: 0.8,
    });

    const shellGeo = new THREE.CylinderGeometry(0.62, 0.44, 0.52, 26, 1, true);
    const rimGeo = new THREE.TorusGeometry(0.62, 0.045, 8, 34);
    const baseGeo = new THREE.CircleGeometry(0.44, 26);
    const handleGeo = new THREE.TorusGeometry(0.5, 0.032, 6, 24, Math.PI);

    this.buckets = [];
    for (let i = 0; i < CONFIG.maxBuckets; i++) {
      const b = new THREE.Group();
      const shell = new THREE.Mesh(shellGeo, this.shellMat);
      b.add(shell);
      const rim = new THREE.Mesh(rimGeo, this.rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.26;
      b.add(rim);
      const base = new THREE.Mesh(baseGeo, this.innerMat);
      base.rotation.x = -Math.PI / 2;
      base.position.y = -0.24;
      b.add(base);
      const handle = new THREE.Mesh(handleGeo, this.rimMat);
      handle.position.y = 0.2;
      handle.rotation.y = Math.PI / 2;
      b.add(handle);
      b.position.y = -i * SPACING;
      this.group.add(b);
      this.buckets.push({ root: b, rim, shell, index: i, pop: 0 });
    }

    // Aiming aid: a soft vertical beam rising from the top bucket.
    const beamMat = new THREE.MeshBasicMaterial({
      map: buildBeamTexture(), color: 0x34e5ff, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.beamMat = beamMat;
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 7.5), beamMat);
    this.beam.position.set(0, 4.0, -0.5);
    this.group.add(this.beam);

    // Ground glow beneath the stack.
    const glowMat = new THREE.MeshBasicMaterial({
      map: buildGlowTexture(128), color: 0x34e5ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.glowMat = glowMat;
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.4), glowMat);
    this.glow.position.set(0, -(CONFIG.maxBuckets - 1) * SPACING - 0.9, -0.6);
    this.group.add(this.glow);
  }

  setAccent(color) {
    this.rimMat.emissive.copy(color);
    this.beamMat.color.copy(color);
    this.glowMat.color.copy(color);
  }

  /** Y of the catching rim, in world space. */
  get catchY() { return this.baseY + 0.26; }

  get topIndex() { return this.count - 1; }

  setCount(n, instant = false) {
    const prev = this.count;
    this.count = THREE.MathUtils.clamp(n, 0, CONFIG.maxBuckets);
    for (let i = 0; i < this.buckets.length; i++) {
      const b = this.buckets[i];
      const visible = i < this.count;
      b.root.visible = visible;
      if (visible && (instant || i >= prev)) b.pop = 1;
    }
    this._layout();
  }

  /**
   * Buckets hang from the catch line downward, so the top bucket always sits
   * at the same height no matter how many are left.
   */
  _layout() {
    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i].root.position.y = -(this.count - 1 - i) * SPACING;
    }
    this.glow.position.y = -(this.count - 1) * SPACING - 0.9;
  }

  /** Play the "bucket destroyed" burst at the top of the stack. */
  loseTop(color) {
    const top = this.buckets[this.count - 1];
    if (!top) return;
    const y = this.baseY + top.root.position.y;
    this.particles.burst(this.x, y, 26, {
      color, color2: new THREE.Color(0xffffff), speed: 7.5, size: 1.5, ttl: 0.9, gravity: -10,
    });
    this.setCount(this.count - 1);
  }

  /** Feedback for a successful catch. */
  onCatch(color) {
    this.flash = 1;
    const y = this.catchY;
    this.particles.burst(this.x, y + 0.1, 12, {
      color, color2: new THREE.Color(0xffffff), speed: 4.6, spread: Math.PI * 0.9,
      angle: Math.PI / 2, size: 1.05, ttl: 0.45, gravity: -9, drag: 2.6,
    });
  }

  /**
   * Is a bomb at `bombX` inside the mouth of the top bucket, given the bucket
   * is at `bucketX`? The caller passes the bucket's position at the instant the
   * bomb crossed the rim, which is partway through the frame — sampling the
   * end-of-frame position instead would misjudge fast crossings.
   */
  catchesAt(bombX, bucketX) {
    if (this.count <= 0) return false;
    return Math.abs(bombX - bucketX) <= CONFIG.bucketRadius + CONFIG.bombRadius * 0.55;
  }

  reset() {
    this.x = 0;
    this.prevX = 0;       // start-of-frame x, so catches can be resolved sub-frame
    this.targetX = 0;
    this.vx = 0;
    this.setCount(CONFIG.startBuckets, true);
  }

  update(dt, halfW) {
    this.time += dt;
    const limit = halfW - CONFIG.bucketRadius;
    this.targetX = THREE.MathUtils.clamp(this.targetX, -limit, limit);
    this.prevX = this.x;

    // Exponential approach to the target, then a hard cap on the distance
    // covered. Both terms are exact functions of elapsed time, so the bucket
    // lands in the same place at 30, 60 or 120fps and doesn't flinch when a
    // frame runs long. (The previous law scaled with 1/dt on one side and with
    // dt on the other, so every hitch in frame timing moved the buckets.)
    const alpha = 1 - Math.exp(-dt / CONFIG.bucketResponse);
    const maxStep = CONFIG.bucketMaxSpeed * dt;
    const step = THREE.MathUtils.clamp((this.targetX - this.x) * alpha, -maxStep, maxStep);
    this.x = THREE.MathUtils.clamp(this.x + step, -limit, limit);
    this.vx = (this.x - this.prevX) / Math.max(dt, 1e-4);

    this.group.position.x = this.x;
    this.group.position.y = this.baseY;

    // Tilt the stack with lateral acceleration.
    const tilt = THREE.MathUtils.clamp(-this.vx * 0.018, -0.3, 0.3);
    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, tilt, 10, dt);

    this.flash = Math.max(0, this.flash - dt * 4);
    const base = 3.0 + Math.sin(this.time * 2.6) * 0.5;
    this.rimMat.emissiveIntensity = base + this.flash * 9;
    this.beamMat.opacity = 0.15 + this.flash * 0.3;
    this.glowMat.opacity = 0.42 + this.flash * 0.5;

    for (const b of this.buckets) {
      if (b.pop > 0) {
        b.pop = Math.max(0, b.pop - dt * 3.2);
        const k = 1 + b.pop * b.pop * 0.6;
        b.root.scale.set(k, 2 - k, k);
      } else if (b.root.scale.x !== 1) {
        b.root.scale.setScalar(1);
      }
    }
  }
}
