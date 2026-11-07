'use strict';
// ---------------------------------------------------------------------------
// Items for mobs: saddles (pigs and striders steered with a carrot / warped fungus on a stick), leads and lead
// knots, name tags (with vanilla's name easter eggs), buckets of fish / axolotls / tadpoles / sulfur cubes, the
// powder snow bucket; the vanilla models for pigs, cows, chickens and sheep (their warm / cold variants, saddles
// and baby models); names drawn over mobs.
// ---------------------------------------------------------------------------

// ---- pigs, cows, chickens and sheep with the vanilla models and climate variants -----------------------------------------
const climateAt = (g, x, z) => { const b = biomeName(g, x, z); return /desert|badlands|savanna|jungle|mangrove|warm|nether|crimson|warped|basalt|soul/.test(b) ? 'warm' : /snowy|frozen|ice|grove|jagged|peaks|taiga|cold|deep_dark/.test(b) ? 'cold' : 'temperate'; };
const FARM_SKIN = {
  pig: (e) => ({ layer: e.baby ? 'pig_baby#main' : e.cvar === 'cold' ? 'cold_pig#main' : 'pig#main', tex: 'entity/pig/pig_' + e.cvar + (e.baby ? '_baby' : '') }),
  cow: (e) => ({ layer: e.baby ? (e.cvar === 'cold' ? 'cold_cow_baby#main' : e.cvar === 'warm' ? 'warm_cow_baby#main' : 'cow_baby#main') : e.cvar === 'cold' ? 'cold_cow#main' : e.cvar === 'warm' ? 'warm_cow#main' : 'cow#main', tex: 'entity/cow/cow_' + e.cvar + (e.baby ? '_baby' : '') }),
  chicken: (e) => ({ layer: e.baby ? 'chicken_baby#main' : e.cvar === 'cold' ? 'cold_chicken#main' : 'chicken#main', tex: 'entity/chicken/chicken_' + e.cvar + (e.baby ? '_baby' : '') }),
  sheep: (e) => ({ layer: e.baby ? 'sheep_baby#main' : 'sheep#main', tex: 'entity/sheep/sheep' + (e.baby ? '_baby' : '') }),
};
(() => {
  const sd = Mob.prototype.saveData, ld = Mob.prototype.loadData;
  Mob.prototype.saveData = function () { const o = sd ? sd.call(this) : {}; if (FARM_SKIN[this.type] || this.type === 'strider') { o.cv = this.cvar; o.sad = this.saddled; if (this.customName) o.name = this.customName; } return o; };
  Mob.prototype.loadData = function (o) { if (ld) ld.call(this, o); if (o && (FARM_SKIN[this.type] || this.type === 'strider')) { if (o.cv) this.cvar = o.cv; this.saddled = !!o.sad; if (o.name) this.customName = o.name; } };
})();
function farmAnim(md, e, a) {
  const P = md.parts, [pos, spd] = emLimbs(e, a);
  emHead(P.head, e, a);
  if (e.type === 'chicken') {
    if (P.right_leg) P.right_leg.xRot = Math.cos(pos * 0.6662) * 1.4 * spd;
    if (P.left_leg) P.left_leg.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd;
    const flap = e.onGround ? 0 : Math.sin((e.age + a) * 1.5) * 0.8 + 0.8;
    if (P.right_wing) P.right_wing.zRot = flap; if (P.left_wing) P.left_wing.zRot = -flap;
    return;
  }
  emQuad(md, pos, spd);
  if (e.type === 'sheep' && e.eatT > 0 && P.head) { const k = Math.min(1, Math.min(e.eatT, 40 - e.eatT) / 4); P.head.y += 9 * k; P.head.xRot = 0.8 * k + P.head.xRot * (1 - k); }
}
// draw an old-style farm animal with the vanilla model (called by Game.drawMob)
Game.prototype.drawFarmMob = function (e, ip, a, env, l) {
  const r = this.renderer;
  if (!e.cvar) e.cvar = climateAt(this, e.pos[0], e.pos[2]);
  const sk = FARM_SKIN[e.type](e), md = EM.get(r, sk.layer), tex = r.etex(sk.tex);
  if (!md) return false;
  if (!tex) return true;
  let m = M4.create();
  if (e.displayMatrix) m = M4.copy(e.displayMatrix);
  else { M4.translate(m, ip[0], ip[1], ip[2]); const by = e.prevBodyYaw !== undefined ? e.prevBodyYaw + angDelta(e.bodyYaw, e.prevBodyYaw) * a : e.bodyYaw; M4.rotY(m, by); }
  if (e.deathTime > 0) M4.rotZ(m, Math.min(1, Math.sqrt((e.deathTime + a) / 20)) * Math.PI / 2);
  upsideDown(e, m);
  EM.reset(md); farmAnim(md, e, a);
  const overlay = e.hurtTime > 0 || e.deathTime > 0 ? [1, 0, 0, 0.4] : null, lt = [l[0], e.fire > 0 ? 1 : l[1]];
  r.drawEM(md, tex, m, lt, env, { overlay });
  if (e.type === 'pig' && e.saddled && !e.baby) { const sm = EM.get(r, 'pig#saddle'); if (sm) { EM.reset(sm); EM.copy(md, sm); r.drawEM(sm, r.etex('entity/equipment/pig_saddle/saddle'), m, lt, env, { overlay }); } }
  if (e.type === 'sheep' && !e.sheared) {
    const wm = EM.get(r, e.baby ? 'sheep_baby#wool' : 'sheep#wool');
    if (wm) {
      EM.reset(wm); EM.copy(md, wm);
      let col = WOOL_RGB[e.woolColor] || [1, 1, 1];
      if (e.customName === 'jeb_') { const t = (e.age + a) / 25, i = Math.floor(t) % 16, f = t % 1, c0 = dyeRGB(DYES[i]), c1 = dyeRGB(DYES[(i + 1) % 16]); col = [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)]; }
      r.drawEM(wm, r.etex('entity/sheep/sheep_wool' + (e.baby ? '_baby' : '')), m, lt, env, { overlay, tint: col });
    }
  }
  if (e.customName && this.drawNameTag) this.drawNameTag(e, ip, e.customName);
  if (e.deathTime === 0 && !e.displayMatrix) {
    const fx = Math.floor(ip[0]), fz = Math.floor(ip[2]);
    let gy = Math.floor(ip[1] + 0.01);
    for (let k = 0; k < 4 && gy > 0 && !SOLIDCUBE[this.world.getBlock(fx, gy - 1, fz)] && !BLOCKS[this.world.getBlock(fx, gy - 1, fz)].solid; k++) gy--;
    const h = ip[1] - gy; if (h < 3) r.drawShadow(ip[0], gy, ip[2], e.w * 0.75 * (1 - h / 6), 0.55 * (1 - h / 3));
  }
  return true;
};
// mobs named Dinnerbone or Grumm are drawn upside down (vanilla's easter egg)
function upsideDown(e, m) { if (e.customName === 'Dinnerbone' || e.customName === 'Grumm') { M4.translate(m, 0, e.h + 0.1, 0); M4.rotZ(m, Math.PI); } }
(() => {
  const _dm = Game.prototype.drawMob;
  Game.prototype.drawMob = function (e, ip, a, env, l) {
    if (!e.vm && FARM_SKIN[e.type] && e !== this.player && this.drawFarmMob(e, ip, a, env, l)) return;
    return _dm.call(this, e, ip, a, env, l);
  };
  const _pd = VMob.prototype.preDraw;
  const _dv = Game.prototype.drawVMob;
  Game.prototype.drawVMob = function (e, ip, a, env, l) {
    if (e.customName === 'Dinnerbone' || e.customName === 'Grumm') { const pd = e.preDraw; e.preDraw = function (m, aa) { upsideDown(this, m); if (pd) pd.call(this, m, aa); }; _dv.call(this, e, ip, a, env, l); if (pd) e.preDraw = pd; else delete e.preDraw; return; }
    return _dv.call(this, e, ip, a, env, l);
  };
})();

// ---- saddled pigs and striders ----------------------------------------------------------------------------------------------
const STICK_FOR = { pig: 'carrot_on_a_stick', strider: 'warped_fungus_on_a_stick' };
(() => {
  const _it = Mob.prototype.interact;
  Mob.prototype.interact = function (p, held) {
    if (_it && _it.call(this, p, held)) return true;
    const g = this.game, k = keyOfStack(held); // (equip.js: null for an id not in ITEMS - no throw)
    if (STICK_FOR[this.type] && !this.baby) {
      if (k === 'saddle' && !this.saddled) { this.saddled = true; useOne(g, p); Sound.ev('entity.' + this.type + '.saddle', this.pos, 0.5, 1); return true; }
      if (this.saddled && !p.vehicle && !p.sneaking && (!held || !(ITEMS[held.id] && ITEMS[held.id].spawnEgg))) { p.mount(this); return true; }
    }
    return nameTagUse(this, p, held) || leadUse(this, p, held);
  };
  Mob.prototype.seat = function () { return [this.pos[0], this.pos[1] + this.h * (this.type === 'strider' ? 1.0 : 0.62), this.pos[2]]; };
  const _tk = Mob.prototype.tick;
  Mob.prototype.tick = function () {
    if (!this.rider || this.vm || !STICK_FOR[this.type]) { _tk.call(this); if (this.leashHolder) this.leashTick(); return; }
    // ridden: goes where the rider looks while it holds the stick; a click with the stick gives a boost
    this.savePrev(); this.baseTick();
    if (this.deathTick()) return;
    // (an id not in ITEMS in the hand threw here every tick of the ride)
    const p = this.rider, held = p.inv.held, steer = !!held && keyOfStack(held) === STICK_FOR[this.type];
    if (this.boostT > 0) this.boostT--;
    let fwd = 0;
    if (steer) { this.yaw = p.yaw; fwd = 1; }
    this.bodyYaw += angDelta(this.yaw, this.bodyYaw) * 0.5;
    const base = this.type === 'pig' ? 0.225 : (this.inLava ? 0.35 : 0.2), s = base * (1 + (this.boostT > 0 ? Math.sin((this.boostT / 140) * Math.PI) * 1.15 : 0));
    if (this.collidedH && this.onGround && fwd) this.vel[1] = 0.42;
    if (this.type === 'strider' && this.inLava) { this.vel[1] = Math.max(this.vel[1], 0.05); }
    this.travel(fwd, 0, s * s * 1.5, false);
    if (this.type === 'strider' && this.inLava) { this.vel[1] = 0; const fy = Math.floor(this.pos[1]); if (this.world.getBlock(Math.floor(this.pos[0]), fy + 1, Math.floor(this.pos[2])) === LAVA) this.pos[1] += 0.1; }
    p.followVehicle(this);
    this.animate();
  };
})();
// the boost: right click with the stick while riding (it wears the stick)
(() => {
  const _ue = typeof useEquipment === 'function' ? useEquipment : null;
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, v = p.vehicle, held = p.inv.held;
    if (v && held && ITEMS[held.id] && STICK_FOR[v.type] === ITEMS[held.id].key && !v.vm && !(v.boostT > 0)) {
      v.boostT = 140 + randInt(0, 700) % 140; this.damageHeld(this.mode === 'creative' ? 0 : v.type === 'pig' ? 7 : 1); p.swing();
      if (held.dmg >= (ITEMS[held.id].durability || 1e9)) p.inv.slots[p.inv.sel] = makeStack('fishing_rod', 1);
      this.useCd = 10; return;
    }
    return _use.call(this);
  };
})();

// ---- name tags ------------------------------------------------------------------------------------------------------------------------
function nameTagUse(e, p, held) {
  if (!held || keyOfStack(held) !== 'name_tag' || !held.name || e === p) return false;
  e.customName = held.name; e.persistent = true;
  useOne(e.game, p);
  return true;
}
(() => {
  const _i = VMob.prototype.interact;
  VMob.prototype.interact = function (p, held) {
    if (nameTagUse(this, p, held)) return true;
    if (leadUse(this, p, held)) return true;
    return _i.call(this, p, held);
  };
})();
// the name over a named mob or a player: text on a dark plate in the world, facing the camera, 0.025 blocks a pixel
// (a fixed size over the head, like vanilla's). o: { color, max (distance), through: also seen through walls, faint
// (vanilla's nameplate when not sneaking), faded: the dim, walls-hide-it plate of one sneaking }
Game.prototype.drawNameTag = function (e, ip, name, o = {}) {
  const r = this.renderer, gl = r.gl;
  if (!this.player || e.distTo(this.player) > (o.max || 32)) return;
  // (a player's name prefix in front: the sign-in event's potato icon, cosmetics.js)
  if (typeof Cosmetics !== 'undefined') name = Cosmetics.tagName(this, e, name);
  if (!r.nameTex) r.nameTex = new Map();
  const col = o.color || '#FFFFFF', key = name + '|' + col;
  let nt = r.nameTex.get(key);
  if (!nt) {
    // three looks: the plate with the text (mobs), the plate with faint text (through walls / sneaking), the text alone
    const w = Font.width(name) + 2, mk = (plate, alpha) => {
      const c = document.createElement('canvas'); c.width = w * 2; c.height = 20;
      const x = c.getContext('2d'); if (plate) { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, c.width, c.height); }
      x.scale(2, 2); x.globalAlpha = alpha; Font.draw(x, name, 1, 1, col, false);
      return r.tex2D(c, false);
    };
    nt = { tex: mk(true, 1), faint: mk(true, 32 / 255), text: mk(false, 1), w, h: 10 };
    r.nameTex.set(key, nt);
    if (r.nameTex.size > 200) { const k = r.nameTex.keys().next().value, old = r.nameTex.get(k); for (const t of [old.tex, old.faint, old.text]) gl.deleteTexture(t); r.nameTex.delete(k); }
  }
  const T2 = r.progTex, cam = r.camPos;
  const y = ip[1] + (o.h ?? e.h * (e.renderScale ? e.renderScale(1) / (e.D && e.D.scale || 1) : 1)) + 0.5;
  const dx = cam[0] - ip[0], dz = cam[2] - ip[2], yaw = Math.atan2(dx, dz), dy = cam[1] - y, pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const s = 0.025, m = M4.create(); M4.translate(m, ip[0], y, ip[2]); M4.rotY(m, yaw); M4.rotX(m, -pitch); M4.rotX(m, Math.PI / 2); M4.scale(m, nt.w * s / 2, 1, nt.h * s / 2);
  gl.useProgram(T2.p);
  gl.uniformMatrix4fv(T2.u.u_vp, false, r.vp); gl.uniformMatrix4fv(T2.u.u_model, false, m);
  gl.uniform4f(T2.u.u_color, 1, 1, 1, 1);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE);
  gl.activeTexture(gl.TEXTURE0); gl.bindVertexArray(r.quadVao);
  const quad = (t) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0); };
  // the letters write depth (vanilla's NORMAL text does): without, clouds and water drawn later came over the tag
  // (feedback 11-01 22:24). On their letters only - vanilla's text shader drops texels under 0.1 alpha: a whole quad's
  // depth cut a box out of the water and clouds behind it (11-04, a named horse before a water wall: the plate's 5867
  // px showed the stone behind the water, grey 105 instead of the water's blue). The plates follow vanilla: the faint
  // see-through one (no depth test) and a mob's leave the depth alone (vanilla's mob plate is a see-through one), the
  // plate of one sneaking (NORMAL text_background) writes it
  const cut = () => {
    if (r.progTexCut === undefined) try { r.progTexCut = compile(gl, TEX_VS, TEX_FS.replace('o = t * u_color;', 'if (t.a < 0.1) discard; o = t * u_color;')); } catch (err) { r.progTexCut = null; }
    const T3 = r.progTexCut;
    if (T3) { gl.useProgram(T3.p); gl.uniformMatrix4fv(T3.u.u_vp, false, r.vp); gl.uniformMatrix4fv(T3.u.u_model, false, m); gl.uniform4f(T3.u.u_color, 1, 1, 1, 1); }
    return !!T3;
  };
  if (o.through) {
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); quad(nt.faint); gl.enable(gl.DEPTH_TEST);
    if (cut()) gl.depthMask(true);
    quad(nt.text);
  } else if (o.faded) { gl.depthMask(true); quad(nt.faint); }
  else {
    // (the letters' depth in a pass of its own, colour untouched: the picture is the plate's alone)
    gl.depthMask(false); quad(nt.tex);
    if (cut()) { gl.colorMask(false, false, false, false); gl.depthMask(true); quad(nt.text); gl.colorMask(true, true, true, true); }
  }
  gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
};
(() => {
  // old-style mobs show their names too
  const _dm = Game.prototype.drawMob;
  Game.prototype.drawMob = function (e, ip, a, env, l) { const r = _dm.call(this, e, ip, a, env, l); if (!e.vm && e.customName && !FARM_SKIN[e.type] && e !== this.player) this.drawNameTag(e, ip, e.customName); return r; };
})();

// ---- leads and lead knots ---------------------------------------------------------------------------------------------------------------
const LEASHABLE = (e) => e instanceof Mob && !(e.T.hostile && !['zoglin', 'hoglin'].includes(e.type)) && !['villager', 'wandering_trader', 'bat', 'ender_dragon', 'wither', 'warden', 'shulker'].includes(e.type);
function leadUse(e, p, held) {
  const g = e.game;
  if (e.leashHolder === p) { e.leashHolder = null; if (g.mode !== 'creative') g.dropItem(e.pos[0], e.pos[1] + 0.5, e.pos[2], makeStack('lead', 1)); Sound.ev('item.lead.untied', e.pos, 1, 1); return true; }
  if (held && keyOfStack(held) === 'lead' && LEASHABLE(e) && !e.leashHolder) { e.leashHolder = p; useOne(g, p); Sound.ev('item.lead.tied', e.pos, 1, 1); return true; }
  return false;
}
Mob.prototype.leashTick = function () {
  const h = this.leashHolder; if (!h) return;
  if (h.dead || (h.deathTime && h.deathTime > 0)) { this.leashHolder = null; return; }
  const d = this.distTo(h);
  if (d > 10) { this.leashHolder = null; if (!(h instanceof LeashKnot) || true) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('lead', 1)); Sound.ev('item.lead.break', this.pos, 1, 1); return; }
  if (d > 6) { const k = (d - 6) * 0.05, dx = h.pos[0] - this.pos[0], dy = h.pos[1] - this.pos[1], dz = h.pos[2] - this.pos[2]; this.vel[0] += dx / d * k; this.vel[1] += Math.max(0, dy / d * k); this.vel[2] += dz / d * k; }
  if (d > 4 && this.vm && !this.rider) this.goal = [h.pos[0], h.pos[1], h.pos[2]];
};
VMob.prototype.leashTick = Mob.prototype.leashTick;
// the knot on a fence post that holds leashed mobs
class LeashKnot extends Entity {
  constructor(g, x, y, z) { super(g, x + 0.5, y + 0.375, z + 0.5, 0.375, 0.5); this.post = [x, y, z]; this.isVehicle = false; this.knot = true; }
  tick() {
    this.savePrev(); this.age++;
    const [x, y, z] = this.post;
    if (!/fence$|_wall$/.test(BLOCKS[this.world.getBlock(x, y, z)].key) || (this.age % 20 === 0 && !this.game.entities.some(e => e.leashHolder === this))) {
      for (const e of this.game.entities) if (e.leashHolder === this) { e.leashHolder = null; this.game.dropItem(e.pos[0], e.pos[1], e.pos[2], makeStack('lead', 1)); }
      this.dead = true; Sound.ev('entity.leash_knot.break', this.pos, 1, 1);
    }
  }
  saveData() { return { post: this.post }; }
  loadData(o) { if (o && o.post) { this.post = o.post; this.pos = [o.post[0] + 0.5, o.post[1] + 0.375, o.post[2] + 0.5]; } }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, md = EM.get(r, 'leash_knot#main'), tex = r.etex('entity/lead_knot/lead_knot'); if (!md || !tex) return;
    EM.reset(md); const m = M4.create(); M4.translate(m, ip[0], ip[1] - 0.375 + 0.0625 * 0, ip[2]);
    r.drawEM(md, tex, m, l, env, {});
  }
}
// right click a fence holding a lead with mobs on it: they get tied to a knot on the post
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target;
    if (t && !this.targetEntity && /fence$/.test(BLOCKS[t.id].key) && !p.sneaking) {
      const mine = this.entities.filter(e => e.leashHolder === p);
      const [x, y, z] = t.pos;
      let knot = this.entities.find(e => e instanceof LeashKnot && e.post[0] === x && e.post[1] === y && e.post[2] === z);
      if (mine.length) {
        if (!knot) { knot = new LeashKnot(this, x, y, z); this.entities.push(knot); }
        for (const e of mine) e.leashHolder = knot;
        Sound.ev('entity.leash_knot.place', knot.pos, 1, 1); p.swing(); return;
      }
      if (knot && this.entities.some(e => e.leashHolder === knot)) { for (const e of this.entities) if (e.leashHolder === knot) e.leashHolder = p; knot.dead = true; p.swing(); return; }
      if (p.inv.held && keyOfStack(p.inv.held) === 'lead') {
        // a lead on a bare fence: a knot with nothing on it is not kept by vanilla either; nothing to do
      }
    }
    return _use.call(this);
  };
})();
// the rope: a sagging brown ribbon from the holder's hand to the mob
Renderer.prototype.drawRibbon = function (pts, w, col) {
  const gl = this.gl, C = this.progCol, v = [], cam = this.camPos;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    const tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2], vx = cam[0] - p[0], vy = cam[1] - p[1], vz = cam[2] - p[2];
    let nx = ty * vz - tz * vy, ny = tz * vx - tx * vz, nz = tx * vy - ty * vx; const l = Math.hypot(nx, ny, nz) || 1; nx *= w / l; ny *= w / l; nz *= w / l;
    const c = col(i / (pts.length - 1));
    v.push(p[0] - nx, p[1] - ny, p[2] - nz, ...c, p[0] + nx, p[1] + ny, p[2] + nz, ...c);
  }
  gl.useProgram(C.p);
  gl.uniformMatrix4fv(C.u.u_vp, false, this.vp); gl.uniformMatrix4fv(C.u.u_model, false, this.identity);
  gl.uniform4fv(C.u.u_color, [1, 1, 1, 1]); gl.uniform3fv(C.u.u_cam, this.camPos); gl.uniform2f(C.u.u_fog, 1e9, 2e9); gl.uniform1f(C.u.u_psize, 1);
  gl.bindVertexArray(this.lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  gl.disable(gl.CULL_FACE); gl.drawArrays(gl.TRIANGLE_STRIP, 0, v.length / 7); gl.enable(gl.CULL_FACE);
};
(() => {
  const _de = Game.prototype.drawEntities;
  Game.prototype.drawEntities = function (a, env) {
    const r = _de.call(this, a, env);
    for (const e of this.entities) {
      const h = e.leashHolder; if (!h || e.dead) continue;
      const ip = e.ipos(a), hp = h.ipos ? h.ipos(a) : h.pos;
      let hx = hp[0], hy = hp[1] + (h instanceof LeashKnot ? 0.25 : h.h * 0.7), hz = hp[2];
      if (h === this.player) { const yw = h.yaw; hx += -Math.cos(yw) * 0.35 * (this.perspective ? 1 : 0.6) - Math.sin(yw) * (this.perspective ? 0.1 : 0.4); hz += Math.sin(yw) * 0.35 * (this.perspective ? 1 : 0.6) - Math.cos(yw) * (this.perspective ? 0.1 : 0.4); hy = hp[1] + (this.perspective ? 1.0 : 1.3); }
      const ex = ip[0] - Math.sin(e.bodyYaw) * e.w * 0.4, ey = ip[1] + e.h * 0.7, ez = ip[2] - Math.cos(e.bodyYaw) * e.w * 0.4;
      const pts = [], n = 24;
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(hx, ex, t), lerp(hy, ey, t) - Math.sin(t * Math.PI) * 0.25 * Math.min(1, Math.hypot(hx - ex, hz - ez) / 4), lerp(hz, ez, t)]); }
      const L = e.lightAt(), k = Math.max(0.15, Math.max(L[0], L[1] * env.day));
      this.renderer.drawRibbon(pts, 0.025, (t) => { const dark = Math.floor(t * 24) % 2 ? 0.7 : 1; return [0.5 * k * dark, 0.4 * k * dark, 0.3 * k * dark, 1]; });
    }
    return r;
  };
})();

// ---- buckets with mobs in them; the powder snow bucket ---------------------------------------------------------------------------------------
const MOB_BUCKET = { cod_bucket: 'cod', salmon_bucket: 'salmon', pufferfish_bucket: 'pufferfish', tropical_fish_bucket: 'tropical_fish', axolotl_bucket: 'axolotl', tadpole_bucket: 'tadpole', sulfur_cube_bucket: 'sulfur_cube' };
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, w = this.world, held = p.inv.held, t = this.target, k = held && ITEMS[held.id] && ITEMS[held.id].key; // (an id not in ITEMS: no throw)
    if (k && MOB_BUCKET[k] && t && !this.targetEntity) {
      const D = DIRS[t.face], b = BLOCKS[t.id], rep = b.replaceable || IS_FLUID[t.id];
      const [x, y, z] = rep ? t.pos : [t.pos[0] + D[0], t.pos[1] + D[1], t.pos[2] + D[2]];
      const cur = w.getBlock(x, y, z);
      if (cur && !IS_FLUID[cur] && !BLOCKS[cur].replaceable) return;
      const water = k !== 'sulfur_cube_bucket';
      if (water && this.dim === 'nether') { Sound.fizz([x, y, z]); if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket'); p.swing(); return; }
      if (water) w.setBlock(x, y, z, WATER, 0);
      const m = createMob(this, MOB_BUCKET[k], x + 0.5, y + (water ? 0.2 : 0), z + 0.5);
      m.persistent = true; m.fromBucket = true;
      const o = held.mob || {};
      if (o.sz && m.size !== undefined) m.size = o.sz;
      if (o.v && m instanceof TropicalFish) [m.shape, m.pattern, m.base, m.pcol] = o.v;
      if (o.var !== undefined) m.variant = o.var;
      if (o.baby) { m.makeBaby(); m.growT = o.baby; }
      if (o.grow) m.grow = o.grow;
      if (o.blk !== undefined) m.block = o.blk;
      if (held.name) m.customName = held.name;
      this.entities.push(m);
      Sound.ev(k === 'axolotl_bucket' ? 'item.bucket.empty_axolotl' : k === 'tadpole_bucket' ? 'item.bucket.empty_tadpole' : k === 'sulfur_cube_bucket' ? 'item.bucket.empty_sulfur_cube' : 'item.bucket.empty_fish', [x, y, z], 1, 1);
      if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack(water ? 'bucket' : 'bucket');
      p.swing(); this.flushMesh(); return;
    }
    // powder snow: place it, or scoop it up with an empty bucket
    if (k === 'powder_snow_bucket' && t && !this.targetEntity && BID.powder_snow !== undefined) {
      const D = DIRS[t.face], [x, y, z] = BLOCKS[t.id].replaceable ? t.pos : [t.pos[0] + D[0], t.pos[1] + D[1], t.pos[2] + D[2]];
      const cur = w.getBlock(x, y, z);
      if (cur && !BLOCKS[cur].replaceable) return;
      w.setBlock(x, y, z, BID.powder_snow, 0); Sound.ev('item.bucket.empty_powder_snow', [x, y, z], 1, 1);
      if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket');
      p.swing(); this.flushMesh(); return;
    }
    if (k === 'bucket' && t && !this.targetEntity && BLOCKS[t.id].key === 'powder_snow') {
      w.setBlock(...t.pos, 0, 0); Sound.ev('item.bucket.fill_powder_snow', t.pos, 1, 1);
      swapHeld(this, p, 'powder_snow_bucket'); p.swing(); this.flushMesh(); return;
    }
    return _use.call(this);
  };
})();
// powder snow: things sink into it and freeze (leather boots let players walk on it)
(() => {
  const _bt = Living.prototype.baseTick;
  Living.prototype.baseTick = function () {
    _bt.call(this);
    if (BID.powder_snow === undefined) return;
    const x = Math.floor(this.pos[0]), z = Math.floor(this.pos[2]);
    const inSnow = this.world.getBlock(x, Math.floor(this.pos[1] + 0.1), z) === BID.powder_snow || this.world.getBlock(x, Math.floor(this.pos[1] + this.h * 0.8), z) === BID.powder_snow;
    if (inSnow) {
      this.vel[0] *= 0.9; this.vel[2] *= 0.9; if (this.vel[1] < -0.05) this.vel[1] = -0.05; this.fallDist = 0;
      if (!/^(stray|polar_bear|snow_golem|wither|skeleton_horse|wither_skeleton)$/.test(this.type) && !(this.inv && this.inv.slots[36] && ITEMS[this.inv.slots[36].id].key === 'leather_boots')) this.frozenT = Math.min(140, (this.frozenT || 0) + 1);
      if (this.jumpHeld) this.vel[1] = 0.1;
    } else if (this.frozenT > 0) this.frozenT = Math.max(0, this.frozenT - 2);
    if (this.frozenT >= 140 && this.age % 40 === 0) this.hurt(this.type === 'blaze' || this.type === 'strider' || this.type === 'magma_cube' ? 5 : 1, { type: 'freeze' });
  };
})();
