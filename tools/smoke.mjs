/**
 * Headless smoke test. Boots the game in Chromium at four viewports and checks
 * that it renders without errors and that the rules still hold.
 *
 *   npm install -D playwright && npx playwright install chromium
 *   npm run smoke
 *
 * Set CHROMIUM_PATH to use a Chromium that Playwright didn't download.
 * The game clock is driven manually, so results don't depend on render speed.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed — run: npm install -D playwright && npx playwright install chromium');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 700));

const launchOptions = { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launchOptions);

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const VIEWPORTS = [
  { w: 390, h: 844, name: 'phone portrait' },
  { w: 844, h: 390, name: 'phone landscape' },
  { w: 768, h: 1024, name: 'tablet' },
  { w: 1440, h: 900, name: 'desktop' },
];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const K = window.KABOOM;
    if (!K) return { boot: false };
    const step = 1 / 60;
    const tick = K.game.update.bind(K.game);
    // Aim only — never move the buckets directly. The control law has to
    // actually deliver them, which is the thing worth testing. A player who
    // locks onto every bomb the moment it spawns is never late, so any miss
    // is the game's fault, not theirs.
    const aimAtLowestBomb = () => {
      const bs = K.game.bombs.active;
      if (!bs.length) return;
      let low = bs[0];
      for (const b of bs) if (b.y < low.y) low = b;
      K.input.target = low.x;
    };

    const playFairly = (fps, seconds) => {
      K.game.start();
      for (let i = 0; i < seconds * fps; i++) { aimAtLowestBomb(); tick(1 / fps); }
      return { wave: K.game.wave, score: K.game.score, buckets: K.game.buckets.count };
    };

    const skilled = playFairly(60, 120);

    // The same run at other frame rates must come out identical: motion is a
    // function of elapsed time, not of how often we sample it.
    const at30 = playFairly(30, 120);
    const at120 = playFairly(120, 120);

    K.game.start();
    let overAt = -1;
    for (let i = 0; i < 60 * 90; i++) { tick(step); if (K.game.state === 'over') { overAt = i / 60; break; } }

    K.game.start();
    K.game.pause();
    const paused = K.game.paused && K.ui.current === 'pause';
    K.game.resume();
    const resumed = !K.game.paused && K.ui.current === null;
    K.game.quit();
    const quit = K.game.state === 'menu' && K.ui.current === 'title';

    const finite = [K.game.buckets.x, K.world.camera.position.x, K.world.bounds.playHalfW,
      K.world.layout.bomberY, K.world.layout.bucketLineY].every(Number.isFinite);

    return {
      boot: true, skilled, at30, at120, overAt, paused, resumed, quit, finite,
      dropRoom: K.world.layout.bomberY - K.world.layout.bucketLineY,
      headroom: K.world.bounds.halfH - K.world.layout.bomberY,
    };
  });

  console.log(`\n— ${vp.name} (${vp.w}×${vp.h}) —`);
  check('boots and exposes game state', r.boot);
  if (r.boot) {
    check('renders without errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    check('skilled play climbs waves', r.skilled.wave >= 4 && r.skilled.score > 400, JSON.stringify(r.skilled));
    check('a fair player never loses a bucket', r.skilled.buckets === 3,
      `${r.skilled.buckets}/3 left`);
    check('play is frame-rate independent',
      r.at30.score === r.skilled.score && r.at120.score === r.skilled.score,
      `30fps=${r.at30.score}  60fps=${r.skilled.score}  120fps=${r.at120.score}`);
    check('idle play reaches game over', r.overAt > 5 && r.overAt < 40, `${r.overAt.toFixed(1)}s`);
    check('pause / resume / quit', r.paused && r.resumed && r.quit);
    check('no NaN in layout or physics', r.finite);
    check('bombs have room to fall', r.dropRoom > 6, r.dropRoom.toFixed(1));
    check('bomber stays inside the frame', r.headroom > 2.2, r.headroom.toFixed(1));
  }
  await ctx.close();
}

console.log('\n' + (failures ? `${failures} failure(s)` : 'all checks passed'));
await browser.close();
stop();
process.exit(failures ? 1 : 0);
