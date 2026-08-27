/**
 * KABOOM // NEON — bootstrap.
 *
 * Sets up the renderer, picks a graphics tier for the device, wires the UI to
 * the game, and runs the frame loop with a light adaptive-quality governor.
 */
import * as THREE from 'three';
import { CONFIG, QUALITY } from './config.js';
import { World } from './world.js';
import { PostFX } from './postfx.js';
import { Particles, Shockwaves } from './particles.js';
import { Bomber } from './bomber.js';
import { Buckets } from './buckets.js';
import { Bombs } from './bombs.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const canvas = document.getElementById('gl');

/* ── Graphics tier ───────────────────────────────────────────────────── */

function detectTier() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = window.innerWidth * window.innerHeight * dpr * dpr;
  if (mem <= 2 || cores <= 3) return 'low';
  if (mem <= 4 || pixels > 2.6e6) return 'med';
  return 'high';
}

function resolveTier(setting) {
  if (setting === 'low') return 'low';
  if (setting === 'high') return 'high';
  return detectTier();
}

/* ── Renderer ────────────────────────────────────────────────────────── */

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,        // MSAA is applied on the HDR target instead
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  });
} catch {
  renderer = null;
}

if (!renderer) {
  const ui = new UI({});
  ui.fatal('This game needs WebGL 2. Try an up-to-date Chrome, Safari or Firefox.');
  throw new Error('WebGL unavailable');
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x05060f, 1);

/* ── Systems ─────────────────────────────────────────────────────────── */

const ui = new UI({
  onPlay: () => { sfx.unlock(); game.start(); },
  onResume: () => game.resume(),
  onPause: () => game.pause(),
  onQuit: () => game.quit(),
  onUiTap: () => { sfx.unlock(); sfx.ui(); },
  onSound: (on) => sfx.setEnabled(on),
  onSensitivity: (v) => input.setSensitivity(v),
  onControlChange: (mode) => {
    input.setMode(mode);
    input.sync(buckets.x);
  },
  onQualityChange: (q) => applyTier(resolveTier(q), true),
});

let tierName = resolveTier(ui.settings.quality);
let tier = QUALITY[tierName];

const world = new World(renderer, tier);
const postfx = new PostFX(renderer);
const particles = new Particles(world.scene, tier.maxParticles);
const shockwaves = new Shockwaves(world.scene, 10);
const bomber = new Bomber(world.scene, particles);
const buckets = new Buckets(world.scene, particles);
const bombs = new Bombs(world.scene, particles);
const sfx = new Sfx();
const input = new Input(canvas);

sfx.setEnabled(ui.settings.sound);
input.setSensitivity(ui.settings.sensitivity);
if (!input.tiltAvailable) {
  ui.setTiltUnavailable();
  if (ui.settings.control === 'tilt') ui.settings.control = 'drag';
}
input.setMode(ui.settings.control);
input.onFirstInput = () => sfx.unlock();

const game = new Game({ world, bomber, buckets, bombs, particles, waves: shockwaves, sfx, ui, input, postfx });

/* ── Sizing ──────────────────────────────────────────────────────────── */

const drawSize = new THREE.Vector2();

function applyTier(name, announce = false) {
  tierName = name;
  tier = QUALITY[name];
  postfx.applySettings({ grain: tier.grain, aberration: tier.aberration });
  resize();
  if (announce && game.state !== 'menu') ui.toast(name.toUpperCase() + ' GRAPHICS', 'cool');
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatio));
  renderer.setSize(w, h, false);
  renderer.getDrawingBufferSize(drawSize);
  world.resize(w, h);
  postfx.setSize(drawSize.x, drawSize.y, tier.bloomLevels, tierName === 'high' ? 4 : 0);
  particles.setScale(drawSize.y * 0.26);
  world.stars.material.uniforms.uScale.value = drawSize.y * 0.5;
  bomber.baseY = world.layout.bomberY;
  buckets.baseY = world.layout.bucketLineY;
  input.halfW = world.bounds.playHalfW;
  ui.el.rotateHint.classList.toggle('hidden', !(w > h && h < 430));
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 220));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

/* ── Housekeeping ────────────────────────────────────────────────────── */

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (game.isRunning) game.pause();
  ui.persistBest();
});
window.addEventListener('pagehide', () => ui.persistBest());
window.addEventListener('blur', () => { if (game.isRunning) game.pause(); });
for (const ev of ['gesturestart', 'gesturechange', 'contextmenu']) {
  window.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'p') {
    if (game.paused) game.resume();
    else if (game.isRunning) game.pause();
  }
  if (k === 'enter' || k === ' ') {
    if (game.state === 'menu' && ui.current === 'title') { sfx.unlock(); game.start(); }
    else if (game.state === 'over' && ui.current === 'over') { sfx.unlock(); game.start(); }
  }
});

/* ── Frame loop ──────────────────────────────────────────────────────── */

const clock = new THREE.Clock();
let frameAccum = 0;
let frameCount = 0;
let downgradeCooldown = 6;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);

  game.update(dt);
  postfx.render(world.scene, world.camera, dt);

  // Adaptive quality: if we can't hold ~45fps for a second, step down a tier.
  if (ui.settings.quality === 'auto' && tierName !== 'low') {
    downgradeCooldown -= dt;
    frameAccum += dt;
    frameCount++;
    if (frameAccum >= 1) {
      const fps = frameCount / frameAccum;
      frameAccum = 0;
      frameCount = 0;
      if (fps < 45 && downgradeCooldown <= 0) {
        downgradeCooldown = 8;
        applyTier(tierName === 'high' ? 'med' : 'low');
      }
    }
  }
}

ui.show('title');
requestAnimationFrame(frame);

// Handy for tweaking from a device console.
window.KABOOM = { game, world, postfx, ui, input, CONFIG, applyTier };
