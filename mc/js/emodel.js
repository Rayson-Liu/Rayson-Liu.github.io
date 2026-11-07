'use strict';
// ---------------------------------------------------------------------------
// Vanilla entity models: the model layers, keyframe animations and entity data the local 26.2 client builds
// (tools/export_entities.py -> tools/build_entities.py -> entitydata.js, etex.js).
// A model is drawn the way vanilla's renderers do: in the model's own space (y down, 24 px above the feet at
// y = 0), turned into the entity's by scale(-1, -1, 1) and a 1.501 block drop; each part translates to its
// pivot, rotates Z, Y, X and scales. Animations work like vanilla's: each frame the parts go back to their
// initial pose, a mob's setupAnim moves them and keyframe animations add their offsets.
// ---------------------------------------------------------------------------
const EM = {
  models: {},
  // the model of a layer ('pig#main'), built on first use; null when the jar has no such layer
  get(r, key) {
    if (key in this.models) return this.models[key];
    const L = window.ENTITY_DATA && ENTITY_DATA.layers[key];
    if (!L) return (this.models[key] = null);
    const parts = {}, meshed = [];
    const mk = (name, a) => {
      const n = { name, ip: a.slice(0, 6), is: a[6] || null, mesh: null, kids: [] };
      if (a[7]) meshed.push([n, a[7]]);
      if (a[8]) for (const k in a[8]) n.kids.push(mk(k, a[8][k]));
      if (name && !parts[name]) parts[name] = n;
      return n;
    };
    // the layer's own root is unnamed: models with a part called "root" get that one
    const m = { key, tw: L.tw, th: L.th, root: mk('', L.root), parts };
    emPack(r, meshed);
    m.all = []; const walk = (n) => { m.all.push(n); n.kids.forEach(walk); }; walk(m.root);
    this.reset(m);
    return (this.models[key] = m);
  },
  has(key) { return !!(window.ENTITY_DATA && ENTITY_DATA.layers[key]); },
  reset(m) {
    for (const n of m.all) {
      n.x = n.ip[0]; n.y = n.ip[1]; n.z = n.ip[2]; n.xRot = n.ip[3]; n.yRot = n.ip[4]; n.zRot = n.ip[5];
      n.xScale = n.is ? n.is[0] : 1; n.yScale = n.is ? n.is[1] : 1; n.zScale = n.is ? n.is[2] : 1;
      n.visible = true; n.skipDraw = false;
    }
  },
  // the pose of src's parts copied onto dst's parts of the same name (vanilla copyPropertiesTo, for layers drawn over a model)
  copy(src, dst) {
    for (const n of dst.all) {
      const s = src.parts[n.name]; if (!s) continue;
      n.x = s.x; n.y = s.y; n.z = s.z; n.xRot = s.xRot; n.yRot = s.yRot; n.zRot = s.zRot;
      n.xScale = s.xScale; n.yScale = s.yScale; n.zScale = s.zScale; n.visible = s.visible;
    }
  },
  // a keyframe animation (ENTITY_DATA.anims, 'WardenAnimation.WARDEN_ROAR') at t seconds, its offsets scaled by k
  anim(m, name, t, k = 1) {
    const A = ENTITY_DATA.anims[name]; if (!A || !m) return;
    const tt = A.loop ? t % A.len : t;
    for (const bone in A.bones) {
      const n = m.parts[bone]; if (!n) continue;
      for (const ch of A.bones[bone]) {
        const v = emSample(ch.k, tt);
        if (ch.t === 'rot') { n.xRot += v[0] * k; n.yRot += v[1] * k; n.zRot += v[2] * k; }
        else if (ch.t === 'pos') { n.x += v[0] * k; n.y += v[1] * k; n.z += v[2] * k; }
        else { n.xScale += v[0] * k; n.yScale += v[1] * k; n.zScale += v[2] * k; }
      }
    }
  },
  // a walking animation driven by the limb swing like vanilla's applyWalk: time = swing position, strength = speed
  walk(m, name, pos, speed, tMul = 1, sMul = 1) { this.anim(m, name, pos * 0.05 * tMul, Math.min(speed * sMul, 1)); },
  // a one-shot / looping animation an entity started (e.anims[name] = the tick it started)
  state(m, e, name, a, k = 1) { const s = e.anims && e.anims[name]; if (s == null) return; this.anim(m, name, (e.age - s + a) / 20, k); },
};
// a channel's value at t: the keyframe at or before t and the next, linear or Catmull-Rom between them
const _emV = [0, 0, 0];
function emSample(K, t) {
  let i = 0;
  while (i + 1 < K.length && K[i + 1][0] < t) i++;
  if (K.length > 1 && K[0][0] >= t) i = 0;
  const j = Math.min(K.length - 1, i + 1), d = K[j][0] - K[i][0];
  const al = d > 0 ? clamp((t - K[i][0]) / d, 0, 1) : 0;
  if (K[j][1] === 0) {
    for (let c = 0; c < 3; c++) _emV[c] = lerp(K[i][5 + c], K[j][2 + c], al);
  } else {
    const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[j], p3 = K[Math.min(K.length - 1, j + 1)];
    for (let c = 0; c < 3; c++) {
      const a = p0[5 + c], b = p1[5 + c], cc = p2[5 + c], dd = p3[5 + c];
      _emV[c] = 0.5 * (2 * b + (-a + cc) * al + (2 * a - 5 * b + 4 * cc - dd) * al * al + (-a + 3 * b - 3 * cc + dd) * al * al * al);
    }
  }
  return _emV;
}
// the parts' faces ([node, faces] each; a face: [nx, ny, nz, then x y z u v for each of 4 corners] in model pixels) as
// one mesh: one buffer and VAO a layer, each part drawn from its own first quad - off, a byte offset into the shared quad
// indices - so drawEM binds a model's VAO once, not once a part (~90 binds a frame with 28 mobs in view, 11-04)
function emPack(r, list) {
  if (!list.length) return;
  let total = 0;
  for (const [, faces] of list) total += faces.length;
  const gl = r.gl, data = new Float32Array(total * 32);
  let o = 0;
  for (const [n, faces] of list) {
    n.mesh = { vao: null, n: faces.length * 4, off: o / 32 * 24 };
    for (const f of faces) for (let k = 0; k < 4; k++) {
      const b = 3 + k * 5;
      data[o++] = f[b] / 16; data[o++] = f[b + 1] / 16; data[o++] = f[b + 2] / 16;
      data[o++] = f[b + 3]; data[o++] = f[b + 4];
      data[o++] = f[0]; data[o++] = f[1]; data[o++] = f[2];
    }
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.quadIdx);
  gl.bindVertexArray(null);
  for (const [n] of list) n.mesh.vao = vao;
}

// an entity texture from etex.js ('entity/horse/horse_white'), made into a GL texture once its image loads
// (null until then)
Renderer.prototype.etex = function (path) {
  const k = '@' + path;
  if (this.entityTex[k]) return k;
  if (!this._etexWait) this._etexWait = new Set();
  if (this._etexWait.has(k)) return null;
  const src = window.ETEX && ETEX[path];
  if (!src) return null;
  this._etexWait.add(k);
  const im = new Image();
  im.onload = () => { this.images[k] = im; this.entityTex[k] = this.tex2D(im, false); };
  im.src = src;
  return null;
};
// several entity textures painted over each other (optionally tinted [r, g, b] 0..1, multiplied like vanilla's
// dyed layers) into one texture, made once per combination; null until all the images have loaded
Renderer.prototype.etexMix = function (layers) {
  const key = '@mix:' + layers.map(l => typeof l === 'string' ? l : l.p + (l.c ? '*' + l.c.join(',') : '')).join('|');
  if (this.entityTex[key]) return key;
  const ims = layers.map(l => { const p = typeof l === 'string' ? l : l.p; this.etex(p); return this.images['@' + p]; });
  if (ims.some(i => !i)) return null;
  const c = document.createElement('canvas'); c.width = ims[0].width; c.height = ims[0].height;
  const x = c.getContext('2d');
  layers.forEach((l, i) => {
    const im = ims[i];
    if (typeof l !== 'string' && l.c) {
      const t = document.createElement('canvas'); t.width = im.width; t.height = im.height;
      const tx = t.getContext('2d'); tx.drawImage(im, 0, 0);
      const d = tx.getImageData(0, 0, t.width, t.height), p = d.data;
      for (let q = 0; q < p.length; q += 4) { p[q] *= l.c[0]; p[q + 1] *= l.c[1]; p[q + 2] *= l.c[2]; }
      tx.putImageData(d, 0, 0);
      x.drawImage(t, 0, 0, c.width, c.height);
    } else x.drawImage(im, 0, 0, c.width, c.height);
  });
  this.entityTex[key] = this.tex2D(c, false);
  return key;
};

// draw a vanilla model posed as it is now; base: the entity's matrix (feet, body yaw applied).
// opts: overlay, tint, bright, vp, attach {part: fn(matrix)}, cull (default on, like vanilla's cutout types)
Renderer.prototype.drawEM = function (m, tex, base, light, env, opts = {}) {
  if (!m || !tex || !this.entityTex[tex]) return;
  const gl = this.gl, E = this.entBegin(tex, light, env, opts);
  // (the matrices from the renderer's pool for this frame, render.js mat: a new array per part was ~10 a mob a frame)
  const mat = this.mat(base); M4.scale(mat, -1, -1, 1); M4.translate(mat, 0, -1.501, 0);
  const cull = opts.cull !== false;
  if (cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
  const att = [];
  let vao = null;
  const rec = (n, pm) => {
    if (!n.visible) return;
    const mm = this.mat(pm);
    M4.translate(mm, n.x / 16, n.y / 16, n.z / 16);
    if (n.zRot) M4.rotZ(mm, n.zRot);
    if (n.yRot) M4.rotY(mm, n.yRot);
    if (n.xRot) M4.rotX(mm, n.xRot);
    if (n.xScale !== 1 || n.yScale !== 1 || n.zScale !== 1) M4.scale(mm, n.xScale, n.yScale, n.zScale);
    if (n.mesh && !n.skipDraw) {
      gl.uniformMatrix4fv(E.u.u_model, false, mm);
      if (n.mesh.vao !== vao) { vao = n.mesh.vao; gl.bindVertexArray(vao); } // (the layer's parts share one: emPack)
      gl.drawElements(gl.TRIANGLES, n.mesh.n * 1.5, gl.UNSIGNED_INT, n.mesh.off);
    }
    if (opts.attach && opts.attach[n.name]) att.push([opts.attach[n.name], this.mat(mm)]);
    for (const k of n.kids) rec(k, mm);
  };
  rec(m.root, mat);
  gl.enable(gl.CULL_FACE);
  this.unit0(); // (texture unit 0 again, before what is attached draws: render.js entBegin)
  for (const [fn, mm] of att) fn(mm);
};
// the same, drawn additively over what is there (eyes, glowing layers)
Renderer.prototype.drawEMGlow = function (m, tex, base, env, opts = {}) {
  const gl = this.gl;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  this.drawEM(m, tex, base, [1, 1], env, { ...opts, bright: true });
  gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); gl.depthMask(true);
};
// a layer drawn over the model at the same depth (markings, collars, saddles that are not inflated)
Renderer.prototype.drawEMOver = function (m, tex, base, light, env, opts = {}) {
  const gl = this.gl;
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthFunc(gl.LEQUAL);
  this.drawEM(m, tex, base, light, env, opts);
  gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
};

// vanilla-style head turn: yaw and pitch (this game's radians) on a part in model space
function emHead(n, e, a) {
  if (!n) return;
  n.yRot = -(e.headYaw || 0);
  n.xRot = -(e.pitch || 0);
}
// the limb swing the way vanilla passes it to setupAnim: position and speed (0..1), interpolated
function emLimbs(e, a) {
  const amt = e.limbAmt || 0, pos = (e.limbSwing || 0) - amt * (1 - a);
  return [pos, Math.min(1, amt)];
}
// four-legged walk (vanilla QuadrupedModel)
function emQuad(m, pos, spd, names = ['right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg']) {
  const P = m.parts, c = Math.cos(pos * 0.6662) * 1.4 * spd, d = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd;
  if (P[names[0]]) P[names[0]].xRot = c;
  if (P[names[1]]) P[names[1]].xRot = d;
  if (P[names[2]]) P[names[2]].xRot = d;
  if (P[names[3]]) P[names[3]].xRot = c;
}
// humanoid arms and legs (vanilla HumanoidModel's walk; aggressive: arms held forward like zombies)
function emHumanoid(m, e, a, opts = {}) {
  const P = m.parts, [pos, spd] = emLimbs(e, a);
  emHead(P.head, e, a);
  if (P.hat) { P.hat.xRot = P.head.xRot; P.hat.yRot = P.head.yRot; }
  const ra = P.right_arm, la = P.left_arm, rl = P.right_leg, ll = P.left_leg;
  if (ra) { ra.xRot = Math.cos(pos * 0.6662 + Math.PI) * 2 * spd * 0.5; ra.zRot = 0; ra.yRot = 0; }
  if (la) { la.xRot = Math.cos(pos * 0.6662) * 2 * spd * 0.5; la.zRot = 0; la.yRot = 0; }
  if (rl) { rl.xRot = Math.cos(pos * 0.6662) * 1.4 * spd; rl.yRot = 0; rl.zRot = 0; }
  if (ll) { ll.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd; ll.yRot = 0; ll.zRot = 0; }
  if (e.riding && rl && ll) {
    if (ra) ra.xRot -= Math.PI / 5; if (la) la.xRot -= Math.PI / 5;
    rl.xRot = -1.4137167; rl.yRot = Math.PI / 10; rl.zRot = 0.07853982;
    ll.xRot = -1.4137167; ll.yRot = -Math.PI / 10; ll.zRot = -0.07853982;
  }
  const t = e.age + a;
  if (opts.zombie && ra && la) {
    // arms forward, raised further while attacking
    const atk = e.swingT > 0 ? Math.sin((1 - e.swingT / 6) * Math.PI) : 0, f = Math.sin(atk * Math.PI);
    const g = Math.sin((1 - (1 - atk) * (1 - atk)) * Math.PI), raise = -Math.PI / (e.aggressive || e.target ? 1.5 : 2.25);
    ra.zRot = 0; la.zRot = 0; ra.yRot = -(0.1 - f * 0.6); la.yRot = 0.1 - f * 0.6;
    ra.xRot = raise + f * 1.2 - g * 0.4; la.xRot = raise + f * 1.2 - g * 0.4;
  } else if (e.swingT > 0 && ra) {
    const s = 1 - e.swingT / 6, f = Math.sin(Math.sqrt(s) * Math.PI);
    ra.xRot -= f * 1.2 + Math.sin(s * Math.PI) * -(P.head ? P.head.xRot - 0.7 : 0) * 0.75;
    ra.yRot += (P.body ? Math.sin(Math.sqrt(s) * Math.PI * 2) * 0.2 : 0);
  }
  if (opts.bow && ra && la) {
    // vanilla bow pose: both arms toward the target
    ra.yRot = -0.1 + P.head.yRot; la.yRot = 0.1 + P.head.yRot + 0.4;
    ra.xRot = -Math.PI / 2 + P.head.xRot; la.xRot = -Math.PI / 2 + P.head.xRot;
  }
  // idle arm sway
  if (ra) { ra.zRot += Math.cos(t * 0.09) * 0.05 + 0.05; ra.xRot += Math.sin(t * 0.067) * 0.05; }
  if (la) { la.zRot -= Math.cos(t * 0.09) * 0.05 + 0.05; la.xRot -= Math.sin(t * 0.067) * 0.05; }
}
