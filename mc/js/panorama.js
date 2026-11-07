'use strict';
// ---------------------------------------------------------------------------
// Title background. Like vanilla's panorama: a cube map of the title world (a fixed seed and camera) that is
// on screen at once, then cross-fades into the live world as soon as the chunks around the camera are built.
// The picture comes from game.capturePanorama() (a developer tool) and ships in panorama_data.js as one
// 3x2 JPEG atlas, faces in PANO_FACES order.
// ---------------------------------------------------------------------------
const PANO_FACES = [
  { yaw: 0, pitch: 0 }, { yaw: Math.PI / 2, pitch: 0 }, { yaw: Math.PI, pitch: 0 },
  { yaw: -Math.PI / 2, pitch: 0 }, { yaw: 0, pitch: Math.PI / 2 }, { yaw: 0, pitch: -Math.PI / 2 },
];
// camera basis (right, up, forward) in world space for render()'s yaw / pitch
function panoBasis(yaw, pitch) {
  return [
    [Math.cos(yaw), 0, -Math.sin(yaw)],
    [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)],
    [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)],
  ];
}
const Panorama = {
  img: null,
  load() {
    const P = window.PANORAMA;
    if (!P || this.img) return;
    this.img = new Image(); this.img.src = P.img;
  },
  ready() { return !!(this.img && this.img.complete && this.img.naturalWidth); },
};
Panorama.load();

Renderer.prototype.drawPanorama = function (yaw, pitch, fovDeg, alpha) {
  const gl = this.gl;
  if (!this.pano) {
    const vs = `#version 300 es
      out vec2 v;
      void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `#version 300 es
      precision highp float;
      in vec2 v; out vec4 o;
      uniform mat3 u_rot; uniform vec2 u_tan; uniform vec3 u_R[6], u_U[6], u_F[6];
      uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_alpha;
      void main() {
        vec3 d = normalize(u_rot * vec3(v * u_tan, 1.0));
        int f = 0; float best = -2.0;
        for (int i = 0; i < 6; i++) { float t = dot(d, u_F[i]); if (t > best) { best = t; f = i; } }
        vec2 c = vec2(dot(d, u_R[f]), dot(d, u_U[f])) / best;
        vec2 uv = clamp(vec2(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5), u_texel, 1.0 - u_texel);
        uv = (uv + vec2(float(f % 3), float(f / 3))) / vec2(3.0, 2.0);
        o = vec4(texture(u_tex, uv).rgb, u_alpha);
      }`;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    const u = {};
    for (const n of ['u_rot', 'u_tan', 'u_R', 'u_U', 'u_F', 'u_tex', 'u_texel', 'u_alpha']) u[n] = gl.getUniformLocation(p, n);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Panorama.img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const B = PANO_FACES.map(f => panoBasis(f.yaw, f.pitch));
    this.pano = { p, u, tex, vao: gl.createVertexArray(), R: new Float32Array(B.flatMap(b => b[0])), U: new Float32Array(B.flatMap(b => b[1])), F: new Float32Array(B.flatMap(b => b[2])),
      texel: [0.5 / (Panorama.img.naturalWidth / 3), 0.5 / (Panorama.img.naturalHeight / 2)] };
  }
  const P = this.pano, b = panoBasis(yaw, pitch), t = Math.tan(fovDeg * Math.PI / 360);
  gl.useProgram(P.p);
  gl.uniformMatrix3fv(P.u.u_rot, false, new Float32Array([...b[0], ...b[1], ...b[2]]));
  gl.uniform2f(P.u.u_tan, t * this.canvas.width / this.canvas.height, t);
  gl.uniform3fv(P.u.u_R, P.R); gl.uniform3fv(P.u.u_U, P.U); gl.uniform3fv(P.u.u_F, P.F);
  gl.uniform2f(P.u.u_texel, P.texel[0], P.texel[1]); gl.uniform1f(P.u.u_alpha, alpha);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.tex); gl.uniform1i(P.u.u_tex, 0);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
  if (alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
  gl.bindVertexArray(P.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
};

// the live title world is ready once every chunk within its view distance is generated and meshed
Game.prototype.titleWorldReady = function () {
  const w = this.world, R = 6, cx = Math.floor(this.titleCam[0]) >> 4, cz = Math.floor(this.titleCam[2]) >> 4;
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
    if (dx * dx + dz * dz > R * R) continue;
    const ch = w.chunks.get(ckey(cx + dx, cz + dz));
    if (!ch || ch.dirty) return false;
  }
  return true;
};
Game.prototype.updatePanorama = function (dt) {
  if (!(this.panoAlpha > 0)) return;
  this.panoT = (this.panoT || 0) + dt;
  if (!this.panoFading && (this.titleWorldReady() || this.panoT > 20000)) this.panoFading = true;
  if (this.panoFading) this.panoAlpha = Math.max(0, this.panoAlpha - dt / 1000);
};

// developer tool: render the six faces from the title camera and return the data for panorama_data.js
Game.prototype.capturePanorama = function (size = 512) {
  const r = this.renderer, out = document.createElement('canvas');
  out.width = size * 3; out.height = size * 2;
  const x = out.getContext('2d'), alpha = this.panoAlpha;
  this.panoAlpha = 0; r.forceSize = [size, size];
  PANO_FACES.forEach((f, i) => {
    this.panoCam = f;
    this.render(0, performance.now());
    x.drawImage(r.canvas, (i % 3) * size, Math.floor(i / 3) * size, size, size);
  });
  this.panoCam = null; r.forceSize = null; this.panoAlpha = alpha;
  return { seed: this.world.seedStr, pos: this.titleCam.map(v => +v.toFixed(2)), img: out.toDataURL('image/jpeg', 0.86) };
};
