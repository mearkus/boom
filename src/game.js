/**
 * Game rules and state machine.
 *
 * Faithful to the 1981 original: catch every bomb the Mad Bomber throws.
 * Drop one and every live bomb detonates, you lose a bucket, and the wave
 * starts over. Survive on three buckets; earn one back every 1,000 points.
 */
import * as THREE from 'three';
import { CONFIG, waveSpec } from './config.js';

const S = {
  MENU: 'menu',
  INTRO: 'intro',
  PLAYING: 'playing',
  GLOAT: 'gloat',
  BREAK: 'break',
  OVER: 'over',
};

export class Game {
  constructor(deps) {
    Object.assign(this, deps); // world, bomber, buckets, bombs, particles, waves, sfx, ui, input, postfx
    this.state = S.MENU;
    this.paused = false;

    this.score = 0;
    this.wave = 1;
    this.spec = waveSpec(1);
    this.toThrow = 0;
    this.caught = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.nextExtraAt = CONFIG.extraBucketEvery;
    this.startBest = 0;
    this.dropTimer = 0;
    this.stateTimer = 0;
    this.timeScale = 1;
    this.timeScaleTarget = 1;
    this.timers = [];

    this._accent = new THREE.Color();
    this._white = new THREE.Color(0xffffff);
    this._hot = new THREE.Color(0xff6a2c);
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────── */

  start() {
    this.score = 0;
    this.wave = 1;
    this.streak = 0;
    this.bestStreak = 0;
    this.nextExtraAt = CONFIG.extraBucketEvery;
    this.startBest = this.ui.best;   // what we have to beat this run
    this.timers.length = 0;
    this.timeScale = this.timeScaleTarget = 1;
    this.paused = false;

    this.bombs.clear();
    this.particles.clear();
    this.waves.clear();
    this.buckets.reset();
    this.bomber.reset();
    this.input.reset(this.world.bounds.playHalfW);
    this.postfx.damage = 0;

    this.ui.setScore(0);
    this.ui.setBuckets(this.buckets.count);
    this.ui.setStreak(0, false);
    this.ui.hideAll();

    this._beginWave(1);
  }

  quit() {
    this.state = S.MENU;
    this.bombs.clear();
    this.particles.clear();
    this.waves.clear();
    this.timers.length = 0;
    this.postfx.damage = 0;
    this.bomber.reset();
    this.buckets.reset();
    this.input.reset(this.world.bounds.playHalfW);
    this.ui.persistBest();
    this.ui.show('title');
  }

  pause() {
    if (this.state === S.MENU || this.state === S.OVER) return;
    this.paused = true;
    this.ui.persistBest();
    this.ui.show('pause');
  }

  resume() {
    this.paused = false;
    this.input.sync(this.buckets.x);
    this.ui.hideAll();
  }

  get isRunning() {
    return !this.paused && this.state !== S.MENU && this.state !== S.OVER;
  }

  /* ── Waves ─────────────────────────────────────────────────────────── */

  _beginWave(n) {
    this.wave = n;
    this.spec = waveSpec(n);
    this.toThrow = this.spec.bombs;
    this.caught = 0;
    this.dropTimer = 0.55;

    this._accent.setHSL(this.spec.hue, 0.85, 0.6);
    this.world.setHue(this.spec.hue);
    this.bomber.setWave(this.spec);
    this.bombs.setAccent(this._accent);
    this.buckets.setAccent(new THREE.Color().setHSL((this.spec.hue + 0.5) % 1, 0.9, 0.62));

    this.ui.setWave(n);
    this.ui.setBombsLeft(this.spec.bombs);
    this.ui.toast(`WAVE ${n}\n${this.spec.value} PT PER BOMB`, 'cool');
    this.bomber.taunt();

    this.state = S.INTRO;
    this.stateTimer = 1.15;
  }

  _restartWave() {
    this.toThrow = this.spec.bombs;
    this.caught = 0;
    this.dropTimer = 0.7;
    this.ui.setBombsLeft(this.toThrow);
    this.state = S.PLAYING;
  }

  _clearWave() {
    const bonus = CONFIG.waveClearBonus * this.wave;
    this._addScore(bonus);
    this.sfx.waveClear();
    this.ui.buzz([12, 40, 12]);
    this.ui.toast(`WAVE CLEAR\n+${bonus}`, 'gold');
    this.world.shake(0.12);

    // Celebratory fountain from the buckets.
    for (let i = 0; i < 3; i++) {
      this.timers.push({
        t: i * 0.12,
        fn: () => this.particles.burst(this.buckets.x, this.buckets.catchY, 26, {
          color: this._accent, color2: this._white, speed: 11, spread: Math.PI * 0.8,
          angle: Math.PI / 2, size: 1.5, ttl: 1.1, gravity: -10, drag: 0.9,
        }),
      });
    }

    this.state = S.BREAK;
    this.stateTimer = CONFIG.waveBreakSeconds;
  }

  /* ── Scoring ───────────────────────────────────────────────────────── */

  get streakActive() { return this.streak >= CONFIG.streakForBonus; }

  _addScore(points) {
    this.score += points;
    this.ui.setScore(this.score, true);
    while (this.score >= this.nextExtraAt) {
      this.nextExtraAt += CONFIG.extraBucketEvery;
      if (this.buckets.count < CONFIG.maxBuckets) {
        this.buckets.setCount(this.buckets.count + 1);
        this.ui.setBuckets(this.buckets.count);
        this.sfx.extraBucket();
        this.ui.toast('EXTRA BUCKET', 'cool');
        this.ui.buzz(30);
      }
    }
    if (this.score > this.ui.best) this.ui.setBest(this.score);
  }

  /* ── Events ────────────────────────────────────────────────────────── */

  _onCatch(bomb) {
    const wasActive = this.streakActive;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (!wasActive && this.streakActive) {
      this.sfx.streakOn();
      this.ui.toast('DOUBLE POINTS', 'gold');
    }
    this.ui.setStreak(this.streak, this.streakActive);

    const value = this.spec.value * (this.streakActive ? CONFIG.streakMultiplier : 1);
    this._addScore(value);
    this.caught++;

    this.bombs.consume(bomb);
    this.buckets.onCatch(this._accent);
    this.sfx.catch(this.streak);
    this.world.pulseLight(this._accent, 6, { x: this.buckets.x, y: this.buckets.catchY });
    this.ui.setBombsLeft(this.toThrow + this.bombs.count);

    if (this.toThrow === 0 && this.bombs.count === 0) this._clearWave();
  }

  _explode(x, y, power, delay = 0) {
    this.timers.push({
      t: delay,
      fn: () => {
        this.particles.burst(x, y, Math.round(52 * power), {
          color: this._hot, color2: new THREE.Color(0xffe08a),
          speed: 13 * power, size: 0.78 * power, ttl: 0.9, gravity: -9, drag: 1.3,
        });
        this.particles.burst(x, y, Math.round(16 * power), {
          color: this._white, speed: 18 * power, size: 0.5, ttl: 0.36, gravity: -3, drag: 3.2,
        });
        this.waves.spawn(x, y, 1.45 * power, 0xfff0dd, 0.24);
        this.world.shake(0.34 * power);
        this.world.pulseLight(this._hot, 26 * power, { x, y });
        this.postfx.punch(0.32 * power, this._hot);
        this.sfx.explode(power);
      },
    });
  }

  _onMiss(bomb) {
    this.streak = 0;
    this.ui.setStreak(0, false);

    const x = bomb.x;
    const y = this.buckets.catchY;
    this._explode(x, y, 1.25, 0);
    this.bombs.consume(bomb);

    // Chain-detonate everything still in the air.
    this.bombs.detonateAll((b, delay) => this._explode(b.x, b.y, 0.85, 0.06 + delay));

    this.buckets.loseTop(this._accent);
    this.ui.setBuckets(this.buckets.count);
    this.sfx.loseBucket();
    this.ui.buzz([40, 60, 90]);
    this.world.shake(CONFIG.shakeOnMiss);
    this.postfx.punch(0.6, this._hot);

    // Brief slow motion for the "oh no" beat.
    this.timeScale = 0.28;
    this.timeScaleTarget = 1;

    this.bomber.gloat();
    this.state = S.GLOAT;
    this.stateTimer = CONFIG.gloatSeconds;

    if (this.buckets.count <= 0) {
      this.ui.toast('BOOM', 'hot');
    } else {
      this.ui.toast(`BUCKET LOST\nWAVE ${this.wave} RESTARTS`, 'hot');
    }
  }

  _gameOver() {
    this.state = S.OVER;
    this.bombs.clear();
    this.timers.length = 0;
    this.sfx.gameOver();
    this.ui.buzz([90, 60, 140]);
    this.postfx.punch(0.9, this._hot);
    this.world.shake(1.2);
    this.particles.burst(this.buckets.x, this.buckets.catchY, 60, {
      color: this._hot, color2: this._white, speed: 16, size: 0.95, ttl: 1.4, gravity: -8, drag: 1.1,
    });
    this.waves.spawn(this.buckets.x, this.buckets.catchY, 3.0, 0xffc9d4, 0.55);

    const isBest = this.score > this.startBest;
    this.ui.persistBest();
    setTimeout(() => {
      if (this.state === S.OVER) this.ui.showGameOver(this.score, this.wave, isBest);
    }, 1100);
  }

  /* ── Frame ─────────────────────────────────────────────────────────── */

  update(dt) {
    // Ambience keeps running behind menus and the pause screen.
    const focus = this.state === S.MENU ? Math.sin(performance.now() * 0.0004) * 2.2 : this.buckets.x;
    this.world.update(dt, focus);

    if (this.state === S.MENU) {
      this.bomber.update(dt, this.world.bounds.playHalfW, true);
      this.buckets.update(dt, this.world.bounds.playHalfW);
      this.bombs.update(dt, 1);
      this.particles.update(dt);
      this.waves.update(dt);
      return;
    }

    if (this.paused) {
      this.particles.update(dt * 0.15);
      this.waves.update(dt * 0.15);
      this.bomber.update(dt * 0.15, this.world.bounds.playHalfW, false);
      return;
    }

    // Scheduled explosions run on real time so chains stay punchy.
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const T = this.timers[i];
      T.t -= dt;
      if (T.t <= 0) { this.timers.splice(i, 1); T.fn(); }
    }

    this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dt * 2.6);
    const gdt = dt * this.timeScale;
    const halfW = this.world.bounds.playHalfW;

    // Player.
    const target = this.input.update(dt, halfW);
    this.buckets.targetX = target;
    this.buckets.update(dt, halfW);

    // Danger vignette when the last bucket is on the line.
    const danger = this.buckets.count <= 1 && this.state !== S.OVER ? 1 : 0;
    this.postfx.damage += (danger * (0.35 + 0.2 * Math.sin(performance.now() * 0.006)) - this.postfx.damage) * Math.min(1, dt * 3);

    switch (this.state) {
      case S.INTRO:
        this.bomber.update(gdt, halfW, true);
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.state = S.PLAYING;
        break;

      case S.PLAYING: {
        this.bomber.update(gdt, halfW, true);
        if (this.toThrow > 0) {
          this.dropTimer -= gdt;
          if (this.dropTimer <= 0) {
            this.dropTimer += this.spec.dropInterval;
            this._throw();
          }
        }
        break;
      }

      case S.GLOAT:
        this.bomber.update(gdt, halfW, false);
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          if (this.buckets.count <= 0) this._gameOver();
          else this._restartWave();
        }
        break;

      case S.BREAK:
        this.bomber.update(gdt, halfW, true);
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this._beginWave(this.wave + 1);
        break;

      case S.OVER:
        this.bomber.update(gdt, halfW, false);
        break;
    }

    this.bombs.update(gdt, 1);
    this._resolveBombs();
    this.particles.update(dt);
    this.waves.update(dt);
  }

  _throw() {
    const from = this.bomber.throwFrom();
    const catchY = this.buckets.catchY;
    const distance = from.y - catchY;
    if (distance <= 0) return;
    const x = THREE.MathUtils.clamp(from.x, -this.world.bounds.playHalfW + 0.4,
                                            this.world.bounds.playHalfW - 0.4);
    this.bombs.spawn(x, from.y, distance, this.spec.fallTime);
    this.toThrow--;
    this.sfx.throwBomb(this.wave);
    this.ui.setBombsLeft(this.toThrow + this.bombs.count);
  }

  _resolveBombs() {
    if (this.state !== S.PLAYING && this.state !== S.INTRO) return;
    const line = this.buckets.catchY;
    for (const b of this.bombs.active.slice()) {
      if (b.prevY >= line && b.y <= line) {
        if (this.buckets.catches(b.x, b.y, b.prevY)) this._onCatch(b);
        else { this._onMiss(b); return; }
      }
    }
  }
}
