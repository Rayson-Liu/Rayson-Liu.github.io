'use strict';
// ---------------------------------------------------------------------------
// Decorations: item frames and glow item frames, paintings (every vanilla painting variant), armor stands,
// banner patterns (banners and shields show them; the loom adds them), signs written in single player (the
// editing screen; dyes, glow ink, ink sacs and honeycomb on signs).
// ---------------------------------------------------------------------------
const EXTRA = (window.ENTITY_DATA && ENTITY_DATA.extra) || {};
const zhT = (k, d) => (EXTRA.lang && EXTRA.lang[k]) || d || k;
// a mesh from a vanilla block model by name ('block/item_frame'), cached
Renderer.prototype.namedMesh = function (name) {
  if (!this._named) this._named = new Map();
  if (this._named.has(name)) return this._named.get(name);
  let mb = null;
  if (typeof VM !== 'undefined' && VM.ready) {
    const i = VM.data.models.findIndex(m => m.name === name);
    if (i >= 0) {
      const quads = VM.bake(i); mb = new MeshBuffer(quads.length * 4 + 4);
      for (const q of quads) { const sh = q.shade ? (q.dir >= 0 ? FACE_SHADE[q.dir] : 0.85) : 1; for (let k = 0; k < 4; k++) mb.v(q.p[k][0], q.p[k][1], q.p[k][2], q.uv[k][0], q.uv[k][1], q.layer, 0, 255, 255, 255, Math.round(sh * 255), 255, 255, q.anim); }
    }
  }
  this._named.set(name, mb);
  return mb;
};
// an item shown in a fixed place (item frames, armor stand hands use the hand code): flat items half a block, blocks a quarter
Game.prototype.drawItemFixed = function (st, m, l, env) {
  const def = ITEMS[st.id], r = this.renderer; if (!def) return;
  const b = def.block !== undefined ? BLOCKS[def.block] : null, vim = r.itemModel(st.id);
  const flat = vim ? (vim.gen || !b) : (!b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door);
  const mm = new Float32Array(m);
  if (flat) {
    const stTex = itemStateTex ? itemStateTex(st, null) : null;
    const layer = stTex ? T(stTex) : vim && vim.gen && vim.model.layers && vim.model.layers.length ? T(vim.model.layers[0]) : b ? (def.flat ? T(def.flat) : b.tex[0]) : def.tex;
    M4.scale(mm, 0.5, 0.5, 0.5); M4.translate(mm, -0.5, -0.5, -1 / 32);
    r.drawMesh(this.spriteMesh(layer), mm, env, l);
  } else {
    M4.scale(mm, 0.25, 0.25, 0.25); M4.rotY(mm, Math.PI); M4.translate(mm, -0.5, -0.5, -0.5);
    if (vim && vim.mesh && !b.bed) r.drawMesh(vim.mesh, mm, env, l);
    else r.drawMesh(this.blockMesh(def.block, b.facing ? 4 : 0), mm, env, l);
  }
};
// the rotation that turns a -z facing model to face direction d (DIRS index)
function faceRot(m, d) {
  switch (d) { case 5: M4.rotY(m, Math.PI); break; case 1: M4.rotY(m, -Math.PI / 2); break; case 0: M4.rotY(m, Math.PI / 2); break; case 3: M4.rotX(m, Math.PI / 2); break; case 2: M4.rotX(m, -Math.PI / 2); break; }
}
const DIR_NAME = ['west', 'east', 'down', 'up', 'north', 'south'];

// ---- things hanging on a block face ----------------------------------------------------------------------------
class Hanging extends Entity {
  constructor(g, x, y, z, face) { super(g, x, y, z, 0.5, 0.5); this.block = [x, y, z]; this.face = face ?? 4 /* (0 is west) */; this.keepSaved = true; this.hittable = true; this.place(); }
  get support() { const D = DIRS[this.face]; return [this.block[0] - D[0], this.block[1] - D[1], this.block[2] - D[2]]; }
  place() { const D = DIRS[this.face], [x, y, z] = this.block; this.pos = [x + 0.5 - D[0] * 0.46875, y + (D[1] ? 0.5 - D[1] * 0.46875 : 0.5) - this.h / 2, z + 0.5 - D[2] * 0.46875]; this.prev = [...this.pos]; }
  saveData() { return { b: this.block, f: this.face, ...(this.more ? this.more() : {}) }; }
  loadData(o) { if (!o) return; this.block = o.b; this.face = o.f; this.place(); if (this.load) this.load(o); }
  survives() { const [x, y, z] = this.support; return !!BLOCKS[this.world.getBlock(x, y, z)].solid; }
  tick() { this.savePrev(); this.age++; if (this.age % 100 === 0 && !this.survives()) this.breakOff(null); }
  breakOff(src) { this.dead = true; if (!(src && src.attacker === this.game.player && this.game.mode === 'creative')) this.game.dropItem(this.pos[0], this.pos[1], this.pos[2], makeStack(this.type, 1)); if (this.onBreak) this.onBreak(src); }
}
// ---- item frames --------------------------------------------------------------------------------------------
class ItemFrame extends Hanging {
  constructor(g, x, y, z, face, glow) { super(g, x, y, z, face); this.type = glow ? 'glow_item_frame' : 'item_frame'; this.item = null; this.rot = 0; this.w = 0.75; this.h = 0.75; this.place(); }
  more() { return { it: this.item, r: this.rot, t: this.type }; }
  load(o) { this.item = o.it || null; this.rot = o.r | 0; if (o.t) this.type = o.t; }
  interact(p, held) {
    const g = this.game;
    if (!this.item) { if (!held) return false; this.item = { ...held, count: 1 }; useOne(g, p); Sound.ev('entity.' + this.type + '.add_item', this.pos, 1, 1); return true; }
    this.rot = (this.rot + 1) % 8; Sound.ev('entity.' + this.type + '.rotate_item', this.pos, 1, 1);
    for (const [x, y, z] of [this.support]) if (g.world && typeof RS !== 'undefined') { RS.wake && RS.wake(g, x, y, z); }
    return true;
  }
  hurt(a, src) {
    if (this.item) { if (!(src && src.attacker === this.game.player && this.game.mode === 'creative')) this.game.dropItem(this.pos[0], this.pos[1], this.pos[2], this.item); this.item = null; Sound.ev('entity.' + this.type + '.remove_item', this.pos, 1, 1); return true; }
    Sound.ev('entity.' + this.type + '.break', this.pos, 1, 1); this.breakOff(src); return true;
  }
  // comparators behind a frame read its rotation
  get comparator() { return this.item ? this.rot + 1 : 0; }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, isMap = !!this.item && !!ITEMS[this.item.id] && ITEMS[this.item.id].key === 'filled_map', glow = this.type === 'glow_item_frame';
    const D = DIRS[this.face], [bx, by, bz] = this.block;
    const m = M4.create(); M4.translate(m, bx + 0.5, by + 0.5, bz + 0.5); faceRot(m, this.face);
    const lt = glow ? [1, 1] : l;
    if (!this.invisible) { const mb = r.namedMesh('block/' + this.type + (isMap ? '_map' : '')); if (mb) { const mm = M4.copy(m); M4.translate(mm, -0.5, -0.5, -0.5); r.drawMesh(mb, mm, env, l); } }
    if (!this.item) return;
    const im = M4.copy(m); M4.translate(im, 0, 0, 0.5 - 1 / 16 - 0.01);
    M4.rotZ(im, this.rot * Math.PI / 4 * (isMap ? 2 : 1)); // clockwise as seen from the front
    if (isMap && g.drawMapInFrame) { g.drawMapInFrame(this.item, im, lt, env); return; }
    M4.rotY(im, Math.PI);
    g.drawItemFixed(this.item, im, lt, env);
  }
}
// ---- paintings -----------------------------------------------------------------------------------------------
const PAINTINGS = Object.entries(EXTRA.painting_variant || {}).map(([k, v]) => ({ key: k, w: v.width, h: v.height, asset: String(v.asset_id).replace('minecraft:', ''), title: zhT('painting.minecraft.' + k + '.title', k), author: zhT('painting.minecraft.' + k + '.author', '') }));
// the ones a player can get from placing a painting (vanilla tag: placeable) - the newer and hidden ones are left out
const PAINTING_PLACEABLE = new Set(['kebab', 'aztec', 'alban', 'aztec2', 'bomb', 'plant', 'wasteland', 'pool', 'courbet', 'sea', 'sunset', 'creebet', 'wanderer', 'graham', 'match', 'bust', 'stage', 'void', 'skull_and_roses', 'wither', 'fighters', 'pointer', 'pigscene', 'burning_skull', 'skeleton', 'donkey_kong', 'baroque', 'humble', 'meditative', 'prairie_ride', 'unpacked', 'backyard', 'bouquet', 'cavebird', 'changing', 'cotan', 'endboss', 'fern', 'finding', 'lowmist', 'orb', 'owlemons', 'passage', 'pond', 'sunflowers', 'tides']);
class Painting extends Hanging {
  constructor(g, x, y, z, face, v) { super(g, x, y, z, face); this.type = 'painting'; this.v = v || PAINTINGS[0]; this.resize(); }
  resize() { const v = this.v || { w: 1, h: 1 }; this.w = Math.max(v.w, 0.0625); this.h = v.h; this.place(); }
  place() {
    const D = DIRS[this.face], [x, y, z] = this.block, v = this.v || { w: 1, h: 1 };
    // the art is centred on the block, offset by half a block for even sizes (vanilla)
    const ox = v.w % 2 === 0 ? 0.5 : 0, oy = v.h % 2 === 0 ? 0.5 : 0;
    const side = [D[2], 0, -D[0]];
    this.center = [x + 0.5 - D[0] * 0.46875 + side[0] * -ox, y + 0.5 + oy, z + 0.5 - D[2] * 0.46875 + side[2] * -ox];
    this.pos = [this.center[0], this.center[1] - v.h / 2, this.center[2]]; this.prev = [...this.pos];
  }
  more() { return { v: this.v && this.v.key }; }
  load(o) { this.v = PAINTINGS.find(p => p.key === o.v) || PAINTINGS[0]; this.resize(); }
  hurt(a, src) { Sound.ev('entity.painting.break', this.pos, 1, 1); this.breakOff(src); return true; }
  survives() { return paintingFits(this.world, this.block, this.face, this.v, this); }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, v = this.v; if (!v) return;
    const tex = r.etex('painting/' + v.asset), back = r.etex('painting/back'); if (!tex) return;
    const m = M4.create(); M4.translate(m, this.center[0], this.center[1], this.center[2]); faceRot(m, this.face);
    const T2 = r.progTex, gl = r.gl, L = Math.max(l[0], l[1] * env.day) * 0.85 + 0.15;
    const quad = (texKey, mm, sh) => { gl.useProgram(T2.p); gl.uniformMatrix4fv(T2.u.u_vp, false, r.vp); gl.uniformMatrix4fv(T2.u.u_model, false, mm); gl.uniform4f(T2.u.u_color, sh, sh, sh, 1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.entityTex[texKey]); gl.bindVertexArray(r.quadVao); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0); };
    gl.disable(gl.CULL_FACE);
    // the quad helper lies flat (xz); stand it up facing -z
    const f = M4.copy(m); M4.translate(f, 0, 0, -1 / 32); M4.rotX(f, -Math.PI / 2); M4.rotZ(f, Math.PI); M4.scale(f, -v.w / 2, 1, v.h / 2); quad(tex, f, L);
    if (back) { const b2 = M4.copy(m); M4.translate(b2, 0, 0, 1 / 32); M4.rotX(b2, -Math.PI / 2); M4.scale(b2, v.w / 2, 1, v.h / 2); quad(back, b2, L * 0.7); }
    gl.enable(gl.CULL_FACE);
  }
}
// does a painting of variant v fit on face d of the block before `block` (wall behind, nothing in front)?
function paintingFits(w, block, face, v, self) {
  if (face === 2 || face === 3) return false;
  const D = DIRS[face], side = [D[2], 0, -D[0]], [x, y, z] = block;
  const x0 = -Math.floor((v.w - 1) / 2) - (v.w % 2 === 0 ? 1 : 0) * 0, y0 = -Math.floor((v.h - 1) / 2);
  for (let i = 0; i < v.w; i++) for (let j = 0; j < v.h; j++) {
    const k = x0 + i - (v.w % 2 === 0 ? v.w / 2 - Math.floor((v.w - 1) / 2) - 1 : 0), yy = y + y0 + j;
    const bx = x + side[0] * -k, bz = z + side[2] * -k;
    if (!BLOCKS[w.getBlock(bx - D[0], yy, bz - D[2])].solid) return false;
    const id = w.getBlock(bx, yy, bz); if (id && !BLOCKS[id].replaceable) return false;
  }
  return true;
}
// ---- armor stands --------------------------------------------------------------------------------------------
class ArmorStand extends Entity {
  constructor(g, x, y, z) { super(g, x, y, z, 0.5, 1.975); this.type = 'armor_stand'; this.keepSaved = true; this.hittable = true; this.gear = [null, null, null, null, null, null]; this.lastHit = -100; this.wobble = 0; this.small = false; this.arms = false; this.bodyYaw = 0; }
  saveData() { return { g: this.gear, s: this.small, a: this.arms, y: this.yaw }; }
  loadData(o) { if (!o) return; this.gear = o.g || this.gear; this.small = !!o.s; this.arms = !!o.a; if (o.y !== undefined) this.yaw = o.y; }
  tick() {
    this.savePrev(); this.age++;
    if (this.wobble > 0) this.wobble--;
    this.vel[1] -= 0.04; this.move(0, this.vel[1], 0); this.vel[1] *= 0.98; if (this.onGround) this.vel[1] = 0;
  }
  // which slot a click at height y aims at: feet / legs / chest / head
  slotAt(y) { const h = (y - this.pos[1]) / (this.small ? 0.5 : 1); return h >= 1.6 ? 3 : h >= 0.9 ? 2 : h >= 0.4 ? 1 : 0; }
  interact(p, held) {
    const g = this.game;
    if (held) {
      const d = ITEMS[held.id]; if (!d) return false; // (an id not in ITEMS: nothing, instead of throwing)
      const ar = d.armor;
      const slot = ar ? 3 - ar.slot : /_(head|skull)$|^carved_pumpkin$/.test(d.key) ? 3 : this.arms ? 4 : -1;
      if (slot < 0) return false;
      const old = this.gear[slot];
      this.gear[slot] = { ...held, count: 1 }; useOne(g, p);
      if (old) { if (g.mode !== 'creative') { if (p.inv.held) p.inv.add(old) && g.dropItem(p.pos[0], p.pos[1], p.pos[2], old); else p.inv.slots[p.inv.sel] = old; } }
      Sound.ev('entity.armor_stand.place', this.pos, 0.5, 1.3); return true;
    }
    const hd = Math.hypot(this.pos[0] - p.pos[0], this.pos[2] - p.pos[2]), hit = p.pos[1] + p.eye() + Math.tan(p.pitch) * hd;
    let slot = this.slotAt(hit);
    if (!this.gear[slot]) slot = this.gear.findIndex(s => s);
    if (slot < 0) return false;
    p.inv.slots[p.inv.sel] = this.gear[slot]; this.gear[slot] = null; return true;
  }
  hurt(a, src) {
    const g = this.game;
    if (src && src.attacker === g.player && g.mode === 'creative') { this.dead = true; Sound.ev('entity.armor_stand.break', this.pos, 1, 1); return true; }
    if (this.age - this.lastHit < 5) {
      this.dead = true; Sound.ev('entity.armor_stand.break', this.pos, 1, 1);
      g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('armor_stand', 1));
      for (const s of this.gear) if (s) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], s);
      for (let i = 0; i < 10; i++) g.particles.spawn('block', this.pos[0] + (Math.random() - 0.5) * 0.4, this.pos[1] + Math.random() * 1.8, this.pos[2] + (Math.random() - 0.5) * 0.4, 0, 0.05, 0, { id: BID.oak_planks || 5 });
    } else { this.lastHit = this.age; this.wobble = 5; Sound.ev('entity.armor_stand.hit', this.pos, 1, 1); }
    return true;
  }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, base = this.small ? 'armor_stand_small' : 'armor_stand', md = EM.get(r, base + '#main'), tex = r.etex('entity/armorstand/armorstand');
    if (!md || !tex) return;
    EM.reset(md);
    const P = md.parts, D = Math.PI / 180;
    // vanilla's default pose
    if (P.left_arm) { P.left_arm.xRot = -10 * D; P.left_arm.zRot = -10 * D; P.left_arm.visible = this.arms; }
    if (P.right_arm) { P.right_arm.xRot = -15 * D; P.right_arm.zRot = 10 * D; P.right_arm.visible = this.arms; }
    if (P.left_leg) { P.left_leg.xRot = -1 * D; P.left_leg.zRot = -1 * D; } if (P.right_leg) { P.right_leg.xRot = 1 * D; P.right_leg.zRot = 1 * D; }
    if (P.base_plate) P.base_plate.yRot = 0;
    const m = M4.create(); M4.translate(m, ip[0], ip[1], ip[2]); M4.rotY(m, this.yaw + (this.wobble > 0 ? Math.sin((this.wobble - a) / 1.5 * Math.PI) * 0.15 : 0));
    const att = {};
    if (this.gear[4]) { const st = this.gear[4]; att.right_arm = (am) => g.drawHeldItem(am, st, false, l, env, this, null); }
    if (this.gear[5]) { const st = this.gear[5]; att.left_arm = (am) => g.drawHeldItem(am, st, true, l, env, this, null); }
    r.drawEM(md, tex, m, l, env, { attach: att, cull: false });
    const fake = { layerKey: () => base + '#main', armorItems: [this.gear[3], this.gear[2], this.gear[1], this.gear[0]] };
    if (fake.armorItems.some(s => s)) drawVArmor(g, r, fake, md, m, l, env, null);
  }
}
// placing them (and frames, paintings) from items; recreated from saves by type
(() => {
  const prev = createMob;
  createMob = function (game, type, x, y, z) {
    if (type === 'item_frame' || type === 'glow_item_frame') return new ItemFrame(game, Math.floor(x), Math.floor(y), Math.floor(z), 4, type === 'glow_item_frame');
    if (type === 'painting') return new Painting(game, Math.floor(x), Math.floor(y), Math.floor(z), 4, null);
    if (type === 'armor_stand') return new ArmorStand(game, x, y, z);
    if (type === 'leash_knot') { const k = new LeashKnot(game, Math.floor(x), Math.floor(y), Math.floor(z)); k.keepSaved = true; k.type = 'leash_knot'; return k; }
    return prev(game, type, x, y, z);
  };
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, w = this.world, held = p.inv.held, t = this.target, k = held && ITEMS[held.id] && ITEMS[held.id].key;
    if (t && !this.targetEntity && (k === 'item_frame' || k === 'glow_item_frame' || k === 'painting' || k === 'armor_stand')) {
      const D = DIRS[t.face], x = t.pos[0] + D[0], y = t.pos[1] + D[1], z = t.pos[2] + D[2];
      if (k === 'armor_stand') {
        if (t.face !== 3 || (w.getBlock(x, y, z) && !BLOCKS[w.getBlock(x, y, z)].replaceable)) return;
        const s = new ArmorStand(this, x + 0.5, y, z + 0.5); s.yaw = Math.round((p.yaw + Math.PI) / (Math.PI / 4)) * Math.PI / 4;
        if (held.name) s.customName = held.name;
        this.entities.push(s); Sound.ev('entity.armor_stand.place', s.pos, 0.75, 0.8); useOne(this, p); p.swing(); return;
      }
      if (this.entities.some(e => e instanceof Hanging && !e.dead && e.block[0] === x && e.block[1] === y && e.block[2] === z && e.face === t.face)) return;
      if (k === 'painting') {
        const fits = PAINTINGS.filter(v => PAINTING_PLACEABLE.has(v.key) && paintingFits(w, [x, y, z], t.face, v));
        if (!fits.length) return;
        const best = Math.max(...fits.map(v => v.w * v.h)), pool = fits.filter(v => v.w * v.h === best);
        const pt = new Painting(this, x, y, z, t.face, held.pv ? PAINTINGS.find(v => v.key === held.pv) || pool[0] : pool[(Math.random() * pool.length) | 0]);
        this.entities.push(pt); Sound.ev('entity.painting.place', pt.pos, 1, 1);
      } else {
        const f = new ItemFrame(this, x, y, z, t.face, k === 'glow_item_frame');
        if (!f.survives()) return;
        this.entities.push(f); Sound.ev('entity.' + k + '.place', f.pos, 1, 1);
      }
      useOne(this, p); p.swing(); return;
    }
    return _use.call(this);
  };
})();

// ---- banner patterns ---------------------------------------------------------------------------------------------
const BANNER_PATTERNS = Object.keys(EXTRA.banner_pattern || {});
const PATTERN_ITEM = { flower_banner_pattern: 'flower', creeper_banner_pattern: 'creeper', skull_banner_pattern: 'skull', mojang_banner_pattern: 'mojang', globe_banner_pattern: 'globe',
  piglin_banner_pattern: 'piglin', flow_banner_pattern: 'flow', guster_banner_pattern: 'guster', field_masoned_banner_pattern: 'bricks', bordure_indented_banner_pattern: 'curly_border' };
const PATTERN_NEEDS_ITEM = new Set(Object.values(PATTERN_ITEM));
const patternName = (p, color) => zhT('block.minecraft.banner.' + p + '.' + color, p);
const bannerColor = (key) => key.replace(/_(wall_)?banner$/, '');
// the banner cloth: the base colour and its patterns painted over it (banners use entity/banner, shields entity/shield)
Renderer.prototype.patternTex = function (dir, base, patterns) {
  return this.etexMix([{ p: 'entity/' + dir + '/base', c: dyeRGB(base) }, ...(patterns || []).map(([pat, col]) => ({ p: 'entity/' + dir + '/' + pat, c: dyeRGB(col) }))]);
};
// banners in the world: their patterns live in the block entity (placed from a stack with patterns)
(() => {
  const _bp = beParts;
  beParts = function (r, b, m, x, y, z) {
    const parts = _bp(r, b, m, x, y, z);
    if (b.be === 'banner' || b.be === 'wall_banner') {
      const be = window.game && game.blockEntities && game.blockEntities.get(x + ',' + y + ',' + z);
      if (be && be.patterns && be.patterns.length) {
        const t = r.patternTex('banner', bannerColor(b.key), be.patterns);
        if (t) for (const p of parts) if (p[0] === 'be_banner_flag') { p[1] = t; if (p[3]) p[3] = { ...p[3], tint: null }; }
      }
    }
    return parts;
  };
  // drawBE takes textures through beTex: let mixed ones through
  const _bt = Renderer.prototype.beTex;
  Renderer.prototype.beTex = function (k) { if (k && k[0] === '@') return this.entityTex[k] ? k : null; return _bt.call(this, k); };
  // placing a banner keeps its patterns; breaking it drops them
  const _pa = Game.prototype.placeAt;
  Game.prototype.placeAt = function (x, y, z, id, meta, held, ...rest) {
    const r = _pa.call(this, x, y, z, id, meta, held, ...rest);
    const b = BLOCKS[this.world.getBlock(x, y, z)];
    if (b && /banner$/.test(b.key) && held && held.patterns) { const be = this.getBlockEntity(x, y, z, 'banner'); be.patterns = held.patterns.map(p => [...p]); if (held.name) be.name = held.name; }
    if (b && /sign$/.test(b.key) && !this.net && this.openSignEditor) setTimeout(() => this.openSignEditor(x, y, z, true), 0);
    return r;
  };
  const _db = Game.prototype.dropBlockLoot;
  Game.prototype.dropBlockLoot = function (x, y, z, id, meta, tool, ...rest) {
    const b = BLOCKS[id], k = x + ',' + y + ',' + z;
    if (b && /banner$/.test(b.key)) {
      const be = this.blockEntities.get(k);
      if (be && be.patterns && be.patterns.length) {
        this.blockEntities.delete(k);
        const st = makeStack(bannerColor(b.key) + '_banner', 1); st.patterns = be.patterns; if (be.name) st.name = be.name;
        this.dropItem(x + 0.5, y + 0.5, z + 0.5, st); return;
      }
    }
    if (b && /sign$/.test(b.key)) { this.blockEntities.delete(k); this.signs.delete(k); }
    return _db.call(this, x, y, z, id, meta, tool, ...rest);
  };
})();
// ---- the loom ------------------------------------------------------------------------------------------------------------
class LoomScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_loom', title || '织布机', pos);
    this.sel = -1; this.scroll = 0;
    this.own(0, 13, 26, { accept: (s) => /_banner$/.test(ITEMS[s.id].key), emptyIcon: 'slot_banner' });
    this.own(1, 33, 26, { accept: (s) => /_dye$/.test(ITEMS[s.id].key), emptyIcon: 'slot_dye' });
    this.own(2, 23, 45, { accept: (s) => !!PATTERN_ITEM[ITEMS[s.id].key], emptyIcon: 'slot_banner_pattern', max: 1 });
    this.slots.push({ x: 143, y: 58, output: true, get: () => this.result, set: () => { }, onTake: () => this.take() });
    this.addPlayerSlots(84, 142);
    this.changed();
  }
  // the choices in vanilla's order (its tags): the pattern item's own, or the ones that need no item
  patterns() {
    const T = (ENTITY_DATA.extra && ENTITY_DATA.extra.tags) || {}, it = this.S(2), key = it && ITEMS[it.id].key, k = key && PATTERN_ITEM[key];
    const tag = (n) => T['banner_pattern:' + n] && T['banner_pattern:' + n].map(x => x.replace('minecraft:', ''));
    if (k) return tag('pattern_item/' + key.replace(/_banner_pattern$/, '')) || [k];
    return tag('no_item_required') || BANNER_PATTERNS.filter(p => p !== 'base' && !PATTERN_NEEDS_ITEM.has(p));
  }
  changed() {
    const ban = this.S(0), dye = this.S(1), list = this.patterns();
    if (this.sel >= list.length) this.sel = -1;
    if (list.length === 1 && this.S(2)) this.sel = 0;
    this.result = null;
    if (ban && dye && this.sel >= 0 && (ban.patterns || []).length < 6) {
      this.result = { ...ban, count: 1, patterns: [...(ban.patterns || []), [list[this.sel], ITEMS[dye.id].key.replace(/_dye$/, '')]] };
    }
  }
  pick(i) { this.sel = i; this.changed(); }
  take() {
    for (const i of [0, 1]) { const s = this.held[i]; if (s) { s.count--; if (!s.count) this.held[i] = null; } }
    Sound.ev('ui.loom.take_result', null, 1, 1); this.changed();
  }
  cell(i) { const j = i - this.scroll * 4; return { x: this.x + 60 + (j % 4) * 14, y: this.y + 13 + Math.floor(j / 4) * 14, w: 14, h: 14 }; }
  mouseDown(ui, mx, my, button, shift) {
    if (this.S(0) && this.S(1)) {
      const list = this.patterns();
      for (let i = this.scroll * 4; i < Math.min(list.length, this.scroll * 4 + 16); i++) if (ui.hit(this.cell(i), mx, my)) { this.pick(i); Sound.ev('ui.loom.select_pattern', null, 1, 1); return; }
    }
    super.mouseDown(ui, mx, my, button, shift);
  }
  wheel(ui, d) { this.scroll = clamp(this.scroll + Math.sign(d), 0, Math.max(0, Math.ceil(this.patterns().length / 4) - 4)); }
  drawMore(ui) {
    const c = ui.ctx, r = this.game.renderer, ban = this.S(0), dye = this.S(1);
    const list = this.patterns(), ok = ban && dye && (ban.patterns || []).length < 6;
    if (ban && (ban.patterns || []).length >= 6) ui.sprite('loom_error', this.x + 133, this.y + 16);
    if (ok) for (let i = this.scroll * 4; i < Math.min(list.length, this.scroll * 4 + 16); i++) {
      const cl = this.cell(i);
      ui.sprite(i === this.sel ? 'loom_pattern_selected' : ui.hit(cl) ? 'loom_pattern_highlighted' : 'loom_pattern', cl.x, cl.y);
      drawPatternPreview(ui, r, 'white', [[list[i], ITEMS[dye.id].key.replace(/_dye$/, '')]], cl.x + 4, cl.y + 2, 5, 10, true);
    }
    ui.sprite(list.length > 16 ? 'loom_scroller' : 'loom_scroller_disabled', this.x + 119, this.y + 13 + (list.length > 16 ? Math.floor(this.scroll / Math.max(1, Math.ceil(list.length / 4) - 4) * 41) : 0));
    // the banner as it would come out
    const show = this.S(3) || ban; // (the result slot: this screen's or the server's)
    if (show) drawPatternPreview(ui, r, bannerColor(ITEMS[show.id].key), show.patterns || [], this.x + 141, this.y + 8, 20, 40, false);
  }
}
// a small picture of a banner's cloth (from the banner texture's front face: 20 x 40 px at 1,1)
function drawPatternPreview(ui, r, base, patterns, x, y, w, h, onlyPattern) {
  const key = r.patternTex('banner', onlyPattern ? 'gray' : base, patterns);
  const im = key && r.mixCanvas && r.mixCanvas.get(key);
  if (!im) return;
  ui.ctx.imageSmoothingEnabled = false;
  ui.ctx.drawImage(im, 1, 1, 20, 40, x, y, w, h);
}
// keep the mixed canvases for screens to draw from
(() => {
  const _mix = Renderer.prototype.etexMix;
  Renderer.prototype.etexMix = function (layers) {
    const k = _mix.call(this, layers);
    if (k && !(this.mixCanvas && this.mixCanvas.has(k))) {
      // rebuild the canvas once for screens (cheap: banner textures are 64 x 64)
      const ims = layers.map(l => this.images['@' + (typeof l === 'string' ? l : l.p)]);
      if (ims.every(Boolean)) {
        const c = document.createElement('canvas'); c.width = ims[0].width; c.height = ims[0].height; const x = c.getContext('2d');
        layers.forEach((l, i) => { const t = document.createElement('canvas'); t.width = ims[i].width; t.height = ims[i].height; const tx = t.getContext('2d'); tx.drawImage(ims[i], 0, 0); if (l.c) { const d = tx.getImageData(0, 0, t.width, t.height); for (let q = 0; q < d.data.length; q += 4) { d.data[q] *= l.c[0]; d.data[q + 1] *= l.c[1]; d.data[q + 2] *= l.c[2]; } tx.putImageData(d, 0, 0); } x.drawImage(t, 0, 0, c.width, c.height); });
        (this.mixCanvas || (this.mixCanvas = new Map())).set(k, c);
      }
    }
    return k;
  };
})();
if (typeof WORKSTATIONS !== 'undefined') { WORKSTATIONS.loom = (g, pos, b) => new LoomScreen(g, pos, b.cn); if (BID.loom !== undefined) BLOCKS[BID.loom].onUse = 'loom'; }
// banner and shield tooltips list the patterns
(() => {
  const _il = UI.prototype.itemLines;
  UI.prototype.itemLines = function (st) {
    const lines = _il.call(this, st);
    if (st && st.patterns && st.patterns.length) for (const [p, c] of st.patterns) lines.splice(1, 0, { text: patternName(p, c), color: '#AAAAAA' });
    // (an id not in ITEMS - telemetry 11-02/03 - has no painting line, instead of throwing)
    if (st && st.pv && ITEMS[st.id] && ITEMS[st.id].key === 'painting') { const v = PAINTINGS.find(q => q.key === st.pv); if (v) lines.push({ text: v.title, color: '#FFFF55' }, { text: v.author, color: '#AAAAAA' }); }
    return lines;
  };
})();

// ---- signs: the editing screen, dyes and wax --------------------------------------------------------------------------------
const signSideKey = (g, x, y, z) => {
  const w = g.world, b = BLOCKS[w.getBlock(x, y, z)], st = (b.states && b.states[w.getMeta(x, y, z)]) || {}, p = g.player;
  if (b.key.includes('wall') && !b.key.includes('hanging')) return 'f';
  const deg = st.rotation !== undefined ? +st.rotation * 22.5 : FACING_DEG[st.facing] ?? 0;
  // the front faces the way the board's text faces (vanilla angle 0 = south)
  const a = deg * Math.PI / 180, fx = -Math.sin(a), fz = Math.cos(a);
  return (p.pos[0] - x - 0.5) * fx + (p.pos[2] - z - 0.5) * fz >= 0 ? 'f' : 'b';
};
Game.prototype.signAt = function (x, y, z) {
  const k = x + ',' + y + ',' + z;
  let t = this.signs.get(k);
  if (!t) { const be = this.getBlockEntity(x, y, z, 'sign'); be.text = be.text || { f: { l: ['', '', '', ''], c: 'black', g: false }, b: { l: ['', '', '', ''], c: 'black', g: false } }; t = be.text; this.signs.set(k, t); }
  return t;
};
Game.prototype.openSignEditor = function (x, y, z, front) {
  if (!/sign$/.test(BLOCKS[this.world.getBlock(x, y, z)].key)) return;
  const t = this.signAt(x, y, z), side = front === true ? 'f' : front || signSideKey(this, x, y, z);
  this.ui.open(new SignScreen(this, [x, y, z], t[side]));
};
class SignScreen {
  constructor(game, pos, side) { this.game = game; this.pos = pos; this.side = side; this.line = 0; const b = BLOCKS[game.world.getBlock(...pos)]; this.wood = b.key.replace(/_(wall_)?(hanging_)?sign$/, ''); this.hanging = b.key.includes('hanging'); }
  layout() { const u = this.game.ui; this.x = Math.floor(u.w / 2); this.y = 40; this.edit(); }
  edit() {
    const u = this.game.ui, s = this;
    u.showInput(this.x - 45, this.y + 40 + this.line * 10, 90, 10, this.side.l[this.line], () => { s.line = (s.line + 1) % 4; s.edit(); }, { max: 15, onInput: (v) => { s.side.l[s.line] = v; }, onEsc: () => u.close() });
    const el = u.input, prev = el.onkeydown;
    el.onkeydown = (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); s.line = (s.line + (e.key === 'ArrowUp' ? 3 : 1)) % 4; s.edit(); return; } prev(e); };
  }
  close() { this.game.ui.hideInput(); this.game.flushMesh && this.game.flushMesh(); if (this.onDone) this.onDone(); }
  key(ui, ev) { return true; }
  mouseDown(ui, mx, my) { if (ui.hit({ x: this.x - 100, y: this.y + 140, w: 200, h: 20 }, mx, my)) ui.close(); }
  draw(ui) {
    const c = ui.ctx, r = this.game.renderer;
    ui.dim(0.4);
    Font.center(c, '编辑告示牌信息', this.x, this.y, '#FFFFFF');
    // the board: the sign texture's front face, scaled up
    const im = r.images['@entity/signs/' + (this.hanging ? 'hanging/' : '') + this.wood];
    if (!im) r.etex('entity/signs/' + (this.hanging ? 'hanging/' : '') + this.wood);
    c.imageSmoothingEnabled = false;
    if (im) { if (this.hanging) c.drawImage(im, 0, 0, 16, 16, this.x - 48, this.y + 22, 96, 96); else c.drawImage(im, 2, 2, 24, 12, this.x - 60, this.y + 30, 120, 60); }
    else { c.fillStyle = '#9C7F4E'; c.fillRect(this.x - 60, this.y + 30, 120, 60); }
    const col = SIGN_TEXT_RGB[this.side.c] || '#000000';
    for (let i = 0; i < 4; i++) { if (i === this.line) continue; Font.center(c, this.side.l[i] || '', this.x, this.y + 41 + i * 10, col, false); }
    ui.drawInputText && ui.drawInputText();
    const done = { x: this.x - 100, y: this.y + 140, w: 200, h: 20 };
    ui.button({ ...done, label: '完成' });
  }
}
// dyes and the rest on a sign (vanilla SignApplicator items); otherwise a right click edits it unless it is waxed
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    // (a held id not in ITEMS, a block id not in BLOCKS - a server's: nothing of this, instead of throwing)
    const p = this.player, t = this.target, held = p.inv.held, k = held && ITEMS[held.id] && ITEMS[held.id].key;
    if (t && !this.targetEntity && !p.sneaking && BLOCKS[t.id] && /sign$/.test(BLOCKS[t.id].key) && !this.net) {
      const [x, y, z] = t.pos, s = this.signAt(x, y, z), side = s[signSideKey(this, x, y, z)];
      const pos = [x + 0.5, y + 0.5, z + 0.5];
      if (s.wax) { Sound.ev('block.sign.waxed_interact_fail', pos, 1, 1); p.swing(); return; }
      if (k && /_dye$/.test(k)) { const c = k.replace(/_dye$/, ''); if (side.c !== c) { side.c = c; useOne(this, p); Sound.ev('item.dye.use', pos, 1, 1); } p.swing(); return; }
      if (k === 'glow_ink_sac' && !side.g) { side.g = true; useOne(this, p); Sound.ev('item.glow_ink_sac.use', pos, 1, 1); p.swing(); return; }
      if (k === 'ink_sac' && side.g) { side.g = false; useOne(this, p); Sound.ev('item.ink_sac.use', pos, 1, 1); p.swing(); return; }
      if (k === 'honeycomb') { s.wax = true; useOne(this, p); Sound.ev('item.honeycomb.wax_on', pos, 1, 1); p.swing(); return; }
      this.openSignEditor(x, y, z); return;
    }
    return _use.call(this);
  };
  // signs written here are saved with the block entities: put them back on load
  const _ds = Game.prototype.drawSignTexts;
  Game.prototype.drawSignTexts = function (env) { return _ds.call(this, env); };
  const _dc = Game.prototype.drawChests;
  Game.prototype.drawChests = function (a, env) {
    if (this.blockEntities && this._signSync !== this.blockEntities) { this._signSync = this.blockEntities; for (const [k, be] of this.blockEntities) if (be.type === 'sign' && be.text) this.signs.set(k, be.text); }
    return _dc.call(this, a, env);
  };
})();
