/** DOM heads-up display, menus and persisted settings. */

const STORE_BEST = 'kaboom.best.v1';
const STORE_SETTINGS = 'kaboom.settings.v1';

const DEFAULT_SETTINGS = {
  control: 'drag',
  sensitivity: 1.4,
  quality: 'auto',
  sound: true,
  haptics: true,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.best = Number(read(STORE_BEST, 0)) || 0;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, read(STORE_SETTINGS, {}));

    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), score: $('score'), best: $('best'), wave: $('wave'),
      bombsLeft: $('bombsLeft'), pips: $('pips'), pauseBtn: $('pauseBtn'),
      streak: $('streak'), toast: $('toast'),
      title: $('titleScreen'), how: $('howScreen'), settings: $('settingsScreen'),
      pause: $('pauseScreen'), over: $('overScreen'),
      bestTitle: $('bestTitle'), finalScore: $('finalScore'), finalSub: $('finalSub'),
      newBest: $('newBest'), overTitle: $('overTitle'),
      controlSeg: $('controlSeg'), qualitySeg: $('qualitySeg'),
      controlHint: $('controlHint'), sens: $('sensSlider'),
      sound: $('soundToggle'), haptics: $('hapticToggle'),
      rotateHint: $('rotateHint'), fatal: $('fatal'),
    };

    this.screens = ['title', 'how', 'settings', 'pause', 'over'];
    this.current = 'title';
    this.backTo = 'title';
    this._pipCount = -1;

    this._buildPips(3);
    this._wire();
    this._syncSettingsUI();
    this.setBest(this.best);
  }

  _wire() {
    const tap = (el, fn) => el && el.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.h.onUiTap) this.h.onUiTap();
      fn(e);
    });

    tap(document.getElementById('playBtn'), () => this.h.onPlay());
    tap(document.getElementById('howBtn'), () => { this.backTo = 'title'; this.show('how'); });
    tap(document.getElementById('settingsBtn'), () => { this.backTo = 'title'; this.show('settings'); });
    tap(document.getElementById('resumeBtn'), () => this.h.onResume());
    tap(document.getElementById('pauseSettingsBtn'), () => { this.backTo = 'pause'; this.show('settings'); });
    tap(document.getElementById('quitBtn'), () => this.h.onQuit());
    tap(document.getElementById('againBtn'), () => this.h.onPlay());
    tap(document.getElementById('menuBtn'), () => this.h.onQuit());
    tap(this.el.pauseBtn, () => this.h.onPause());
    for (const b of document.querySelectorAll('.back-btn')) tap(b, () => this.show(this.backTo));

    const seg = (root, key, cb) => {
      for (const b of root.querySelectorAll('button')) {
        tap(b, () => {
          const v = b.dataset.value;
          this.settings[key] = v;
          this._syncSettingsUI();
          this._save();
          if (cb) cb(v);
        });
      }
    };
    seg(this.el.controlSeg, 'control', (v) => this.h.onControlChange(v));
    seg(this.el.qualitySeg, 'quality', (v) => this.h.onQualityChange(v));

    this.el.sens.addEventListener('input', () => {
      this.settings.sensitivity = Number(this.el.sens.value);
      this._save();
      this.h.onSensitivity(this.settings.sensitivity);
    });
    this.el.sound.addEventListener('change', () => {
      this.settings.sound = this.el.sound.checked;
      this._save();
      this.h.onSound(this.settings.sound);
    });
    this.el.haptics.addEventListener('change', () => {
      this.settings.haptics = this.el.haptics.checked;
      this._save();
    });
  }

  _save() { write(STORE_SETTINGS, this.settings); }

  _syncSettingsUI() {
    const mark = (root, value) => {
      for (const b of root.querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === value);
    };
    mark(this.el.controlSeg, this.settings.control);
    mark(this.el.qualitySeg, this.settings.quality);
    this.el.sens.value = String(this.settings.sensitivity);
    this.el.sound.checked = !!this.settings.sound;
    this.el.haptics.checked = !!this.settings.haptics;
    const hints = {
      drag: 'Touch anywhere and slide — your thumb never covers the buckets.',
      direct: 'The buckets jump to wherever you touch.',
      tilt: 'Tilt your phone left and right. Tap Tilt again to re-centre.',
    };
    this.el.controlHint.textContent = hints[this.settings.control] || '';
  }

  setTiltUnavailable() {
    const btn = this.el.controlSeg.querySelector('[data-value="tilt"]');
    if (btn) btn.disabled = true;
  }

  /* ── Screens ───────────────────────────────────────────────────────── */

  show(name) {
    this.current = name;
    for (const s of this.screens) this.el[s].classList.toggle('hidden', s !== name);
    const inGame = name === null || name === 'pause';
    this.el.hud.classList.toggle('hidden', !inGame);
  }

  hideAll() { this.show(null); }

  /* ── HUD ───────────────────────────────────────────────────────────── */

  _buildPips(max) {
    this.el.pips.innerHTML = '';
    this.pips = [];
    for (let i = 0; i < max; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      this.el.pips.appendChild(d);
      this.pips.push(d);
    }
  }

  setScore(v, bump) {
    this.el.score.textContent = v.toLocaleString();
    if (bump) {
      this.el.score.classList.remove('bump');
      void this.el.score.offsetWidth;
      this.el.score.classList.add('bump');
    }
  }

  /** localStorage is synchronous, so only write when a run ends. */
  setBest(v, persist = false) {
    this.best = v;
    this.el.best.textContent = 'BEST ' + v.toLocaleString();
    this.el.bestTitle.textContent = v.toLocaleString();
    if (persist) write(STORE_BEST, v);
  }

  persistBest() { write(STORE_BEST, this.best); }

  setWave(n) { this.el.wave.textContent = String(n); }

  setBombsLeft(n) { this.el.bombsLeft.textContent = n + ' LEFT'; }

  setBuckets(n) {
    if (n === this._pipCount) return;
    this._pipCount = n;
    this.pips.forEach((p, i) => p.classList.toggle('spent', i >= n));
  }

  setStreak(n, active) {
    if (!active) { this.el.streak.classList.add('hidden'); return; }
    this.el.streak.classList.remove('hidden');
    this.el.streak.textContent = `STREAK ×${n}  ·  DOUBLE POINTS`;
  }

  toast(text, tone = '') {
    const t = this.el.toast;
    t.className = tone;
    t.textContent = text;
    t.classList.remove('hidden');
    void t.offsetWidth;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(this._toastTO);
    this._toastTO = setTimeout(() => t.classList.add('hidden'), 900);
  }

  showGameOver(score, wave, isBest) {
    this.el.finalScore.textContent = score.toLocaleString();
    this.el.finalSub.textContent = `WAVE ${wave} · BEST ${this.best.toLocaleString()}`;
    this.el.newBest.classList.toggle('hidden', !isBest);
    this.el.overTitle.textContent = isBest ? 'NEW HIGH SCORE' : 'THE BOMBER WINS';
    this.show('over');
  }

  fatal(message) {
    this.el.fatal.textContent = message;
    this.el.fatal.classList.remove('hidden');
    for (const s of this.screens) this.el[s].classList.add('hidden');
    this.el.hud.classList.add('hidden');
  }

  buzz(pattern) {
    if (!this.settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
  }
}
