# KABOOM // NEON

A mobile-first, browser-based remake of the 1981 Activision classic **Kaboom!**,
rebuilt in **three.js** with a modern real-time look: HDR rendering, a hand-rolled
bloom pipeline, ACES tone mapping, particle pyrotechnics and a procedural
synth-wave stage.

The Mad Bomber patrols the skyline dropping bombs. You slide a stack of buckets
underneath and catch every single one. Drop one and the whole screen goes up.

---

## Play

The game is plain static files — no build step, no bundler, no CDN.

```bash
npm start          # serves the folder on http://localhost:8080
```

Then open it on your phone at `http://<your-computer-ip>:8080` over the same
Wi-Fi. Any static host works too (GitHub Pages, Netlify, S3, `python3 -m http.server`);
just serve the repository root.

> It must be served over HTTP(S), not opened as a `file://` URL — ES modules and
> the service worker both require an origin.

### GitHub Pages

It runs on Pages as-is — no build step, no Actions workflow needed:

1. **Settings → Pages → Source: Deploy from a branch**
2. Pick the branch and **`/ (root)`**, then save.
3. It goes live at `https://<user>.github.io/<repo>/` after a minute or so.

Everything is referenced with relative `./` paths, so the project subpath in that
URL is fine, and `.nojekyll` stops Jekyll from touching the files on the way out.
Pages serves over HTTPS, so the service worker registers and the game is
installable and playable offline straight from there.

### Install it like an app

There's a web app manifest and a service worker, so on iOS (Share → *Add to
Home Screen*) or Android (*Install app*) it runs full-screen and works offline.

---

## How to play

| | |
|---|---|
| **Goal** | Catch every bomb the Bomber throws. |
| **Miss one** | Every live bomb detonates, you lose a bucket, and the wave restarts. |
| **Waves** | Each wave adds 10 bombs, drops them faster, and raises each bomb's value (capped at 8 points). |
| **Extra buckets** | One free bucket every 1,000 points, up to three. |
| **Streak** | 25 catches without a miss doubles every bomb's value until you drop one. |

### Controls

| Mode | How it works |
|---|---|
| **Drag** (default) | Touch anywhere and slide. Relative, so your thumb never covers the buckets. |
| **Direct** | The buckets jump to wherever you touch. |
| **Tilt** | Device orientation. Re-select *Tilt* in Settings to re-centre. iOS asks for motion permission. |
| **Keyboard** | `←`/`→` or `A`/`D` to move, `Esc`/`P` to pause, `Enter`/`Space` to start. |

Sensitivity, graphics tier, sound and haptics all live in **Settings** and
persist in `localStorage`.

---

## How it's put together

```
index.html            markup, HUD and menus, three.js import map
styles.css            HUD / menu styling, safe-area aware
src/
  main.js             bootstrap: renderer, graphics tier, resize, frame loop
  config.js           tuning constants and the per-wave difficulty curve
  game.js             rules and state machine (waves, scoring, misses, game over)
  world.js            camera framing, lighting, procedural sky/skyline/floor, screen shake
  postfx.js           HDR target → bright pass → bloom pyramid → ACES composite
  particles.js        pooled additive point sprites + shockwave rings
  bomber.js           the Mad Bomber: procedural mesh, patrol, throw and gloat animation
  buckets.js          the player's bucket stack and catch test
  bombs.js            pooled falling bombs with fuse sparks and trails
  input.js            drag / direct / tilt / keyboard control
  audio.js            procedural WebAudio sound effects (no audio files)
  ui.js               DOM HUD, menus, settings and high-score persistence
vendor/three/         pinned three.js build (r180), MIT
tools/serve.mjs       zero-dependency static server for local play
tools/smoke.mjs       headless Chromium smoke test (optional, needs playwright)
```

### Graphics notes

* **No example modules.** `EffectComposer` and friends live in three's
  `examples/jsm`; the post pipeline here is written from scratch against core
  three only, which keeps the vendored payload to two files.
* **HDR scene buffer.** The scene renders into a half-float target (three
  disables tone mapping for render targets), so emissive materials can exceed
  1.0 and actually bloom. Falls back to 8-bit with a lower threshold where
  `EXT_color_buffer_half_float` is missing.
* **Bloom pyramid.** Bright pass → 2–4 mips of separable 9-tap gaussian →
  weighted recombination in the composite pass, which also does ACES tone
  mapping, chromatic aberration, vignette, film grain and the hit flash.
* **Procedural everything.** Sky, nebulae, skyline, floor grid, glow sprites,
  the icon and every sound effect are generated at runtime or checked in as SVG.
  Total download is dominated by three.js itself.
* **Adaptive quality.** A tier is picked from `deviceMemory` /
  `hardwareConcurrency` / pixel count, and on *Auto* the game steps down a tier
  if it can't hold ~45 fps for a second. Pixel ratio, bloom mip count, particle
  budget, MSAA, grain and aberration all follow the tier.

### Layout

Vertical layout is derived from the visible frame rather than hard-coded, so the
same build reads correctly on a tall phone, a tablet and a laptop. Bomb fall
*time* is what the difficulty curve specifies — fall *speed* is computed from
the actual drop height, so the game plays identically at any aspect ratio.

---

## Smoke test

Optional, but it catches regressions in the rules and the render path:

```bash
npm install -D playwright && npx playwright install chromium
npm run smoke
```

It boots the game at four viewports, drives the game clock manually (so results
don't depend on render speed), and asserts that skilled play climbs waves
without losing buckets, that idle play ends the run, that pause/resume/quit
round-trip, and that nothing in the layout or physics goes `NaN`.

---

## Updating three.js

```bash
npm install three@<version>
npm run vendor:three
```

Then bump `CACHE` in `sw.js` so returning players pick up the new files.

---

## Licence

Game code © its authors. Bundled three.js is MIT — see `vendor/three/LICENSE`.
*Kaboom!* is a trademark of its respective owner; this is an original homage,
not affiliated with or endorsed by them.
