'use strict';
// ---------------------------------------------------------------------------
// Renderer additions: Nether/End mob models, Ender Dragon, end crystals,
// beams, End sky, billboards
// ---------------------------------------------------------------------------
Renderer.prototype.initModels2 = function () {
  const M = this.models;
  const P = (tw, th, parts) => ({ parts: this.packParts(parts, tw, th) }); // (one VAO a model: render.js packParts)
  M.enderman = P(64, 32, [
    { name: 'head', pivot: [0, 38, 0], boxes: [[0, 0, -4, 0, -4, 8, 8, 8]] },
    { name: 'jaw', pivot: [0, 38, 0], boxes: [[0, 16, -4, 0, -4, 8, 8, 8, -0.5]] },
    { name: 'body', pivot: [0, 26, 0], boxes: [[32, 16, -4, 0, -2, 8, 12, 4]] },
    { name: 'rarm', pivot: [5, 37, 0], boxes: [[56, 0, -1, -29, -1, 2, 30, 2]] },
    { name: 'larm', pivot: [-5, 37, 0], boxes: [[56, 0, -1, -29, -1, 2, 30, 2, 0, true]] },
    { name: 'rleg', pivot: [2, 30, 0], boxes: [[56, 0, -1, -30, -1, 2, 30, 2]] },
    { name: 'lleg', pivot: [-2, 30, 0], boxes: [[56, 0, -1, -30, -1, 2, 30, 2, 0, true]] },
  ]);
  const rods = [];
  for (let i = 0; i < 12; i++) rods.push({ name: 'rod' + i, pivot: [0, 0, 0], boxes: [[0, 16, -1, 0, -1, 2, 8, 2]] });
  M.blaze = P(64, 32, [{ name: 'head', pivot: [0, 20, 0], boxes: [[0, 0, -4, 0, -4, 8, 8, 8]] }, ...rods]);
  const tent = [], tr = RNG(1234);
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * 5 + ((i / 3 | 0) % 2 ? 1.5 : -1.5) * 0.5, z = ((i / 3 | 0) - 1) * 5, L = 9 + tr.int(5);
    tent.push({ name: 't' + i, pivot: [x, 1, z], boxes: [[0, 0, -1, -L, -1, 2, L, 2]] });
  }
  M.ghast = P(64, 32, [{ name: 'body', pivot: [0, 0, 0], boxes: [[0, 0, -8, 0, -8, 16, 16, 16]] }, ...tent]);
  M.zombified_piglin = P(64, 64, [
    { name: 'head', pivot: [0, 24, 0], boxes: [[0, 0, -5, 0, -4, 10, 8, 8], [31, 1, -2, 0, -5, 4, 4, 1]] },
    { name: 'rear', pivot: [5, 30, 0], boxes: [[51, 6, 0, -5, -2, 1, 5, 4]] },
    { name: 'lear', pivot: [-5, 30, 0], boxes: [[39, 6, -1, -5, -2, 1, 5, 4, 0, true]] },
    { name: 'body', pivot: [0, 12, 0], boxes: [[16, 16, -4, 0, -2, 8, 12, 4]] },
    { name: 'rarm', pivot: [6, 22, 0], boxes: [[40, 16, -2, -10, -2, 4, 12, 4]] },
    { name: 'larm', pivot: [-6, 22, 0], boxes: [[32, 48, -2, -10, -2, 4, 12, 4]] },
    { name: 'rleg', pivot: [2, 12, 0], boxes: [[0, 16, -2, -12, -2, 4, 12, 4]] },
    { name: 'lleg', pivot: [-2, 12, 0], boxes: [[16, 48, -2, -12, -2, 4, 12, 4]] },
  ]);
  const segs = [];
  for (let i = 0; i < 8; i++) segs.push({ name: 's' + i, pivot: [0, 7 - i, 0], boxes: [[i < 4 ? 0 : 32, (i % 4) * 9, -4, 0, -4, 8, 1, 8]] });
  M.magma_cube = P(64, 64, [...segs, { name: 'core', pivot: [0, 2, 0], boxes: [[24, 40, -2, 0, -2, 4, 4, 4]] }]);
  // end crystal
  // chests: vanilla block-entity boxes mirrored in x and y (drawn with scale(-1,-1,1)) so the
  // shared box UV layout lands on the right faces; lid and lock hinge at the back edge
  const chest = (bx, w, lx, lw) => [
    { name: 'bottom', pivot: [0, 0, 0], boxes: [[0, 19, bx, -10, 1, w, 10, 14]] },
    { name: 'lid', pivot: [0, -9, 1], boxes: [[0, 0, bx, -5, 0, w, 5, 14]] },
    { name: 'lock', pivot: [0, -9, 1], boxes: [[0, 0, lx, -2, 14, lw, 4, 1]] },
  ];
  M.chest = P(64, 64, chest(-15, 14, -9, 2));
  M.chest_left = P(64, 64, chest(-15, 15, -1, 1));
  M.chest_right = P(64, 64, chest(-16, 15, -16, 1));
  M.crystal_base = P(64, 32, [{ name: 'b', pivot: [0, 0, 0], boxes: [[0, 16, -6, 0, -6, 12, 4, 12]] }]);
  M.crystal_glass = P(64, 32, [{ name: 'g', pivot: [0, 0, 0], boxes: [[0, 0, -4, -4, -4, 8, 8, 8]] }]);
  M.crystal_core = P(64, 32, [{ name: 'c', pivot: [0, 0, 0], boxes: [[32, 0, -4, -4, -4, 8, 8, 8]] }]);
  // ender dragon pieces (256x256 texture), modelled y-up, facing -z, in pixels
  const D = (boxes) => this.makeModelPart(boxes, 256, 256);
  this.dragon = {
    body: D([[0, 0, -12, -24, -8, 24, 24, 64], [220, 53, -1, 0, -2, 2, 6, 12], [220, 53, -1, 0, 18, 2, 6, 12], [220, 53, -1, 0, 38, 2, 6, 12]]),
    seg: D([[192, 104, -5, -5, -5, 10, 10, 10], [48, 0, -1, 5, -3, 2, 4, 6]]),
    head: D([[112, 30, -8, -8, -16, 16, 16, 16], [176, 44, -6, -4, -30, 12, 5, 16], [0, 0, -5, 8, -10, 2, 4, 6], [0, 0, 3, 8, -10, 2, 4, 6, 0, true], [112, 0, -5, 1, -28, 2, 2, 4], [112, 0, 3, 1, -28, 2, 2, 4, 0, true]]),
    jaw: D([[176, 65, -6, -4, -16, 12, 4, 16]]),
    wing: D([[112, 88, 0, -4, -4, 56, 8, 8], [-56, 88, 0, 0, 2, 56, 0, 56]]),
    tip: D([[112, 136, 0, -2, -2, 56, 4, 4], [-56, 144, 0, 0, 2, 56, 0, 56]]),
    fleg: D([[112, 104, -4, -20, -4, 8, 24, 8]]), ftip: D([[226, 138, -3, -23, -3, 6, 24, 6]]), ffoot: D([[144, 104, -4, -4, -12, 8, 4, 16]]),
    rleg: D([[0, 0, -8, -28, -8, 16, 32, 16]]), rtip: D([[196, 0, -6, -30, 0, 12, 32, 12]]), rfoot: D([[112, 0, -9, -6, -20, 18, 6, 24]]),
  };
  // billboard quad (for fireballs, eyes)
  this.spriteBuf = new MeshBuffer(256);
  this.spriteGL = this.makeDynamic();
};

// draw one model mesh with the entity program (its uniforms through entBegin's cache, render.js ufState: setting them
// here behind its back left the cache believing in values the program no longer had)
Renderer.prototype.drawPart = function (mesh, texName, model, light, env, opts = {}) {
  const gl = this.gl, E = this.entBegin(texName, light, env, opts);
  gl.uniformMatrix4fv(E.u.u_model, false, model);
  gl.bindVertexArray(mesh.vao);
  const off = mesh.off || 0; // (a part of a packed model: from its first quad)
  if (this.shRec && !opts.vp) this.shRec.push({ vao: mesh.vao, n: mesh.n, off, m: new Float32Array(model), tex: this.entityTex[texName] });
  if (!this.shRecOnly) gl.drawElements(gl.TRIANGLES, mesh.n * 1.5, gl.UNSIGNED_INT, off);
  this.unit0();
};

// textured beam between two points (crystal healing, end gateway, beacons); added on, or blended ('alpha')
Renderer.prototype.drawBeam = function (a, b, texName, width, color, scroll, blend) {
  const gl = this.gl, T = this.progTex, cam = this.camPos;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1;
  const mx = (a[0] + b[0]) / 2 - cam[0], my = (a[1] + b[1]) / 2 - cam[1], mz = (a[2] + b[2]) / 2 - cam[2];
  // side vector perpendicular to beam and view
  let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;
  const sl = Math.hypot(sx, sy, sz) || 1; sx *= width / sl; sy *= width / sl; sz *= width / sl;
  const v0 = scroll, v1 = scroll + len / 4;
  const data = new Float32Array([a[0] - sx, a[1] - sy, a[2] - sz, 0, v0, a[0] + sx, a[1] + sy, a[2] + sz, 1, v0, b[0] + sx, b[1] + sy, b[2] + sz, 1, v1, b[0] - sx, b[1] - sy, b[2] - sz, 0, v1]);
  if (!this.beamVao) {
    this.beamVao = gl.createVertexArray(); gl.bindVertexArray(this.beamVao);
    this.beamBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
  }
  gl.bindVertexArray(this.beamVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.useProgram(T.p);
  gl.uniformMatrix4fv(T.u.u_vp, false, this.vp); gl.uniformMatrix4fv(T.u.u_model, false, this.identity);
  gl.uniform4fv(T.u.u_color, color);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.entityTex[texName]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
  gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
};

// additive light rays (dragon death)
Renderer.prototype.drawRays = function (center, t, count, seed) {
  const gl = this.gl, C = this.progCol, r = RNG(seed), v = [];
  const k = Math.min(1, t / 200);
  for (let i = 0; i < count * k + 1; i++) {
    let x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1; const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    const len = (20 + r() * 40) * (0.3 + k), w = (2 + r() * 4) * (0.5 + k);
    // a thin triangle fan blade: center + two points around the tip
    const px = -z, pz = x;
    const tip = [center[0] + x * len, center[1] + y * len, center[2] + z * len];
    const a = [tip[0] + px * w, tip[1], tip[2] + pz * w], b = [tip[0] - px * w, tip[1] + w * 0.5, tip[2] - pz * w];
    v.push(center[0], center[1], center[2], 1, 1, 1, 0.9 * (1 - k * 0.3), a[0], a[1], a[2], 0.8, 0.4, 1, 0, b[0], b[1], b[2], 0.8, 0.4, 1, 0);
  }
  if (!this.rayVao) {
    this.rayVao = gl.createVertexArray(); gl.bindVertexArray(this.rayVao);
    this.rayBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.rayBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  }
  gl.bindVertexArray(this.rayVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.rayBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
  gl.useProgram(C.p);
  gl.uniformMatrix4fv(C.u.u_vp, false, this.vp); gl.uniformMatrix4fv(C.u.u_model, false, this.identity);
  gl.uniform4f(C.u.u_color, 1, 1, 1, 1); gl.uniform3fv(C.u.u_cam, this.camPos); gl.uniform2f(C.u.u_fog, 1e9, 2e9); gl.uniform1f(C.u.u_psize, 1);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.drawArrays(gl.TRIANGLES, 0, v.length / 7);
  gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
};

// End sky: a dark textured box around the camera
Renderer.prototype.drawEndSky = function () {
  const gl = this.gl, T = this.progTex;
  if (!this.endSkyVao) {
    const S = 100, R = 16, f = [];
    const quad = (a, b, c, d) => { f.push(...a, 0, 0, ...b, R, 0, ...c, R, R, ...d, 0, R); };
    quad([-S, -S, -S], [S, -S, -S], [S, -S, S], [-S, -S, S]);
    quad([-S, S, S], [S, S, S], [S, S, -S], [-S, S, -S]);
    quad([-S, -S, S], [S, -S, S], [S, S, S], [-S, S, S]);
    quad([S, -S, -S], [-S, -S, -S], [-S, S, -S], [S, S, -S]);
    quad([-S, -S, -S], [-S, -S, S], [-S, S, S], [-S, S, -S]);
    quad([S, -S, S], [S, -S, -S], [S, S, -S], [S, S, S]);
    this.endSkyVao = gl.createVertexArray(); gl.bindVertexArray(this.endSkyVao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(f), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
  }
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.useProgram(T.p);
  gl.uniformMatrix4fv(T.u.u_vp, false, this.vpNoTranslate()); gl.uniformMatrix4fv(T.u.u_model, false, this.identity);
  gl.uniform4f(T.u.u_color, 0.16, 0.16, 0.16, 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.entityTex.end_sky);
  gl.bindVertexArray(this.endSkyVao);
  gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_INT, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE);
};

// camera-facing sprites from the texture array (fireballs, eyes of ender, pearls)
Renderer.prototype.drawSprites = function (list, env, right, up) {
  if (!list.length) return;
  const mb = this.spriteBuf; mb.reset();
  // a sprite may be rectangular (w/h), upright-only (cyl: turns with the camera yaw but stays vertical)
  // and animated (anim = frame count of an animated tile)
  const hr = Math.hypot(right[0], right[2]) || 1, flatR = [right[0] / hr, 0, right[2] / hr], worldUp = [0, 1, 0];
  for (const s of list) {
    const R = s.cyl ? flatR : right, U = s.cyl ? worldUp : up, sw = s.w || s.size, sh = s.h || s.size;
    const r = [R[0] * sw, R[1] * sw, R[2] * sw], u = [U[0] * sh, U[1] * sh, U[2] * sh];
    const [x, y, z] = s.pos, c = s.col || [255, 255, 255], L = s.bright ? 255 : 200, an = s.anim || 0;
    mb.v(x - r[0] - u[0], y - r[1] - u[1], z - r[2] - u[2], 0, 1, s.layer, 0, c[0], c[1], c[2], 255, L, L, an);
    mb.v(x + r[0] - u[0], y + r[1] - u[1], z + r[2] - u[2], 1, 1, s.layer, 0, c[0], c[1], c[2], 255, L, L, an);
    mb.v(x + r[0] + u[0], y + r[1] + u[1], z + r[2] + u[2], 1, 0, s.layer, 0, c[0], c[1], c[2], 255, L, L, an);
    mb.v(x - r[0] + u[0], y - r[1] + u[1], z - r[2] + u[2], 0, 0, s.layer, 0, c[0], c[1], c[2], 255, L, L, an);
  }
  this.drawDynamic(mb, this.spriteGL, { ...env, fogNear: 1e8, fogFar: 2e8 }, { noCull: true, alphaTest: 0.1 });
};
