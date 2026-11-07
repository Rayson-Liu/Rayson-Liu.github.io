'use strict';
// ---------------------------------------------------------------------------
// WebGL2 renderer
// ---------------------------------------------------------------------------
const CHUNK_VS = `#version 300 es
layout(location=0) in vec4 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in uvec2 a_tex;
layout(location=3) in vec4 a_col;
layout(location=4) in vec2 a_light;
layout(location=5) in uint a_anim;
uniform mat4 u_vp; uniform mat4 u_model; uniform int u_sec; // u_sec: compact terrain section (anim in a_pos.w)
uniform vec3 u_cam; uniform float u_tick; uniform vec3 u_lightOv; // x>=0: override sky/block
out vec2 v_uv; flat out uint v_layer; flat out uint v_overlay; out vec4 v_col; out vec2 v_light; out float v_dist;
void main(){
  vec4 wp = u_model * vec4(a_pos.xyz,1.0);
  gl_Position = u_vp * wp;
  v_uv = a_uv;
  uint layer = a_tex.x;
  uint anim = u_sec == 1 ? uint(a_pos.w * 65535.0 + 0.5) : a_anim;
  if (anim > 0u) layer += uint(floor(u_tick / 2.0)) % anim;
  v_layer = layer; v_overlay = a_tex.y;
  v_col = a_col;
  v_light = u_lightOv.z > 0.5 ? u_lightOv.xy : a_light;
  v_dist = length(wp.xz - u_cam.xz);
  float dy = abs(wp.y - u_cam.y); v_dist = max(v_dist, dy * 0.5);
}`;
const CHUNK_FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_day; uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_alphaTest; uniform vec4 u_colorMul;
uniform float u_gamma; uniform vec3 u_nightTint; uniform vec3 u_ambient;
uniform uint u_portalLayer; uniform sampler2D u_portalTex; uniform float u_time; uniform vec2 u_res;
uniform sampler2D u_lightmap;
in vec2 v_uv; flat in uint v_layer; flat in uint v_overlay; in vec4 v_col; in vec2 v_light; in float v_dist;
out vec4 o;
float bright(float x){ float a = x / (4.0 - 3.0 * x); float b = 1.0 - pow(1.0 - x, 3.0); return mix(a, b, u_gamma); }
void main(){
  if (v_layer == u_portalLayer) { // (integers: a float compare rounds layers past 2048 together on half-precision phones)
    vec2 sc = gl_FragCoord.xy / u_res.y;
    vec3 col = vec3(0.035, 0.07, 0.09);
    for (int i = 0; i < 6; i++) {
      float fi = float(i), s = 0.6 + fi * 0.35, a = fi * 1.3;
      mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
      vec2 uv = r * sc * s + vec2(u_time * 0.000012 * (fi + 2.0), u_time * 0.000018 * (7.0 - fi));
      vec3 st = texture(u_portalTex, uv).rgb;
      vec3 tint = vec3(0.4 + 0.1 * sin(fi), 0.6 + 0.15 * cos(fi * 2.0), 0.7 + 0.2 * sin(fi * 3.0)) * (0.5 + 0.12 * fi);
      col += st * tint;
    }
    o = vec4(col, 1.0);
    return;
  }
  vec4 t = texture(u_tex, vec3(v_uv, float(v_layer)));
  vec3 c;
  uint ovl = v_overlay & 0x7fffu;
  if (v_overlay >= 0x8000u) t.a = 1.0; // 图形品质 流畅: leaves drawn solid
  if (ovl > 0u) {
    vec4 ov = texture(u_tex, vec3(v_uv, float(ovl)));
    c = mix(t.rgb, ov.rgb * v_col.rgb, ov.a);
  } else c = t.rgb * v_col.rgb;
  if (t.a < u_alphaTest) discard;
  // vanilla lightmap: x = block light, y = sky light (smoothly interpolated levels, like vanilla)
  vec3 L = texture(u_lightmap, (vec2(v_light.y, v_light.x) * 15.0 + 0.5) / 16.0).rgb;
  c *= L * v_col.a;
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  c = mix(c, u_fogColor, f);
  o = vec4(c, t.a) * u_colorMul;
}`;

const ENT_VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in vec3 a_n;
uniform mat4 u_vp; uniform mat4 u_model; uniform vec3 u_cam; uniform float u_inv;
out vec2 v_uv; out float v_shade; out float v_dist;
void main(){
  vec4 wp = u_model * vec4(a_pos,1.0);
  gl_Position = u_vp * wp;
  v_uv = a_uv;
  vec3 n = normalize(mat3(u_model) * a_n);
  // vanilla entity lighting: two fixed directional lights, 0.4 ambient + 0.6 diffuse
  vec3 L0 = normalize(vec3(0.2, 1.0, -0.7)), L1 = normalize(vec3(-0.2, 1.0, 0.7));
  v_shade = min(1.0, 0.4 + 0.6 * (max(dot(n, L0), 0.0) + max(dot(n, L1), 0.0)));
  // a preview in a menu (u_inv): lit from the viewer's side, front and back alike (it turns), the sides a little darker
  if (u_inv > 0.5) { vec3 F0 = normalize(vec3(-0.3, 0.6, 1.0)), F1 = normalize(vec3(0.3, 0.6, -1.0)); v_shade = min(1.0, 0.55 + 0.5 * (max(dot(n, F0), 0.0) + max(dot(n, F1), 0.0))); }
  v_dist = length(wp.xz - u_cam.xz);
}`;
const ENT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_light; uniform float u_day; uniform vec4 u_overlay; uniform vec3 u_tint;
uniform vec3 u_fogColor; uniform vec2 u_fog; uniform float u_gamma; uniform vec3 u_nightTint; uniform vec3 u_ambient; uniform float u_bright; uniform float u_fade;
uniform sampler2D u_lightmap;
in vec2 v_uv; in float v_shade; in float v_dist; out vec4 o;
float bright(float x){ float a = x / (4.0 - 3.0 * x); float b = 1.0 - pow(1.0 - x, 3.0); return mix(a, b, u_gamma); }
void main(){
  vec4 t = texture(u_tex, v_uv);
  if (t.a < 0.1) discard;
  vec3 c = t.rgb * u_tint;
  c = mix(c, u_overlay.rgb, u_overlay.a);
  vec3 L = texture(u_lightmap, (vec2(u_light.y, u_light.x) * 15.0 + 0.5) / 16.0).rgb;
  L = mix(L, vec3(1.0), u_bright);
  c *= L * mix(min(v_shade, 1.0), 1.0, u_bright);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  o = vec4(mix(c, u_fogColor, f), t.a * (1.0 - u_fade));
}`;

const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 v_p;
void main(){ v_p = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_invVP; uniform vec3 u_sky; uniform vec3 u_fogColor; uniform vec3 u_sunDir; uniform vec4 u_sunset; uniform vec3 u_void; uniform float u_voidOn;
in vec2 v_p; out vec4 o;
void main(){
  vec4 a = u_invVP * vec4(v_p, 1.0, 1.0);
  vec3 d = normalize(a.xyz / a.w);
  float h = d.y;
  vec3 c = mix(u_fogColor, u_sky, smoothstep(0.0, 0.45, h));
  // vanilla only draws the dark lower sky when the camera is below the horizon height (y 63)
  if (h < 0.0 && u_voidOn > 0.5) c = mix(u_fogColor, u_void, smoothstep(-0.12, -0.6, h));
  // sunrise / sunset glow
  vec3 sd = normalize(vec3(u_sunDir.x, 0.0, u_sunDir.z) + vec3(0.0001));
  float g = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), sd), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(h - 0.05)));
  c = mix(c, u_sunset.rgb, clamp(g * u_sunset.a, 0.0, 1.0));
  o = vec4(c, 1.0);
}`;

const TEX_VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv;
uniform mat4 u_vp; uniform mat4 u_model;
out vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = u_vp * u_model * vec4(a_pos, 1.0); }`;
const TEX_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec4 u_color;
in vec2 v_uv; out vec4 o;
void main(){ vec4 t = texture(u_tex, v_uv); o = t * u_color; }`;

const COL_VS = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec4 a_col;
uniform mat4 u_vp; uniform mat4 u_model; uniform vec3 u_cam; uniform float u_psize;
out vec4 v_col; out float v_dist;
void main(){ vec4 wp = u_model * vec4(a_pos,1.0); gl_Position = u_vp * wp; v_col = a_col; v_dist = length(wp.xz - u_cam.xz); gl_PointSize = u_psize; }`;
const COL_FS = `#version 300 es
precision highp float;
uniform vec4 u_color; uniform vec3 u_fogColor; uniform vec2 u_fog;
in vec4 v_col; in float v_dist; out vec4 o;
void main(){ vec4 c = v_col * u_color; float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0); o = vec4(mix(c.rgb, u_fogColor, f), c.a * (1.0 - f * f)); }`;

const AMB0 = [0.08, 0.08, 0.08]; // (the ambient light where env has none)

// more tiles than one texture array may hold: TEX_STACK tiles one above the other in each layer (16 x 16*TEX_STACK).
// (it was a second array on unit 9 - black on older Mali phones, ~27% of them: Mali-G51/G52/G57/G72/G76, the
// self-test's statistics 2026-11-01; one array is all any phone has to get right)
let TEX_STACK = 1;
function compile(gl, vs, fs) {
  // a tile by its number (uint): its layer and its place in the layer picked as integers, so the float layer stays
  // below 2048 (see init); v kept a quarter texel inside the tile (still the same texel row) so the nearest texel
  // never comes from the tile above or below, even with the rounding of /3, /5...
  if (fs.includes('uniform sampler2DArray u_tex;')) {
    const F = TEX_STACK;
    fs = fs.replace(/texture\(u_tex, vec3\(v_uv, float\(([^()]+)\)\)\)/g, 'texLayer(v_uv, $1)');
    if (/texture\(u_tex, vec3\(/.test(fs)) throw new Error('tile lookup not through texLayer');
    fs = fs.replace('uniform sampler2DArray u_tex;', F > 1 ? `uniform sampler2DArray u_tex;
vec4 texLayer(vec2 uv, uint l) { vec2 s = vec2(1.0, 1.0 / ${F}.0), gx = dFdx(uv) * s, gy = dFdy(uv) * s;
  return textureGrad(u_tex, vec3(uv.x, (clamp(uv.y, 0.015625, 0.984375) + float(l % ${F}u)) / ${F}.0, float(l / ${F}u)), gx, gy); }`
      : `uniform sampler2DArray u_tex;
vec4 texLayer(vec2 uv, uint l) { return texture(u_tex, vec3(uv, float(l))); }`);
  }
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

// ---- GPU memory for terrain meshes -------------------------------------------------------------------
// A buffer per section meant thousands of small buffers, created and deleted hundreds of times a second while
// chunks stream in, each rounded up by the driver to its allocation granularity. Instead sections take ranges
// of a few big buffers (pages): first fit from each page's sorted free list, neighbours merged on free, a page
// deleted once empty. Meshes bigger than half a page get a page of their own.
// Each page has one VAO, its attributes from the page's start, and a mesh is drawn from it by its first index: a range
// starts on a whole quad (ARENA_ALIGN a multiple of the 96-byte quad - 4 vertices of SVSTRIDE 24 - and of the 256 it
// was), so its quads are the shared quad index buffer's from off / 96 on. A VAO per mesh meant a bindVertexArray before
// each section's draw: ~270 a frame at view distance 8, ~1 400 with the shader pack's depth passes and shadow cascades;
// now ~20 and under 200 (11-04)
const ARENA_PAGE = 8 << 20, ARENA_ALIGN = 768;
class VertexArena {
  // mkVao(buf): a VAO with the section attributes over the whole of buf
  constructor(gl, mkVao) { this.gl = gl; this.mkVao = mkVao; this.pages = []; this.used = 0; this.total = 0; this.pagedUsed = 0; this.pagedTotal = 0; this.pageN = 0; }
  newPage(size) {
    const gl = this.gl, buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, size, gl.STATIC_DRAW);
    const pg = { buf, size, free: [[0, size]], used: 0, allocs: new Set(), id: this.pageN++, vao: this.mkVao(buf) };
    this.pages.push(pg); this.total += size;
    return pg;
  }
  // first fit in a shared page (not skip)
  fit(size, skip) {
    for (const pg of this.pages) {
      if (pg.solo || pg === skip || pg.size - pg.used < size) continue;
      const f = pg.free;
      for (let i = 0; i < f.length; i++) {
        if (f[i][1] < size) continue;
        const off = f[i][0];
        if (f[i][1] === size) f.splice(i, 1); else { f[i][0] += size; f[i][1] -= size; }
        pg.used += size;
        return { pg, off, size };
      }
    }
    return null;
  }
  alloc(bytes) {
    const size = Math.ceil(bytes / ARENA_ALIGN) * ARENA_ALIGN;
    this.used += size;
    if (size > ARENA_PAGE / 2) { const pg = this.newPage(size); pg.free = []; pg.used = size; pg.solo = true; return { pg, off: 0, size }; }
    let a = this.fit(size, null);
    if (!a) {
      const pg = this.newPage(ARENA_PAGE); this.pagedTotal += ARENA_PAGE;
      pg.free[0][0] = size; pg.free[0][1] -= size; pg.used = size;
      a = { pg, off: 0, size };
    }
    this.pagedUsed += size; a.pg.allocs.add(a);
    return a;
  }
  free(a) {
    this.used -= a.size;
    if (!a.pg.solo) { this.pagedUsed -= a.size; a.pg.allocs.delete(a); }
    this.release(a.pg, a.off, a.size);
  }
  // gives a range back to its page; an emptied page is deleted (keeping one shared page)
  release(pg, off, size) {
    pg.used -= size;
    if (pg.used === 0 && (pg.solo || this.pages.filter(p => !p.solo).length > 1)) {
      this.gl.deleteVertexArray(pg.vao); this.gl.deleteBuffer(pg.buf); this.total -= pg.size;
      if (!pg.solo) this.pagedTotal -= pg.size;
      this.pages.splice(this.pages.indexOf(pg), 1);
      return;
    }
    const f = pg.free;
    let i = 0;
    while (i < f.length && f[i][0] < off) i++;
    f.splice(i, 0, [off, size]);
    if (i + 1 < f.length && f[i][0] + f[i][1] === f[i + 1][0]) { f[i][1] += f[i + 1][1]; f.splice(i + 1, 1); }
    if (i > 0 && f[i - 1][0] + f[i - 1][1] === f[i][0]) { f[i - 1][1] += f[i][1]; f.splice(i, 1); }
  }
  // the shared pages only free themselves when completely empty, so after the view distance drops or the player
  // moves on, pages stay with a few meshes each. With over half a page's worth and 30 % idle, the emptiest page's
  // meshes move into the others' gaps (a GPU-side copy; the mesh is drawn from its new page and place from then on - its
  // pg and off; at most `budget` bytes a call) until it is empty and deleted
  compact(budget = 1 << 20) {
    if (this.pagedTotal - this.pagedUsed < ARENA_PAGE * 1.5 || this.pagedTotal < this.pagedUsed * 1.3) return 0;
    let src = null;
    for (const pg of this.pages) if (!pg.solo && (!src || pg.used < src.used)) src = pg;
    if (!src) return 0;
    const gl = this.gl;
    let moved = 0;
    for (const a of src.allocs) {
      if (moved >= budget) break;
      const b = this.fit(a.size, src);
      if (!b) break; // the others are full: nothing to gain
      gl.bindBuffer(gl.COPY_READ_BUFFER, src.buf); gl.bindBuffer(gl.COPY_WRITE_BUFFER, b.pg.buf);
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, a.off, b.off, a.size);
      const off = a.off;
      src.allocs.delete(a); a.pg = b.pg; a.off = b.off; b.pg.allocs.add(a);
      this.release(src, off, a.size);
      moved += a.size;
    }
    gl.bindBuffer(gl.COPY_READ_BUFFER, null); gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    return moved;
  }
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    // the context lost (telemetry 11-02 / 11-03: 351 devices): preventDefault, or the browser never gives it back;
    // see onContextLost
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(); }, false);
    canvas.addEventListener('webglcontextrestored', () => this.onContextRestored(), false);
    // a canvas resized between frames is blank until a frame is drawn into it, and the browser shows it blank: dynamic
    // resolution's steps (perf.js DynRes, every few seconds while frames come late - mostly with shaders on) flashed the
    // screen black ("每隔一段时间就会黑一下（大约5s一次）", feedback 11-02 / 11-03: 38 devices, 31 with shaders). Asked
    // for between frames (inFrame false: the game.render hook in telemetry.js), the new size waits for the next frame,
    // whose render begins with resize(). (Here on the instance: mobile.js replaces Renderer.prototype.resize)
    this.resize = function () { if (this.inFrame === false) return; return Object.getPrototypeOf(this).resize.call(this); };
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    // more tiles than one texture array may hold: two or more to a layer (?texsplit=N in the address tries a cap of N)
    const maxLayers = +new URLSearchParams(location.search).get('texsplit') || gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
    // (also at 2048: some phones run fragment shaders in half precision whatever they declare, and a layer number past
    // 2048 rounds to its neighbour there - grass sides (2647) drawn as the end portal (2649); the layer numbers stay
    // below 2048, which half precision holds exactly)
    const cap = Math.min(maxLayers, 2048);
    TEX_STACK = Math.ceil(ASSETS.count / cap);
    this.progChunk = compile(gl, CHUNK_VS, CHUNK_FS);
    this.progEnt = compile(gl, ENT_VS, ENT_FS);
    this.progSky = compile(gl, SKY_VS, SKY_FS);
    this.progTex = compile(gl, TEX_VS, TEX_FS);
    this.progCol = compile(gl, COL_VS, COL_FS);
    this.proj = M4.create(); this.view = M4.create(); this.vp = M4.create();
    this.identity = M4.create();
    this.fov = 70; this.renderDist = 8;
    this.camPos = [0, 0, 0];
    this.sections = new Map(); // key -> {o: {vao, buf}, n, t, tn, x, y, z, m: model matrix}
    this.secVis = new Map();   // key -> face visibility of sections with blocks (missing: all open)
    this.cols = new Map();     // chunk key -> { s: its sections (or null), v: their face visibility }, for the culling walk
    this.cullDirty = true;
    this.emptyVao = gl.createVertexArray();
    this.gamma = 0.5;
    this.entityTex = {};
    this.modelCache = {};
    this.particleBuf = new MeshBuffer(4096);
    this.particleGL = this.makeDynamic();
    this.miscBuf = new MeshBuffer(1024);
    this.miscGL = this.makeDynamic();
    this.ufEpoch = 0; this.texEp = -1; this.matI = 0; // (uniform cache, matrix pool: see ufState, mat)
  }
  // a frame of game.render (the telemetry.js hook sets it around each one; resize waits while it is false): the matrix
  // pool starts over and the cached uniforms are checked again - also in frames with no world (a frozen title, previews)
  get inFrame() { return this._inFrame; }
  set inFrame(v) { this._inFrame = v; if (v) { this.matI = 0; this.ufEpoch++; } }

  async init() {
    const gl = this.gl;
    // ---- texture array
    // the tiles come in rows of ASSETS.cols (tileXY); the texture wants them one after another
    const strip = await loadImage(ASSETS.strip);
    const n = ASSETS.count, sc = this.stripCols = ASSETS.cols || 1;
    const cv = document.createElement('canvas'); cv.width = strip.width; cv.height = strip.height;
    const cx = cv.getContext('2d'); cx.drawImage(strip, 0, 0);
    const grid = cx.getImageData(0, 0, cv.width, cv.height).data, data = new Uint8ClampedArray(n * 1024);
    for (let k = 0; k < n; k++) {
      const x0 = (k % sc) * 16, y0 = Math.floor(k / sc) * 16;
      for (let y = 0; y < 16; y++) data.set(grid.subarray(((y0 + y) * cv.width + x0) * 4, ((y0 + y) * cv.width + x0 + 16) * 4), (k * 16 + y) * 64);
    }
    this.stripCanvas = cv;
    _spriteAlpha = new Uint8Array(n * 256);
    for (let i = 0; i < n * 256; i++) _spriteAlpha[i] = data[i * 4 + 3];
    this.tileData = data;
    // TEX_STACK tiles one after another are already one 16 x 16*TEX_STACK image (a tile is its rows in order), at
    // every mip level, so a layer is just the next run of tiles; the last layer padded with empty tiles
    const levels = 5, F = TEX_STACK, layers = Math.ceil(n / F);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, 16, 16 * F, layers);
    // one mip level of all tiles -> the array
    const upload = (level, size, px) => {
      const want = layers * F * size * size * 4;
      if (px.length < want) { const p = new Uint8Array(want); p.set(px); px = p; }
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, 0, size, size * F, layers, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    let cur = new Uint8Array(data.buffer.slice(0)), size = 16;
    // pre-multiply-free mip generation that keeps color of transparent texels sane
    for (let i = 0; i < n * 256; i++) if (cur[i * 4 + 3] === 0) { cur[i * 4] = cur[i * 4 + 1] = cur[i * 4 + 2] = 0; }
    this.fillTransparent(cur, 16, n);
    upload(0, 16, cur);
    // like vanilla: leaves are "cutout_mipped" (alpha is averaged, so distant leaves thin out), while the
    // other cutout textures (plants, glass, ladders, rails, torches...) are not mipmapped and stay crisp,
    // so their smaller levels are point-sampled instead of averaged
    const pointMip = new Uint8Array(n), leafLayers = new Set();
    for (const b of BLOCKS) if (b && b.key && b.key.endsWith('leaves')) for (const l of (Array.isArray(b.tex) ? b.tex : [b.tex])) leafLayers.add(l);
    for (let k = 0; k < n; k++) {
      if (leafLayers.has(k)) continue;
      let cut = true, some = false;
      for (let i = k * 256; i < (k + 1) * 256; i++) { const al = cur[i * 4 + 3]; if (al !== 0 && al !== 255) { cut = false; break; } if (al === 0) some = true; }
      pointMip[k] = cut && some ? 1 : 0;
    }
    for (let l = 1; l < levels; l++) {
      const ns = size >> 1;
      const nx = new Uint8Array(ns * ns * n * 4);
      for (let k = 0; k < n; k++) for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
        let r = 0, g = 0, b = 0, a = 0, w = 0;
        if (pointMip[k]) {
          const i = ((k * size + y * 2) * size + x * 2) * 4, o = ((k * ns + y) * ns + x) * 4;
          nx[o] = cur[i]; nx[o + 1] = cur[i + 1]; nx[o + 2] = cur[i + 2]; nx[o + 3] = cur[i + 3];
          continue;
        }
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = ((k * size + y * 2 + dy) * size + x * 2 + dx) * 4;
          const al = cur[i + 3];
          a += al;
          const ww = al + 1;
          r += cur[i] * ww; g += cur[i + 1] * ww; b += cur[i + 2] * ww; w += ww;
        }
        const o = ((k * ns + y) * ns + x) * 4;
        nx[o] = r / w; nx[o + 1] = g / w; nx[o + 2] = b / w; nx[o + 3] = a / 4;
      }
      upload(l, ns, nx);
      cur = nx; size = ns;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels - 1);
    // anisotropic filtering is intentionally off: on D3D (ANGLE) it also makes magnification linear and blurs the pixel art
    this.texArray = tex;
    initAnimTable();
    this.portalLayer = T('end_portal_marker');
    try { this.texSelfTest(n, data); } catch (e) { }

    // ---- 2D images
    this.images = {};
    for (const k in ASSETS.images) this.images[k] = await loadImage(ASSETS.images[k]);
    for (const k of ['pig', 'cow', 'sheep', 'sheep_wool', 'chicken', 'zombie', 'skeleton', 'creeper', 'spider', 'spider_eyes', 'steve', 'sun', 'moon0', 'moon1', 'moon2', 'moon3', 'moon4', 'moon5', 'moon6', 'moon7', 'arrow_entity', 'shadow', 'rain', 'snowfall', 'chest_normal', 'chest_left', 'chest_right', 'armor_leather', 'armor_leather_overlay', 'armor_leather_legs', 'armor_leather_legs_overlay', 'armor_iron', 'armor_iron_legs', 'armor_diamond', 'armor_diamond_legs',
      'enderman', 'enderman_eyes', 'blaze', 'ghast', 'ghast_shooting', 'zombified_piglin', 'magma_cube', 'piglin', 'hoglin', 'strider', 'strider_cold', 'armor_golden', 'armor_golden_legs', 'dragon', 'dragon_eyes', 'dragon_exploding', 'end_crystal', 'end_crystal_beam', 'end_portal_tex', 'end_sky', 'beacon_beam']) {
      this.entityTex[k] = this.tex2D(this.images[k], ['rain', 'snowfall', 'end_portal_tex', 'end_sky', 'end_crystal_beam', 'beacon_beam'].includes(k));
    }
    // colormaps
    const cm = (img) => { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 256, 256).data; };
    this.grassMap = cm(this.images.grass_color); this.foliageMap = cm(this.images.foliage_color);
    // clouds
    {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
      x.drawImage(this.images.clouds, 0, 0);
      const d = x.getImageData(0, 0, 256, 256).data;
      this.cloudMap = new Uint8Array(256 * 256);
      for (let i = 0; i < 65536; i++) this.cloudMap[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    }
    // shared quad index buffer
    const maxQuads = 1 << 18;
    const idx = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) { const v = i * 4, o = i * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3; }
    this.quadIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.initStars();
    this.lineVao = gl.createVertexArray(); this.lineBuf = gl.createBuffer();
    this.cloudGL = null; this.cloudKey = '';
    this.initModels();
    this.initModels2();
    this.fx = new ShaderPack(this);
  }

  // Bleed opaque colours into fully transparent texels so mipmaps & filtering don't show dark fringes.
  fillTransparent(d, size, n) {
    for (let k = 0; k < n; k++) {
      for (let pass = 0; pass < 2; pass++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = ((k * size + y) * size + x) * 4;
        if (d[i + 3] !== 0) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = ((k * size + yy) * size + xx) * 4;
          if (d[j + 3] || d[j] || d[j + 1] || d[j + 2]) { r += d[j]; g += d[j + 1]; b += d[j + 2]; c++; }
        }
        if (c) { d[i] = r / c; d[i + 1] = g / c; d[i + 2] = b / c; }
      }
    }
  }

  tex2D(img, repeat) {
    const gl = this.gl, t = gl.createTexture();
    this.texEp = -1; // (bound on whichever unit is active, mid-frame too: the frame's textures go again - bindFrameTex)
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }

  // ---- VAO helpers ------------------------------------------------------------
  setupChunkAttribs() {
    const gl = this.gl;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VSTRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VSTRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_SHORT, VSTRIDE, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, VSTRIDE, 24);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.UNSIGNED_BYTE, true, VSTRIDE, 28);
    gl.enableVertexAttribArray(5); gl.vertexAttribIPointer(5, 1, gl.UNSIGNED_BYTE, VSTRIDE, 30);
  }
  // compact terrain sections (mesher.js compactVerts), starting at byte `base` of the bound buffer
  setupSectionAttribs(base = 0) {
    const gl = this.gl, S = SVSTRIDE;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, true, S, base);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.HALF_FLOAT, false, S, base + 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_SHORT, S, base + 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, S, base + 16);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.UNSIGNED_BYTE, true, S, base + 20);
    gl.disableVertexAttribArray(5); gl.vertexAttribI4ui(5, 0, 0, 0, 0); // the animation count rides in the position's 4th component
  }
  // a section's vertices go into a range of the shared arena (no buffer of its own): drawn with its page's VAO (secDraw)
  makeSectionMesh(data) {
    const gl = this.gl, a = (this.arena || (this.arena = new VertexArena(gl, (buf) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); this.setupSectionAttribs(0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
      gl.bindVertexArray(null);
      return vao;
    }))).alloc(data.byteLength);
    gl.bindBuffer(gl.ARRAY_BUFFER, a.pg.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, a.off, data);
    return { a };
  }
  // the sections in `list` (o: opaque meshes, else translucent) drawn with program P's u_model, in the list's order (rev:
  // last first); the page's VAO bound only when it changes - sorted by page, a page binds once. Returns the triangles
  secDraw(P, list, o, rev) {
    const gl = this.gl, loc = P.u.u_model, n = list.length;
    let pg = null, tris = 0;
    for (let k = 0; k < n; k++) {
      const s = list[rev ? n - 1 - k : k], m = o ? s.o : s.t;
      if (!m) continue;
      const a = m.a, cnt = o ? s.n : s.tn;
      if (a.pg !== pg) { pg = a.pg; gl.bindVertexArray(pg.vao); }
      gl.uniformMatrix4fv(loc, false, s.m);
      gl.drawElements(gl.TRIANGLES, cnt * 1.5, gl.UNSIGNED_INT, a.off / 4); // (off / 96 quads of 6 four-byte indices)
      tris += cnt / 2;
    }
    return tris;
  }
  makeVao(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.setupChunkAttribs();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    gl.bindVertexArray(null);
    return { vao, buf };
  }
  makeDynamic() {
    return { vao: null, buf: null };
  }
  uploadDynamic(d, mb) {
    const gl = this.gl;
    if (!d.vao) {
      d.vao = gl.createVertexArray(); gl.bindVertexArray(d.vao);
      d.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
      this.setupChunkAttribs();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    } else { gl.bindVertexArray(d.vao); gl.bindBuffer(gl.ARRAY_BUFFER, d.buf); }
    gl.bufferData(gl.ARRAY_BUFFER, mb.u8.subarray(0, mb.n * VSTRIDE), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }
  meshToGL(mb) {
    // static GL object for a MeshBuffer (items etc.)
    if (mb.gl) return mb.gl;
    mb.gl = this.makeVao(mb.u8.subarray(0, mb.n * VSTRIDE));
    mb.gl.n = mb.n;
    return mb.gl;
  }

  setSection(key, cx, sy, cz, res) {
    const gl = this.gl;
    const old = this.sections.get(key);
    if (old) this.freeSection(old);
    if (!res.opaque && !res.trans) { this.sections.delete(key); return; }
    const s = { x: cx * 16, y: sy * 16, z: cz * 16, n: res.nOpaque, tn: res.nTrans };
    const k = 65535 / SV_SCALE; // normalised u16 -> blocks
    s.m = new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, s.x - 8, s.y - 8, s.z - 8, 1]);
    if (res.opaque) s.o = this.makeSectionMesh(res.opaque);
    if (res.trans) s.t = this.makeSectionMesh(res.trans);
    this.sections.set(key, s);
    this.cullDirty = true;
    if (Math.abs(s.x + 8 - this.camPos[0]) < 240 && Math.abs(s.z + 8 - this.camPos[2]) < 240) this.shadowDirty = true; // (inside the far shadow cascade)
    // a section that appears inside the area the last walk reached is drawn at once (the list holds keys)
    this.col(cx, cz).s[sy] = s;
    if (this.cullList && this.cullSeenAt(cx, sy, cz)) this.cullList.push(s);
  }
  setSectionVis(key, vis) {
    if (vis === undefined || vis === VIS_ALL) this.secVis.delete(key); else this.secVis.set(key, vis);
    const ck = Math.floor(key / 32);
    this.col(Math.floor(ck / 65536) - 32768, (ck % 65536) - 32768).v[key - ck * 32] = vis === undefined ? VIS_ALL : vis;
    this.cullDirty = true;
  }
  clearSections() {
    for (const s of this.sections.values()) this.freeSection(s);
    this.sections.clear(); this.secVis.clear(); this.cols.clear(); this.cullDirty = true; this.shadowDirty = true;
  }
  // the sections of a chunk column and their face visibility, kept for the culling walk
  col(cx, cz) {
    const k = ckey(cx, cz);
    let c = this.cols.get(k);
    if (!c) { c = { s: new Array(SECTIONS).fill(null), v: new Uint16Array(SECTIONS).fill(VIS_ALL) }; this.cols.set(k, c); }
    return c;
  }
  freeSection(s) {
    s.dead = true; // the culling walk's list may still hold it until the next walk
    const c = this.cols.get(ckey(s.x >> 4, s.z >> 4));
    if (c && c.s[s.y >> 4] === s) c.s[s.y >> 4] = null;
    if (s.o) this.arena.free(s.o.a);
    if (s.t) this.arena.free(s.t.a);
  }
  dropChunk(cx, cz) {
    for (let sy = 0; sy < SECTIONS; sy++) {
      const k = (ckey(cx, cz) * 32) + sy;
      const s = this.sections.get(k);
      if (s) { this.freeSection(s); this.sections.delete(k); }
      this.secVis.delete(k);
    }
    this.cols.delete(ckey(cx, cz));
    this.cullDirty = true;
  }

  // ---- cave culling ------------------------------------------------------------------
  // Vanilla's section occlusion walk: breadth first from the camera's section, crossing a section from the
  // face it was entered by to another face only when its cells connect them (Mesher.visibility), and never
  // turning back toward the camera. Sections it can't reach (caves under the ground you stand on) aren't
  // drawn. The walk is redone when the camera enters another section or meshes change (at most every 100 ms).
  // It reads the chunk columns (one map lookup per column, cached in a grid around the camera) and marks the
  // sections it has reached in a flat array: a walk at render distance 16 visits ~20 000 sections, and doing
  // that with map lookups and a Set of keys took 2 - 3 ms.
  updateCulling() {
    const cam = this.camPos, R = this.renderDist, now = performance.now();
    const ccx = Math.floor(cam[0]) >> 4, csy = Math.floor(cam[1]) >> 4, ccz = Math.floor(cam[2]) >> 4;
    // above / below the world, or no culling wanted (camera inside a block, title screen): everything in range
    if (this.noCull || csy < 0 || csy >= SECTIONS) { this.cullKey = null; return (this.cullList = null); }
    const key = ccx * 1e6 + csy * 1e3 + ccz + R * 1e12;
    if (key === this.cullKey && (!this.cullDirty || now - this.cullT < 100)) return this.cullList;
    this.cullKey = key; this.cullT = now; this.cullDirty = false;
    // grid around the camera's column, R + 2 each side (the walk stays within R + 1)
    const off = R + 2, W = 2 * off + 1, N = W * W * SECTIONS;
    let seen = this.cullGrid;
    if (!seen || seen.length < N) seen = this.cullGrid = new Uint8Array(N); else seen.fill(0, 0, N);
    const cols = this.cullCols && this.cullCols.length >= W * W ? this.cullCols : (this.cullCols = new Array(W * W));
    cols.fill(undefined, 0, W * W); // undefined: not looked up yet, null: no column
    this.cullCenter = [ccx, ccz, off, W];
    const out = [];
    const Q = this.cullQ || (this.cullQ = { x: new Int32Array(65536), y: new Int8Array(65536), z: new Int32Array(65536), f: new Int8Array(65536), d: new Uint8Array(65536) });
    const R2 = (R + 1) * (R + 1);
    let head = 0, tail = 0;
    const push = (x, y, z, f, d) => {
      if (tail >= Q.x.length) { for (const k of ['x', 'y', 'z', 'f', 'd']) { const a = new Q[k].constructor(Q[k].length * 2); a.set(Q[k]); Q[k] = a; } }
      Q.x[tail] = x; Q.y[tail] = y; Q.z[tail] = z; Q.f[tail] = f; Q.d[tail] = d; tail++;
    };
    seen[(off * W + off) * SECTIONS + csy] = 1;
    push(ccx, csy, ccz, -1, 0);
    while (head < tail) {
      const x = Q.x[head], y = Q.y[head], z = Q.z[head], f = Q.f[head], d = Q.d[head]; head++;
      const gi = (x - ccx + off) * W + (z - ccz + off);
      let c = cols[gi];
      if (c === undefined) c = cols[gi] = this.cols.get(ckey(x, z)) || null;
      let m = VIS_ALL;
      if (c) { const s = c.s[y]; if (s) out.push(s); m = c.v[y]; }
      for (let e = 0; e < 6; e++) {
        if (d & (1 << (e ^ 1))) continue;                       // never back toward the camera
        if (f >= 0 && !(m & (1 << VIS_PAIR[f * 6 + e]))) continue; // entry face can't see this face
        const nx = x + (e === 0 ? -1 : e === 1 ? 1 : 0), ny = y + (e === 2 ? -1 : e === 3 ? 1 : 0), nz = z + (e === 4 ? -1 : e === 5 ? 1 : 0);
        if (ny < 0 || ny >= SECTIONS || (nx - ccx) * (nx - ccx) + (nz - ccz) * (nz - ccz) > R2) continue;
        const ni = ((nx - ccx + off) * W + (nz - ccz + off)) * SECTIONS + ny;
        if (seen[ni]) continue;
        seen[ni] = 1;
        push(nx, ny, nz, e ^ 1, d | (1 << e));
      }
    }
    return (this.cullList = out);
  }
  // did the last walk reach this section? (a section meshed since then is drawn at once if so)
  cullSeenAt(cx, sy, cz) {
    const C = this.cullCenter;
    if (!C) return false;
    const dx = cx - C[0] + C[2], dz = cz - C[1] + C[2];
    return dx >= 0 && dz >= 0 && dx < C[3] && dz < C[3] && !!this.cullGrid[(dx * C[3] + dz) * SECTIONS + sy];
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.floor(window.innerWidth * dpr * this.resScale), h = Math.floor(window.innerHeight * dpr * this.resScale);
    if (this.forceSize) [w, h] = this.forceSize; // panorama capture
    w = Math.max(1, w); h = Math.max(1, h); // a collapsed window must not leave zero-sized framebuffers
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // ---- WebGL context loss ------------------------------------------------------------------------------
  // Phones take the GPU back from a page in the background or short of memory, drivers reset (telemetry 11-02 / 11-03:
  // 351 devices). Every GPU object goes with the context, and the game makes them all over its files (models, skins,
  // capes, block entities, the companion, the weather, name tags...), so they are not rebuilt one by one: nothing is drawn
  // while lost (the game.render hook in telemetry.js - drawing went on with the dead objects, "shaderSource: parameter 1
  // is not of type 'WebGLShader'" 11 500 times on 4 devices, and the screen stayed white or black), single player is
  // paused, the world saved, and a tap on the notice reloads the page (a fresh context, everything made again)
  onContextLost() {
    if (this.lost) return;
    this.lost = true;
    const g = typeof window !== 'undefined' ? window.game : null;
    try { if (typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count('gl:lost'); } catch (e) { }
    try { if (g && g.state === 'play' && !g.net && g.ui && !(g.ui.screen && g.ui.screen.pauses) && typeof PauseScreen !== 'undefined') g.ui.open(new PauseScreen(g)); } catch (e) { }
    // (the mouse free for the notice: in a room no pause menu opens to let it go)
    try { if (g && g.releasePointer) g.releasePointer(); } catch (e) { }
    const playing = !!(g && g.state === 'play'), room = !!(g && g.net), t0 = performance.now();
    let saved = Promise.resolve();
    try { if (playing && !room && g.saveWorld) saved = Promise.resolve(g.saveWorld(true)); } catch (e) { saved = Promise.reject(e); }
    // (saveWorld catches its own failures - it puts "保存失败" in the chat, which can't be seen now - and resolves)
    const failed = () => !!(g && g.ui && g.ui.chat && g.ui.chat.some((m) => m.t >= t0 && String(m.text).startsWith('保存失败')));
    this.lostSave = saved = saved.then(() => !failed(), () => false);
    try { this.lostNotice(g, playing, room, saved); } catch (e) { }
  }
  // a frame while lost (the game.render hook in telemetry.js): nothing is drawn, and single player stays paused - Esc
  // closed the pause menu (and took the mouse again on a PC), and the world went on unseen behind the notice
  lostFrame(g) {
    if (g.state === 'play' && !g.net && g.ui && !g.ui.screen && typeof PauseScreen !== 'undefined') try { g.ui.open(new PauseScreen(g)); } catch (e) { }
  }
  onContextRestored() {
    // (the objects made before are still gone: the reload on the notice is what brings the picture back)
    try { if (typeof Telemetry !== 'undefined' && Telemetry.count) { Telemetry.count('gl:restored'); Telemetry.event('contextrestored', {}); } } catch (e) { }
    if (this.lostEl) { const s = this.lostEl.querySelector('[data-k=gpu]'); if (s) s.textContent = '显卡已经恢复，重新加载就能继续玩'; }
  }
  // the notice over the dead picture: what happened, the save, one tap to reload (inside mobile.js's turned stage, so it
  // turns with the game on a phone held upright)
  lostNotice(g, playing, room, saved) {
    if (this.lostEl || typeof document === 'undefined') return;
    const d = this.lostEl = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:50;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.88);color:#fff;font:16px "Microsoft YaHei",sans-serif;text-align:center;line-height:1.6;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none';
    const line = (text, css, k) => { const e = document.createElement('div'); e.textContent = text; if (css) e.style.cssText = css; if (k) e.dataset.k = k; d.appendChild(e); return e; };
    line('画面中断了', 'font-size:22px;font-weight:bold;margin-bottom:6px');
    line('显卡把游戏画面收回了（切到后台、显存不够或显卡驱动重启时会这样）', null, 'gpu');
    const st = line(room ? '联机房间：重新加载后再进入房间' : playing ? '正在保存世界…' : '', 'color:#FFFF55');
    if (playing && !room) saved.then((ok) => { st.textContent = ok ? '世界已保存' : '保存失败：会回到最近一次自动保存'; st.style.color = ok ? '#55FF55' : '#FF5555'; });
    const btn = line('点这里重新加载', 'margin-top:14px;padding:10px 28px;border:2px solid #fff;background:rgba(255,255,255,0.12)');
    if (g && g.settings && g.settings.shaders > 0) line('经常出现的话，可以在 选项 → 视频设置 → 光影 调低或关闭', 'margin-top:12px;font-size:13px;color:#C0C0C0');
    const reload = () => {
      try { if (typeof Telemetry !== 'undefined' && Telemetry.count) { Telemetry.count('gl:reload'); Telemetry.flush(false); } } catch (e) { }
      // (not 'play' any more: the page's "leave?" prompt asks only then - the world is already saved)
      if (g) g.state = 'boot';
      location.reload();
    };
    const go = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (d.dataset.going) return;
      d.dataset.going = '1'; btn.textContent = '正在重新加载…';
      const t = setTimeout(reload, 4000); saved.then(() => { clearTimeout(t); reload(); });
    };
    // (pointerup: touch.js takes every touchstart on the window and so no click ever comes on a phone)
    d.addEventListener('pointerup', go);
    for (const k of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown', 'wheel']) d.addEventListener(k, (e) => e.stopPropagation(), { passive: true });
    (document.getElementById('stage') || document.body).appendChild(d);
  }

  // ---- stars --------------------------------------------------------------------
  initStars() {
    const gl = this.gl, r = RNG(10842), pts = [];
    for (let i = 0; i < 1500; i++) {
      let x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1;
      const l = Math.hypot(x, y, z); if (l > 1 || l < 0.01) continue;
      x /= l; y /= l; z /= l;
      const b = 0.5 + r() * 0.5;
      pts.push(x * 100, y * 100, z * 100, b, b, b, 1);
    }
    this.starCount = pts.length / 7;
    this.starVao = gl.createVertexArray(); gl.bindVertexArray(this.starVao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    // textured quad for sun/moon
    this.quadVao = gl.createVertexArray(); gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, -1, 0, 0, 1, 0, -1, 1, 0, 1, 0, 1, 1, 1, -1, 0, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    gl.bindVertexArray(null);
  }

  // ---- clouds ------------------------------------------------------------------------
  // clouds reach well past the terrain and fade out (colour and alpha) before the edge of the generated grid,
  // so cells never pop in and the far plane never cuts them
  cloudRange() { return Math.max(256, this.renderDist * 16 * 2 + 64); }
  buildClouds(px, pz, drift) {
    const CELL = 12, R = Math.ceil(this.cloudRange() / CELL) + 2;
    const ox = Math.floor((px + drift) / CELL), oz = Math.floor(pz / CELL);
    const key = ox + ',' + oz + ',' + R;
    if (key === this.cloudKey) return;
    this.cloudKey = key;
    const map = this.cloudMap;
    const at = (x, z) => map[mod(z, 256) * 256 + mod(x, 256)];
    const v = [];
    const H = 4, Y = 0;
    const push = (x, y, z, s) => v.push(x, y, z, s, s, s, 1);
    for (let z = oz - R; z <= oz + R; z++) for (let x = ox - R; x <= ox + R; x++) {
      if (!at(x, z) || (x - ox) * (x - ox) + (z - oz) * (z - oz) > R * R) continue;
      const X0 = x * CELL, X1 = X0 + CELL, Z0 = z * CELL, Z1 = Z0 + CELL;
      push(X0, Y + H, Z0, 1); push(X0, Y + H, Z1, 1); push(X1, Y + H, Z1, 1); push(X1, Y + H, Z0, 1);
      push(X0, Y, Z0, 0.7); push(X1, Y, Z0, 0.7); push(X1, Y, Z1, 0.7); push(X0, Y, Z1, 0.7);
      if (!at(x - 1, z)) { push(X0, Y, Z0, 0.85); push(X0, Y, Z1, 0.85); push(X0, Y + H, Z1, 0.85); push(X0, Y + H, Z0, 0.85); }
      if (!at(x + 1, z)) { push(X1, Y, Z1, 0.85); push(X1, Y, Z0, 0.85); push(X1, Y + H, Z0, 0.85); push(X1, Y + H, Z1, 0.85); }
      if (!at(x, z - 1)) { push(X1, Y, Z0, 0.8); push(X0, Y, Z0, 0.8); push(X0, Y + H, Z0, 0.8); push(X1, Y + H, Z0, 0.8); }
      if (!at(x, z + 1)) { push(X0, Y, Z1, 0.8); push(X1, Y, Z1, 0.8); push(X1, Y + H, Z1, 0.8); push(X0, Y + H, Z1, 0.8); }
    }
    const gl = this.gl;
    if (!this.cloudGL) {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
      gl.bindVertexArray(null);
      this.cloudGL = { vao, buf, n: 0 };
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudGL.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    this.cloudGL.n = v.length / 7;
  }

  // ---- entity models -----------------------------------------------------------------
  // box: [u, v, x, y, z, w, h, d, inflate, mirror] in pixels relative to the part pivot.
  // Convention: y up, model faces -z, model's right side is +x.
  boxGeom(out, u, v, x, y, z, w, h, d, inf, tw, th, mirror) {
    const x0 = x - inf, y0 = y - inf, z0 = z - inf, x1 = x + w + inf, y1 = y + h + inf, z1 = z + d + inf;
    // a mirrored cube (vanilla ModelPart.Cube) is the plain one turned over in x about its own middle - every face's
    // texture flipped and each side face's texture on the other side - its quads' corners in reverse order so they
    // still face out. (Only flipping the textures left the elytra's right wing with edge strips not matching the wing)
    // [BL, BR, TR, TL], uLeft, uRight, vBottom, vTop, normal
    const F = [
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], u + d, u + d + w, v + d + h, v + d, [0, 0, -1]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], u + 2 * d + w, u + 2 * d + 2 * w, v + d + h, v + d, [0, 0, 1]],
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], u, u + d, v + d + h, v + d, [1, 0, 0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], u + d + w, u + 2 * d + w, v + d + h, v + d, [-1, 0, 0]],
      [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], u + d, u + d + w, v + d, v, [0, 1, 0]],
      [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], u + d + w, u + d + 2 * w, v + d, v, [0, -1, 0]],
    ];
    for (const f of F) {
      const uL = f[4], uR = f[5], uv = [[uL, f[6]], [uR, f[6]], [uR, f[7]], [uL, f[7]]];
      for (const k of mirror ? [0, 3, 2, 1] : [0, 1, 2, 3]) {
        const c = f[k], px = mirror ? x0 + x1 - c[0] : c[0];
        out.push(px / 16, c[1] / 16, c[2] / 16, uv[k][0] / tw, uv[k][1] / th, mirror ? -f[8][0] : f[8][0], f[8][1], f[8][2]);
      }
    }
  }
  // (post: changes the vertices before they go up - 8 numbers each, position first)
  makeModelPart(boxes, tw, th, post) {
    const data = [];
    for (const b of boxes) this.boxGeom(data, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8] || 0, tw, th, b[9]);
    if (post) post(data);
    return { vao: this.modelVao(data), n: data.length / 8 };
  }
  // the parts of one model in one buffer and one VAO: drawModel binds it once a model, not once a part (with emodel.js
  // emPack ~230 binds a frame fewer with 28 mobs in view, 11-04). A part's mesh starts at its own first quad - off, a
  // byte offset into the shared quad indices (6 four-byte indices a quad)
  packParts(parts, tw, th) {
    const data = [], at = [];
    for (const p of parts) { const v0 = data.length / 8; for (const b of p.boxes) this.boxGeom(data, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8] || 0, tw, th, b[9]); at.push(v0); }
    const vao = this.modelVao(data);
    parts.forEach((p, i) => { const v1 = i + 1 < parts.length ? at[i + 1] : data.length / 8; p.mesh = { vao, n: v1 - at[i], off: at[i] / 4 * 24 }; });
    return parts;
  }
  modelVao(data) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    gl.bindVertexArray(null);
    return vao;
  }
  initModels() {
    const M = this.models = {};
    const P = (tw, th, parts) => ({ parts: this.packParts(parts, tw, th) });
    const R = -Math.PI / 2;
    const humanoid = (aw, lu, lv, llu, llv, mirrorLeft, hat) => [
      { name: 'head', pivot: [0, 24, 0], boxes: [[0, 0, -4, 0, -4, 8, 8, 8], ...(hat ? [[32, 0, -4, 0, -4, 8, 8, 8, 0.5]] : [])] },
      { name: 'body', pivot: [0, 12, 0], boxes: [[16, 16, -4, 0, -2, 8, 12, 4]] },
      { name: 'rarm', pivot: [4 + aw / 2, 22, 0], boxes: [[40, 16, -aw / 2, -10, -aw / 2, aw, 12, aw]] },
      { name: 'larm', pivot: [-4 - aw / 2, 22, 0], boxes: [[lu, lv, -aw / 2, -10, -aw / 2, aw, 12, aw, 0, mirrorLeft]] },
      { name: 'rleg', pivot: [2, 12, 0], boxes: [[0, 16, -aw / 2, -12, -aw / 2, aw, 12, aw]] },
      { name: 'lleg', pivot: [-2, 12, 0], boxes: [[llu, llv, -aw / 2, -12, -aw / 2, aw, 12, aw, 0, mirrorLeft]] },
    ];
    M.zombie = P(64, 64, humanoid(4, 40, 16, 0, 16, true, true));
    // the player also has vanilla's second skin layer (jacket, sleeves, trousers: the same boxes inflated 0.25)
    M.steve = P(64, 64, humanoid(4, 32, 48, 16, 48, false, true).map(p => {
      const o = { body: [16, 32], rarm: [40, 32], larm: [48, 48], rleg: [0, 32], lleg: [0, 48] }[p.name];
      return o ? { ...p, boxes: [...p.boxes, [o[0], o[1], ...p.boxes[0].slice(2, 8), 0.25]] } : p;
    }));
    M.skeleton = P(64, 32, humanoid(2, 40, 16, 0, 16, true, false));
    M.creeper = P(64, 32, [
      { name: 'head', pivot: [0, 18, 0], boxes: [[0, 0, -4, 0, -4, 8, 8, 8]] },
      { name: 'body', pivot: [0, 6, 0], boxes: [[16, 16, -4, 0, -2, 8, 12, 4]] },
      { name: 'leg0', pivot: [2, 6, 4], boxes: [[0, 16, -2, -6, -2, 4, 6, 4]] },
      { name: 'leg1', pivot: [-2, 6, 4], boxes: [[0, 16, -2, -6, -2, 4, 6, 4]] },
      { name: 'leg2', pivot: [2, 6, -4], boxes: [[0, 16, -2, -6, -2, 4, 6, 4]] },
      { name: 'leg3', pivot: [-2, 6, -4], boxes: [[0, 16, -2, -6, -2, 4, 6, 4]] },
    ]);
    const legs4 = (y, zb, zf, x, h) => [
      { name: 'leg0', pivot: [x, y, zb], boxes: [[0, 16, -2, -h, -2, 4, h, 4]] },
      { name: 'leg1', pivot: [-x, y, zb], boxes: [[0, 16, -2, -h, -2, 4, h, 4]] },
      { name: 'leg2', pivot: [x, y, zf], boxes: [[0, 16, -2, -h, -2, 4, h, 4]] },
      { name: 'leg3', pivot: [-x, y, zf], boxes: [[0, 16, -2, -h, -2, 4, h, 4]] },
    ];
    M.pig = P(64, 64, [
      { name: 'head', pivot: [0, 12, -6], boxes: [[0, 0, -4, -4, -8, 8, 8, 8], [16, 16, -2, -3, -9, 4, 3, 1]] },
      { name: 'body', pivot: [0, 10, 0], boxes: [[28, 8, -5, -8, -4, 10, 16, 8]], rotX: R },
      ...legs4(6, 7, -5, 3, 6),
    ]);
    M.cow = P(64, 64, [
      // 1.21.5+ layout: head with muzzle and forward horns, udder on the body
      { name: 'head', pivot: [0, 20, -8], boxes: [[0, 0, -4, -4, -6, 8, 8, 6], [1, 33, -3, -4, -7, 6, 3, 1], [22, 0, 4, 2, -5, 1, 3, 1], [22, 0, -5, 2, -5, 1, 3, 1]] },
      { name: 'body', pivot: [0, 17, 1], boxes: [[18, 4, -6, -9, -5, 12, 18, 10], [52, 0, -2, -9, -6, 4, 6, 1]], rotX: R },
      ...legs4(12, 7, -5, 4, 12),
    ]);
    M.sheep = P(64, 32, [
      { name: 'head', pivot: [0, 18, -8], boxes: [[0, 0, -3, -2, -6, 6, 6, 8]] },
      { name: 'body', pivot: [0, 15, 0], boxes: [[28, 8, -4, -8, -3, 8, 16, 6]], rotX: R },
      ...legs4(12, 7, -5, 3, 12),
    ]);
    M.sheep_wool = P(64, 32, [
      { name: 'head', pivot: [0, 18, -8], boxes: [[0, 0, -3, -2, -4, 6, 6, 6, 0.6]] },
      { name: 'body', pivot: [0, 15, 0], boxes: [[28, 8, -4, -8, -3, 8, 16, 6, 1.75]], rotX: R },
      { name: 'leg0', pivot: [3, 12, 7], boxes: [[0, 16, -2, -6, -2, 4, 6, 4, 0.5]] },
      { name: 'leg1', pivot: [-3, 12, 7], boxes: [[0, 16, -2, -6, -2, 4, 6, 4, 0.5]] },
      { name: 'leg2', pivot: [3, 12, -5], boxes: [[0, 16, -2, -6, -2, 4, 6, 4, 0.5]] },
      { name: 'leg3', pivot: [-3, 12, -5], boxes: [[0, 16, -2, -6, -2, 4, 6, 4, 0.5]] },
    ]);
    M.chicken = P(64, 32, [
      { name: 'head', pivot: [0, 9, -4], boxes: [[0, 0, -2, 0, -2, 4, 6, 3], [14, 0, -2, 2, -4, 4, 2, 2], [14, 4, -1, 0, -3, 2, 2, 2]] },
      { name: 'body', pivot: [0, 8, 0], boxes: [[0, 9, -3, -4, -3, 6, 8, 6]], rotX: R },
      { name: 'leg0', pivot: [1.5, 5, 1], boxes: [[26, 0, -1.5, -5, -3, 3, 5, 3]] },
      { name: 'leg1', pivot: [-1.5, 5, 1], boxes: [[26, 0, -1.5, -5, -3, 3, 5, 3]] },
      { name: 'wing0', pivot: [4, 11, 0], boxes: [[24, 13, -1, -4, -3, 1, 4, 6]] },
      { name: 'wing1', pivot: [-4, 11, 0], boxes: [[24, 13, 0, -4, -3, 1, 4, 6]] },
    ]);
    const spiderLegs = [];
    for (let i = 0; i < 8; i++) {
      const right = i % 2 === 0, row = i >> 1; // row 0 = front
      spiderLegs.push({ name: 'leg' + i, pivot: [right ? 4 : -4, 9, -1 + row], boxes: [[18, 0, right ? -1 : -15, -1, -1, 16, 2, 2]] });
    }
    M.spider = P(64, 32, [
      { name: 'head', pivot: [0, 9, -3], boxes: [[32, 4, -4, -4, -8, 8, 8, 8]] },
      { name: 'neck', pivot: [0, 9, 0], boxes: [[0, 0, -3, -3, -3, 6, 6, 6]] },
      { name: 'body', pivot: [0, 9, 9], boxes: [[0, 12, -5, -4, -6, 10, 8, 12]] },
      ...spiderLegs,
    ]);
    M.arm = P(64, 64, [{ name: 'arm', pivot: [0, 0, 0], boxes: [[40, 16, -2, -10, -2, 4, 12, 4], [40, 32, -2, -10, -2, 4, 12, 4, 0.25]] }]);
    M.arm_left = P(64, 64, [{ name: 'arm', pivot: [0, 0, 0], boxes: [[32, 48, -2, -10, -2, 4, 12, 4], [48, 48, -2, -10, -2, 4, 12, 4, 0.25]] }]); // (both hands on a map)
    // vanilla humanoid armour layers: outer (helmet, chestplate, boots) inflated 1.0, inner (leggings) 0.5
    const armour = (inf) => [
      { name: 'head', pivot: [0, 24, 0], boxes: [[0, 0, -4, 0, -4, 8, 8, 8, inf]] },
      { name: 'body', pivot: [0, 12, 0], boxes: [[16, 16, -4, 0, -2, 8, 12, 4, inf]] },
      { name: 'rarm', pivot: [6, 22, 0], boxes: [[40, 16, -2, -10, -2, 4, 12, 4, inf]] },
      { name: 'larm', pivot: [-6, 22, 0], boxes: [[40, 16, -2, -10, -2, 4, 12, 4, inf, true]] },
      { name: 'rleg', pivot: [2, 12, 0], boxes: [[0, 16, -2, -12, -2, 4, 12, 4, inf]] },
      { name: 'lleg', pivot: [-2, 12, 0], boxes: [[0, 16, -2, -12, -2, 4, 12, 4, inf, true]] },
    ];
    M.armor_outer = P(64, 32, armour(1.0));
    M.armor_inner = P(64, 32, armour(0.5));
  }

  // black blocks, items and grass sides on phones (players' feedback 2026-10-31, almost all Mali GPUs): a few opaque
  // tiles below and past 2048 (the ones that were in the second array, black there) drawn through the terrain
  // shaders' own lookup into a 1x1 target and read back; the result goes to the statistics (tex2_* still means the
  // tiles past 2048, so the numbers compare with the days before TEX_STACK)
  texSelfTest(n, data) {
    const gl = this.gl, S = n > 2048 ? 2048 : 0;
    const opaque = (from, to) => { const out = []; for (let k = from; k < to && out.length < 3; k++) { let ok = true; for (let i = k * 256; i < (k + 1) * 256; i += 17) if (data[i * 4 + 3] < 255) { ok = false; break; } if (ok) out.push(k); } return out; };
    const tiles = [...opaque(1, S || n), ...(S ? opaque(S, n) : [])];
    if (!tiles.length) return;
    const p = compile(gl, `#version 300 es
void main(){ gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }`, `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform uint u_l; out vec4 o;
void main(){ vec2 v_uv = vec2(0.53, 0.53); o = texture(u_tex, vec3(v_uv, float(u_l))); }`);
    const fb = gl.createFramebuffer(), rt = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rt); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
    gl.viewport(0, 0, 1, 1); gl.useProgram(p.p); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray); gl.uniform1i(p.u.u_tex, 0);
    gl.bindVertexArray(null);
    const px = new Uint8Array(4), res = [];
    for (const k of tiles) {
      gl.uniform1ui(p.u.u_l, k); gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const i = (k * 256 + 8 * 16 + 8) * 4, d = Math.abs(px[0] - data[i]) + Math.abs(px[1] - data[i + 1]) + Math.abs(px[2] - data[i + 2]);
      res.push({ second: !!S && k >= S, ok: d < 24, black: px[0] + px[1] + px[2] < 12 });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(rt); gl.deleteProgram(p.p);
    gl.enable(gl.DEPTH_TEST);
    const first = res.filter((r) => !r.second), second = res.filter((r) => r.second);
    this.texTest = { first: first.every((r) => r.ok), second: second.length ? second.every((r) => r.ok) : null, black2: second.some((r) => r.black) };
    const report = () => { if (typeof Telemetry === 'undefined' || !Telemetry.count) return setTimeout(report, 3000);
      Telemetry.count('tex1_' + (this.texTest.first ? 'ok' : 'bad')); if (this.texTest.second !== null) Telemetry.count('tex2_' + (this.texTest.second ? 'ok' : this.texTest.black2 ? 'black' : 'bad')); };
    setTimeout(report, 3000);
  }
  // ---- vanilla lightmap ----------------------------------------------------------------------
  // 16x16 colours for every (block light, sky light) pair like vanilla's LightTexture, rebuilt when what it
  // depends on changes (the torch flicker once a tick, as vanilla's): daylight darkening, bluish night sky light,
  // warm flickering block light, the dimension's ambient light, the brightness (gamma) curve.
  lightmapTex() {
    if (!this._lm) {
      const gl = this.gl; this._lm = gl.createTexture(); this._lmData = new Uint8Array(16 * 16 * 4).fill(255);
      gl.bindTexture(gl.TEXTURE_2D, this._lm);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._lmData);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return this._lm;
  }
  updateLightmap(env, dim) {
    const gl = this.gl, tex = this.lightmapTex(), d = this._lmData, gamma = this.gamma, nv = env.nightVision > 0 ? env.nightVision : 0;
    const ambient = dim === 'nether' ? 0.1 : 0, forceBright = dim === 'end';
    let skyD = 1;
    if (dim === 'overworld' && env.celestial !== undefined) {
      let f = 1 - (Math.cos(env.celestial * Math.PI * 2) * 2 + 0.2);
      f = 1 - clamp(f, 0, 1);
      f *= 1 - (env.rain || 0) * 5 / 16;
      skyD = f * 0.8 + 0.2;
    }
    // the torch flicker moves once a client tick like vanilla's LightTexture.tick (20 a second), not every frame - at
    // 120 fps it was 6 steps a tick. By the 20 Hz of the clock, not env.tick: the world's time stands still on the title,
    // with advance_time off and on a server whose clock is stopped, and torches flicker there too
    const tk = Math.floor(performance.now() / 50);
    if (tk !== this._lmTick) { this._lmTick = tk; this.flicker = ((this.flicker || 0) + (Math.random() - Math.random()) * Math.random() * Math.random() * 0.1) * 0.9; }
    // nothing it depends on changed (between two ticks, most frames): the table and the texture stay. It was rebuilt and
    // uploaded every frame: 0.09 ms of render's 1.1 ms on a PC (11-03 profile, 256 cells through ~12 .map closures each);
    // now 41 -> 8 us when it changes and 0.3 us when not (desktop, 11-04; the same bytes for 2 187 sets of inputs)
    const L = this._lmIn || (this._lmIn = { skyD: NaN, fl: NaN, gamma: NaN, nv: NaN, dim: null });
    if (L.skyD === skyD && L.fl === this.flicker && L.gamma === gamma && L.nv === nv && L.dim === dim) return;
    L.skyD = skyD; L.fl = this.flicker; L.gamma = gamma; L.nv = nv; L.dim = dim;
    // (the same arithmetic in the same order as the .map version it replaces: the bytes come out identical)
    const skyF = skyD * 0.95 + 0.05, sa = skyD + (1 - skyD) * 0.35, blockF = this.flicker + 1.5;
    const bS = this._lmS || (this._lmS = new Float64Array(16)), bB = this._lmB || (this._lmB = new Float64Array(16));
    for (let l = 0; l < 16; l++) { const f = l / 15, f1 = f / (4 - 3 * f), v = f1 + ambient * (1 - f1); bS[l] = v * skyF; bB[l] = v * blockF; }
    for (let s = 0; s < 16; s++) {
      const f4 = bS[s];
      for (let b = 0; b < 16; b++) {
        const f5 = bB[b];
        let r = f5, g = f5 * ((f5 * 0.6 + 0.4) * 0.6 + 0.4), bl = f5 * (f5 * f5 * 0.6 + 0.4);
        if (forceBright) { r = clamp(r + (0.99 - r) * 0.25, 0, 1); g = clamp(g + (1.12 - g) * 0.25, 0, 1); bl = clamp(bl + (1.0 - bl) * 0.25, 0, 1); }
        else { r += sa * f4; r = r + (0.75 - r) * 0.04; g += sa * f4; g = g + (0.75 - g) * 0.04; bl += f4; bl = bl + (0.75 - bl) * 0.04; }
        r = clamp(r, 0, 1); g = clamp(g, 0, 1); bl = clamp(bl, 0, 1);
        // night vision: every light level as bright as its brightest channel allows
        if (nv > 0) { const mx = Math.max(r, g, bl); if (mx > 0) { r = r + (r / mx - r) * nv; g = g + (g / mx - g) * nv; bl = bl + (bl / mx - bl) * nv; } }
        r = r + (1 - Math.pow(1 - r, 4) - r) * gamma; g = g + (1 - Math.pow(1 - g, 4) - g) * gamma; bl = bl + (1 - Math.pow(1 - bl, 4) - bl) * gamma;
        r = clamp(r + (0.75 - r) * 0.04, 0, 1); g = clamp(g + (0.75 - g) * 0.04, 0, 1); bl = clamp(bl + (0.75 - bl) * 0.04, 0, 1);
        const o = (s * 16 + b) * 4;
        d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = bl * 255; d[o + 3] = 255;
      }
    }
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ---- frame ---------------------------------------------------------------------------
  setCamera(pos, yaw, pitch, fovDeg, extra) {
    const w = this.canvas.width, h = this.canvas.height;
    this.frameTime = performance.now() % 10000000; // one time per frame (waving must match between passes)
    this.near = 0.05; this.far = Math.max(256, this.renderDist * 16 * 1.6 + 64, this.cloudRange() + 160);
    M4.perspective(this.proj, fovDeg * Math.PI / 180, w / h, this.near, this.far);
    const v = M4.identity(this.view);
    if (extra) extra(v);
    M4.rotX(v, -pitch); M4.rotY(v, -yaw);
    M4.translate(v, -pos[0], -pos[1], -pos[2]);
    M4.mul(this.vp, this.proj, v);
    this.camPos = pos;
    this.planes = frustumPlanes(this.vp);
    this.ufEpoch++; // (a new camera matrix, made in place: the uniform cache forgets it - ufState)
    this.matI = 0;
    this.shOn = false; this.shN = 0; // (a shadow batch left open by a failed frame)
  }

  // ---- uniforms only when they change ------------------------------------------------------------
  // The terrain and entity programs got their whole set of uniforms and texture binds on every use: ~25 GL calls for
  // each mob, armour layer, item, held item and particle batch (3 830 calls a frame with 28 mobs in view, 11-04; with
  // this, the shadow batch, the meshes' shared VAOs and the matrix pool 1 870, render 0.72 -> 0.33 ms on a desktop and
  // 1.64 -> 1.1 ms with the shader pack - several times both on a phone). Each program now keeps the values it
  // was last given (P.st) and a uniform goes only when its value differs: the frame's (camera, fog, time, gamma) once,
  // a model's (light, overlay, tint) when they change. The camera matrix is compared by identity - setCamera remakes it in
  // place - so ufEpoch (bumped at each frame's start, by setCamera and by the shader pack's post passes) forgets all.
  // The textures they read - the tiles on unit 0, the end portal's on 2, the light table on 8 - are bound once an epoch
  // (bindFrameTex), the entity skin on unit 1 only when it changes (tex1), and the active unit is left at 0, so a texture
  // bound elsewhere without choosing a unit (capes, maps, the textures made on first use) never lands on 1, 2 or 8.
  // Code that sets these uniforms itself must go through here, or the cache believes in values the program no longer
  // has (companion.js sets u_bright: that one always goes)
  ufState(P) {
    let st = P.st;
    if (!st || st.ep !== this.ufEpoch) st = P.st = { ep: this.ufEpoch, vp: null, cx: NaN, cy: NaN, cz: NaN, tick: NaN, day: NaN, f0: NaN, f1: NaN, f2: NaN, fn: NaN, ff: NaN,
      gam: NaN, n0: NaN, n1: NaN, n2: NaN, a0: NaN, a1: NaN, a2: NaN, pl: NaN, time: NaN, rw: NaN, rh: NaN, mId: false, at: NaN, c0: NaN, c1: NaN, c2: NaN, c3: NaN,
      l0: NaN, l1: NaN, l2: NaN, o0: NaN, o1: NaN, o2: NaN, o3: NaN, t0: NaN, t1: NaN, t2: NaN, inv: NaN, fade: NaN };
    if (this.texEp !== this.ufEpoch) this.bindFrameTex();
    return st;
  }
  bindFrameTex() {
    const gl = this.gl;
    this.texEp = this.ufEpoch; this.tex1 = null;
    if (this.entityTex.end_portal_tex) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.entityTex.end_portal_tex); }
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this.lightmapTex());
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray);
  }
  // what the terrain and entity programs share: the camera, the fog, the brightness, the dimension's light
  ufFrame(P, st, vp, env) {
    const gl = this.gl, u = P.u, c = this.camPos, f = env.fogColor, n = env.nightTint, a = env.ambient || AMB0;
    if (st.vp !== vp) { st.vp = vp; gl.uniformMatrix4fv(u.u_vp, false, vp); }
    if (st.cx !== c[0] || st.cy !== c[1] || st.cz !== c[2]) { st.cx = c[0]; st.cy = c[1]; st.cz = c[2]; gl.uniform3f(u.u_cam, c[0], c[1], c[2]); }
    if (st.day !== env.day) { st.day = env.day; if (u.u_day) gl.uniform1f(u.u_day, env.day); }
    if (st.f0 !== f[0] || st.f1 !== f[1] || st.f2 !== f[2]) { st.f0 = f[0]; st.f1 = f[1]; st.f2 = f[2]; gl.uniform3f(u.u_fogColor, f[0], f[1], f[2]); }
    if (st.fn !== env.fogNear || st.ff !== env.fogFar) { st.fn = env.fogNear; st.ff = env.fogFar; gl.uniform2f(u.u_fog, env.fogNear, env.fogFar); }
    if (st.gam !== this.gamma) { st.gam = this.gamma; if (u.u_gamma) gl.uniform1f(u.u_gamma, this.gamma); }
    if (st.n0 !== n[0] || st.n1 !== n[1] || st.n2 !== n[2]) { st.n0 = n[0]; st.n1 = n[1]; st.n2 = n[2]; if (u.u_nightTint) gl.uniform3f(u.u_nightTint, n[0], n[1], n[2]); }
    if (st.a0 !== a[0] || st.a1 !== a[1] || st.a2 !== a[2]) { st.a0 = a[0]; st.a1 = a[1]; st.a2 = a[2]; if (u.u_ambient) gl.uniform3f(u.u_ambient, a[0], a[1], a[2]); }
  }
  // fx: use the shader-pack terrain program (only terrain / water while shaders are on). at, color, light: this use's
  // alpha cut-off (vanilla cutout_mipped's 0.5), colour multiplier and light override ([sky, block]: the vertices' own)
  useChunkProg(env, fx = false, at = 0.5, color = null, light = null) {
    const gl = this.gl, P = fx && this.fxOn ? (fx === 'trans' ? this.fx.pChunkT : this.fx.pChunk) : this.progChunk, u = P.u;
    gl.useProgram(P.p);
    const st = this.ufState(P);
    if (!P.units) { P.units = true; gl.uniform1i(u.u_portalTex, 2); if (u.u_lightmap) gl.uniform1i(u.u_lightmap, 8); }
    this.ufFrame(P, st, this.vp, env);
    if (st.tick !== env.tick) { st.tick = env.tick; gl.uniform1f(u.u_tick, env.tick); }
    const pl = this.portalLayer ?? 65535; if (st.pl !== pl) { st.pl = pl; gl.uniform1ui(u.u_portalLayer, pl); }
    const tm = this.frameTime ?? performance.now() % 10000000; if (st.time !== tm) { st.time = tm; gl.uniform1f(u.u_time, tm); }
    const w = this.canvas.width, h = this.canvas.height; if (st.rw !== w || st.rh !== h) { st.rw = w; st.rh = h; gl.uniform2f(u.u_res, w, h); }
    // what each use starts from: no model matrix (drawMesh sets its own), and this use's values
    if (!st.mId) { st.mId = true; gl.uniformMatrix4fv(u.u_model, false, this.identity); }
    this.chunkAlpha(P, at);
    this.chunkColor(P, color);
    if (light) this.chunkLight(P, light[0], light[1], 1); else this.chunkLight(P, 0, 0, 0);
    if (u.u_pass) gl.uniform1i(u.u_pass, 0);
    return P;
  }
  // the terrain program's per-draw values (useChunkProg's cache)
  chunkAlpha(P, v) { const st = P.st; if (st.at !== v) { st.at = v; this.gl.uniform1f(P.u.u_alphaTest, v); } }
  chunkColor(P, c) {
    const st = P.st, r = c ? c[0] : 1, g = c ? c[1] : 1, b = c ? c[2] : 1, a = c ? c[3] : 1;
    if (st.c0 !== r || st.c1 !== g || st.c2 !== b || st.c3 !== a) { st.c0 = r; st.c1 = g; st.c2 = b; st.c3 = a; this.gl.uniform4f(P.u.u_colorMul, r, g, b, a); }
  }
  chunkLight(P, x, y, z) { const st = P.st; if (st.l0 !== x || st.l1 !== y || st.l2 !== z) { st.l0 = x; st.l1 = y; st.l2 = z; this.gl.uniform3f(P.u.u_lightOv, x, y, z); } }
  chunkModel(P, m) { P.st.mId = m === this.identity; this.gl.uniformMatrix4fv(P.u.u_model, false, m); }

  // ---- matrices for one frame --------------------------------------------------------------------
  // drawModel, drawEM, the hand, the sky... made a new Float32Array for every model part, attached item and sky piece:
  // 419 typed arrays a frame with 28 mobs in view, 39 left (11-04), garbage the collector stops phones for. They come
  // from this pool instead,
  // started over at each frame (inFrame, setCamera): a matrix from here is good until the frame ends - one kept longer
  // (the shader pack's entity record, read next frame) is copied
  mat(src) {
    const P = this.matP || (this.matP = []);
    let m = P[this.matI];
    if (!m) { if (this.matI >= 16384) return src ? new Float32Array(src) : M4.create(); m = P[this.matI] = new Float32Array(16); }
    this.matI++;
    if (src) m.set(src); else { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; }
    return m;
  }

  drawSky(env) {
    const gl = this.gl, S = this.progSky;
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(S.p);
    gl.disable(gl.CULL_FACE);
    const vpr = this.vpNoTranslate(), inv = invert4(vpr, this.mat());
    gl.uniformMatrix4fv(S.u.u_invVP, false, inv);
    gl.uniform3fv(S.u.u_sky, env.skyColor);
    gl.uniform3fv(S.u.u_fogColor, env.fogColor);
    gl.uniform3fv(S.u.u_sunDir, env.sunDir);
    gl.uniform4fv(S.u.u_sunset, env.sunset);
    gl.uniform3fv(S.u.u_void, env.voidColor);
    gl.uniform1f(S.u.u_voidOn, this.camPos[1] + (this.yOff || 0) < 63 ? 1 : 0);
    // with the shader pack the sky and the (round) sun are drawn in post: here only the stars and the moon, on black
    const fxSun = this.fxOn && this.fx && this.fx.sunDiscCol;
    if (fxSun) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    else { gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    // stars
    if (env.starBright > 0.01) {
      const C = this.progCol; gl.useProgram(C.p);
      const m = this.mat(); M4.rotY(m, -Math.PI / 2); M4.rotX(m, env.celestial * Math.PI * 2);
      gl.uniformMatrix4fv(C.u.u_vp, false, vpr); gl.uniformMatrix4fv(C.u.u_model, false, m);
      gl.uniform4f(C.u.u_color, 1, 1, 1, env.starBright); gl.uniform3f(C.u.u_cam, 0, 0, 0); gl.uniform2f(C.u.u_fog, 1e9, 2e9);
      gl.uniform3fv(C.u.u_fogColor, env.fogColor); gl.uniform1f(C.u.u_psize, Math.max(1, this.canvas.height / 700));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(this.starVao); gl.drawArrays(gl.POINTS, 0, this.starCount);
    }
    // sun & moon
    const T = this.progTex; gl.useProgram(T.p);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniformMatrix4fv(T.u.u_vp, false, vpr);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    const a = env.celestial * Math.PI * 2;
    for (const which of ['sun', 'moon']) {
      if (which === 'sun' && fxSun) continue;
      const m = this.mat(); M4.rotY(m, -Math.PI / 2); M4.rotX(m, a + (which === 'moon' ? Math.PI : 0));
      M4.translate(m, 0, 100, 0); M4.scale(m, which === 'sun' ? 30 : 20, 1, which === 'sun' ? 30 : 20);
      gl.uniformMatrix4fv(T.u.u_model, false, m);
      // with the shader pack the HDR target can hold a brighter moon, which then blooms
      const k = this.fxOn ? 1.4 : 1;
      gl.uniform4f(T.u.u_color, k, k, k, which === 'sun' ? env.sunAlpha : 1 - env.rain * 0.9);
      gl.bindTexture(gl.TEXTURE_2D, this.entityTex[which === 'sun' ? 'sun' : 'moon' + env.moonPhase]);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE);
  }
  // (pooled: good for this frame)
  vpNoTranslate() {
    const v = this.mat(this.view); v[12] = v[13] = v[14] = 0;
    return mul4(this.mat(), this.proj, v);
  }

  drawTerrain(env) {
    const gl = this.gl;
    if (this.arena) this.arena.compact();
    const P = this.useChunkProg(env, true);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    const cam = this.camPos, maxD = (this.renderDist + 1) * 16;
    if (P.u.u_sec) gl.uniform1i(P.u.u_sec, 1);
    // a frame cleared to the fog colour (under water, in lava or powder snow, the nether): a section all past the fog's
    // end shows only that colour - not drawn (the picture is the same to the pixel). Under water the fog ends 24 - 96
    // blocks out, and the whole view distance was drawn behind it: at render distance 12 in an ocean 244 sections,
    // 384 000 triangles, now 80 and 135 000 (one part of "进水就卡", feedback ~15 players); the nether's fog ends at half
    // the view distance. The distance is the terrain shaders' fog distance (max of the level one and half the height
    // difference), to the section's nearest point. With the shader pack: its light shafts march the depth buffer out to
    // their own distance (an empty pixel let them run on - water / lava brighter, lava up to 60 levels a pixel), so only
    // sections past both go; and an empty pixel is sky to its compose pass, lit by the sky in powder snow (skyOn there,
    // the picture's brightness 50 -> 108): not left out in powder snow
    const g = typeof window !== 'undefined' ? window.game : null, fx = this.fxOn && this.fx;
    let fogEnd = (env.sky === 'none' || (g && g.renderer === this && (g.headInWater || g.headInLava || (g.headInPowder && !fx)))) && env.fogFar > 0 && env.fogFar < maxD ? env.fogFar + 1 : 0;
    if (fogEnd && fx && fx.cfg && fx.cfg.vl && fx.shadowOn && fx.A && fx.A.vl[0] + fx.A.vl[1] + fx.A.vl[2] > 0.002) fogEnd = Math.max(fogEnd, Math.max(128, fx.renderD * 0.98) + 1);
    const vis = [], cand = this.updateCulling() || this.sections.values();
    for (const s of cand) {
      if (s.dead) continue;
      const dx = s.x + 8 - cam[0], dz = s.z + 8 - cam[2];
      if (dx * dx + dz * dz > maxD * maxD) continue;
      if (fogEnd) {
        const ex = Math.max(0, Math.abs(dx) - 8), ez = Math.max(0, Math.abs(dz) - 8), ey = Math.max(0, Math.abs(s.y + 8 - cam[1]) - 8);
        if (ex * ex + ez * ez > fogEnd * fogEnd || ey * 0.5 > fogEnd) continue;
      }
      if (!aabbInFrustum(this.planes, s.x, s.y, s.z, s.x + 16, s.y + 16, s.z + 16)) continue;
      s.d = dx * dx + dz * dz + (s.y + 8 - cam[1]) ** 2;
      vis.push(s);
    }
    vis.sort((a, b) => a.d - b.d);
    // the solid pass in bands of 48 blocks nearest first (the GPU still skips what is behind), each band by mesh page, so
    // a page's VAO binds once a band (secDraw); the translucent pass keeps vis, its exact far-to-near order
    const opq = this.opq || (this.opq = []);
    opq.length = 0;
    for (const s of vis) if (s.o) { s.band = Math.floor(Math.sqrt(s.d) / 48); opq.push(s); }
    opq.sort((a, b) => (a.band - b.band) || (a.o.a.pg.id - b.o.a.pg.id) || (a.d - b.d));
    const pre = this.fxOn && this.fx.pDepth;
    if (pre) {
      // depth only (same vertex shader), then shade with LEQUAL and no depth writes: each pixel lit once
      const D = this.fx.pDepth;
      gl.useProgram(D.p);
      gl.uniformMatrix4fv(D.u.u_vp, false, this.vp); gl.uniform3fv(D.u.u_cam, this.camPos);
      gl.uniform1f(D.u.u_tick, env.tick); gl.uniform1f(D.u.u_time, this.frameTime); gl.uniform1f(D.u.u_wave, 1);
      gl.uniform1i(D.u.u_sec, 1); gl.uniform1i(D.u.u_mat, 5); gl.uniform1i(D.u.u_tex, 0); gl.uniform1f(D.u.u_alphaTest, 0.5);
      gl.colorMask(false, false, false, false);
      this.secDraw(D, opq, true, false);
      gl.colorMask(true, true, true, true);
      gl.useProgram(P.p);
      gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    }
    P.st.mId = false;
    const tris = this.secDraw(P, opq, true, false);
    if (pre) { gl.depthFunc(gl.LESS); gl.depthMask(true); }
    this.chunkModel(P, this.identity);
    if (P.u.u_sec) gl.uniform1i(P.u.u_sec, 0);
    this.visSections = vis;
    this.stats = { sections: vis.length, tris };
  }

  drawTranslucent(env) {
    const gl = this.gl;
    if (this.fxOn) this.fx.copyScene();
    const P = this.useChunkProg(env, 'trans', 0.01);
    if (P.u.u_pass) gl.uniform1i(P.u.u_pass, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    if (P.u.u_sec) gl.uniform1i(P.u.u_sec, 1);
    const vis = this.visSections || [];
    P.st.mId = false;
    this.secDraw(P, vis, false, true); // (far to near)
    this.chunkModel(P, this.identity);
    if (P.u.u_sec) gl.uniform1i(P.u.u_sec, 0);
    if (this.fxOn) {
      // the shader pack's post fog needs the water surface's depth: written afterwards by the depth-only program
      // (writing it while shading kept the GPU from skipping hidden water)
      const D = this.fx.pDepth;
      gl.useProgram(D.p); gl.disable(gl.BLEND);
      gl.colorMask(false, false, false, false); gl.depthMask(true);
      gl.uniformMatrix4fv(D.u.u_vp, false, this.vp); gl.uniform3fv(D.u.u_cam, this.camPos);
      gl.uniform1f(D.u.u_tick, env.tick); gl.uniform1f(D.u.u_time, this.frameTime); gl.uniform1f(D.u.u_wave, 1);
      gl.uniform1i(D.u.u_sec, 1); gl.uniform1i(D.u.u_mat, 5); gl.uniform1i(D.u.u_tex, 0); gl.uniform1f(D.u.u_alphaTest, 0.01);
      this.secDraw(D, vis, false, false);
      gl.colorMask(true, true, true, true);
      gl.uniform1i(D.u.u_sec, 0);
    }
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  drawClouds(env, px, pz) {
    if (!this.showClouds) return;
    if (this.fxOn && this.fx.cloudsOn) return; // the shader pack draws its own (volumetric) clouds
    // vanilla's thick fogs (under water, blindness...) hide the clouds too: they were drawn with their own far fog and
    // showed through the water's ("在水下能看到云", feedback 11-01 19:37). Those fogs are spheres around the eye (vanilla
    // FogShape.SPHERE) and the cloud program's fog is a level distance, so the layer's height goes into its range: a layer
    // further above or below than the fog reaches is left out, and a nearer one is as fogged right overhead as its height
    // makes it and gone where the sphere meets it
    const cr = this.cloudRange(), cy = 192 - (this.yOff || 0), camY = this.camPos[1], g = typeof window !== 'undefined' ? window.game : null;
    let fogN = cr * 0.45, fogF = cr;
    if ((g && g.renderer === this && (g.headInWater || g.headInLava || g.headInPowder)) || env.fogFar < this.renderDist * 16 - 1) {
      const dy = Math.max(0, cy - camY, camY - cy - 4), F = env.fogFar, n = Math.min(env.fogNear, F - 0.01);
      if (dy >= F) return;
      const f0 = clamp((dy - n) / (F - n), 0, 0.99);
      fogF = Math.sqrt(F * F - dy * dy); fogN = -f0 * fogF / (1 - f0);
    }
    const drift = env.tick * 0.03;
    this.buildClouds(px, pz, drift);
    const gl = this.gl, C = this.progCol;
    gl.useProgram(C.p);
    const m = this.mat(); M4.translate(m, -drift, cy, 0);
    gl.uniformMatrix4fv(C.u.u_vp, false, this.vp); gl.uniformMatrix4fv(C.u.u_model, false, m);
    const cc = env.cloudColor;
    gl.uniform4f(C.u.u_color, cc[0], cc[1], cc[2], 0.8);
    gl.uniform3fv(C.u.u_cam, this.camPos); gl.uniform3fv(C.u.u_fogColor, env.fogColor);
    gl.uniform2f(C.u.u_fog, fogN, fogF); gl.uniform1f(C.u.u_psize, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(this.cloudGL.vao);
    // depth pre-pass so overlapping cloud faces don't double blend
    gl.colorMask(false, false, false, false);
    gl.drawElements(gl.TRIANGLES, this.cloudGL.n * 1.5, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true);
    gl.depthFunc(gl.LEQUAL);
    gl.drawElements(gl.TRIANGLES, this.cloudGL.n * 1.5, gl.UNSIGNED_INT, 0);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
  }

  // Render a MeshBuffer (item / block) with a model matrix using the chunk program
  drawMesh(mb, model, env, light, opts = {}) {
    const gl = this.gl;
    const g = this.meshToGL(mb);
    const P = this.useChunkProg(env, false, 0.1, opts.color, light);
    this.chunkModel(P, model);
    gl.bindVertexArray(g.vao);
    // (the shader pack keeps what entities draw for their shadows next frame; shRecOnly: only that)
    if (this.shRec) this.shRec.push({ vao: g.vao, n: g.n, m: new Float32Array(model) });
    if (!this.shRecOnly) gl.drawElements(gl.TRIANGLES, g.n * 1.5, gl.UNSIGNED_INT, 0);
  }

  drawModel(name, texName, model, poses, light, env, opts = {}) {
    const gl = this.gl, E = this.entBegin(texName, light, env, opts), mdl = this.models[name];
    const attached = [], mats = {}, draw = !this.shRecOnly && !opts.hidden;
    let vao = null;
    for (const part of mdl.parts) {
      const pose = poses && poses[part.name];
      if (pose && pose.hidden) continue;
      const m = this.mat(part.parent && mats[part.parent] ? mats[part.parent] : model);
      M4.translate(m, part.pivot[0] / 16, part.pivot[1] / 16, part.pivot[2] / 16);
      if (pose) {
        if (pose.t) M4.translate(m, pose.t[0], pose.t[1], pose.t[2]);
        // pose.zx: vanilla ModelPart's order (turned about x first, then y, then z). The elytra's wings need it: turned
        // about z first, both wings' faces stayed in one plane and flickered where they overlap
        if (pose.zx) { if (pose.rz) M4.rotZ(m, pose.rz); if (pose.ry) M4.rotY(m, pose.ry); if (pose.rx) M4.rotX(m, pose.rx); }
        else {
          if (pose.ry) M4.rotY(m, pose.ry);
          if (pose.rx) M4.rotX(m, pose.rx);
          if (pose.rz) M4.rotZ(m, pose.rz);
        }
      }
      if (part.rotY) M4.rotY(m, part.rotY);
      if (part.rotX) M4.rotX(m, part.rotX);
      if (part.rotZ) M4.rotZ(m, part.rotZ);
      mats[part.name] = m;
      // (opts.hidden: an invisible body - only what is attached to it, held items, is drawn. The record is drawn next
      // frame: its own copy of the matrix, not the pool's. A packed model's parts share a VAO: bound once - packParts)
      const ms = part.mesh, off = ms.off || 0;
      if (this.shRec && !opts.vp && !opts.hidden) this.shRec.push({ vao: ms.vao, n: ms.n, off, m: new Float32Array(m), tex: this.entityTex[texName] });
      if (draw && ms.n) {
        if (ms.vao !== vao) { vao = ms.vao; gl.bindVertexArray(vao); }
        gl.uniformMatrix4fv(E.u.u_model, false, m);
        gl.drawElements(gl.TRIANGLES, ms.n * 1.5, gl.UNSIGNED_INT, off);
      }
      if (opts.attach && opts.attach[part.name]) attached.push([opts.attach[part.name], this.mat(m)]);
    }
    this.unit0();
    for (const [fn, m] of attached) fn(m);
  }
  // the entity shader set up for one model: texture, light, fog, overlay / tint (opts); returns the program
  entBegin(texName, light, env, opts = {}) {
    const gl = this.gl, E = this.fxOn ? this.fx.pEnt : this.progEnt, u = E.u;
    gl.useProgram(E.p);
    const st = this.ufState(E);
    if (!E.units) { E.units = true; gl.uniform1i(u.u_tex, 1); if (u.u_lightmap) gl.uniform1i(u.u_lightmap, 8); }
    this.ufFrame(E, st, opts.vp || this.vp, env);
    // per model: each value only when it differs from the program's last (u_bright always - companion.js sets it itself)
    if (st.l0 !== light[0] || st.l1 !== light[1]) { st.l0 = light[0]; st.l1 = light[1]; gl.uniform2f(u.u_light, light[0], light[1]); }
    const o = opts.overlay, o0 = o ? o[0] : 0, o1 = o ? o[1] : 0, o2 = o ? o[2] : 0, o3 = o ? o[3] : 0;
    if (st.o0 !== o0 || st.o1 !== o1 || st.o2 !== o2 || st.o3 !== o3) { st.o0 = o0; st.o1 = o1; st.o2 = o2; st.o3 = o3; gl.uniform4f(u.u_overlay, o0, o1, o2, o3); }
    const t = opts.tint, t0 = t ? t[0] : 1, t1 = t ? t[1] : 1, t2 = t ? t[2] : 1;
    if (st.t0 !== t0 || st.t1 !== t1 || st.t2 !== t2) { st.t0 = t0; st.t1 = t1; st.t2 = t2; gl.uniform3f(u.u_tint, t0, t1, t2); }
    gl.uniform1f(u.u_bright, opts.bright ? 1 : 0);
    const inv = opts.inv ? 1 : 0, fade = 1 - (opts.alpha ?? 1);
    if (u.u_inv && st.inv !== inv) { st.inv = inv; gl.uniform1f(u.u_inv, inv); }
    if (u.u_fade && st.fade !== fade) { st.fade = fade; gl.uniform1f(u.u_fade, fade); }
    // the skin, when it changed: unit 1 is then left active (u1) - each caller (drawModel, drawEM, drawPart, companion.js)
    // goes back to 0 once its parts are drawn and before anything else runs (see ufState)
    const tx = this.entityTex[texName];
    if (this.tex1 !== tx) { this.tex1 = tx; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tx); this.u1 = true; }
    return E;
  }
  // back to texture unit 0 after entBegin's draws
  unit0() { if (this.u1) { this.u1 = false; this.gl.activeTexture(this.gl.TEXTURE0); } }

  // ---- entity shadows, all of an entity pass in one draw ----------------------------------------------------------
  // Each mob's round shadow was its own draw with its own state: ~15 GL calls and a matrix each (430 of a frame's
  // 2 300 calls with 28 mobs, 11-04). Between beginShadows and flushShadows (around game.js drawEntityList) drawShadow
  // only queues; the flush draws them in the order they came, with the state each had (vanilla does the same: its
  // shadows go into one buffer drawn after the entities). Shadows don't write depth, so the entities drawn after one
  // still cover it as before. Outside a batch, or with another camera matrix (a preview), it draws at once as before
  beginShadows() { this.shOn = true; this.shVp = this.vp; this.shN = 0; }
  queueShadow(x, y, z, r, alpha) {
    let q = this.shQ;
    if (!q || (this.shN + 1) * 28 > q.length) { const n = new Float32Array(Math.max(28 * 64, q ? q.length * 2 : 0)); if (q) n.set(q); q = this.shQ = n; }
    // per corner: the shadow's place (y + 0.01 as drawShadow's matrix had it), the corner, its radius and alpha
    const o = this.shN++ * 28, yy = y + 0.01;
    for (let k = 0; k < 4; k++) { const i = o + k * 7; q[i] = x; q[i + 1] = yy; q[i + 2] = z; q[i + 3] = k === 0 || k === 3 ? -1 : 1; q[i + 4] = k < 2 ? -1 : 1; q[i + 5] = r; q[i + 6] = alpha; }
  }
  flushShadows() {
    const n = this.shN; this.shOn = false; this.shN = 0;
    if (!n) return;
    const gl = this.gl;
    let S = this.progShadow;
    if (!S) {
      // the same arithmetic as progTex with drawShadow's matrix (u_vp * model * corner, the model built here), so the
      // picture is the one drawShadow made
      S = this.progShadow = compile(gl, `#version 300 es
layout(location=0) in vec3 a_c; layout(location=1) in vec4 a_o;
uniform mat4 u_vp; out vec2 v_uv; flat out float v_a;
void main(){ mat4 m = mat4(a_o.z, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, a_o.z, 0.0, a_c.x, a_c.y, a_c.z, 1.0);
  v_uv = a_o.xy * 0.5 + 0.5; v_a = a_o.w; gl_Position = u_vp * m * vec4(a_o.x, 0.0, a_o.y, 1.0); }`, `#version 300 es
precision highp float;
uniform sampler2D u_tex; in vec2 v_uv; flat in float v_a; out vec4 o;
void main(){ vec4 t = texture(u_tex, v_uv); o = t * vec4(1.0, 1.0, 1.0, v_a); }`);
      S.vao = gl.createVertexArray(); gl.bindVertexArray(S.vao);
      S.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
      gl.useProgram(S.p); gl.uniform1i(S.u.u_tex, 0);
    }
    gl.useProgram(S.p);
    gl.uniformMatrix4fv(S.u.u_vp, false, this.shVp);
    gl.bindVertexArray(S.vao); gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.shQ.subarray(0, n * 28), gl.STREAM_DRAW);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
    gl.enable(gl.CULL_FACE); // (drawMob and drawEM leave it on: the shadows were drawn with it)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.entityTex.shadow);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  drawShadow(x, y, z, r, alpha) {
    if (this.shOn && this.vp === this.shVp) return this.queueShadow(x, y, z, r, alpha);
    const gl = this.gl, T = this.progTex;
    gl.useProgram(T.p);
    const m = this.mat(); M4.translate(m, x, y + 0.01, z); M4.scale(m, r, 1, r);
    gl.uniformMatrix4fv(T.u.u_vp, false, this.vp); gl.uniformMatrix4fv(T.u.u_model, false, m);
    gl.uniform4f(T.u.u_color, 1, 1, 1, alpha);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.entityTex.shadow);
    gl.bindVertexArray(this.quadVao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }

  // Draw dynamic chunk-format geometry (particles, break overlay, rain)
  drawDynamic(mb, dyn, env, opts = {}) {
    if (!mb.n) return;
    const gl = this.gl;
    this.uploadDynamic(dyn, mb);
    this.useChunkProg(env, false, opts.alphaTest ?? 0.1, opts.colorMul || null);
    if (opts.blend === 'mul') { gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2); }
    else if (opts.blend === 'alpha') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    if (opts.noCull) gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(dyn.vao);
    gl.drawElements(gl.TRIANGLES, mb.n * 1.5, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.CULL_FACE);
  }

  drawLines(verts, color) {
    const gl = this.gl, C = this.progCol;
    gl.useProgram(C.p);
    gl.uniformMatrix4fv(C.u.u_vp, false, this.vp); gl.uniformMatrix4fv(C.u.u_model, false, this.identity);
    gl.uniform4fv(C.u.u_color, color); gl.uniform3fv(C.u.u_cam, this.camPos); gl.uniform2f(C.u.u_fog, 1e9, 2e9); gl.uniform1f(C.u.u_psize, 1);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, verts.length / 7);
    gl.disable(gl.BLEND);
  }

  // ---- GUI icons -------------------------------------------------------------------------
  // Each item is drawn the way vanilla's item model says: flat sprites for "generated" models, 3D
  // block models with the model's own "gui" display transform (most blocks [30,225,0], stairs
  // [30,135,0] ...), the item model's tints, and GUI lighting (top brightest, left side lighter).
  buildIcons() {
    const gl = this.gl, S = 64;
    // each item gets the next slot of the atlas (item ids run up past 3000: placed by id it would be mostly empty)
    const ids = ITEMS.map((it, i) => it ? i : -1).filter(i => i >= 0);
    const cols = 32, rows = Math.ceil(ids.length / cols), slot = this.iconSlot = new Int16Array(ITEMS.length).fill(-1);
    ids.forEach((id, k) => { slot[id] = k; });
    const atlas = document.createElement('canvas'); atlas.width = cols * S; atlas.height = rows * S;
    const actx = atlas.getContext('2d');
    actx.imageSmoothingEnabled = false;
    const fb = gl.createFramebuffer(), tex = gl.createTexture(), rb = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, S, S);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.viewport(0, 0, S, S);
    const px = new Uint8Array(S * S * 4), img = actx.createImageData(S, S);
    const env = { tick: 0, day: 1, fogColor: [0, 0, 0], fogNear: 1e8, fogFar: 2e8, nightTint: [1, 1, 1] };
    const savedVP = this.vp; const savedCam = this.camPos;
    this.camPos = [0, 0, 0];
    const vp = M4.create(); M4.ortho(vp, -0.5, 0.5, -0.5, 0.5, -10, 10);
    this.vp = vp;
    const VD = typeof VM !== 'undefined' && VM.ready ? VM.data : null;
    for (const id of ids) {
      const it = ITEMS[id];
      const cx = (slot[id] % cols) * S, cy = Math.floor(slot[id] / cols) * S;
      const b = it.block !== undefined ? BLOCKS[it.block] : null;
      const info = VD && VD.items[it.key];
      // (the GUI's own model where the item has one: spears, the spyglass and the trident are small sprites there)
      const mi = info ? (info.gui !== undefined ? info.gui : info.m) : undefined;
      const model = mi !== undefined ? VD.models[mi] : null;
      const tint = info ? this.itemTint(info.tints) : null;
      // block-entity blocks (banners, heads, chests ...): their entity model (blockents.js); the shield: its model too
      // (its item model has no shape of its own, only a planks particle texture)
      const shield = it.key === 'shield' && this.shieldIcon;
      if (shield || (b && ((b.be && b.be !== 'invisible') || (b.chestLike && b.id !== 52)))) {
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        if (shield) this.shieldIcon(model && model.display && model.display.gui, env, vp); else this.beIcon(b, env, vp);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, S, S);
        gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
        actx.putImageData(img, cx, cy);
        continue;
      }
      // flat sprite: vanilla "generated" item models (or no model data at all)
      if (model && model.gen && model.layers && model.layers.length) {
        model.layers.forEach((l, k) => this.drawFlatIcon(actx, T(l), cx, cy, S, info ? this.itemTint(info.tints, k) : null));
        continue;
      }
      if (!model) {
        const flat = !it.block || it.flat || (b && (b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door));
        if (flat) { this.drawFlatIcon(actx, it.block ? (it.flat ? T(it.flat) : b.tex[0]) : it.tex, cx, cy, S, b && b.tint === 'grass' ? [124, 189, 107] : null); continue; }
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const d = (model && model.display.gui) || { r: [30, 225, 0], t: [0, 0, 0], s: [0.625, 0.625, 0.625] };
      const R = M4.create();
      M4.rotX(R, d.r[0] * Math.PI / 180); M4.rotY(R, d.r[1] * Math.PI / 180); M4.rotZ(R, d.r[2] * Math.PI / 180);
      const m = M4.create();
      M4.translate(m, d.t[0] / 16, d.t[1] / 16, d.t[2] / 16);
      M4.mul(m, m, R);
      M4.scale(m, d.s[0], d.s[1], d.s[2]);
      // (a bed: both halves - its item model is the head's block model alone, and the icon showed half a bed, players
      // said; the foot block at z 0, the head at z -1, so the pair is centred at z 0)
      M4.translate(m, -0.5, -0.5, b && b.bed ? 0 : -0.5);
      let mb;
      if (b && b.bed) mb = Mesher.multi([[it.block, 0, 0, 0, 0], [it.block, 4, 0, 0, -1]]);
      else if (model && model.elements && model.elements.length) mb = this.iconMesh(VM.bake(mi), R, tint, model.light);
      else if (b) { let meta = 0; if (b.facing) meta = 4; if (b.stairs) meta = 0; mb = Mesher.single(id, meta); }
      else { this.drawFlatIcon(actx, it.tex, cx, cy, S, null); continue; }
      this.useChunkProg(env);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      // (a model's overlay faces lie on its base faces - the grass block's tinted side fringe - and come after them:
      // with LESS they lost, and the base texture's own bright fringe showed instead)
      gl.depthFunc(gl.LEQUAL);
      this.drawMesh(mb, m, env, [1, 0]);
      gl.depthFunc(gl.LESS);
      gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      actx.putImageData(img, cx, cy);
      if (mb.gl) { gl.deleteVertexArray(mb.gl.vao); gl.deleteBuffer(mb.gl.buf); }
    }
    gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex); gl.deleteRenderbuffer(rb);
    this.vp = savedVP; this.camPos = savedCam;
    this.iconAtlas = atlas; this.iconCols = cols; this.iconSize = S;
  }
  // where an item's icon is in iconAtlas
  iconXY(id) {
    const k = this.iconSlot[id] ?? -1, S = this.iconSize, c = this.iconCols;
    return k < 0 ? [0, 0] : [(k % c) * S, Math.floor(k / c) * S];
  }
  // a block-entity block's icon: its model turned like vanilla's GUI items (heads face front-left, banners nearly
  // front-on), scaled to fit
  beIcon(b, env, vp) {
    const fam = b.chestLike ? 'chest' : b.be;
    const [ry, sc, h] = { head: [45, 1.1, 8], wall_head: [45, 1.1, 8], banner: [20, 0.36, 42], wall_banner: [20, 0.36, 42], decorated_pot: [225, 0.55, 20],
      conduit: [225, 1.2, 16], golem_statue: [225, 0.6, 24], shulker_box: [225, 0.625, 16], chest: [225, 0.625, 14] }[fam] || [225, 0.625, 16];
    const base = M4.create();
    M4.rotX(base, 30 * Math.PI / 180); M4.rotY(base, ry * Math.PI / 180); M4.scale(base, sc, sc, sc);
    M4.translate(base, 0, -h / 32, 0);
    const L = [1, 0], e = { ...env, ambient: [0.3, 0.3, 0.3] };
    if (b.chestLike) {
      const mat = new Float32Array(base);
      M4.translate(mat, -0.5, 0, -0.5); M4.scale(mat, -1, -1, 1);
      this.initBEModels();
      const tex = this.beTex(chestTexBase(b.key)) || 'chest_normal';
      this.drawModel('chest', tex, mat, null, L, e, { vp });
      return;
    }
    // the models sit on the block's bottom centre: draw at -0.5 so base * translate(0.5) lands at the origin
    const b0 = new Float32Array(base); M4.translate(b0, -0.5, 0, -0.5);
    const st = b.states ? b.states.findIndex(s => (s.rotation === undefined || s.rotation === '0') && (s.facing === undefined || s.facing === 'south' || s.facing === 'up')) : 0;
    this.drawBE(b, Math.max(0, st), 0, 0, 0, L, e, { vp, base: b0 });
  }
  // vanilla item model for an item id: { model, gen, mesh } (mesh = block geometry lit like the world)
  itemModel(id) {
    if (!this._itemModels) this._itemModels = new Map();
    let r = this._itemModels.get(id);
    if (r !== undefined) return r;
    r = null;
    const VD = typeof VM !== 'undefined' && VM.ready ? VM.data : null, it = ITEMS[id], info = VD && it && VD.items[it.key];
    if (info && info.m !== undefined) {
      const model = VD.models[info.m];
      r = { model, gen: !!model.gen, mesh: null };
      // (a bed: its item model is the head's block model alone, with one template texture - in the hand and on the
      // ground half a bed showed, and red whatever its colour; the placed bed's own head and foot instead, the foot
      // south of the head like vanilla's bed item)
      if (it.block !== undefined && BLOCKS[it.block] && BLOCKS[it.block].bed) r.mesh = Mesher.multi([[it.block, 4, 0, 0, 0], [it.block, 0, 0, 0, 1]]);
      else if (!model.gen && model.elements && model.elements.length) {
        const quads = VM.bake(info.m);
        const tint = this.itemTint(info.tints), mb = new MeshBuffer(quads.length * 4 + 4);
        for (const q of quads) {
          const sh = q.shade ? (q.dir >= 0 ? FACE_SHADE[q.dir] : 0.85) : 1, c = q.tint >= 0 && tint ? tint : [255, 255, 255];
          for (let k = 0; k < 4; k++) mb.v(q.p[k][0], q.p[k][1], q.p[k][2], q.uv[k][0], q.uv[k][1], q.layer, 0, c[0], c[1], c[2], Math.round(sh * 255), 255, 255, q.anim);
        }
        r.mesh = mb;
      }
    }
    this._itemModels.set(id, r);
    return r;
  }
  // icon geometry from baked vanilla quads, shaded by where each face points on screen
  iconMesh(quads, R, tint, light) {
    const mb = new MeshBuffer(quads.length * 4 + 4);
    for (const q of quads) {
      const n = q.n, sx = R[0] * n[0] + R[4] * n[1] + R[8] * n[2], sy = R[1] * n[0] + R[5] * n[1] + R[9] * n[2];
      let shade = 1;
      // (vanilla's GUI item lighting, measured off a vanilla inventory: the top as is, the left side 0.65, the right 0.41)
      if (light !== 'front') shade = sy > 0.45 ? 1 : (sx < 0 ? 0.65 : 0.41);
      const c = q.tint >= 0 && tint ? tint : [255, 255, 255];
      for (let k = 0; k < 4; k++) mb.v(q.p[k][0], q.p[k][1], q.p[k][2], q.uv[k][0], q.uv[k][1], q.layer, 0, c[0], c[1], c[2], Math.round(shade * 255), 255, 255, q.anim);
    }
    return mb;
  }
  // vanilla item tint sources: grass(temperature, downfall), foliage, constant
  // the tint of a model layer (tints[i]): constant colours, the grass / foliage colour maps, and for the kinds
  // that depend on the stack (potion, dye, firework, map colour ...) their default colour
  itemTint(tints, i = 0) {
    const t = tints && tints[i];
    if (!t) return null;
    const type = (t.type || '').replace('minecraft:', ''), rgb = (v) => { v >>>= 0; return (v & 0xFFFFFF) === 0xFFFFFF ? null : [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
    if (type === 'constant') return rgb(t.value);
    if (type === 'grass' || type === 'foliage') {
      const img = this.images[type === 'grass' ? 'grass_color' : 'foliage_color'];
      if (!this._cmap) this._cmap = {};
      if (!this._cmap[type]) { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.drawImage(img, 0, 0); this._cmap[type] = x.getImageData(0, 0, 256, 256).data; }
      const T0 = clamp(t.temperature ?? 0.5, 0, 1), D0 = clamp(t.downfall ?? 1, 0, 1) * T0;
      const i = (Math.floor((1 - D0) * 255) * 256 + Math.floor((1 - T0) * 255)) * 4, d = this._cmap[type];
      return [d[i], d[i + 1], d[i + 2]];
    }
    if (t.default !== undefined) return rgb(t.default);
    return null;
  }
  // where a tile (texture layer) sits in stripCanvas
  tileXY(k) { const c = this.stripCols; return [(k % c) * 16, Math.floor(k / c) * 16]; }
  drawFlatIcon(ctx, layer, x, y, S, tint) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const cx = c.getContext('2d');
    cx.drawImage(this.stripCanvas, ...this.tileXY(layer), 16, 16, 0, 0, 16, 16);
    if (tint) {
      const d = cx.getImageData(0, 0, 16, 16);
      for (let i = 0; i < 1024; i += 4) { d.data[i] = d.data[i] * tint[0] / 255; d.data[i + 1] = d.data[i + 1] * tint[1] / 255; d.data[i + 2] = d.data[i + 2] * tint[2] / 255; }
      cx.putImageData(d, 0, 0);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, 16, 16, x + 4, y + 4, S - 8, S - 8);
  }
}

// a * b into out (column-major; out is neither a nor b) - M4.mul's arithmetic without its scratch array
function mul4(out, a, b) {
  for (let j = 0; j < 4; j++) {
    const b0 = b[j * 4], b1 = b[j * 4 + 1], b2 = b[j * 4 + 2], b3 = b[j * 4 + 3];
    for (let i = 0; i < 4; i++) out[j * 4 + i] = a[i] * b0 + a[4 + i] * b1 + a[8 + i] * b2 + a[12 + i] * b3;
  }
  return out;
}
// (out: where to write it, not m)
function invert4(m, out) {
  const inv = out || new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
