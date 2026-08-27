/**
 * The Mad Bomber — a procedurally built, hovering menace who patrols the top
 * of the screen, lobs bombs, and gloats every time one gets past you.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';

const TWO_PI = Math.PI * 2;

export class Bomber {
  constructor(scene, particles) {
    this.particles = particles;
    this.group = new THREE.Group();
    this.baseY = CONFIG.bomberY;
    this.group.position.set(0, this.baseY, 0);
    scene.add(this.group);

    this.x = 0;
    this.dir = 1;
    this.speed = 3;
    this.chaos = 0.12;
    this.vx = 0;
    this.time = 0;
    this.throwT = 1;
    this.throwArm = 1;      // +1 right arm, -1 left arm
    this.gloatT = 0;
    this.tauntT = 0;
    this.baseHue = 0.94;

    this._build();
  }

  _build() {
    const body = new THREE.MeshStandardMaterial({
      color: 0x161a38, metalness: 0.82, roughness: 0.26, envMapIntensity: 1.5,
    });
    const cloth = new THREE.MeshStandardMaterial({
      color: 0x2b1252, metalness: 0.25, roughness: 0.55, envMapIntensity: 1.1,
    });
    const skin = new THREE.MeshStandardMaterial({
      color: 0x74e6a8, metalness: 0.1, roughness: 0.42,
      emissive: 0x0f4a30, emissiveIntensity: 0.6, envMapIntensity: 1.2, flatShading: true,
    });
    this.trim = new THREE.MeshStandardMaterial({
      color: 0x0a0d1e, emissive: 0xff3d6e, emissiveIntensity: 1.9, roughness: 0.4, metalness: 0.3,
    });
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffe27a, emissiveIntensity: 3.4, roughness: 1,
    });
    this.grinMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff5a3c, emissiveIntensity: 2.4, roughness: 1,
    });
    this.materials = [body, cloth, skin, this.trim, this.eyeMat, this.grinMat];

    // Robe / body — narrow enough that the head stays the focal point.
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.7, 1.15, 20, 1), cloth);
    robe.position.y = -0.45;
    this.group.add(robe);

    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.05, 8, 30), this.trim);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = -1.0;
    this.group.add(hem);

    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), body);
    shoulders.scale.set(1.5, 0.66, 1.0);
    shoulders.position.y = 0.18;
    this.group.add(shoulders);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 24), this.trim);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.34;
    this.group.add(collar);

    // Head — deliberately oversized so the face reads on a phone.
    this.head = new THREE.Group();
    this.head.position.y = 0.92;
    this.group.add(this.head);

    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), skin);
    skull.scale.set(1.0, 1.06, 0.88);
    this.head.add(skull);

    const eyeGeo = new THREE.SphereGeometry(0.15, 12, 10);
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, this.eyeMat);
      e.position.set(sx * 0.24, 0.1, 0.5);
      this.head.add(e);
      this.eyes.push(e);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x0a0512 }));
      pupil.position.set(sx * 0.26, 0.08, 0.62);
      this.head.add(pupil);
      // Angry brow.
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.07), this.trim);
      brow.position.set(sx * 0.25, 0.3, 0.52);
      brow.rotation.z = sx * -0.5;
      this.head.add(brow);
    }

    // Grin: a half torus, opening downward.
    this.grin = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 24, Math.PI), this.grinMat);
    this.grin.position.set(0, -0.16, 0.48);
    this.grin.rotation.z = Math.PI;
    this.head.add(this.grin);

    // Jester hat.
    this.hat = new THREE.Group();
    this.hat.position.y = 0.52;
    this.head.add(this.hat);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 18, 1, true), cloth);
    cap.position.y = 0.4;
    cap.rotation.z = -0.16;
    this.hat.add(cap);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.06, 8, 26), this.trim);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.02;
    this.hat.add(band);
    this.pom = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), this.trim);
    this.pom.position.set(-0.16, 0.86, 0);
    this.hat.add(this.pom);

    // Arms.
    this.arms = [];
    const armGeo = new THREE.CapsuleGeometry(0.1, 0.5, 4, 10);
    const handGeo = new THREE.SphereGeometry(0.17, 12, 10);
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.72, 0.24, 0.26);
      const arm = new THREE.Mesh(armGeo, body);
      arm.position.y = -0.3;
      pivot.add(arm);
      const hand = new THREE.Mesh(handGeo, skin);
      hand.position.y = -0.62;
      pivot.add(hand);
      pivot.rotation.z = sx * -0.85;
      this.group.add(pivot);
      this.arms.push({ pivot, hand, side: sx, rest: sx * -0.85 });
    }

    // Hover ring + thruster glow.
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.035, 8, 36), this.trim);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = -1.3;
    this.group.add(this.ring);

    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xff5c8a, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.thrust = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), this.glowMat);
    this.thrust.rotation.x = -Math.PI / 2;
    this.thrust.position.y = -1.34;
    this.group.add(this.thrust);
  }

  setWave(spec) {
    this.speed = spec.bomberSpeed;
    this.chaos = spec.bomberChaos;
    this.baseHue = spec.hue;
    const accent = new THREE.Color().setHSL(spec.hue, 0.85, 0.58);
    this.trim.emissive.copy(accent);
    this.glowMat.color.copy(accent);
    this.grinMat.emissive.copy(accent).lerp(new THREE.Color(0xff8a3c), 0.5);
  }

  reset() {
    this.x = 0;
    this.dir = Math.random() > 0.5 ? 1 : -1;
    this.gloatT = 0;
    this.throwT = 1;
    this.group.position.set(0, this.baseY, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(1);
  }

  gloat(seconds = CONFIG.gloatSeconds) { this.gloatT = seconds; }
  taunt(seconds = 1.0) { this.tauntT = seconds; }
  get isGloating() { return this.gloatT > 0; }

  /** Start a throw animation; returns the world position of the throwing hand. */
  throwFrom() {
    this.throwArm = Math.random() > 0.5 ? 1 : -1;
    this.throwT = 0;
    const arm = this.arms.find((a) => a.side === this.throwArm) || this.arms[0];
    const p = new THREE.Vector3();
    arm.hand.getWorldPosition(p);
    p.z = 0;
    return p;
  }

  update(dt, halfW, moving) {
    this.time += dt;
    const t = this.time;

    if (this.gloatT > 0) {
      this.gloatT -= dt;
      // Spin and swell while cackling.
      this.group.rotation.y += dt * 9;
      const k = 1 + Math.sin(t * 22) * 0.07;
      this.group.scale.setScalar(k);
      this.grin.scale.set(1.35, 1.5, 1.35);
      this.head.rotation.z = Math.sin(t * 14) * 0.22;
      this.vx = 0;
    } else {
      this.group.rotation.y *= Math.pow(0.02, dt);
      this.group.scale.setScalar(THREE.MathUtils.damp(this.group.scale.x, 1, 8, dt));
      this.grin.scale.setScalar(THREE.MathUtils.damp(this.grin.scale.x, 1, 8, dt));
      this.head.rotation.z = THREE.MathUtils.damp(this.head.rotation.z, 0, 8, dt);

      if (moving) {
        const limit = halfW - 1.0;
        // Weaving patrol: a sine wobble on top of the sweep keeps it unpredictable.
        const weave = Math.sin(t * (1.1 + this.speed * 0.14)) * this.chaos;
        this.vx = this.dir * this.speed * (0.75 + Math.abs(weave));
        this.x += this.vx * dt;
        if (this.x > limit) { this.x = limit; this.dir = -1; }
        if (this.x < -limit) { this.x = -limit; this.dir = 1; }
        if (Math.random() < this.chaos * dt * 1.4) this.dir *= -1;
      } else {
        this.vx = 0;
      }
    }

    this.group.position.x = this.x;
    this.group.position.y = this.baseY + Math.sin(t * 2.1) * 0.14;

    // Lean into the direction of travel.
    const lean = THREE.MathUtils.clamp(-this.vx * 0.045, -0.34, 0.34);
    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, lean, 7, dt);

    // Hat and pom trail behind.
    this.hat.rotation.z = THREE.MathUtils.damp(this.hat.rotation.z, lean * 1.6, 5, dt);
    this.pom.position.x = 0.06 - this.vx * 0.03;

    // Throw animation.
    this.throwT = Math.min(1, this.throwT + dt * 4.2);
    for (const a of this.arms) {
      let target = a.rest + Math.sin(t * 2.4 + a.side) * 0.08;
      if (a.side === this.throwArm && this.throwT < 1) {
        const k = this.throwT;
        const swing = k < 0.3 ? -(k / 0.3) * 1.5 : -1.5 + ((k - 0.3) / 0.7) * 3.1;
        target = a.rest + a.side * swing;
      }
      a.pivot.rotation.z = THREE.MathUtils.damp(a.pivot.rotation.z, target, 14, dt);
    }

    // Eyes pulse; brighter as the wave heats up.
    const pulse = 3.4 + Math.sin(t * 6) * 1.1 + (this.gloatT > 0 ? 5 : 0);
    this.eyeMat.emissiveIntensity = pulse;

    this.glowMat.opacity = 0.26 + 0.12 * Math.sin(t * 7.3);
    this.ring.rotation.z += dt * 1.4;

    // Thruster embers.
    if (this.particles && Math.random() < dt * 34) {
      this.particles.emit({
        x: this.group.position.x + (Math.random() - 0.5) * 1.3,
        y: this.group.position.y - 1.36,
        z: (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -1.4 - Math.random(),
        color: this.glowMat.color,
        size: 0.7,
        ttl: 0.5,
        gravity: -1.2,
        drag: 1.2,
      });
    }
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.glowMat.dispose();
  }
}
