/**
 * Touch / mouse / keyboard / tilt control.
 *
 *  drag    – relative: put your thumb anywhere and slide (default, keeps the
 *            buckets out from under your finger)
 *  direct  – absolute: the buckets go where you touch
 *  tilt    – device orientation, for when you want to look like a maniac
 */
import { CONFIG } from './config.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'drag';
    this.sensitivity = 1.4;
    this.target = 0;
    this.halfW = 5.5;
    this.pointerDown = false;
    this.keys = new Set();
    this.tiltAvailable = 'DeviceOrientationEvent' in window;
    this.tiltGranted = false;
    this.tiltNeutral = null;
    this.tiltValue = 0;
    this.onFirstInput = null;
    this._firedFirst = false;

    this._startPx = 0;
    this._startTarget = 0;

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    const opts = { passive: false };

    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._fireFirst();
      this.pointerDown = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this._startPx = e.clientX;
      this._startTarget = this.target;
      if (this.mode === 'direct') this._applyDirect(e.clientX);
    }, opts);

    c.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      e.preventDefault();
      if (this.mode === 'direct') this._applyDirect(e.clientX);
      else if (this.mode === 'drag') {
        const dx = (e.clientX - this._startPx) / window.innerWidth;
        this.target = this._startTarget + dx * 2 * this.halfW * this.sensitivity;
      }
    }, opts);

    const end = (e) => {
      this.pointerDown = false;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      if (['arrowleft', 'arrowright', 'a', 'd', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
        this._fireFirst();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    this._onTilt = (e) => {
      // gamma: left/right tilt in portrait. beta: used when held landscape.
      const landscape = Math.abs(window.orientation || 0) === 90 ||
                        (window.screen.orientation && window.screen.orientation.type.startsWith('landscape'));
      let v = landscape ? e.beta : e.gamma;
      if (v == null) return;
      if (landscape && (window.orientation === -90 || (window.screen.orientation &&
          window.screen.orientation.angle === 270))) v = -v;
      if (this.tiltNeutral === null) this.tiltNeutral = v;
      this.tiltValue = v - this.tiltNeutral;
    };
  }

  _fireFirst() {
    if (this._firedFirst) return;
    this._firedFirst = true;
    if (this.onFirstInput) this.onFirstInput();
  }

  _applyDirect(px) {
    const n = (px / window.innerWidth) * 2 - 1;
    this.target = n * this.halfW * this.sensitivity;
  }

  setMode(mode) {
    this.mode = mode;
    this.tiltNeutral = null;
    if (mode === 'tilt') this.enableTilt();
    else window.removeEventListener('deviceorientation', this._onTilt);
  }

  setSensitivity(v) { this.sensitivity = v; }

  /** iOS needs an explicit permission prompt from a user gesture. */
  async enableTilt() {
    if (!this.tiltAvailable) return false;
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      } catch { return false; }
    }
    this.tiltGranted = true;
    this.tiltNeutral = null;
    window.addEventListener('deviceorientation', this._onTilt);
    return true;
  }

  /** Snap the control target to the buckets' current position. */
  sync(x) {
    this.target = x;
    this._startTarget = x;
  }

  reset(halfW) {
    this.halfW = halfW;
    this.target = 0;
    this.tiltNeutral = null;
  }

  update(dt, halfW) {
    this.halfW = halfW;
    const limit = halfW - CONFIG.bucketRadius;

    if (this.mode === 'tilt' && this.tiltGranted) {
      const n = Math.max(-1, Math.min(1, this.tiltValue / 22));
      this.target = n * limit * Math.min(1.35, this.sensitivity);
    }

    let kb = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) kb -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) kb += 1;
    if (kb !== 0) this.target += kb * CONFIG.bucketMaxSpeed * 0.8 * dt;

    this.target = Math.max(-limit, Math.min(limit, this.target));
    return this.target;
  }
}
