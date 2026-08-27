/**
 * Tuning constants and the wave curve.
 *
 * Wave numbers follow the spirit of the 1981 original: the Mad Bomber throws
 * ten more bombs each wave, drops them faster, and each bomb is worth its wave
 * number up to eight points.
 */

export const CONFIG = {
  // Buckets
  startBuckets: 3,
  maxBuckets: 3,
  extraBucketEvery: 1000,
  bucketRadius: 0.62,     // catch half-width, world units
  bucketMaxSpeed: 42,     // world units / second — a hard, honest speed limit
  bucketResponse: 0.042,  // seconds to close ~63% of the gap (lower = snappier)

  // Playfield (world units). Height is derived from the viewport aspect.
  playWidthMax: 15,
  playWidthMin: 9,
  bucketLineY: -7.2,      // y of the top bucket's rim
  floorY: -8.6,
  bomberY: 6.9,

  // Bombs
  bombRadius: 0.34,
  trailPerSecond: 34,

  // Scoring
  streakForBonus: 25,
  streakMultiplier: 2,
  waveClearBonus: 25,

  // Feel
  shakeOnCatch: 0.0,
  shakeOnMiss: 1.0,
  gloatSeconds: 1.6,
  waveBreakSeconds: 1.9,
};

/** Per-wave difficulty. `wave` is 1-based. */
export function waveSpec(wave) {
  const w = Math.max(1, wave | 0);
  return {
    wave: w,
    bombs: Math.min(10 + (w - 1) * 10, 150),
    value: Math.min(w, 8),
    // Seconds for a bomb to fall the full playfield height.
    fallTime: Math.max(0.72, 2.35 * Math.pow(0.885, w - 1)),
    // Seconds between throws.
    dropInterval: Math.max(0.13, 0.68 * Math.pow(0.9, w - 1)),
    // Bomber patrol speed, world units / second.
    bomberSpeed: Math.min(10.5, 2.4 + w * 0.62),
    // How eagerly the bomber changes direction mid-sweep.
    bomberChaos: Math.min(0.55, 0.05 + w * 0.05),
    // Palette drift so each wave reads differently.
    hue: (0.94 + (w - 1) * 0.085) % 1,
  };
}

export const QUALITY = {
  low:  { pixelRatio: 1.0,  bloomLevels: 2, maxParticles: 700,  grain: 0.0,  aberration: 0.0,  stars: 260 },
  med:  { pixelRatio: 1.5,  bloomLevels: 3, maxParticles: 1400, grain: 0.03, aberration: 0.7,  stars: 520 },
  high: { pixelRatio: 2.0,  bloomLevels: 4, maxParticles: 2400, grain: 0.045, aberration: 1.2, stars: 900 },
};
