/**
 * A small hand-rolled post pipeline: HDR scene buffer -> bright pass ->
 * separable-gaussian bloom pyramid -> composite with ACES tone mapping,
 * chromatic aberration, vignette, film grain and hit flash.
 *
 * Written against three's core only so the game ships with no example modules.
 */
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uKnee + 1e-5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}`;

// Nine-tap gaussian, run once per axis.
const BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uStep;          // texel size * axis
varying vec2 vUv;
void main() {
  vec4 sum = texture2D(tSrc, vUv) * 0.227027;
  sum += (texture2D(tSrc, vUv + uStep * 1.3846) + texture2D(tSrc, vUv - uStep * 1.3846)) * 0.316216;
  sum += (texture2D(tSrc, vUv + uStep * 3.2307) + texture2D(tSrc, vUv - uStep * 3.2307)) * 0.070270;
  gl_FragColor = sum;
}`;

const COPY_FRAG = /* glsl */`
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

function compositeFrag(levels) {
  let samplers = '';
  let gather = '';
  for (let i = 0; i < levels; i++) {
    samplers += `uniform sampler2D tBloom${i};\n`;
    // Wider mips contribute a little less so the glow keeps a defined core.
    const w = (1.0 / (1.0 + i * 0.55)).toFixed(4);
    gather += `  bloom += texture2D(tBloom${i}, vUv).rgb * ${w};\n`;
  }
  return /* glsl */`
uniform sampler2D tScene;
${samplers}
uniform vec2 uResolution;
uniform float uBloom;
uniform float uExposure;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uFlash;
uniform vec3  uFlashColor;
uniform float uDamage;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  // Chromatic aberration grows toward the edges of the frame.
  vec3 scene;
  if (uAberration > 0.0) {
    vec2 off = fromCenter * r2 * uAberration * 0.011;
    scene.r = texture2D(tScene, uv + off).r;
    scene.g = texture2D(tScene, uv).g;
    scene.b = texture2D(tScene, uv - off).b;
  } else {
    scene = texture2D(tScene, uv).rgb;
  }

  vec3 bloom = vec3(0.0);
${gather}
  vec3 color = scene + bloom * uBloom;
  color += uFlashColor * uFlash;
  color *= uExposure;
  color = aces(color);

  // Vignette, plus a red pulse when the player is down to their last bucket.
  float vig = smoothstep(0.95, 0.18, r2 * 2.0);
  color *= mix(1.0, vig, uVignette);
  float dmg = uDamage * smoothstep(0.05, 0.55, r2);
  color = mix(color, mix(color, vec3(1.0, 0.12, 0.22), 0.55), dmg);

  if (uGrain > 0.0) {
    float n = hash(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
    color += n * uGrain;
  }

  gl_FragColor = vec4(max(color, 0.0), 1.0);
}`;
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeo, null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const gl = renderer.getContext();
    const halfFloatOk = !!(gl.getExtension('EXT_color_buffer_half_float') ||
                           gl.getExtension('EXT_color_buffer_float'));
    this.hdr = halfFloatOk;
    this.type = halfFloatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.rtScene = this._makeTarget(2, 2, { depth: true });
    this.levels = [];
    this.levelCount = 0;

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: null },
        uThreshold: { value: this.hdr ? 1.0 : 0.72 },
        uKnee: { value: 0.6 },
      },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } },
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COPY_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null } },
    });
    this.compositeMat = null;

    this.flash = 0;
    this.flashColor = new THREE.Color(1, 0.55, 0.25);
    this.damage = 0;
    this.time = 0;
    this.settings = { bloom: 0.95, exposure: 1.22, aberration: 0.8, vignette: 0.6, grain: 0.04 };
  }

  _makeTarget(w, h, { depth = false, samples = 0 } = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: this.type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      stencilBuffer: false,
      generateMipmaps: false,
      samples,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    return rt;
  }

  _buildComposite(levels) {
    if (this.compositeMat) this.compositeMat.dispose();
    const uniforms = {
      tScene: { value: this.rtScene.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBloom: { value: this.settings.bloom },
      uExposure: { value: this.settings.exposure },
      uAberration: { value: this.settings.aberration },
      uVignette: { value: this.settings.vignette },
      uGrain: { value: this.settings.grain },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: this.flashColor },
      uDamage: { value: 0 },
    };
    for (let i = 0; i < levels; i++) uniforms['tBloom' + i] = { value: null };
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: compositeFrag(levels),
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,   // tone mapping happens inside the shader
    });
    this.levelCount = levels;
  }

  /** (Re)allocate every buffer. `levels` is the number of bloom mips. */
  setSize(width, height, levels, samples = 0) {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    this.width = w; this.height = h;
    if (this.rtScene.samples !== samples) {
      this.rtScene.samples = samples;
      this.rtScene.dispose();
    }
    this.rtScene.setSize(w, h);

    if (levels !== this.levels.length) {
      for (const lv of this.levels) { lv.a.dispose(); lv.b.dispose(); }
      this.levels = [];
      for (let i = 0; i < levels; i++) {
        this.levels.push({ a: this._makeTarget(2, 2), b: this._makeTarget(2, 2), w: 2, h: 2 });
      }
      this._buildComposite(levels);
    }

    let lw = w, lh = h;
    for (let i = 0; i < this.levels.length; i++) {
      lw = Math.max(2, Math.floor(lw / 2));
      lh = Math.max(2, Math.floor(lh / 2));
      const lv = this.levels[i];
      lv.w = lw; lv.h = lh;
      lv.a.setSize(lw, lh);
      lv.b.setSize(lw, lh);
      this.compositeMat.uniforms['tBloom' + i].value = lv.a.texture;
    }
    this.compositeMat.uniforms.tScene.value = this.rtScene.texture;
    this.compositeMat.uniforms.uResolution.value.set(w, h);
  }

  applySettings(partial) {
    Object.assign(this.settings, partial);
    if (!this.compositeMat) return;
    const u = this.compositeMat.uniforms;
    u.uBloom.value = this.settings.bloom;
    u.uExposure.value = this.settings.exposure;
    u.uAberration.value = this.settings.aberration;
    u.uVignette.value = this.settings.vignette;
    u.uGrain.value = this.settings.grain;
  }

  /** Kick a full-screen flash; `color` is a THREE.Color. */
  punch(intensity, color) {
    this.flash = Math.max(this.flash, intensity);
    if (color) this.flashColor.copy(color);
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.camera);
  }

  render(scene, camera, dt) {
    const r = this.renderer;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 3.4);

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // Bright pass into the first (half resolution) mip.
    this.brightMat.uniforms.tSrc.value = this.rtScene.texture;
    this._blit(this.brightMat, this.levels[0].a);

    for (let i = 0; i < this.levels.length; i++) {
      const lv = this.levels[i];
      this.blurMat.uniforms.tSrc.value = lv.a.texture;
      this.blurMat.uniforms.uStep.value.set(1 / lv.w, 0);
      this._blit(this.blurMat, lv.b);

      this.blurMat.uniforms.tSrc.value = lv.b.texture;
      this.blurMat.uniforms.uStep.value.set(0, 1 / lv.h);
      this._blit(this.blurMat, lv.a);

      const next = this.levels[i + 1];
      if (next) {
        this.copyMat.uniforms.tSrc.value = lv.a.texture;
        this._blit(this.copyMat, next.a);
      }
    }

    const u = this.compositeMat.uniforms;
    u.uTime.value = this.time;
    u.uFlash.value = this.flash;
    u.uDamage.value = this.damage;
    this.quad.material = this.compositeMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.camera);
  }

  dispose() {
    this.rtScene.dispose();
    for (const lv of this.levels) { lv.a.dispose(); lv.b.dispose(); }
    this.quadGeo.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.copyMat.dispose();
    if (this.compositeMat) this.compositeMat.dispose();
  }
}
