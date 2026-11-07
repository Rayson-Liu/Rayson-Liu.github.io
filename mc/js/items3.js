'use strict';
// ---------------------------------------------------------------------------
// Items with systems of their own: bundles, fishing rods, maps (and the cartography table), books and quills,
// written books and lecterns, jukeboxes and music discs, spyglasses, goat horns, brushes on suspicious sand and
// gravel, trial keys with vaults and trial spawners; the wandering trader's vanilla trade lists.
// ---------------------------------------------------------------------------
const keyOf3 = (st) => st && ITEMS[st.id] ? ITEMS[st.id].key : '';
const LUCK = (st) => enchLevel(st, 'luck_of_the_sea') || 0;

// ---- bundles: hold up to a stack's worth of mixed items ------------------------------------------------------------------
const isBundle = (st) => !!st && /(^|_)bundle$/.test(keyOf3(st));
const bundleWeight = (st) => isBundle(st) ? 4 + (st.bundle || []).reduce((s, x) => s + bundleWeight(x) * (isBundle(x) ? 1 : 0) + (isBundle(x) ? 0 : 64 / maxStack(x.id) * x.count), 0) : 64 / maxStack(st.id) * st.count;
const bundleFill = (b) => (b.bundle || []).reduce((s, x) => s + (isBundle(x) ? bundleWeight(x) : 64 / maxStack(x.id) * x.count), 0);
// put as much of st as fits into bundle b; returns what is left (or the same stack)
function bundleInsert(b, st) {
  if (!st || isBundle(st) && st === b) return st;
  if (st.bundle && st.bundle.length && isBundle(st)) { /* bundles go in whole */ }
  const per = isBundle(st) ? bundleWeight(st) : 64 / maxStack(st.id), room = 64 - bundleFill(b), n = Math.min(st.count, Math.floor(room / per));
  if (n <= 0) return st;
  b.bundle = b.bundle || [];
  const same = b.bundle.find(x => sameKind(x, st) && x.count < maxStack(x.id) && !isBundle(x));
  if (same) { const k = Math.min(n, maxStack(same.id) - same.count); same.count += k; if (n > k) b.bundle.unshift({ ...st, count: n - k }); }
  else b.bundle.unshift({ ...st, count: n });
  Sound.ev('item.bundle.insert', null, 0.8, 0.8 + Math.random() * 0.4);
  return st.count - n > 0 ? { ...st, count: st.count - n } : null;
}
function bundleTake(b) { if (!b.bundle || !b.bundle.length) return null; const st = b.bundle.shift(); Sound.ev('item.bundle.remove_one', null, 0.8, 0.8 + Math.random() * 0.4); return st; }
(() => {
  const _cs = ContainerScreen.prototype.clickSlot;
  ContainerScreen.prototype.clickSlot = function (ui, s, button) {
    const st = s.get(), cur = ui.cursor;
    if (button === 2 && !s.output) {
      if (isBundle(cur) && st && !isBundle(st)) { const left = bundleInsert(cur, st); s.set(left); this.changed(); return; }
      if (isBundle(cur) && !st) { const out = bundleTake(cur); if (out) { s.set(out); this.changed(); } return; }
      if (isBundle(st) && cur) { const left = bundleInsert(st, cur); ui.cursor = left; this.changed(); return; }
      if (isBundle(st) && !cur && st.bundle && st.bundle.length) { ui.cursor = bundleTake(st); this.changed(); return; }
    }
    return _cs.call(this, ui, s, button);
  };
  const _il = UI.prototype.itemLines;
  UI.prototype.itemLines = function (st) {
    const lines = _il.call(this, st);
    if (isBundle(st)) {
      const c = st.bundle || [];
      for (const x of c.slice(0, 8)) lines.push({ text: (ITEMS[x.id] ? ITEMS[x.id].cn : '未知物品') + ' x' + x.count, color: '#AAAAAA' }); // (an id not in ITEMS: no throw)
      if (c.length > 8) lines.push({ text: '以及 ' + (c.length - 8) + ' 个物品…', color: '#AAAAAA' });
      const f = Math.round(bundleFill(st));
      lines.push({ text: c.length ? f + '/64' : '空', color: f >= 64 ? '#FF5555' : '#AAAAAA' });
    }
    return lines;
  };
})();

// ---- using things in the hand -------------------------------------------------------------------------------------------
(() => {
  const _ue = Game.prototype.useEquipment;
  Game.prototype.useEquipment = function (held, def) {
    const p = this.player, k = def && def.key;
    if (!k) return _ue.call(this, held, def);
    if (isBundle(held) && held.bundle && held.bundle.length && !this.target) {
      // empties out in front of the player
      for (const st of held.bundle) this.dropFromPlayer(st);
      held.bundle = []; Sound.ev('item.bundle.drop_contents', p.pos, 0.8, 1); p.swing(); return true;
    }
    if (k === 'fishing_rod') { this.useRod(held); return true; }
    if (k === 'spyglass') { this.startUsing(held, 'main'); Sound.ev('item.spyglass.use', p.pos, 1, 1); return true; }
    if (k === 'goat_horn') {
      if ((p.cooldowns || {})[k] > this.tickCount) return true;
      const ins = EXTRA.instrument && EXTRA.instrument[(held.instrument || 'ponder_goat_horn').replace('minecraft:', '')];
      Sound.ev(ins ? ins.sound_event.replace('minecraft:', '') : 'item.goat_horn.sound.0', p.pos, 16, 1);
      (p.cooldowns || (p.cooldowns = {}))[k] = this.tickCount + 140; this.startUsing(held, 'main'); return true;
    }
    if (k === 'brush' && this.target) { this.startUsing(held, 'main'); return true; }
    if (k === 'map') { this.newMap(held); return true; }
    if (k === 'writable_book') { this.ui.open(new BookScreen(this, held, true)); return true; }
    if (k === 'written_book') { this.ui.open(new BookScreen(this, held, false)); return true; }
    if (k === 'knowledge_book') { useOne(this, p); this.ui.actionBar = { text: '配方已解锁', t: performance.now(), color: '#FFFF55' }; return true; }
    return _ue.call(this, held, def);
  };
  const _ut = Game.prototype.usingTick;
  Game.prototype.usingTick = function (st) {
    const k = keyOf3(st), p = this.player;
    if (k === 'brush') this.brushTick(st);
    if (k === 'goat_horn' && p.useT > 140) p.usingItem = null;
    return _ut.call(this, st);
  };
  const _ru = Game.prototype.releaseUsing;
  Game.prototype.releaseUsing = function (st) {
    const k = keyOf3(st);
    if (k === 'spyglass') Sound.ev('item.spyglass.stop_using', this.player.pos, 1, 1);
    return _ru.call(this, st);
  };
  // the spyglass zooms in (vanilla: a tenth of the field of view) and shows its scope
  const _tf = Game.prototype.tickFov;
  Game.prototype.tickFov = function () { _tf.call(this); const p = this.player; if (p && p.usingItem === ITEM_KEY.spyglass && this.perspective === 0) this.fovMod = this.oFovMod + (0.1 - this.oFovMod) * 0.5; };
  const _hud = UI.prototype.drawHUD;
  UI.prototype.drawHUD = function () {
    const g = this.game, p = g.player;
    if (p && p.usingItem === ITEM_KEY.spyglass && g.perspective === 0) {
      const im = g.renderer.images['@misc/spyglass_scope'] || this.img.spyglass_scope;
      const s = Math.min(this.w, this.h), c = this.ctx;
      c.fillStyle = '#000'; c.fillRect(0, 0, (this.w - s) / 2 + 1, this.h); c.fillRect((this.w + s) / 2 - 1, 0, (this.w - s) / 2 + 1, this.h);
      if (im) { c.imageSmoothingEnabled = false; c.drawImage(im, (this.w - s) / 2, (this.h - s) / 2, s, s); }
      return;
    }
    return _hud.call(this);
  };
})();

// ---- fishing ------------------------------------------------------------------------------------------------------------------
class FishingHook extends Entity {
  constructor(g, owner, rod) {
    const p = owner, eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]];
    super(g, eye[0], eye[1], eye[2], 0.25, 0.25);
    const d = g.lookDir();
    this.owner = owner; this.rod = rod; this.vel = [d[0] * 1.5 + (Math.random() - 0.5) * 0.02, d[1] * 1.5 + 0.1, d[2] * 1.5 + (Math.random() - 0.5) * 0.02];
    this.wait = 0; this.nibble = 0; this.bite = 0; this.hooked = null; this.inWaterT = 0;
    const lure = enchLevel(rod, 'lure') || 0; this.lure = lure;
    this.resetWait();
  }
  resetWait() { this.wait = Math.max(20, randInt(100, 600) - this.lure * 100); this.nibble = 0; this.bite = 0; }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, o = this.owner, v = this.vel;
    if (o.dead || o.deathTime || !o.inv.held || keyOf3(o.inv.held) !== 'fishing_rod' || this.distTo(o) > 32) { this.dead = true; o.fishHook = null; return; }
    if (this.hooked) {
      if (this.hooked.dead) { this.hooked = null; return; }
      this.pos = [this.hooked.pos[0], this.hooked.pos[1] + this.hooked.h * 0.8, this.hooked.pos[2]]; return;
    }
    // hits an entity on the way
    if (!this.inWaterT) for (const e of g.entities) {
      if (e === this || e === o || !(e instanceof Living) || e.dead || e.deathTime) continue;
      const b = e.box();
      if (this.pos[0] > b[0] - 0.1 && this.pos[0] < b[3] + 0.1 && this.pos[1] > b[1] - 0.1 && this.pos[1] < b[4] + 0.1 && this.pos[2] > b[2] - 0.1 && this.pos[2] < b[5] + 0.1) { this.hooked = e; e.hurt(0.0001, { type: 'mob', attacker: o }); return; }
    }
    const x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1]), z = Math.floor(this.pos[2]), id = this.world.getBlock(x, y, z);
    const water = this.world.waterAt(x, y, z);
    if (water) {
      // float: bob at the surface
      const surf = y + 0.88;
      v[1] += (surf - this.pos[1]) * 0.1 - 0.02; v[0] *= 0.9; v[2] *= 0.9; v[1] *= 0.9;
      if (!this.inWaterT) Sound.ev('entity.fishing_bobber.splash', this.pos, 0.25, 1 + (Math.random() - 0.5) * 0.4);
      this.inWaterT++;
      this.openWater = true;
      this.fishTick(x, y, z);
    } else { v[1] -= 0.03; v[0] *= 0.92; v[1] *= 0.92; v[2] *= 0.92; this.inWaterT = 0; }
    this.move(v[0], v[1], v[2]);
  }
  fishTick(x, y, z) {
    const g = this.game;
    if (this.bite > 0) { if (--this.bite === 0) this.resetWait(); return; }
    if (this.nibble > 0) {
      // a fish swims in: bubbles toward the hook
      if (--this.nibble === 0) {
        this.vel[1] -= 0.2 * (0.6 + Math.random() * 0.4); this.bite = randInt(20, 40);
        Sound.ev('entity.fishing_bobber.splash', this.pos, 0.25, 1 + (Math.random() - 0.5) * 0.4);
        for (let i = 0; i < 8; i++) g.particles.spawn('bubble', this.pos[0] + (Math.random() - 0.5) * 0.3, this.pos[1], this.pos[2] + (Math.random() - 0.5) * 0.3, 0, 0.1, 0);
      } else if (Math.random() < 0.3) { const a = Math.random() * Math.PI * 2, d = this.nibble * 0.05; g.particles.spawn('splash', this.pos[0] + Math.sin(a) * d, this.pos[1] + 0.1, this.pos[2] + Math.cos(a) * d, 0, 0.05, 0); }
      return;
    }
    const sky = this.world.skyAt(x, y + 1, z) >= 15, rain = g.weather > 0.3 && sky;
    this.wait -= (rain && Math.random() < 0.25 ? 2 : 1) * (sky ? 1 : 0.5);
    if (this.wait <= 0) this.nibble = randInt(20, 80);
  }
  // reeled in: the catch, the hooked entity pulled in, or nothing
  retrieve() {
    const g = this.game, o = this.owner;
    let dmg = 0;
    if (this.hooked) { const e = this.hooked, dx = o.pos[0] - e.pos[0], dy = o.pos[1] - e.pos[1], dz = o.pos[2] - e.pos[2]; e.vel[0] += dx * 0.1; e.vel[1] += dy * 0.1 + Math.sqrt(Math.hypot(dx, dy, dz)) * 0.08; e.vel[2] += dz * 0.1; dmg = 5; }
    else if (this.bite > 0) {
      const out = rollLoot('gameplay/fishing', { e: this, luck: LUCK(this.rod), player: true });
      for (const st of out) {
        const it = new ItemEntity(g, this.pos[0], this.pos[1], this.pos[2], st, null);
        const dx = o.pos[0] - this.pos[0], dy = o.pos[1] - this.pos[1], dz = o.pos[2] - this.pos[2];
        it.vel = [dx * 0.1, dy * 0.1 + Math.sqrt(Math.hypot(dx, dy, dz)) * 0.08, dz * 0.1]; g.entities.push(it);
      }
      g.dropXp(o.pos[0], o.pos[1] + 0.5, o.pos[2] + 0.5, randInt(1, 6));
      if (g.stats) g.stats.fish = (g.stats.fish || 0) + 1;
      dmg = 1;
    } else if (this.onGround) dmg = 2;
    this.dead = true; o.fishHook = null;
    return dmg;
  }
  comp() { }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, gl = r.gl, tex = r.beTex('fishing_hook'); if (!tex) return;
    const cam = r.camPos, dx = cam[0] - ip[0], dz = cam[2] - ip[2], yaw = Math.atan2(dx, dz), pitch = Math.atan2(cam[1] - ip[1], Math.hypot(dx, dz));
    const m = M4.create(); M4.translate(m, ip[0], ip[1] + 0.1, ip[2]); M4.rotY(m, yaw); M4.rotX(m, -pitch); M4.rotX(m, Math.PI / 2); M4.scale(m, 0.25, 1, 0.25);
    const T2 = r.progTex; gl.useProgram(T2.p); gl.uniformMatrix4fv(T2.u.u_vp, false, r.vp); gl.uniformMatrix4fv(T2.u.u_model, false, m);
    const L = Math.max(l[0], l[1] * env.day) * 0.8 + 0.2; gl.uniform4f(T2.u.u_color, L, L, L, 1);
    gl.disable(gl.CULL_FACE); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.entityTex[tex]); gl.bindVertexArray(r.quadVao); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0); gl.enable(gl.CULL_FACE);
    // the line: from the rod's tip to the hook, sagging a little
    const o = this.owner, op = o.ipos ? o.ipos(a) : o.pos, yw = o.yaw, fp = g.perspective === 0 && o === g.player;
    const sx = op[0] - Math.sin(yw) * (fp ? 0.6 : 0.8) - Math.cos(yw) * (fp ? 0.35 : 0.4), sz = op[2] - Math.cos(yw) * (fp ? 0.6 : 0.8) + Math.sin(yw) * (fp ? 0.35 : 0.4), sy = op[1] + (fp ? o.eye() - 0.25 + Math.sin(o.pitch) * 0.6 : 1.9);
    const v = [], n = 16;
    for (let i = 0; i < n; i++) for (const t of [i / n, (i + 1) / n]) v.push(lerp(sx, ip[0], t), lerp(sy, ip[1] + 0.1, t) - Math.sin(t * Math.PI) * 0.15 * (this.inWaterT ? 1 : 0.3), lerp(sz, ip[2], t), 0, 0, 0, 1);
    r.drawLines(v, [0, 0, 0, 1]);
  }
}
Game.prototype.useRod = function (held) {
  const p = this.player;
  if (p.fishHook && !p.fishHook.dead) {
    const dmg = p.fishHook.retrieve();
    if (dmg && this.mode !== 'creative') this.damageHeld(dmg);
    Sound.ev('entity.fishing_bobber.retrieve', p.pos, 1, 0.4 / (Math.random() * 0.4 + 0.8));
  } else {
    p.fishHook = new FishingHook(this, p, held); this.entities.push(p.fishHook);
    Sound.ev('entity.fishing_bobber.throw', p.pos, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
  }
  p.swing();
};

// ---- maps --------------------------------------------------------------------------------------------------------------------------
const MAP_PAL = (EXTRA.mappalette || []).map(v => [(v >> 16) & 255, (v >> 8) & 255, v & 255, (v >>> 24) & 255]);
const mapColorOf = (id, meta) => { const b = BLOCKS[id]; if (!b) return 0; const c = EXTRA.mapcolors && EXTRA.mapcolors[b.key]; if (c == null) return b.solid ? 11 : 0; return Array.isArray(c) ? (c[meta] ?? c[0]) : c; };
Game.prototype.mapData = function (id) {
  const M = this.worldMeta.maps || (this.worldMeta.maps = {});
  const m = M[id]; if (!m) return null;
  if (!m.px) { m.px = new Uint8Array(16384); if (m.data) { const b = atob(m.data); for (let i = 0; i < b.length && i < 16384; i++) m.px[i] = b.charCodeAt(i); } }
  return m;
};
Game.prototype.newMap = function (held, scale = 0, src = null) {
  const p = this.player, M = this.worldMeta.maps || (this.worldMeta.maps = {});
  const id = (this.worldMeta.nextMap = (this.worldMeta.nextMap || 0) + 1) - 1;
  const size = 128 << scale;
  const cx = src ? src.cx : Math.floor((p.pos[0] + 64) / size) * size + size / 2 - 64, cz = src ? src.cz : Math.floor((p.pos[2] + 64) / size) * size + size / 2 - 64;
  M[id] = { cx, cz, scale, dim: this.dim || 'overworld', locked: false, px: new Uint8Array(16384) };
  if (!held) return id;
  const st = makeStack('filled_map', 1); st.mapId = id;
  swapHeld(this, p, 'filled_map', { mapId: id });
  Sound.ev('ui.cartography_table.take_result', p.pos, 1, 1);
  p.swing();
  return id;
};
// a map fills in around the player holding it: one pass over a few columns each tick (vanilla's map updates)
Game.prototype.updateMap = function (m) {
  if (m.locked || (m.dim || 'overworld') !== (this.dim || 'overworld')) return;
  const p = this.player, w = this.world, s = 1 << m.scale;
  const ppx = Math.floor((p.pos[0] - m.cx) / s) + 64, ppz = Math.floor((p.pos[2] - m.cz) / s) + 64, R = Math.floor(128 / s);
  m.col = ((m.col || 0) + 1) % 16;
  for (let px = ppx - R + 1; px < ppx + R; px++) {
    if ((px & 15) !== m.col || px < 0 || px >= 128) continue;
    let prevH = 0;
    for (let pz = ppz - R - 1; pz < ppz + R; pz++) {
      if (pz < -1 || pz >= 128 || (px - ppx) ** 2 + (pz - ppz) ** 2 > R * R) continue;
      const wx = m.cx + (px - 64) * s, wz = m.cz + (pz - 64) * s;
      if (!w.isLoaded(wx, wz)) continue;
      // the column's top (most common colour over the scaled area, its average height)
      let h = 0, col = 0, depth = 0;
      const counts = {};
      for (let ix = 0; ix < s; ix++) for (let iz = 0; iz < s; iz++) {
        let y = w.surfaceY(wx + ix, wz + iz) + 1, id = 0;
        do { y--; id = w.getBlock(wx + ix, y, wz + iz); } while (y > -64 && (id === 0 || mapColorOf(id, 0) === 0));
        let c = mapColorOf(id, w.getMeta(wx + ix, y, wz + iz));
        if (IS_FLUID[id] && id === WATER) { let yy = y; while (yy > -64 && IS_FLUID[w.getBlock(wx + ix, yy, wz + iz)]) { yy--; depth++; } }
        h += y; counts[c] = (counts[c] || 0) + 1;
      }
      h /= s * s; depth /= s * s;
      col = +Object.keys(counts).reduce((a2, b2) => counts[a2] >= counts[b2] ? a2 : b2);
      let br;
      if (col === 12) { const dd = depth * 0.1 + ((px + pz) & 1) * 0.2; br = dd < 0.5 ? 2 : dd > 0.9 ? 0 : 1; }
      else { const dd = (h - prevH) * 4 / (s + 4) + (((px + pz) & 1) - 0.5) * 0.4; br = dd > 0.6 ? 2 : dd < -0.6 ? 0 : 1; }
      prevH = h;
      if (pz < 0) continue;
      const v = col * 4 + br;
      if (m.px[pz * 128 + px] !== v) { m.px[pz * 128 + px] = v; m.dirty = true; }
    }
  }
};
(() => {
  const _t = Game.prototype.tick;
  Game.prototype.tick = function (...args) {
    const r = _t.apply(this, args);
    const p = this.player;
    if (p && this.state === 'play' && !this.net) for (const st of [p.inv.held, p.inv.slots[40]]) if (st && keyOf3(st) === 'filled_map' && st.mapId != null) { const m = this.mapData(st.mapId); if (m) this.updateMap(m); }
    return r;
  };
  // saved with the world as base64
  const _cs = Game.prototype.collectDimSave;
  Game.prototype.collectDimSave = function () {
    for (const id in this.worldMeta.maps || {}) { const m = this.worldMeta.maps[id]; if (m.px && m.dirtySave !== false) { let s = ''; for (let i = 0; i < m.px.length; i++) s += String.fromCharCode(m.px[i]); m.data = btoa(s); } }
    const px = {}; for (const id in this.worldMeta.maps || {}) { px[id] = this.worldMeta.maps[id].px; delete this.worldMeta.maps[id].px; }
    try { return _cs.call(this); } finally { for (const id in px) this.worldMeta.maps[id].px = px[id]; }
  };
})();
// the map's picture on a 2D canvas (screens)
function mapPicture(m) {
  if (!m || !m.px) return null;
  const cv = mapPicture.cv || (mapPicture.cv = document.createElement('canvas')); cv.width = 128; cv.height = 128;
  const x = cv.getContext('2d'), im = x.createImageData(128, 128);
  for (let i = 0; i < 16384; i++) { const v = m.px[i], col = v >= 4 ? MAP_PAL[v] : null; if (col) { im.data[i * 4] = col[0]; im.data[i * 4 + 1] = col[1]; im.data[i * 4 + 2] = col[2]; im.data[i * 4 + 3] = 255; } }
  x.putImageData(im, 0, 0);
  return cv;
}
// the map's picture as a texture (with the player's marker drawn on top when drawn), rebuilt when it changed
Renderer.prototype.mapTex = function (g, id) {
  const m = g.mapData(id); if (!m) return null;
  const k = '@map:' + id;
  if (!this.entityTex[k] || m.dirty) {
    const c = this._mapCanvas || (this._mapCanvas = document.createElement('canvas')); c.width = 128; c.height = 128;
    const x = c.getContext('2d'), im = x.createImageData(128, 128);
    for (let i = 0; i < 16384; i++) { const v = m.px[i], col = v >= 4 ? MAP_PAL[v] : null; if (col) { im.data[i * 4] = col[0]; im.data[i * 4 + 1] = col[1]; im.data[i * 4 + 2] = col[2]; im.data[i * 4 + 3] = 255; } }
    x.putImageData(im, 0, 0);
    if (this.entityTex[k]) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.entityTex[k]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); }
    else this.entityTex[k] = this.tex2D(c, false);
    m.dirty = false;
  }
  return k;
};
// a 1 x 1 textured quad facing -z (m at its centre)
function texQuad(r, tex, m, L, w = 1, h = 1) {
  const gl = r.gl, T2 = r.progTex, f = M4.copy(m);
  M4.rotX(f, -Math.PI / 2); M4.rotZ(f, Math.PI); M4.scale(f, -w / 2, 1, h / 2);
  gl.useProgram(T2.p); gl.uniformMatrix4fv(T2.u.u_vp, false, r.vp); gl.uniformMatrix4fv(T2.u.u_model, false, f); gl.uniform4f(T2.u.u_color, L, L, L, 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.entityTex[tex]); gl.bindVertexArray(r.quadVao);
  const bl = gl.isEnabled(gl.BLEND); if (!bl) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  gl.disable(gl.CULL_FACE); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0); gl.enable(gl.CULL_FACE);
  if (!bl) gl.disable(gl.BLEND);
}
Game.prototype.drawMapInFrame = function (st, m, lt, env) {
  const r = this.renderer, t = st.mapId != null ? r.mapTex(this, st.mapId) : null, L = Math.max(lt[0], lt[1] * env.day) * 0.85 + 0.15;
  const bg = r.etex('map/map_background');
  if (bg) { const b = M4.copy(m); M4.translate(b, 0, 0, 0.002); texQuad(r, bg, b, L, 1, 1); }
  if (t) { const f = M4.copy(m); M4.translate(f, 0, 0, -0.002); texQuad(r, t, f, L, -7 / 8, -7 / 8); } // seen from -z: north at the top, east on the right
};
// held in the hand: the map in front of the view (both hands when the other one is empty)
(() => {
  const _dh = Game.prototype.drawHand;
  Game.prototype.drawHand = function (a, env) {
    const p = this.player, st = p.inv.held;
    if (!(st && keyOf3(st) === 'filled_map') || this.perspective !== 0) return _dh.call(this, a, env);
    const r = this.renderer, gl = r.gl, D = Math.PI / 180;
    if (!r.fxOn) gl.clear(gl.DEPTH_BUFFER_BIT); // (with the shader pack the hand goes in front by its depth range; post needs the world's depth)
    const proj = M4.create(); M4.perspective(proj, 70 * Math.PI / 180, r.canvas.width / r.canvas.height, 0.05, 10);
    const savedVP = r.vp, savedCam = r.camPos; r.vp = proj; r.camPos = [0, 0, 0];
    // vanilla ItemInHandRenderer.renderTwoHandedMap: low and nearly flat while looking ahead, up in front when looking
    // down (calculateMapTilt), the swing and lowering of the hands; both arms hold it
    const sw = p.swingT > 0 ? clamp((6 - p.swingT + a) / 6, 0, 1) : 0, sq = Math.sqrt(sw);
    const eq = 1 - lerp(p.oHandH ?? 1, p.handH ?? 1, a);
    const tf = clamp(1 - (-p.pitch / D) / 45 + 0.1, 0, 1), tilt = -Math.cos(tf * Math.PI) * 0.5 + 0.5;
    const m = M4.create();
    M4.translate(m, 0, 0.2 * Math.sin(sw * Math.PI) / 2, -0.4 * Math.sin(sq * Math.PI));
    M4.translate(m, 0, 0.04 - eq * 1.2 - tilt * 0.5, -0.72); M4.rotX(m, tilt * -85 * D);
    const lt = p.lightAt(), env2 = { ...env, fogNear: 1e8, fogFar: 2e8 };
    if (!p.invisible) for (const side of [1, -1]) {
      const h = M4.copy(m); M4.rotY(h, 90 * D);
      M4.rotY(h, 92 * D); M4.rotX(h, 45 * D); M4.rotZ(h, side * -41 * D); M4.translate(h, side * 0.3, -1.1, 0.45);
      // renderRightHand / renderLeftHand: the arm part (its pivot and box), turned from this game's model space to vanilla's
      M4.translate(h, side * -6 / 16, 2 / 16, 0); M4.rotZ(h, Math.PI);
      r.drawModel(typeof Skins !== 'undefined' ? Skins.armOf(this, side < 0) : side > 0 ? 'arm' : 'arm_left', typeof Skins !== 'undefined' ? Skins.texOf(this, p) : 'steve', h, null, lt, env2, { vp: proj });
    }
    M4.rotX(m, Math.sin(sq * Math.PI) * 20 * D);
    // the map: 128 pixels across 0.76 (2 x 0.38), its background 142
    const l = lt, L = Math.max(l[0], l[1] * env.day) * 0.8 + 0.2;
    const bg = r.etex('map/map_background'), t = st.mapId != null ? r.mapTex(this, st.mapId) : null;
    const S = 0.76;
    if (bg) texQuad(r, bg, m, L, S * 142 / 128, S * 142 / 128);
    if (t) { const f = M4.copy(m); M4.translate(f, 0, 0, 0.003); texQuad(r, t, f, L, S, -S); } // north at the top
    // the player's marker
    const md = st.mapId != null && this.mapData(st.mapId), mk = r.etex('map/decorations/player');
    if (md && md.net && md.icons) {
      // a server's map: the markers it sent (x, z in half-pixels from the centre, direction in sixteenths)
      for (const [type, ix, iz, dir] of md.icons) {
        const t = r.etex('map/decorations/' + type); if (!t) continue;
        const f = M4.copy(m); M4.translate(f, ix / 128 * S / 2, -iz / 128 * S / 2, 0.006); M4.rotZ(f, -dir * Math.PI / 8); texQuad(r, t, f, 1, S / 16, S / 16);
      }
    } else if (md && mk) {
      const s = 1 << md.scale, mx = (p.pos[0] - md.cx) / s / 64, mz = (p.pos[2] - md.cz) / s / 64;
      if (Math.abs(mx) < 1 && Math.abs(mz) < 1) { const f = M4.copy(m); M4.translate(f, mx * S / 2, -mz * S / 2, 0.006); M4.rotZ(f, p.yaw + Math.PI); texQuad(r, mk, f, 1, S / 16, S / 16); }
    }
    r.vp = savedVP; r.camPos = savedCam;
  };
  const _il = UI.prototype.itemLines;
  UI.prototype.itemLines = function (st) { const lines = _il.call(this, st); if (keyOf3(st) === 'filled_map' && st.mapId != null) { const m = this.game.mapData(st.mapId); lines.splice(1, 0, { text: '#' + st.mapId, color: '#AAAAAA' }); if (m) lines.push({ text: '比例尺 1:' + (1 << m.scale), color: '#AAAAAA' }, { text: '(级别 ' + m.scale + '/4)', color: '#AAAAAA' }); if (m && m.locked) lines.push({ text: '已锁定', color: '#AAAAAA' }); } return lines; };
})();
// the cartography table: copy a map, zoom it out with paper, lock it with a glass pane
class CartographyScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_cartography_table', title || '制图台', pos);
    this.own(0, 15, 15, { accept: (s) => keyOf3(s) === 'filled_map' }); this.own(1, 15, 52, { accept: (s) => /^(map|paper|glass_pane)$/.test(keyOf3(s)) });
    this.slots.push({ x: 145, y: 39, output: true, get: () => this.result, set: () => { }, onTake: () => this.take() });
    this.addPlayerSlots(84, 142); this.changed();
  }
  changed() {
    const a = this.S(0), b = this.S(1); this.result = null; this.mode = null;
    if (!a || !b) return;
    const m = this.game.mapData(a.mapId), k = keyOf3(b);
    if (k === 'map') { this.result = { ...a, count: 2 }; this.mode = 'copy'; }
    else if (k === 'paper' && m && m.scale < 4 && !m.locked) { this.result = { ...a, count: 1, zoom: true }; this.mode = 'zoom'; }
    else if (k === 'glass_pane' && m && !m.locked) { this.result = { ...a, count: 1, lock: true }; this.mode = 'lock'; }
  }
  take() {
    const g = this.game, a = this.S(0), src = g.mapData(a.mapId);
    if (this.mode === 'zoom') { const id = g.newMap(null, src.scale + 1, null); const nm = g.mapData(id); const s = 128 << nm.scale; nm.cx = Math.floor((src.cx + 64) / s) * s + s / 2 - 64; nm.cz = Math.floor((src.cz + 64) / s) * s + s / 2 - 64; this.result = { ...makeStack('filled_map', 1), mapId: id }; }
    if (this.mode === 'lock') { const id = g.newMap(null, src.scale, src); const nm = g.mapData(id); nm.px.set(src.px); nm.locked = true; this.result = { ...makeStack('filled_map', 1), mapId: id }; }
    if (this.mode === 'copy') this.result = { ...a, count: 2 };
    for (const i of [0, 1]) { const s = this.held[i]; if (s) { s.count--; if (!s.count) this.held[i] = null; } }
    Sound.ev('ui.cartography_table.take_result', null, 1, 1);
  }
  // the preview in the middle: the map on its paper - smaller inside a bigger sheet when zooming out, two sheets
  // when copying, a padlock when locking
  drawMore(ui) {
    const a = this.S(0); if (!a) return;
    const m = this.game.mapData(a.mapId), c = ui.ctx, X = this.x, Y = this.y;
    const pic = (x, y, s) => { const cv = mapPicture(m); if (cv) { c.imageSmoothingEnabled = false; c.drawImage(cv, X + x, Y + y, Math.round(128 * s), Math.round(128 * s)); } };
    if (this.mode === 'zoom') { ui.sprite('cartography_table_scaled_map', X + 67, Y + 13, 66, 66); pic(85, 31, 0.226); }
    else if (this.mode === 'copy') {
      ui.sprite('cartography_table_duplicated_map', X + 83, Y + 13, 50, 66); pic(86, 16, 0.34);
      ui.sprite('cartography_table_duplicated_map', X + 67, Y + 29, 50, 66); pic(70, 32, 0.34);
    } else { ui.sprite('cartography_table_map', X + 67, Y + 13, 66, 66); pic(71, 17, 0.45); }
    if (this.mode === 'lock') ui.sprite('cartography_table_locked', X + 118, Y + 60);
    if (m && m.locked && this.S(1)) ui.sprite('cartography_table_error', X + 35, Y + 31);
  }
}
if (typeof WORKSTATIONS !== 'undefined') { WORKSTATIONS.cartography = (g, pos, b) => new CartographyScreen(g, pos, b.cn); if (BID.cartography_table !== undefined) BLOCKS[BID.cartography_table].onUse = 'cartography'; }

// ---- books ------------------------------------------------------------------------------------------------------------------------------
class BookScreen {
  constructor(game, stack, edit, lectern) {
    this.game = game; this.st = stack; this.edit = edit; this.lectern = lectern;
    this.pages = stack.pages ? [...stack.pages] : ['']; this.page = lectern ? (lectern.page || 0) : 0; this.signing = false; this.title = '';
  }
  layout() { const u = this.game.ui; this.x = Math.floor((u.w - 192) / 2); this.y = 2; if (this.edit) this.focus(); }
  focus() {
    const u = this.game.ui, s = this;
    if (this.signing) { this.hideArea(); u.showInput(this.x + 36 + 10, this.y + 50, 100, 12, this.title, () => s.sign(), { max: 32, onInput: (v) => { s.title = v; }, onEsc: () => u.close() }); u.inputBox = null; return; }
    u.hideInput();
    // a page takes line breaks: typed into a hidden text area, drawn on the page
    let ta = u.bookArea;
    if (!ta) { ta = u.bookArea = document.createElement('textarea'); Object.assign(ta.style, { position: 'fixed', left: '-2000px', top: '0', width: '200px', height: '200px', opacity: '0' }); document.body.appendChild(ta); }
    ta.value = this.pages[this.page] || ''; ta.style.display = 'block';
    ta.oninput = () => { let v = ta.value.slice(0, 1024); while (s.wrap(v, true).length > 14) v = v.slice(0, -1); if (v !== ta.value) ta.value = v; s.pages[s.page] = v; s.save(); };
    ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') u.close(); if (e.key === 'PageUp' && s.page > 0) { s.page--; s.turned(); } if (e.key === 'PageDown') { if (s.page === s.pages.length - 1 && s.pages.length < 100) s.pages.push(''); s.page++; s.turned(); } };
    setTimeout(() => ta.focus(), 0);
  }
  hideArea() { const ta = this.game.ui.bookArea; if (ta) { ta.style.display = 'none'; ta.oninput = null; ta.onkeydown = null; ta.blur(); } }
  save() { if (this.edit && !this.signing) this.st.pages = [...this.pages]; }
  close() { const u = this.game.ui; this.hideArea(); u.hideInput(); this.save(); if (this.edit && !this.signed) this.netSend(null); }
  // on a server the book is the server's: the pages (and the title when signed) are sent as edit_book
  netSend(title) { const g = this.game; if (!g.net) return; const p = g.player, slot = p.inv.slots.indexOf(this.st); g.net.send({ t: 'book', slot: slot < 0 ? p.inv.sel : slot, pages: this.pages, title }); }
  key(ui, ev) { return true; }
  btns() {
    const x = this.x, y = this.y, b = [];
    if (this.page > 0) b.push({ x: x + 43, y: y + 154, w: 23, h: 13, act: 'prev', sprite: 'page_backward' });
    if (this.page < this.pages.length - 1 || (this.edit && this.pages.length < 100 && this.pages[this.page])) b.push({ x: x + 116, y: y + 154, w: 23, h: 13, act: 'next', sprite: 'page_forward' });
    if (this.edit) { b.push({ x: x + 1, y: y + 196, w: 94, h: 20, act: 'sign', label: this.signing ? '署名并关闭' : '署名' }, { x: x + 98, y: y + 196, w: 94, h: 20, act: this.signing ? 'cancel' : 'done', label: this.signing ? '取消' : '完成' }); }
    else if (this.lectern) b.push({ x: x + 1, y: y + 196, w: 94, h: 20, act: 'take', label: '取书' }, { x: x + 98, y: y + 196, w: 94, h: 20, act: 'done', label: '完成' });
    else b.push({ x: x + 48, y: y + 196, w: 96, h: 20, act: 'done', label: '完成' });
    return b;
  }
  mouseDown(ui, mx, my) {
    for (const b of this.btns()) if (ui.hit(b, mx, my)) {
      Sound.click && Sound.click();
      if (b.act === 'prev') { this.page--; this.turned(); }
      if (b.act === 'next') { if (this.page === this.pages.length - 1) this.pages.push(''); this.page++; this.turned(); }
      if (b.act === 'done') ui.close();
      if (b.act === 'sign') { if (this.signing) this.sign(); else { this.signing = true; this.focus(); } }
      if (b.act === 'cancel') { this.signing = false; this.focus(); }
      if (b.act === 'take') { const g = this.game, l = this.lectern; if (l && l.book) { if (g.player.inv.add(l.book)) g.dropFromPlayer(l.book); l.book = null; bsetProp(g.world, ...l.pos, 'has_book', 'false'); } ui.close(); }
      return;
    }
  }
  turned() { if (this.lectern) { this.lectern.page = this.page; Sound.ev('item.book.page_turn', this.lectern.pos, 1, 1); } else Sound.ev('item.book.page_turn', null, 1, 1); if (this.edit) this.focus(); }
  sign() {
    if (!this.title.trim()) return;
    const g = this.game, p = g.player, st = this.st;
    if (g.net) { this.signed = true; this.netSend(this.title.trim()); g.ui.close(); return; }
    const wb = { ...makeStack('written_book', 1), pages: this.pages.filter((t, i) => t || i === 0), title: this.title.trim(), author: g.playerName || (g.worldMeta && g.worldMeta.playerName) || '玩家', gen: 0 };
    const i = p.inv.slots.indexOf(st); if (i >= 0) p.inv.slots[i] = wb;
    g.ui.close();
  }
  wrap(text) {
    const out = [];
    for (const para of String(text).split('\n')) { let line = ''; for (const ch of para) { if (Font.width(line + ch) > 114) { out.push(line); line = ''; } line += ch; } out.push(line); }
    return out.slice(0, 14);
  }
  draw(ui) {
    const c = ui.ctx, x = this.x, y = this.y, im = this.game.renderer.images['@gui/book'] || ui.img.book_gui;
    if (im) c.drawImage(im, 0, 0, 192, 192, x, y, 192, 192); else { c.fillStyle = '#F5EBD0'; c.fillRect(x + 20, y, 150, 180); }
    if (this.signing) {
      Font.center(c, '输入书名：', x + 96, y + 34, '#000000', false);
      Font.center(c, this.title + (Math.floor(performance.now() / 300) % 2 ? '_' : ''), x + 96, y + 50, '#000000', false);
      Font.center(c, '作者：' + (this.game.playerName || '玩家'), x + 96, y + 62, '#444444', false);
      Font.center(c, '注意！署名后此书将不可再编辑。', x + 96, y + 82, '#000000', false);
    } else {
      const pg = '第 ' + (this.page + 1) + ' 页，共 ' + Math.max(this.pages.length, 1) + ' 页';
      Font.draw(c, pg, x + 148 - Font.width(pg), y + 16, '#000000', false);
      const lines = this.wrap(this.pages[this.page] || '');
      lines.forEach((l, i) => Font.draw(c, l, x + 36, y + 32 + i * 9, '#000000', false));
      if (this.edit && Math.floor(performance.now() / 300) % 2) { const last = lines[lines.length - 1] || ''; Font.draw(c, '_', x + 36 + Font.width(last), y + 32 + (lines.length - 1) * 9, '#000000', false); }
    }
    for (const b of this.btns()) {
      if (b.sprite) { const hov = ui.hit(b); ui.sprite('widget_' + b.sprite + (hov ? '_highlighted' : ''), b.x, b.y); if (!ui.img['widget_' + b.sprite]) Font.draw(c, b.act === 'prev' ? '<' : '>', b.x + 8, b.y + 3, hov ? '#AA0000' : '#000000', false); }
      else ui.button(b);
    }
  }
}
(() => {
  const _il = UI.prototype.itemLines;
  UI.prototype.itemLines = function (st) {
    const lines = _il.call(this, st);
    if (keyOf3(st) === 'written_book' && st.title) { lines[0] = { text: st.title, color: '#FFFF55' }; lines.splice(1, 0, { text: '作者：' + (st.author || '?'), color: '#AAAAAA' }, { text: ['原稿', '原稿的副本', '副本的副本', '破烂不堪'][st.gen | 0], color: '#AAAAAA' }); }
    return lines;
  };
})();
// lecterns: put a book on, read it, take it back; comparators read the page
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target, held = p.inv.held;
    if (t && !this.targetEntity && BLOCKS[t.id].key === 'lectern' && !this.net) {
      const be = this.getBlockEntity(...t.pos, 'lectern'); be.pos = [...t.pos];
      if (be.book) { this.ui.open(new BookScreen(this, be.book, false, be)); return; }
      if (held && /^(writable_book|written_book)$/.test(keyOf3(held)) && !p.sneaking) {
        be.book = { ...held, count: 1 }; be.page = 0; useOne(this, p); bsetProp(this.world, ...t.pos, 'has_book', 'true');
        Sound.ev('item.book.put', t.pos, 1, 1); p.swing(); return;
      }
    }
    return _use.call(this);
  };
})();

// ---- jukeboxes and music discs: a disc goes in and comes out (comparators read it) and the notes rise, but nothing
// plays - the music discs' songs were taken out with the background music (user, 2026-10-29) ----
const SONGS = EXTRA.jukebox_song || {};
const discSong = (st) => { const k = keyOf3(st); if (!/^music_disc_/.test(k)) return null; const s = k.replace(/^music_disc_/, ''); return SONGS[s] ? { key: s, ...SONGS[s] } : null; };
Game.prototype.jukeboxPlay = function (pos, disc) {
  this.jukeboxes = this.jukeboxes || new Map();
  const k = pos.join(','), song = discSong(disc);
  this.jukeboxStop(pos);
  if (!song) return;
  const j = { x: pos[0], y: pos[1], z: pos[2], playing: true, song, t0: this.tickCount };
  this.jukeboxes.set(k, j);
  for (let i = 0; i < 4; i++) this.particles.spawn('note', pos[0] + 0.5, pos[1] + 1.2, pos[2] + 0.5, 0, 0.05, 0, { col: [255, 80, 200] });
};
Game.prototype.jukeboxStop = function (pos) {
  const k = pos.join(','), j = this.jukeboxes && this.jukeboxes.get(k);
  if (!j) return;
  this.jukeboxes.delete(k);
};
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target, held = p.inv.held;
    if (t && !this.targetEntity && BLOCKS[t.id].key === 'jukebox' && !this.net) {
      const be = this.getBlockEntity(...t.pos, 'jukebox');
      if (be.disc) { this.dropItem(t.pos[0] + 0.5, t.pos[1] + 1.1, t.pos[2] + 0.5, be.disc); be.disc = null; this.jukeboxStop(t.pos); p.swing(); return; }
      if (held && discSong(held) && !p.sneaking) { be.disc = { ...held, count: 1 }; useOne(this, p); this.jukeboxPlay(t.pos, be.disc); p.swing(); return; }
    }
    return _use.call(this);
  };
  const _db = Game.prototype.dropBlockLoot;
  Game.prototype.dropBlockLoot = function (x, y, z, id, meta, tool, ...rest) {
    const k = x + ',' + y + ',' + z, b = BLOCKS[id];
    if (b && b.key === 'jukebox') { const be = this.blockEntities.get(k); if (be && be.disc) { this.dropItem(x + 0.5, y + 0.5, z + 0.5, be.disc); be.disc = null; } this.jukeboxStop([x, y, z]); }
    if (b && b.key === 'lectern') { const be = this.blockEntities.get(k); if (be && be.book) { this.dropItem(x + 0.5, y + 0.5, z + 0.5, be.book); be.book = null; } }
    return _db.call(this, x, y, z, id, meta, tool, ...rest);
  };
  // the music fades with distance; ends with the song
  const _t = Game.prototype.tick;
  Game.prototype.tick = function (...args) {
    const r = _t.apply(this, args);
    if (!this.jukeboxes || !this.player) return r;
    for (const [k, j] of this.jukeboxes) {
      if (BLOCKS[this.world.getBlock(j.x, j.y, j.z)].key !== 'jukebox') { this.jukeboxStop([j.x, j.y, j.z]); continue; }
      const d = Math.hypot(this.player.pos[0] - j.x - 0.5, this.player.pos[1] - j.y, this.player.pos[2] - j.z - 0.5);
      if ((this.tickCount - j.t0) / 20 > j.song.length_in_seconds) j.playing = false;
      if (j.playing && this.tickCount % 20 === 0 && d < 32) this.particles.spawn('note', j.x + 0.5, j.y + 1.2, j.z + 0.5, 0, 0.05, 0, { col: [Math.random() * 255 | 0, Math.random() * 255 | 0, Math.random() * 255 | 0] });
    }
    return r;
  };
})();
(() => { const _il = UI.prototype.itemLines; UI.prototype.itemLines = function (st) { const lines = _il.call(this, st); const s = discSong(st); if (s) lines.splice(1, 0, { text: zhT('jukebox_song.minecraft.' + s.key, s.key), color: '#AAAAAA' }); if (keyOf3(st) === 'goat_horn') lines.splice(1, 0, { text: zhT('instrument.minecraft.' + (st.instrument || 'ponder_goat_horn').replace('minecraft:', ''), ''), color: '#AAAAAA' }); return lines; }; })();

// ---- brushes: dust off suspicious sand and gravel ----------------------------------------------------------------------------------------
Game.prototype.brushTick = function (st) {
  const p = this.player, t = this.target;
  if (!t || this.targetEntity) { p.usingItem = null; return; }
  if (p.useT % 10 !== 5) return;
  const [x, y, z] = t.pos, b = BLOCKS[t.id], w = this.world;
  const sus = b.key === 'suspicious_sand' || b.key === 'suspicious_gravel', sand = /sand/.test(b.key);
  Sound.ev(sand ? 'item.brush.brushing.sand' : /gravel/.test(b.key) ? 'item.brush.brushing.gravel' : 'item.brush.brushing.generic', t.pos, 1, 1);
  for (let i = 0; i < 4; i++) this.particles.spawn('block', x + 0.5 + DIRS[t.face][0] * 0.55, y + 0.5 + DIRS[t.face][1] * 0.55, z + 0.5 + DIRS[t.face][2] * 0.55, (Math.random() - 0.5) * 0.1, 0.05, (Math.random() - 0.5) * 0.1, { id: t.id, meta: w.getMeta(x, y, z) });
  if (!sus) return;
  const be = this.getBlockEntity(x, y, z, 'brushable'); be.brush = (be.brush || 0) + 1;
  const d = Math.min(3, Math.floor(be.brush / 2));
  if (be.brush < 8) { bsetProp(w, x, y, z, 'dusted', String(d)); return; }
  // done: the find pops out of the top face, the block turns plain
  const table = be.loot || defaultArchaeology(this, x, z, sand);
  for (const s of rollLoot(table, { e: p, player: true })) this.dropItem(x + 0.5, y + 1.1, z + 0.5, s);
  this.blockEntities.delete(x + ',' + y + ',' + z);
  w.setBlock(x, y, z, BID[sand ? 'sand' : 'gravel'], 0);
  Sound.ev(sand ? 'item.brush.brushing.sand.complete' : 'item.brush.brushing.gravel.complete', t.pos, 1, 1);
  this.damageHeld(1); p.usingItem = null; this.flushMesh();
};
function defaultArchaeology(g, x, z, sand) {
  const b = biomeName(g, x, z);
  if (/warm_ocean|lukewarm/.test(b)) return 'archaeology/ocean_ruin_warm';
  if (/ocean/.test(b)) return 'archaeology/ocean_ruin_cold';
  if (sand) return /desert/.test(b) ? 'archaeology/desert_pyramid' : 'archaeology/desert_well';
  return Math.random() < 0.1 ? 'archaeology/trail_ruins_rare' : 'archaeology/trail_ruins_common';
}

// ---- vaults and trial spawners -------------------------------------------------------------------------------------------------------
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target, held = p.inv.held, k = keyOf3(held);
    if (t && !this.targetEntity && BLOCKS[t.id].key === 'vault' && !this.net) {
      const [x, y, z] = t.pos, ominous = Features.propOf(t.id, this.world.getMeta(x, y, z), 'ominous') === 'true';
      const be = this.getBlockEntity(x, y, z, 'vault'); be.rewarded = be.rewarded || [];
      const want = ominous ? 'ominous_trial_key' : 'trial_key';
      if (k !== want || be.rewarded.includes('player') || be.eject) { Sound.ev('block.vault.insert_item_fail', t.pos, 1, 1); p.swing(); return; }
      useOne(this, p); be.rewarded.push('player');
      be.eject = rollLoot(ominous ? 'chests/trial_chambers/reward_ominous' : 'chests/trial_chambers/reward', { e: p, player: true }); be.ejectT = 0;
      bsetProp(this.world, x, y, z, 'vault_state', 'unlocking'); Sound.ev('block.vault.insert_item', t.pos, 1, 1); p.swing(); return;
    }
    return _use.call(this);
  };
  const _t = Game.prototype.tick;
  Game.prototype.tick = function (...args) {
    const r = _t.apply(this, args);
    if (!this.blockEntities || this.net || this.state !== 'play') return r;
    for (const be of this.blockEntities.values()) {
      if (be.type === 'vault' && be.eject) {
        const [x, y, z] = be.pos;
        if (++be.ejectT % 20 !== 0) continue;
        if (be.ejectT === 20) bsetProp(this.world, x, y, z, 'vault_state', 'ejecting');
        const st = be.eject.shift();
        if (st) { const it = new ItemEntity(this, x + 0.5, y + 1.1, z + 0.5, st, [(Math.random() - 0.5) * 0.1, 0.2, (Math.random() - 0.5) * 0.1]); this.entities.push(it); Sound.ev('block.vault.eject_item', be.pos, 1, 0.8 + Math.random() * 0.4); }
        else { be.eject = null; bsetProp(this.world, x, y, z, 'vault_state', 'inactive'); Sound.ev('block.vault.deactivate', be.pos, 1, 1); }
      }
    }
    if (this.tickCount % 2 === 0) this.tickTrialSpawners();
    return r;
  };
})();
const TS_KEYS = Object.keys(EXTRA.trial_spawner || {});
Game.prototype.tickTrialSpawners = function () {
  const p = this.player, w = this.world;
  if (!p || this.difficulty === 0) return;
  // nearby trial spawner blocks are found as the player moves (they are rare)
  if (this.tickCount % 40 === 0) {
    const x0 = Math.floor(p.pos[0]), y0 = Math.floor(p.pos[1]), z0 = Math.floor(p.pos[2]);
    this._ts = [];
    if (BID.trial_spawner !== undefined) for (let dx = -14; dx <= 14; dx++) for (let dy = -6; dy <= 6; dy++) for (let dz = -14; dz <= 14; dz++) if (w.getBlock(x0 + dx, y0 + dy, z0 + dz) === BID.trial_spawner) this._ts.push([x0 + dx, y0 + dy, z0 + dz]);
  }
  for (const [x, y, z] of this._ts || []) {
    const be = this.getBlockEntity(x, y, z, 'trial_spawner'); be.pos = [x, y, z];
    const ominous = Features.propOf(BID.trial_spawner, w.getMeta(x, y, z), 'ominous') === 'true';
    if (!be.config) { const pool = TS_KEYS.filter(k => k.endsWith(ominous ? '/ominous' : '/normal')); be.config = pool[(Math.random() * pool.length) | 0]; }
    const C = EXTRA.trial_spawner[be.config] || {}, tc = this.tickCount;
    if (be.cooldown && tc < be.cooldown) continue;
    if (be.cooldown) { be.cooldown = 0; bsetProp(w, x, y, z, 'trial_spawner_state', 'waiting_for_players'); }
    const near = Math.hypot(p.pos[0] - x - 0.5, p.pos[1] - y, p.pos[2] - z - 0.5) < 14 && !p.creative;
    if (!be.active) { if (!near) continue; be.active = true; be.spawned = 0; be.mobs = []; be.total = (C.total_mobs || 6) + (C.total_mobs_added_per_player || 2) * 0; bsetProp(w, x, y, z, 'trial_spawner_state', 'active'); Sound.ev('block.trial_spawner.detect_player', [x, y, z], 1, 1); }
    be.mobs = be.mobs.filter(m => !m.dead && m.deathTime === 0);
    if (be.spawned < be.total) {
      if (be.mobs.length < (C.simultaneous_mobs || 2) && tc - (be.lastSpawn || 0) >= (C.ticks_between_spawn || 40)) {
        const pot = C.spawn_potentials || [{ data: { entity: { id: 'minecraft:zombie' } }, weight: 1 }];
        const type = pickW(pot.map(q => [q.data.entity.id.replace('minecraft:', ''), q.weight || 1]));
        const sx = x + 0.5 + randInt(-4, 4), sz = z + 0.5 + randInt(-4, 4);
        if (MOB_TYPES[type] || type === 'zombie') {
          const m = createMob(this, type, sx, y, sz); m.persistent = true; m.target = p;
          if (be.config.includes('baby_zombie') && m.makeBaby) m.makeBaby();
          if (!m.collides(m.box())) { this.entities.push(m); be.mobs.push(m); be.spawned++; be.lastSpawn = tc; Sound.ev('block.trial_spawner.spawn_mob', [x, y, z], 1, 1); for (let i = 0; i < 10; i++) this.particles.spawn('flame', sx + (Math.random() - 0.5), y + Math.random() * 2, sz + (Math.random() - 0.5), 0, 0.02, 0); }
        }
      }
    } else if (!be.mobs.length) {
      // the trial is over: the rewards pop out, then a long cooldown
      const tables = C.loot_tables_to_eject || [{ data: 'minecraft:spawners/' + (ominous ? 'ominous/' : '') + 'trial_chamber/consumables', weight: 1 }, { data: 'minecraft:spawners/' + (ominous ? 'ominous/' : '') + 'trial_chamber/key', weight: 1 }];
      const tb = pickW(tables.map(q => [String(q.data).replace('minecraft:', ''), q.weight || 1]));
      for (const st of rollLoot(tb, { e: p, player: true })) this.dropItem(x + 0.5, y + 1.2, z + 0.5, st);
      Sound.ev('block.trial_spawner.eject_item', [x, y, z], 1, 1);
      be.active = false; be.cooldown = tc + (C.target_cooldown_length || 36000);
      bsetProp(w, x, y, z, 'trial_spawner_state', 'cooldown');
    }
  }
};

// ---- the wandering trader's vanilla trade lists (trade_set: buying 2, common 5, uncommon 1) -------------------------------------------------
(() => {
  if (typeof WanderingTrader === 'undefined' || !EXTRA.trade_set) return;
  const tagList = (name) => { const t = EXTRA.tags && EXTRA.tags['villager_trade:' + name]; return (t || []).flatMap(v => typeof v === 'string' ? (v[0] === '#' ? tagList(v.slice(11)) : [v.replace('minecraft:', '')]) : []); };
  const toOffer = (k) => {
    const T2 = EXTRA.villager_trade[k]; if (!T2 || !T2.wants || !T2.gives) return null;
    const id = (o) => String(o.id).replace('minecraft:', ''), n = (o) => typeof o.count === 'number' ? o.count : o.count ? Math.round(lootNum(o.count)) : 1;
    const o = { a: id(T2.wants), an: n(T2.wants), r: id(T2.gives), rn: n(T2.gives), uses: T2.max_uses || 1, used: 0, xp: T2.xp || 1 };
    if (T2.additional_wants) { o.b = id(T2.additional_wants); o.bn = n(T2.additional_wants); }
    return ITEM_KEY[o.a] !== undefined && ITEM_KEY[o.r] !== undefined && (!o.b || ITEM_KEY[o.b] !== undefined) ? o : null;
  };
  const _of = WanderingTrader.prototype.offers;
  WanderingTrader.prototype.offers = function () {
    if (!this.trades) {
      const out = [];
      for (const set of ['wandering_trader/buying', 'wandering_trader/common', 'wandering_trader/uncommon']) {
        const S = EXTRA.trade_set[set]; if (!S) continue;
        const pool = tagList(String(S.trades).replace(/^#minecraft:/, '')).map(toOffer).filter(Boolean);
        const amt = typeof S.amount === 'number' ? S.amount : Math.round(lootNum(S.amount));
        for (let i = 0; i < amt && pool.length; i++) out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
      }
      if (out.length) this.trades = out;
    }
    return this.trades || _of.call(this);
  };
})();
