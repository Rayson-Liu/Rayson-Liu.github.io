'use strict';
// ---------------------------------------------------------------------------
// Hostile and neutral mobs drawn with the vanilla models (vmobs.js): skeleton kinds (stray, bogged, parched,
// wither skeleton), zombie kinds (husk, drowned, giant), cave spiders, silverfish, endermites, slimes, sulfur
// cubes, phantoms, witches, illagers (pillager, vindicator, evoker, illusioner) and vexes, ravagers, breezes,
// creakings, the warden, shulkers, piglin brutes, zoglins and the wither.
// ---------------------------------------------------------------------------
const diffMul = (g, d) => g.difficulty === 1 ? Math.min(d / 2 + 1, d) : g.difficulty === 3 ? d * 1.5 : d;
const lookVec = (e, t) => { const dx = t.pos[0] - e.pos[0], dy = t.pos[1] + t.h * 0.5 - (e.pos[1] + e.h * 0.85), dz = t.pos[2] - e.pos[2], l = Math.hypot(dx, dy, dz) || 1; return [dx / l, dy / l, dz / l, l]; };

// ---- humanoid monsters: an item in hand, armour, the humanoid animation ------------------------------------------
class Humanoid extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.hand = this.D.hand ? makeStack(typeof this.D.hand === 'function' ? this.D.hand(this) : this.D.hand, 1) : null; this.armorItems = []; this.persistent = false; }
  extraSave() { return { hand: this.hand, arm: this.armorItems }; }
  extraLoad(o) { if (o.hand !== undefined) this.hand = o.hand; if (o.arm) this.armorItems = o.arm; }
  setupAnim(md, a) {
    emHumanoid(md, this, a, { zombie: !!this.D.zombieArms, bow: !!(this.D.bow && this.target) });
    if (this.charging && md.parts.right_arm) { md.parts.right_arm.xRot = -Math.PI / 2 + md.parts.head.xRot; md.parts.left_arm.xRot = -Math.PI / 2 + md.parts.head.xRot; md.parts.left_arm.yRot = 0.6; }
  }
  attachments(g, md, lt, env) {
    if (!this.hand) return null;
    const st = this.hand;
    return { right_arm: (am) => g.drawHeldItem(am, st, false, lt, env, this, null) };
  }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (this.D.outer) { const om = EM.get(r, this.layerKey().replace('#main', '#outer')); if (om) { EM.reset(om); EM.copy(md, om); r.drawEM(om, r.etex(this.D.outer + (this.baby && this.D.outerBaby ? '_baby' : '')), m, lt, env, { overlay }); } }
    if (this.armorItems.some(s => s)) drawVArmor(g, r, this, md, m, lt, env, overlay);
  }
}
// worn armour on a vanilla humanoid model: the layer's helmet / chestplate / leggings / boots parts, the equipment texture
function drawVArmor(g, r, e, md, m, lt, env, overlay) {
  const base = e.layerKey().split('#')[0];
  ['helmet', 'chestplate', 'leggings', 'boots'].forEach((slot, i) => {
    const st = e.armorItems[i]; if (!st) return;
    const a = ITEMS[st.id].armor, mat = a && a.mat; if (!mat || mat === 'elytra') return;
    const am = EM.get(r, base + '#' + slot); if (!am) return;
    EM.reset(am); EM.copy(md, am);
    const dir = slot === 'leggings' ? 'humanoid_leggings' : 'humanoid', m2 = mat === 'golden' ? 'gold' : mat === 'chain' || mat === 'chainmail' ? 'chainmail' : mat === 'turtle' ? 'turtle_scute' : mat;
    r.drawEM(am, r.etex('entity/equipment/' + dir + '/' + m2), m, lt, env, { overlay, tint: m2 === 'leather' ? dyeTintOf(st, [160 / 255, 101 / 255, 64 / 255]) : null, cull: false });
    if (m2 === 'leather') r.drawEM(am, r.etex('entity/equipment/' + dir + '/leather_overlay'), m, lt, env, { overlay, cull: false });
  });
}
// random armour on spawn (vanilla: chance by difficulty, mostly leather / gold / chain / iron)
function randomArmor(e) {
  const g = e.game; if (Math.random() > 0.15 * (g.difficulty / 3)) return;
  const mat = pickW([['leather', 37], ['golden', 49], ['chainmail', 13], ['iron', 1]]);
  ['helmet', 'chestplate', 'leggings', 'boots'].forEach((s, i) => { if (Math.random() < (i === 0 ? 1 : 0.6)) { const k = mat + '_' + s; if (ITEM_KEY[k] !== undefined) e.armorItems[i] = makeStack(k, 1); } });
}

// ---- skeletons: keep their distance and shoot ---------------------------------------------------------------------
class SkeletonKind extends Humanoid {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); randomArmor(this); this.strafeT = 0; this.strafeDir = 1; }
  ranged(c, t, d) {
    if (this.D.melee) return this.chase(c, t, d);
    c.look = t;
    if (d > 15) { c.goal = [t.pos[0], t.pos[1], t.pos[2]]; this.drawT = 0; return; }
    if (d < 6) { const dx = this.pos[0] - t.pos[0], dz = this.pos[2] - t.pos[2], l = Math.hypot(dx, dz) || 1; c.goal = [this.pos[0] + dx / l * 3, this.pos[1], this.pos[2] + dz / l * 3]; c.mod = 0.8; }
    if (++this.strafeT > 20 && Math.random() < 0.3) { this.strafeDir *= -1; this.strafeT = 0; }
    c.strafe = this.strafeDir * 0.5;
    c.face = Math.atan2(-(t.pos[0] - this.pos[0]), -(t.pos[2] - this.pos[2]));
    if (!this.canSee(t)) { this.drawT = 0; return; }
    this.drawT = (this.drawT || 0) + 1;
    if (this.drawT >= (this.game.difficulty === 3 ? 20 : 40)) {
      this.drawT = 0;
      const [vx, vy, vz, l] = lookVec(this, t), sp = 1.6, err = (14 - this.game.difficulty * 4) * 0.0075;
      const arr = new Arrow(this.game, this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2], [vx * sp + (Math.random() - 0.5) * err, vy * sp + l * 0.2 * 0.05 + (Math.random() - 0.5) * err, vz * sp + (Math.random() - 0.5) * err], this);
      if (this.D.tip) arr.tip = makeStack('tipped_arrow', 1), arr.tip.pot = this.D.tip;
      arr.baseDmg = 2 + this.game.difficulty * 0.11;
      if (this.fire > 0) arr.fire = 100;
      this.game.entities.push(arr);
      Sound.ev('entity.' + (this.D.soundType || this.type) + '.shoot', this.pos, 1, 1 / (Math.random() * 0.4 + 0.8));
    }
  }
  melee(t) { super.melee(t); if (this.type === 'wither_skeleton' && t.addEffect) t.addEffect('wither', 0, 200); }
  setupAnim(md, a) {
    emHumanoid(md, this, a, { bow: !this.D.melee && !!this.target });
    if (this.D.melee && this.target && md.parts.right_arm) { const ra = md.parts.right_arm; ra.xRot = -Math.PI / 2 * 0.6 + (this.swingT > 0 ? -Math.sin((1 - this.swingT / 6) * Math.PI) * 1.2 : 0); }
  }
  // strays turn from skeletons in powder snow; skeletons in the hot desert don't burn as parched
}
for (const [t, o] of [['stray', { outer: 'entity/skeleton/stray_overlay', tip: 'slowness', tex: 'entity/skeleton/stray' }], ['bogged', { outer: 'entity/skeleton/bogged_overlay', tip: 'poison', tex: 'entity/skeleton/bogged' }],
  ['parched', { tex: 'entity/skeleton/parched', tip: 'weakness', burns: false }], ['wither_skeleton', { tex: 'entity/skeleton/wither_skeleton', melee: true, hand: 'stone_sword', burns: false }]]) {
  defVMob(t, { cls: SkeletonKind, hand: o.hand || 'bow', burns: o.burns !== false, xp: 5, shadowR: 0.4, bow: !o.melee, ...o, tex: () => o.tex, T: { hostile: true } });
}
// bogged can be sheared for their mushrooms
VMOB.bogged.postInteract = null;
SkeletonKind.prototype.postInteract = function (p, held) {
  if (this.type === 'bogged' && held && ITEMS[held.id].key === 'shears' && !this.sheared) { this.sheared = true; this.game.dropItem(this.pos[0], this.pos[1] + 1.7, this.pos[2], makeStack('brown_mushroom', 1)); this.game.dropItem(this.pos[0], this.pos[1] + 1.7, this.pos[2], makeStack('red_mushroom', 1)); Sound.ev('entity.bogged.shear', this.pos, 1, 1); this.game.damageHeld(1); return true; }
  return false;
};
(() => { const _s = SkeletonKind.prototype.setupAnim; SkeletonKind.prototype.setupAnim = function (md, a) { _s.call(this, md, a); if (this.type === 'bogged' && md.parts.mushrooms) md.parts.mushrooms.visible = !this.sheared; }; })();

// ---- zombie kinds: husks (hunger, no burning), drowned (swim, tridents), giants ------------------------------------------
class ZombieKind extends Humanoid {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z); randomArmor(this);
    if (type === 'drowned') { const r = Math.random(); this.hand = r < 0.0625 ? makeStack('trident', 1) : r < 0.1 ? makeStack('fishing_rod', 1) : Math.random() < 0.03 ? makeStack('nautilus_shell', 1) : null; this.waterBreather = true; }
    if (Math.random() < 0.05 && type !== 'giant') this.makeBaby();
  }
  get ai() { return this.type === 'drowned' && this.inWater ? 'amph' : 'ground'; }
  makeBaby() { super.makeBaby(); this.growT = 1e12; return this; }
  // (vanilla Drowned.okTarget: at night, or a target in the water - by day one in the water hunted players on dry land too)
  wantsPlayer() { return this.game.difficulty > 0 && (this.type !== 'drowned' || !this.game.isDay() || this.game.player.inWater); }
  huntTarget() { if ((this.age + this.id) % 20) return null; return this.game.entities.find(e => !e.dead && !e.deathTime && (e.type === 'villager' || e.type === 'wandering_trader' || e.type === 'iron_golem' || (e.type === 'turtle' && e.baby)) && e.distTo(this) < 16 && this.canSee(e)) || null; }
  ranged(c, t, d) {
    // drowned with a trident throw it from a distance
    if (this.hand && ITEMS[this.hand.id].key === 'trident' && d > 3 && d < 16 && this.canSee(t)) {
      c.look = t; c.face = Math.atan2(-(t.pos[0] - this.pos[0]), -(t.pos[2] - this.pos[2])); this.charging = true;
      if (this.attackCd <= 0) {
        this.attackCd = 40; this.charging = false;
        const [vx, vy, vz, l] = lookVec(this, t);
        const tr = typeof ThrownTrident !== 'undefined' ? new ThrownTrident(this.game, this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2], [vx * 1.6, vy * 1.6 + l * 0.01, vz * 1.6], this, makeStack('trident', 1)) : new Arrow(this.game, this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2], [vx * 1.6, vy * 1.6, vz * 1.6], this);
        tr.noPickup = true; tr.baseDmg = 8;
        this.game.entities.push(tr); Sound.ev('entity.drowned.shoot', this.pos, 1, 1);
      }
      return;
    }
    this.charging = false;
    this.chase(c, t, d);
  }
  melee(t) {
    super.melee(t);
    if (this.type === 'husk' && t.addEffect) t.addEffect('hunger', 0, 140 * this.game.difficulty);
    if (t === this.game.player && Math.random() < 0.05 * this.game.difficulty && this.type !== 'giant') this.callHelp = true;
  }
  texKey(r) { return r.etex(this.D.tex2 + (this.baby && this.type !== 'giant' ? '_baby' : '')); }
  moveBy(c) {
    if (this.type === 'drowned' && this.inWater) {
      // drowned swim toward their target (or sink to the bottom)
      if (c.goal) { const dy = c.goal[1] - this.pos[1]; this.vel[1] += clamp(dy, -1, 1) * 0.01; }
      else this.vel[1] -= 0.005;
      const s = this.T.speed * 0.6;
      if (c.goal) { const dx = c.goal[0] - this.pos[0], dz = c.goal[2] - this.pos[2], l = Math.hypot(dx, dz); if (l > 0.3) { this.turnTo(Math.atan2(-dx, -dz), 0.3); this.vel[0] += dx / l * s * 0.1; this.vel[2] += dz / l * s * 0.1; } }
      this.move(this.vel[0], this.vel[1], this.vel[2]); this.vel[0] *= 0.9; this.vel[1] *= 0.9; this.vel[2] *= 0.9;
      this.bodyYaw += angDelta(this.yaw, this.bodyYaw) * 0.3; return;
    }
    super.moveBy(c);
  }
}
const ZD = (t, tex, o = {}) => defVMob(t, { cls: ZombieKind, zombieArms: true, burns: true, xp: 5, shadowR: 0.4, tex2: tex, T: { hostile: true, attack: 3 }, ...o });
ZD('husk', 'entity/zombie/husk', { burns: false });
ZD('drowned', 'entity/zombie/drowned', { outer: 'entity/zombie/drowned_outer_layer', outerBaby: true, waterOk: true, sinks: true });
ZD('giant', 'entity/zombie/zombie', { burns: false, layer: 'giant#main', shadowR: 3, T: { hostile: true, attack: 50 } });

// ---- cave spiders: small, poisonous, climb walls -------------------------------------------------------------------------
class CaveSpider extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.persistent = false; }
  wantsPlayer() { return this.game.difficulty > 0 && (!this.game.isDay() || this.world.skyAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 1), Math.floor(this.pos[2])) < 8 || this.anger > 0); }
  melee(t) { super.melee(t); const d = this.game.difficulty; if (d >= 2 && t.addEffect) t.addEffect('poison', 0, (d === 3 ? 15 : 7) * 20); }
  fight(c) { const t = this.target, d = this.distTo(t); if (this.onGround && d < 4 && d > 2 && Math.random() < 0.1) { const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], l = Math.hypot(dx, dz) || 1; this.vel[1] = 0.4; this.vel[0] += dx / l * 0.3; this.vel[2] += dz / l * 0.3; } VMob.prototype.fight.call(this, c); }
  setupAnim(md, a) { spiderAnim(md, this, a); }
  texKey(r) { return r.etex('entity/spider/cave_spider'); }
  drawLayers(g, r, md, m, a, env) { const t = r.etex('entity/spider/spider_eyes'); if (t) r.drawEMGlow(md, t, m, env, {}); }
}
function spiderAnim(md, e, a) {
  const P = md.parts, [pos, spd] = emLimbs(e, a);
  emHead(P.head, e, a);
  const legs = [['right_hind_leg', 'left_hind_leg'], ['right_middle_hind_leg', 'left_middle_hind_leg'], ['right_middle_front_leg', 'left_middle_front_leg'], ['right_front_leg', 'left_front_leg']];
  legs.forEach(([rn, ln], i) => {
    const ph = [0, Math.PI, Math.PI / 2, Math.PI * 1.5][i];
    const y = -Math.cos(pos * 0.6662 * 2 + ph) * 0.4 * spd, z = Math.abs(Math.sin(pos * 0.6662 + ph)) * 0.4 * spd;
    if (P[rn]) { P[rn].yRot += y; P[rn].zRot += z; }
    if (P[ln]) { P[ln].yRot -= y; P[ln].zRot -= z; }
  });
}
defVMob('cave_spider', { cls: CaveSpider, climbs: true, xp: 5, shadowR: 0.35, T: { hostile: true, attack: 2 } });

// ---- silverfish and endermites: small crawling pests ---------------------------------------------------------------------------
class Crawler extends VMob {
  wantsPlayer() { return this.game.difficulty > 0; }
  onAttacked(src) {
    // silverfish wake the ones hiding in infested blocks nearby
    if (this.type !== 'silverfish') return;
    const w = this.world, x0 = Math.floor(this.pos[0]), y0 = Math.floor(this.pos[1]), z0 = Math.floor(this.pos[2]);
    for (let dx = -5; dx <= 5; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) {
      const k = BLOCKS[w.getBlock(x0 + dx, y0 + dy, z0 + dz)].key;
      if (k && k.startsWith('infested_') && Math.random() < 0.3) { w.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0); const s = spawnAt(this.game, 'silverfish', x0 + dx + 0.5, y0 + dy, z0 + dz + 0.5); s.target = src.attacker; s.persistent = false; }
    }
  }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    for (let i = 0; i < 7; i++) { const n = P['segment' + i]; if (!n) continue; n.yRot = Math.cos(t * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.05 * (1 + Math.abs(i - 2)); n.x = Math.sin(t * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.2 * Math.abs(i - 2); }
    for (let i = 0; i < 3; i++) { const n = P['layer' + i], s = P['segment' + [2, 4, 1][i]]; if (n && s) { n.yRot = s.yRot; n.x = s.x; } }
  }
  texKey(r) { return r.etex('entity/' + this.type + '/' + this.type); }
}
defVMob('silverfish', { cls: Crawler, xp: 5, shadowR: 0.3, T: { hostile: true, attack: 1 }, stepSound: true });
defVMob('endermite', { cls: Crawler, xp: 3, shadowR: 0.3, T: { hostile: true, attack: 2 }, despawnT: 2400 });

// ---- slimes and sulfur cubes: hop, split when they die --------------------------------------------------------------------------
class Slime extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.setSize([1, 2, 4][randInt(0, 2)]); this.squish = 0; this.prevSquish = 0; this.jumpT = randInt(10, 30); this.persistent = false; }
  setSize(s) { this.size = s; this.w = this.h = 0.52 * s; this.maxHealth = this.health = s * s; this.T = { ...MOB_TYPES[this.type], speed: 0.2 + 0.1 * s, attack: s > 1 ? s : 0 }; }
  extraSave() { return { sz: this.size }; }
  extraLoad(o) { if (o.sz) { const h = this.health; this.setSize(o.sz); this.health = Math.min(h, this.maxHealth); } }
  wantsPlayer() { return this.size > 1 && this.game.difficulty > 0; }
  think(c) { VMob.prototype.think.call(this, c); if (!this.target && !c.goal && Math.random() < 0.02) this.goal = this.randomGoal(8, 2); }
  moveBy(c) {
    this.prevSquish = this.squish; this.squish *= 0.6;
    if (this.onGround) {
      if (this.wasAir) { this.squish = -0.5; this.sound(this.size > 1 ? 'squish' : 'squish_small', 0.4 * this.size); }
      this.wasAir = false;
      if (--this.jumpT <= 0 && (c.goal || this.target)) {
        const gq = c.goal || this.target.pos, dx = gq[0] - this.pos[0], dz = gq[2] - this.pos[2], l = Math.hypot(dx, dz) || 1;
        this.yaw = Math.atan2(-dx, -dz); this.vel[1] = 0.42; const s = this.T.speed * 0.35; this.vel[0] = dx / l * s; this.vel[2] = dz / l * s;
        this.jumpT = this.target ? randInt(5, 15) : randInt(10, 30); this.squish = 1; this.sound(this.size > 1 ? 'jump' : 'jump_small', 0.4 * this.size);
      }
    } else this.wasAir = true;
    this.travel(0, 0, 0, false);
    if (!this.onGround) { const v = this.vel; this.move(0, 0, 0); v[0] *= 1.0; v[2] *= 1.0; }
    this.bodyYaw += angDelta(this.yaw, this.bodyYaw) * 0.5;
  }
  afterMove() {
    // touching damage from big slimes
    const t = this.target;
    if (t && this.size > 1 && this.attackCd <= 0 && this.distTo(t) < this.w * 0.6 + t.w * 0.5 + 0.3) { this.attackCd = 10; t.hurt(diffMul(this.game, this.T.attack), { type: 'mob', attacker: this, knockFrom: this.pos }); this.sound('attack'); }
  }
  fight(c) { c.look = this.target; c.goal = [...this.target.pos]; }
  onDeath() {
    if (this.size <= 1) return;
    for (let i = 0, n = randInt(2, 4); i < n; i++) { const s = createMob(this.game, this.type, this.pos[0] + (Math.random() - 0.5) * this.w / 2, this.pos[1] + 0.5, this.pos[2] + (Math.random() - 0.5) * this.w / 2); s.setSize(this.size / 2); s.persistent = this.persistent; if (this.customName) s.customName = this.customName; this.game.entities.push(s); }
  }
  layerKey() { return 'slime#main'; }
  renderScale(a) { return 0.999 * this.size; }
  preDraw(m, a) { const sq = lerp(this.prevSquish, this.squish, a) / (this.size * 0.5 + 1), k = 1 / (sq + 1); M4.scale(m, 1 / k, k, 1 / k); }
  setupAnim() { }
  texKey(r) { return r.etex('entity/slime/slime'); }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    const om = EM.get(r, 'slime#outer'), gl = r.gl; if (!om) return;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    r.drawEM(om, r.etex('entity/slime/slime'), m, lt, env, { overlay });
    gl.disable(gl.BLEND);
  }
}
defVMob('slime', { cls: Slime, xp: 0, shadowR: 0.25, T: { hostile: true }, stepSound: false, noDeathFlip: false });
VMOB.slime.loot = 'slime';
(() => { const _x = VMob.prototype.die; Slime.prototype.die = function (src) { this.D.xp = this.size; _x.call(this, src); }; })();
// sulfur cubes (26.2): bouncy cubes that swallow a block and carry it; grow on slime balls, fit in a bucket when small
class SulfurCube extends Slime {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.setSize(Math.random() < 0.5 ? 1 : 2); this.block = null; }
  setSize(s) { this.size = s; this.w = this.h = 0.49 * s; this.maxHealth = this.health = 10 * s; this.T = { ...MOB_TYPES[this.type], speed: 0.25, attack: 0 }; }
  extraSave() { return { sz: this.size, blk: this.block }; }
  extraLoad(o) { if (o.sz) this.setSize(o.sz); this.block = o.blk || null; }
  wantsPlayer() { return false; }
  onDeath() { if (this.block) this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], this.block); }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (k === 'slime_ball' && this.size < 2) { this.setSize(2); useOne(g, p); this.sound('eat'); return true; }
    if (k === 'bucket' && this.size === 1 && ITEM_KEY.sulfur_cube_bucket !== undefined) { swapHeld(g, p, 'sulfur_cube_bucket', { mob: { blk: this.block } }); this.dead = true; Sound.ev('item.bucket.fill_sulfur_cube', this.pos, 1, 1); return true; }
    if (held && ITEMS[held.id].block !== undefined && !this.block && SOLIDCUBE[ITEMS[held.id].block]) { this.block = { ...held, count: 1 }; useOne(g, p); this.sound('absorb'); return true; }
    if (!held && this.block) { g.dropItem(this.pos[0], this.pos[1] + this.h, this.pos[2], this.block); this.block = null; this.sound('eject'); return true; }
    return false;
  }
  layerKey() { return this.size > 1 ? 'sulfur_cube#main' : 'sulfur_cube_small#main'; }
  renderScale() { return 1; }
  preDraw(m, a) { M4.translate(m, 0, this.h / 2, 0); const sq = lerp(this.prevSquish, this.squish, a) * 0.3, k = 1 / (sq + 1); M4.scale(m, 1 / k, k, 1 / k); M4.translate(m, 0, -1.501, 0); }
  texKey(r) { return r.etex('entity/sulfur_cube/sulfur_cube_inner' + (this.size > 1 ? '' : '_small')); }
  drawVM(g, r, m, a, env, lt, overlay) {
    const big = this.size > 1, im = EM.get(r, big ? 'sulfur_cube#inner' : 'sulfur_cube_small#inner'), om = EM.get(r, this.layerKey());
    if (im) r.drawEM(im, this.texKey(r), m, lt, env, { overlay });
    // the swallowed block, inside
    if (this.block && g.blockMesh && ITEMS[this.block.id].block !== undefined) { const mm = M4.copy(m); M4.translate(mm, 0, 1.501, 0); const s = big ? 0.55 : 0.3; M4.translate(mm, -s / 2, -s / 2, -s / 2); M4.scale(mm, s, s, s); r.drawMesh(g.blockMesh(ITEMS[this.block.id].block, 0), mm, env, lt); }
    if (om) { const gl = r.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); r.drawEM(om, r.etex('entity/sulfur_cube/sulfur_cube_outer' + (big ? '' : '_small')), m, lt, env, { overlay }); gl.disable(gl.BLEND); }
  }
}
defVMob('sulfur_cube', { cls: SulfurCube, xp: 1, shadowR: 0.3, T: { hostile: false, passive: true }, stepSound: false });

// ---- phantoms: circle overhead at night, swoop at players who haven't slept ---------------------------------------------------
class Phantom extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.circle = [x, y, z]; this.ang = Math.random() * Math.PI * 2; this.swoop = 0; this.size = 0; this.persistent = false; }
  wantsPlayer() { return this.game.difficulty > 0; }
  think(c) {
    const g = this.game, p = g.player;
    this.ang += 0.04;
    if (this.target && this.swoop <= 0 && this.age % 100 === 0 && Math.random() < 0.5) this.swoop = 60;
    if (this.target && this.swoop > 0) {
      this.swoop--;
      const t = this.target; c.goal = [t.pos[0], t.pos[1] + t.h * 0.5, t.pos[2]]; c.mod = 2;
      if (this.distTo(t) < 1.5 && this.attackCd <= 0) { this.melee(t); this.swoop = 0; this.circle = [t.pos[0], t.pos[1] + 20 + randInt(0, 10), t.pos[2]]; this.sound('bite'); }
      return;
    }
    if (this.target) this.circle = [this.target.pos[0], Math.max(this.circle[1], this.target.pos[1] + 15), this.target.pos[2]];
    c.goal = [this.circle[0] + Math.cos(this.ang) * 12, this.circle[1] + Math.sin(this.ang * 2) * 2, this.circle[2] + Math.sin(this.ang) * 12];
    if (this.age % 40 === 0) this.sound('swoop', 0.3);
  }
  setupAnim(md, a) {
    const P = md.parts, t = (this.age + this.id * 3 + a) * 7.448451 * Math.PI / 180, f = Math.cos(t) * 16 * Math.PI / 180;
    if (P.left_wing_base) P.left_wing_base.zRot = f; if (P.left_wing_tip) P.left_wing_tip.zRot = f;
    if (P.right_wing_base) P.right_wing_base.zRot = -f; if (P.right_wing_tip) P.right_wing_tip.zRot = -f;
    if (P.tail_base) P.tail_base.xRot = -(5 + Math.cos(t * 2) * 5) * Math.PI / 180; if (P.tail_tip) P.tail_tip.xRot = -(5 + Math.cos(t * 2) * 5) * Math.PI / 180;
  }
  preDraw(m) { M4.translate(m, 0, 1.3125, 0.1875); M4.rotX(m, -(this.pitch3 || 0)); }
  texKey(r) { return r.etex('entity/phantom/phantom'); }
  drawLayers(g, r, md, m, a, env) { const t = r.etex('entity/phantom/phantom_eyes'); if (t) r.drawEMGlow(md, t, m, env, {}); }
}
defVMob('phantom', { cls: Phantom, ai: 'fly', burns: true, xp: 5, shadowR: 0.75, T: { hostile: true, attack: 6, flySpeed: 0.6 }, speed3: 2, noDeathFlip: false, stepSound: false });
// phantoms come for players who haven't slept for three nights (vanilla's insomnia, the TIME_SINCE_REST stat), at night,
// from the sea level up under open sky (PhantomSpawner). Lying down in a bed sets the count back (trySleep below): it never
// did, so after an hour of play they came every night, sleeping or not - "睡觉时还会刷幻翼", feedback 2026-11-02. And none
// by day in the rain: vanilla needs the sky darkened by 5, which by day takes a thunderstorm (there are none here)
Game.prototype.trySpawnPhantoms = function () {
  const p = this.player, w = this.world;
  if (this.difficulty === 0 || p.creative || (this.dim && this.dim !== 'overworld')) return;
  p.sinceRest = (p.sinceRest || 0) + 1200;
  if (this.sleeping || spawnDarken(this) < 5) return;
  if (p.sinceRest < 72000 || Math.random() * p.sinceRest < 72000) return;
  if (Math.floor(p.pos[1]) < SEA + 1 || w.skyAt(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 2), Math.floor(p.pos[2])) < 15) return;
  const n = 1 + randInt(0, this.difficulty);
  for (let i = 0; i < n; i++) { const m = spawnAt(this, 'phantom', p.pos[0] + randInt(-10, 10), p.pos[1] + 20 + randInt(0, 14), p.pos[2] + randInt(-10, 10)); m.persistent = false; m.target = p; }
};
(() => { const _sleep = Game.prototype.trySleep; Game.prototype.trySleep = function (...a) { const r = _sleep.apply(this, a); if (this.sleeping && this.player) this.player.sinceRest = 0; return r; }; })();

// ---- witches: throw harmful potions, drink helpful ones -----------------------------------------------------------------------------
class Witch extends Humanoid {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.hand = null; this.drinkT = 0; }
  ranged(c, t, d) {
    c.look = t;
    if (this.drinkT > 0) return;
    if (d > 8) c.goal = [t.pos[0], t.pos[1], t.pos[2]];
    if (this.attackCd <= 0 && d < 10 && this.canSee(t)) {
      this.attackCd = 60;
      const hasFx = (k) => t.hasEffect && t.hasEffect(k);
      const pot = d >= 8 && !hasFx('slowness') ? 'slowness' : t.health >= 8 && !hasFx('poison') ? 'poison' : d <= 3 && !hasFx('weakness') && Math.random() < 0.25 ? 'weakness' : 'harming';
      const [vx, vy, vz, l] = lookVec(this, t), st = makeStack('splash_potion', 1); st.pot = pot;
      if (typeof ThrownPotion !== 'undefined') this.game.entities.push(new ThrownPotion(this.game, this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2], [vx * 0.75, vy * 0.75 + l * 0.02 + 0.2, vz * 0.75], this, st));
      this.sound('throw');
    }
  }
  think(c) {
    if (this.drinkT > 0) {
      if (--this.drinkT === 0 && this.hand) { const k = this.hand.pot; for (const [e, t, amp] of (typeof POTIONS !== 'undefined' && POTIONS[k]) || []) { if (e === 'instant_health') this.health = Math.min(this.maxHealth, this.health + 4 * (amp + 1)); else if (this.addEffect) this.addEffect(e, amp, t); } this.hand = null; }
      return;
    }
    const pot = this.inWater && this.air < 200 ? 'water_breathing' : this.fire > 0 ? 'fire_resistance' : this.health < this.maxHealth && Math.random() < 0.05 ? 'healing' : this.target && this.distTo(this.target) > 11 && Math.random() < 0.05 ? 'swiftness' : null;
    if (pot) { this.hand = makeStack('potion', 1); this.hand.pot = pot; this.drinkT = 32; this.sound('drink'); return; }
    VMob.prototype.think.call(this, c);
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a);
    if (P.right_leg) P.right_leg.xRot = Math.cos(pos * 0.6662) * 1.4 * spd * 0.5;
    if (P.left_leg) P.left_leg.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd * 0.5;
    if (P.nose) { P.nose.x = 0; P.nose.z = 0; if (this.drinkT > 0) P.nose.y = -2 + Math.sin(this.age * 0.8) * 0.5; }
  }
  attachments(g, md, lt, env) {
    if (!this.hand) return null; const st = this.hand;
    return { arms: (am) => { M4.translate(am, 0, 0.25, -0.15); M4.rotX(am, Math.PI); M4.scale(am, 0.75, 0.75, 0.75); g.drawHeldItem(am, st, false, lt, env, this, null); } };
  }
  texKey(r) { return r.etex('entity/witch/witch'); }
}
defVMob('witch', { cls: Witch, xp: 5, shadowR: 0.4, T: { hostile: true }, immune: [] });

// ---- illagers -----------------------------------------------------------------------------------------------------------------------------
class Illager extends Humanoid {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.spellT = 0; this.spell = null; this.persistent = false; }
  huntTarget() { if ((this.age + this.id) % 20) return null; return this.game.entities.find(e => !e.dead && !e.deathTime && (e.type === 'villager' || e.type === 'wandering_trader' || e.type === 'iron_golem') && e.distTo(this) < 16 && this.canSee(e)) || null; }
  get aggressive() { return !!this.target; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a);
    if (P.right_leg) P.right_leg.xRot = Math.cos(pos * 0.6662) * 1.4 * spd * 0.5;
    if (P.left_leg) P.left_leg.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd * 0.5;
    const crossed = !(this.target || this.spellT > 0 || this.charging || this.type === 'pillager' && this.hand);
    if (P.arms) P.arms.visible = crossed;
    if (P.right_arm) P.right_arm.visible = !crossed;
    if (P.left_arm) P.left_arm.visible = !crossed;
    if (crossed) return;
    const t = this.age + a;
    if (this.spellT > 0) {
      // spellcasting: both arms up, waving
      P.right_arm.z = 0; P.right_arm.x = -5; P.left_arm.z = 0; P.left_arm.x = 5;
      P.right_arm.xRot = Math.cos(t * 0.6662) * 0.25; P.left_arm.xRot = Math.cos(t * 0.6662) * 0.25;
      P.right_arm.zRot = 2.3561945; P.left_arm.zRot = -2.3561945; P.right_arm.yRot = 0; P.left_arm.yRot = 0;
    } else if (this.charging || (this.type === 'pillager' && this.target)) {
      // crossbow held up and aimed
      P.right_arm.yRot = -0.3 + P.head.yRot; P.left_arm.yRot = 0.6 + P.head.yRot;
      P.right_arm.xRot = -Math.PI / 2 + P.head.xRot + 0.1; P.left_arm.xRot = -1.5 + P.head.xRot;
    } else {
      // melee: arms forward, swinging the weapon
      const s = this.swingT > 0 ? Math.sin((1 - this.swingT / 6) * Math.PI) : 0;
      P.right_arm.xRot = -Math.PI / 2 * 0.8 - s * 1.2; P.left_arm.xRot = Math.cos(pos * 0.6662) * 0.5 * spd;
    }
  }
  texKey(r) { return r.etex('entity/illager/' + this.type); }
}
class Pillager extends Illager {
  ranged(c, t, d) {
    c.look = t;
    if (d > 12) { c.goal = [t.pos[0], t.pos[1], t.pos[2]]; this.charging = false; return; }
    if (d < 5) { const dx = this.pos[0] - t.pos[0], dz = this.pos[2] - t.pos[2], l = Math.hypot(dx, dz) || 1; c.goal = [this.pos[0] + dx / l * 3, this.pos[1], this.pos[2] + dz / l * 3]; }
    c.face = Math.atan2(-(t.pos[0] - this.pos[0]), -(t.pos[2] - this.pos[2]));
    this.charging = true;
    if (!this.canSee(t)) return;
    this.loadT = (this.loadT || 0) + 1;
    if (this.loadT === 1) Sound.ev('item.crossbow.loading_start', this.pos, 1, 1);
    if (this.loadT >= 25 && this.attackCd <= 0) {
      this.loadT = 0; this.attackCd = 20 + randInt(0, 20);
      const [vx, vy, vz, l] = lookVec(this, t), sp = 1.6;
      const arr = new Arrow(this.game, this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2], [vx * sp, vy * sp + l * 0.015, vz * sp], this);
      arr.baseDmg = 3; this.game.entities.push(arr); Sound.ev('item.crossbow.shoot', this.pos, 1, 1);
    }
  }
  attachments(g, md, lt, env) { const st = this.hand; if (!st) return null; const k = this.target ? 'right_arm' : 'right_arm'; return { [k]: (am) => g.drawHeldItem(am, st, false, lt, env, this, null) }; }
}
class Vindicator extends Illager {
  get johnny() { return this.customName === 'Johnny'; }
  huntTarget() { if (this.johnny && (this.age + this.id) % 20 === 0) return this.game.entities.find(e => e instanceof Mob && e !== this && !e.dead && e.distTo(this) < 16 && !(e instanceof Illager) && e.type !== 'ravager') || null; return super.huntTarget(); }
  attachments(g, md, lt, env) { if (!this.target || !this.hand) return null; const st = this.hand; return { right_arm: (am) => g.drawHeldItem(am, st, false, lt, env, this, null) }; }
}
class Evoker extends Illager {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.hand = null; this.castCd = 0; }
  ranged(c, t, d) {
    c.look = t;
    if (this.spellT > 0) {
      if (--this.spellT === 0) this.castSpell(t);
      return;
    }
    if (d < 8) { const dx = this.pos[0] - t.pos[0], dz = this.pos[2] - t.pos[2], l = Math.hypot(dx, dz) || 1; c.goal = [this.pos[0] + dx / l * 4, this.pos[1], this.pos[2] + dz / l * 4]; c.mod = 0.6; }
    else if (d > 12) c.goal = [t.pos[0], t.pos[1], t.pos[2]];
    if (--this.castCd <= 0 && this.canSee(t)) {
      const vexes = this.game.entities.filter(e => e.type === 'vex' && !e.dead && e.distTo(this) < 16).length;
      this.spell = vexes < 8 && Math.random() < 0.4 ? 'vex' : 'fangs';
      this.spellT = this.spell === 'vex' ? 100 : 40; this.castCd = this.spell === 'vex' ? 340 : 100;
      Sound.ev(this.spell === 'vex' ? 'entity.evoker.prepare_summon' : 'entity.evoker.prepare_attack', this.pos, 1, 1);
    }
  }
  castSpell(t) {
    const g = this.game;
    if (this.spell === 'vex') { for (let i = 0; i < 3; i++) { const v = spawnAt(g, 'vex', this.pos[0] + randInt(-2, 2), this.pos[1] + 1, this.pos[2] + randInt(-2, 2)); v.owner = this; v.target = t; v.life = 30 * (20 + randInt(0, 90)); v.persistent = false; } Sound.ev('entity.evoker.cast_spell', this.pos, 1, 1); return; }
    // a line of fangs toward the target, or a ring around itself when it is close
    const near = this.distTo(t) < 3;
    if (near) { for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; evokerFang(g, this, this.pos[0] + Math.cos(a) * 1.5, this.pos[2] + Math.sin(a) * 1.5, 0); } for (let i = 0; i < 8; i++) { const a = i * Math.PI * 2 / 8 + 1.2566371; evokerFang(g, this, this.pos[0] + Math.cos(a) * 2.5, this.pos[2] + Math.sin(a) * 2.5, 3); } }
    else { const a = Math.atan2(t.pos[2] - this.pos[2], t.pos[0] - this.pos[0]); for (let i = 0; i < 16; i++) { const d = 1.25 * (i + 1); evokerFang(g, this, this.pos[0] + Math.cos(a) * d, this.pos[2] + Math.sin(a) * d, i); } }
    Sound.ev('entity.evoker.cast_spell', this.pos, 1, 1);
  }
}
// evoker fangs: snap shut a moment after appearing, biting what stands on them
class EvokerFangs extends Entity {
  constructor(g, x, y, z, delay, owner) { super(g, x, y, z, 0.5, 0.8); this.delay = delay; this.owner = owner; this.life = 0; this.yaw = Math.random() * Math.PI * 2; }
  tick() {
    this.savePrev();
    if (--this.delay > 0) return;
    this.life++;
    if (this.life === 1) Sound.ev('entity.evoker_fangs.attack', this.pos, 1, Math.random() * 0.2 + 0.85);
    if (this.life === 4) for (const e of this.game.entities) if (e instanceof Living && e !== this.owner && !(e instanceof Illager) && !e.dead && Math.abs(e.pos[0] - this.pos[0]) < 0.6 + e.w / 2 && Math.abs(e.pos[2] - this.pos[2]) < 0.6 + e.w / 2 && Math.abs(e.pos[1] - this.pos[1]) < 1) e.hurt(6, { type: 'magic', attacker: this.owner });
    if (this.life > 22) this.dead = true;
  }
  drawSelf(g, ip, a) {
    if (this.delay > 0) return;
    const r = g.renderer, md = EM.get(r, 'evoker_fangs#main'), tex = r.etex('entity/illager/evoker_fangs'); if (!md || !tex) return;
    EM.reset(md);
    const t = Math.min(1, (this.life + a) / 20), bite = t > 0.9 ? 1 : 0, open = Math.sin(Math.min(1, t * 2) * Math.PI) ;
    if (md.parts.upper_jaw) md.parts.upper_jaw.zRot = Math.PI - (1 - bite) * open * 0.35 * Math.PI;
    if (md.parts.lower_jaw) md.parts.lower_jaw.zRot = Math.PI + (1 - bite) * open * 0.35 * Math.PI;
    const m = M4.create(); M4.translate(m, ip[0], ip[1] - (t > 0.9 ? (t - 0.9) * 10 : 0) * 0.5 - (1 - Math.min(1, t * 4)) * 0.7, ip[2]); M4.rotY(m, this.yaw);
    r.drawEM(md, tex, m, this.lightAt(), g.envCache || { day: 1, fogColor: [0, 0, 0], fogNear: 1e8, fogFar: 2e8, nightTint: [1, 1, 1] }, {});
  }
}
function evokerFang(g, owner, x, z, delay) {
  let y = Math.floor(owner.pos[1]) + 1;
  for (let k = 0; k < 6 && !SOLIDCUBE[g.world.getBlock(Math.floor(x), y - 1, Math.floor(z))]; k++) y--;
  if (SOLIDCUBE[g.world.getBlock(Math.floor(x), y, Math.floor(z))]) return;
  g.entities.push(new EvokerFangs(g, x, y, z, delay, owner));
}
// vexes: fly through walls with a sword, die after a while
class Vex extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.noClip = true; this.life = 0; this.hand = makeStack('iron_sword', 1); this.chargeT = 0; this.persistent = false; }
  wantsPlayer() { return this.game.difficulty > 0; }
  think(c) {
    if (this.life > 0 && --this.life === 0) { this.hurt(1000, { type: 'generic' }); return; }
    if (this.target) {
      const t = this.target;
      if (this.chargeT <= 0 && Math.random() < 0.02) this.chargeT = 20;
      if (this.chargeT > 0) { this.chargeT--; c.goal = [t.pos[0], t.pos[1] + t.h * 0.5, t.pos[2]]; c.mod = 2; if (this.distTo(t) < 1.2 && this.attackCd <= 0) { this.melee(t); this.chargeT = 0; } return; }
      c.goal = [t.pos[0] + Math.cos(this.age * 0.05) * 3, t.pos[1] + 2, t.pos[2] + Math.sin(this.age * 0.05) * 3]; c.look = t; return;
    }
    const o = this.owner && !this.owner.dead ? this.owner.pos : this.pos;
    if (!this.goal || this.near(this.goal, 1) || Math.random() < 0.02) this.goal = [o[0] + randInt(-7, 7), o[1] + randInt(0, 4), o[2] + randInt(-7, 7)];
    c.goal = this.goal;
  }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    emHead(P.head, this, a);
    const f = Math.cos(t * 5.5 * Math.PI / 180) * 0.1;
    if (P.right_arm) { P.right_arm.zRot = Math.PI / 5 + f; P.right_arm.xRot = this.chargeT > 0 ? -Math.PI * 0.8 : -0.3; }
    if (P.left_arm) P.left_arm.zRot = -(Math.PI / 5 + f);
    if (P.right_wing) { P.right_wing.yRot = 0.47 + Math.cos(t * 45.836624 * Math.PI / 180) * 0.3; P.right_wing.xRot = 0.47; P.right_wing.zRot = -0.47; }
    if (P.left_wing) { P.left_wing.yRot = -(0.47 + Math.cos(t * 45.836624 * Math.PI / 180) * 0.3); P.left_wing.xRot = 0.47; P.left_wing.zRot = 0.47; }
  }
  texKey(r) { return r.etex(this.chargeT > 0 ? 'entity/illager/vex_charging' : 'entity/illager/vex'); }
  attachments(g, md, lt, env) { const st = this.hand; return { right_arm: (am) => { M4.translate(am, 0.0625, 0.4, 0); M4.scale(am, 0.6, 0.6, 0.6); g.drawHeldItem(am, st, false, lt, env, this, null); } }; }
}
defVMob('pillager', { cls: Pillager, hand: 'crossbow', xp: 5, shadowR: 0.4, T: { hostile: true } });
defVMob('vindicator', { cls: Vindicator, hand: 'iron_axe', xp: 5, shadowR: 0.4, T: { hostile: true } });
defVMob('evoker', { cls: Evoker, xp: 10, shadowR: 0.4, T: { hostile: true } });
defVMob('illusioner', { cls: SkeletonKind, hand: 'bow', bow: true, xp: 5, shadowR: 0.4, tex: () => 'entity/illager/illusioner', T: { hostile: true } });
defVMob('vex', { cls: Vex, ai: 'fly', xp: 3, shadowR: 0, T: { hostile: true, attack: 9 }, stepSound: false, hover: true, bright: true });
Evoker.prototype.ranged = Evoker.prototype.ranged;
// the illusioner uses the illager model: borrow the illager animation
VMOB.illusioner.anim = (md, e, a) => Illager.prototype.setupAnim.call(e, md, a);

// ---- ravagers: charge and roar --------------------------------------------------------------------------------------------------------------
class Ravager extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.roarT = 0; this.stunT = 0; this.atkT = 0; this.persistent = false; }
  wantsPlayer() { return this.game.difficulty > 0; }
  think(c) {
    if (this.stunT > 0) { this.stunT--; if (this.stunT === 0) { this.roarT = 20; } return; }
    if (this.roarT > 0) {
      if (--this.roarT === 10) { this.sound('roar'); for (const e of this.game.entities) if (e instanceof Living && e !== this && !(e instanceof Illager) && e.distTo(this) < 4) { e.hurt(6, { type: 'mob', attacker: this }); const dx = e.pos[0] - this.pos[0], dz = e.pos[2] - this.pos[2], l = Math.hypot(dx, dz) || 1; e.vel[0] += dx / l * 1; e.vel[2] += dz / l * 1; e.vel[1] = 0.3; } }
      return;
    }
    VMob.prototype.think.call(this, c);
    // tramples leaves and crops in the way
    if (this.collidedH && this.age % 5 === 0) {
      const x = Math.floor(this.pos[0] - Math.sin(this.yaw) * 1.6), z = Math.floor(this.pos[2] - Math.cos(this.yaw) * 1.6);
      for (let dy = 0; dy < 3; dy++) { const id = this.world.getBlock(x, Math.floor(this.pos[1]) + dy, z), k = BLOCKS[id].key; if (/leaves$|^(wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem)$/.test(k)) this.game.breakBlockAt ? this.game.breakBlockAt(x, Math.floor(this.pos[1]) + dy, z) : this.world.setBlock(x, Math.floor(this.pos[1]) + dy, z, 0, 0); }
    }
  }
  melee(t) { super.melee(t); this.atkT = 10; if (t.usingItem && t.inv && t.inv.held && ITEMS[t.inv.held.id].key === 'shield') this.stunT = 40; }
  afterMove() { if (this.atkT > 0) this.atkT--; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = -(this.pitch || 0); }
    emQuad(md, pos, spd * 0.4);
    if (P.mouth) P.mouth.xRot = this.atkT > 0 ? Math.sin(this.atkT / 10 * Math.PI) * 0.6 : this.roarT > 0 ? 0.8 : 0;
    if (P.neck && this.stunT > 0) P.neck.y = -7 + Math.sin(this.age) * 1;
  }
  texKey(r) { return r.etex('entity/illager/ravager'); }
}
defVMob('ravager', { cls: Ravager, xp: 20, shadowR: 1.1, T: { hostile: true }, reach: 1.2, attackCd: 10 });

// ---- breezes: hop around and blast wind charges -------------------------------------------------------------------------------------------------
class Breeze extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.st = 'idle'; this.stT = 0; this.persistent = false; }
  hurt(a, src) { if (src && (src.type === 'arrow' || src.projectile)) { this.sound('deflect'); return false; } return super.hurt(a, src); }
  wantsPlayer() { return this.game.difficulty > 0; }
  ranged(c, t, d) {
    c.look = t; this.stT++;
    if (this.st === 'idle' && this.stT > 30) {
      if (d < 20 && this.canSee(t) && Math.random() < 0.5) { this.st = 'shoot'; this.stT = 0; this.anims = { SHOOT: this.age }; this.sound('inhale'); }
      else if (this.onGround) { this.st = 'jump'; this.stT = 0; this.anims = { JUMP: this.age }; this.sound('charge'); }
    } else if (this.st === 'shoot' && this.stT === 20) {
      const [vx, vy, vz] = lookVec(this, t);
      const wc = typeof Thrown !== 'undefined' ? new Thrown(this.game, this.pos[0] + vx, this.pos[1] + this.h * 0.6, this.pos[2] + vz, [vx * 0.7, vy * 0.7, vz * 0.7], this, 'wind_charge') : null;
      if (wc) { wc.breeze = true; this.game.entities.push(wc); }
      this.sound('shoot');
    } else if (this.st === 'jump' && this.stT === 10) {
      const a2 = Math.random() * Math.PI * 2; this.vel[1] = 0.9; this.vel[0] = Math.cos(a2) * 0.4; this.vel[2] = Math.sin(a2) * 0.4; this.sound('jump');
    } else if (this.stT > 40) { this.st = 'idle'; this.stT = 0; this.anims = {}; }
  }
  think(c) { if (!this.target) { this.st = 'idle'; this.stT = 0; } VMob.prototype.think.call(this, c); }
  onLand(d) { if (this.st === 'jump') this.sound('land'); }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    EM.anim(md, 'BreezeAnimation.IDLE', t / 20);
    for (const k in this.anims) EM.anim(md, 'BreezeAnimation.' + k, (this.age - this.anims[k] + a) / 20);
    if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = -(this.pitch || 0); }
    if (P.rods) P.rods.yRot = t * Math.PI * 0.1;
  }
  texKey(r) { return r.etex('entity/breeze/breeze'); }
  drawLayers(g, r, md, m, a, env, lt) {
    const wm = EM.get(r, 'breeze#wind'), et = r.etex('entity/breeze/breeze_eyes'), em = EM.get(r, 'breeze#eyes');
    if (wm) { EM.reset(wm); EM.copy(md, wm); const gl = r.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); r.drawEM(wm, r.etex('entity/breeze/breeze_wind'), m, [1, 1], env, { cull: false }); gl.disable(gl.BLEND); }
    if (em && et) { EM.reset(em); EM.copy(md, em); r.drawEMGlow(em, et, m, env, {}); }
  }
}
defVMob('breeze', { cls: Breeze, xp: 10, shadowR: 0.4, T: { hostile: true }, stepSound: false, immune: ['fall'] });

// ---- creakings: freeze while watched; tied to a creaking heart that protects them -------------------------------------------------------------------
class Creaking extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.heart = null; this.frozen = false; this.persistent = false; }
  extraSave() { return { heart: this.heart }; }
  extraLoad(o) { this.heart = o.heart || null; }
  wantsPlayer() { return this.game.difficulty > 0; }
  watched() {
    const p = this.game.player; if (p.creative || this.distTo(p) > 24) return false;
    const dx = this.pos[0] - p.pos[0], dy = this.pos[1] + 1.5 - (p.pos[1] + 1.6), dz = this.pos[2] - p.pos[2], l = Math.hypot(dx, dy, dz) || 1;
    const lx = -Math.sin(p.yaw) * Math.cos(p.pitch), ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    return (dx * lx + dy * ly + dz * lz) / l > 0.8 && this.canSee(p);
  }
  think(c) {
    if (this.heart) {
      const [x, y, z] = this.heart, k = BLOCKS[this.world.getBlock(x, y, z)].key;
      if (k !== 'creaking_heart' || this.game.isDay()) { this.dead = true; particleBurst(this.game, 'poof', this.pos[0], this.pos[1] + 1, this.pos[2], 20, 1.5); this.sound('death'); return; }
      if (Math.hypot(x - this.pos[0], z - this.pos[2]) > 32) { c.goal = [x, y, z]; return; }
    }
    const was = this.frozen; this.frozen = this.watched();
    if (this.frozen) { if (!was) this.sound('freeze'); return; }
    if (was) this.sound('unfreeze');
    VMob.prototype.think.call(this, c);
  }
  hurt(a, src) {
    if (this.heart) { this.anims.INVULNERABLE = this.age; this.sound('sway'); Sound.ev('block.creaking_heart.hurt', [this.heart[0], this.heart[1], this.heart[2]], 1, 1); this.hurtTime = 0; return false; }
    return super.hurt(a, src);
  }
  moveBy(c) { if (this.frozen) { this.travel(0, 0, 0, false); return; } super.moveBy(c); }
  melee(t) { super.melee(t); this.anims.ATTACK = this.age; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = -(this.pitch || 0); }
    if (!this.frozen) EM.walk(md, 'CreakingAnimation.CREAKING_WALK', pos, spd, 1, 1);
    for (const k in this.anims) EM.anim(md, 'CreakingAnimation.CREAKING_' + k, (this.age - this.anims[k] + a) / 20);
  }
  texKey(r) { return r.etex('entity/creaking/creaking'); }
  drawLayers(g, r, md, m, a, env) { if (this.frozen) return; const t = r.etex('entity/creaking/creaking_eyes'), em = EM.get(r, 'creaking#eyes'); if (t && em) { EM.reset(em); EM.copy(md, em); r.drawEMGlow(em, t, m, env, {}); } }
}
defVMob('creaking', { cls: Creaking, xp: 0, shadowR: 0.6, T: { hostile: true }, reach: 0.8 });
// an active creaking heart (between two pale oak logs, at night) brings out its creaking
BLOCK_RANDOM_TICK.creaking_heart = (g, x, y, z, id, m) => {
  if (g.isDay() || g.difficulty === 0) return;
  const w = g.world, ax = Features.propOf(id, m, 'axis') || 'y', D = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[ax];
  const log = (dx, dy, dz) => /pale_oak_(log|wood)$/.test(BLOCKS[w.getBlock(x + dx, y + dy, z + dz)].key);
  if (!log(D[0], D[1], D[2]) || !log(-D[0], -D[1], -D[2])) return;
  if (g.entities.some(e => e instanceof Creaking && e.heart && e.heart[0] === x && e.heart[1] === y && e.heart[2] === z)) return;
  for (let k = 0; k < 10; k++) {
    const sx = x + randInt(-16, 16), sz = z + randInt(-16, 16); let sy = y + 8;
    while (sy > y - 8 && !SOLIDCUBE[w.getBlock(sx, sy - 1, sz)]) sy--;
    if (w.getBlock(sx, sy, sz) || w.getBlock(sx, sy + 1, sz) || w.getBlock(sx, sy + 2, sz)) continue;
    const c = spawnAt(g, 'creaking', sx + 0.5, sy, sz + 0.5); c.heart = [x, y, z]; c.persistent = false; Sound.ev('block.creaking_heart.spawn', [x + 0.5, y, z + 0.5], 1, 1);
    return;
  }
};

// ---- the warden: blind, hunts by sound and smell, a sonic boom for what it can't reach -----------------------------------------------------------------
class Warden extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.st = 'emerge'; this.stT = 0; this.anims = { EMERGE: this.age }; this.angerAt = new Map(); this.boomCd = 0; this.sniffT = 0; this.persistent = true; this.idleCalm = 0; this.sound('emerge'); }
  extraSave() { return { st: this.st === 'dig' ? 'idle' : this.st }; }
  extraLoad(o) { this.st = 'idle'; this.anims = {}; }
  wantsPlayer() { return false; }
  // (vanilla: not hurt while coming out of the ground or going back in; a creative player is never its target - hit by
  // one it roared and turned on them every time, then forgot them at once: "出场时一直打他，动画循环鬼畜", "每次攻击都重新咆哮")
  hurt(a, src) {
    if (this.st === 'emerge' || this.st === 'dig') return false;
    const atk = src && src.attacker, ignored = !!atk && atk === this.game.player && this.game.player.creative;
    const r = super.hurt(a, src);
    if (ignored && this.target === atk) this.target = null;
    else if (r && atk) this.addAnger(atk, 100);
    return r;
  }
  addAnger(e, n) {
    if (e === this.game.player && this.game.player.creative) return; this.angerAt.set(e, Math.min(150, (this.angerAt.get(e) || 0) + n)); if ((this.angerAt.get(e) || 0) >= 80 && this.target !== e) { this.target = e; this.anims.ROAR = this.age; this.roarT = 84; this.sound('roar'); } }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || (this.target === this.game.player && this.game.player.creative))) this.target = null; }
  think(c) {
    const g = this.game, p = g.player;
    this.stT++;
    if (this.st === 'emerge') { if (this.stT > 134) { this.st = 'idle'; this.anims = {}; } return; }
    if (this.st === 'dig') { if (this.stT > 100) this.dead = true; return; }
    if (this.roarT > 0) { this.roarT--; return; }
    // vibrations: a player moving without sneaking, nearby; darkness to the players around it
    if (!p.creative && this.distTo(p) < 16 && !p.sneaking && Math.hypot(p.pos[0] - p.prev[0], p.pos[1] - p.prev[1], p.pos[2] - p.prev[2]) > 0.05 && this.age % 10 === 0) { this.addAnger(p, 10); this.sound('listening', 0.6); }
    if (this.age % 120 === 0 && !p.creative && this.distTo(p) < 20 && p.addEffect) p.addEffect('darkness', 0, 260);
    if (this.boomCd > 0) this.boomCd--;
    for (const [e, v] of this.angerAt) { if (v <= 1 || e.dead) this.angerAt.delete(e); else if (this.age % 20 === 0) this.angerAt.set(e, v - 1); }
    if (this.target) {
      const t = this.target, d = this.distTo(t);
      c.look = t;
      // the sonic boom: when out of reach for a while
      if (this.sonicT > 0) {
        if (--this.sonicT === 26) {
          t.hurt(10, { type: 'sonic_boom', attacker: this }); const [vx, , vz] = lookVec(this, t); t.vel[0] += vx * 2.5; t.vel[1] += 0.5; t.vel[2] += vz * 2.5;
          this.sound('sonic_boom', 3); for (let i = 1; i < Math.floor(d); i++) g.particles.spawn('poof', this.pos[0] + vx * i, this.pos[1] + 1.6 + (t.pos[1] - this.pos[1]) * i / d, this.pos[2] + vz * i, 0, 0, 0);
        }
        return;
      }
      if (d > 4 && d < 15 && this.boomCd <= 0 && this.canSee(t) && Math.random() < 0.05) { this.sonicT = 60; this.boomCd = 40; this.anims.SONIC_BOOM = this.age; this.sound('sonic_charge', 3); return; }
      c.goal = [t.pos[0], t.pos[1], t.pos[2]]; c.mod = 1.2;
      if (d < 2.5 && this.attackCd <= 0) { this.melee(t); this.anims.ATTACK = this.age; }
      return;
    }
    if (Math.random() < 1 / 300) { this.anims.SNIFF = this.age; this.sound('sniff'); const near = g.entities.find(e => e instanceof Living && e !== this && !(e instanceof Warden) && !e.dead && e.distTo(this) < 24 && !(e === p && p.creative)); if (near) this.addAnger(near, 35); }
    // calm for a long while: digs back into the ground
    if (++this.idleCalm > 1200 && !this.angerAt.size) { this.st = 'dig'; this.stT = 0; this.anims = { DIG: this.age }; this.sound('dig'); return; }
    if (this.angerAt.size) this.idleCalm = 0;
    VMob.prototype.think.call(this, c);
  }
  melee(t) { super.melee(t); if (t.usingItem && t.inv && t.inv.held && ITEMS[t.inv.held.id].key === 'shield') t.shieldDown = 100; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), t = this.age + a;
    if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = -(this.pitch || 0); }
    // a heavy walk, tendrils quivering
    const w = Math.cos(pos * 0.8) * spd;
    if (P.left_leg) P.left_leg.xRot = Math.cos(pos * 0.6662) * 1.4 * spd * 0.7;
    if (P.right_leg) P.right_leg.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd * 0.7;
    if (P.body) P.body.zRot = w * 0.1;
    if (P.left_arm) P.left_arm.xRot = -Math.cos(pos * 0.6662) * 1.0 * spd;
    if (P.right_arm) P.right_arm.xRot = -Math.cos(pos * 0.6662 + Math.PI) * 1.0 * spd;
    const tq = Math.sin(t * 0.25) * 0.1 * (this.target ? 2 : 1);
    if (P.left_tendril) P.left_tendril.xRot = tq; if (P.right_tendril) P.right_tendril.xRot = -tq;
    for (const k in this.anims) EM.anim(md, 'WardenAnimation.WARDEN_' + k, (this.age - this.anims[k] + a) / 20);
  }
  texKey(r) { return r.etex('entity/warden/warden'); }
  drawLayers(g, r, md, m, a, env) {
    const t = this.age + a, beat = Math.max(0, Math.cos(t * 0.045 * (this.target ? 2 : 1)) * 0.5 + 0.2);
    const layer = (k, tex, alpha) => { const lm = EM.get(r, 'warden#' + k), tx = r.etex(tex); if (!lm || !tx || alpha <= 0.02) return; EM.reset(lm); EM.copy(md, lm); const gl = r.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthFunc(gl.LEQUAL); r.drawEM(lm, tx, m, [1, 1], env, { alpha, bright: true }); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); };
    layer('bioluminescent', 'entity/warden/warden_bioluminescent_layer', 1);
    layer('pulsating_spots', 'entity/warden/warden_pulsating_spots_1', Math.max(0, Math.cos(t * 0.045) * 0.25 + 0.25));
    layer('pulsating_spots', 'entity/warden/warden_pulsating_spots_2', Math.max(0, Math.cos(t * 0.045 + Math.PI) * 0.25 + 0.25));
    layer('heart', 'entity/warden/warden_heart', beat);
    layer('tendrils', 'entity/warden/warden', this.target ? 0.6 : 0.2);
  }
}
defVMob('warden', { cls: Warden, xp: 5, shadowR: 0.8, T: { hostile: true }, reach: 1, attackCd: 18, knock: 0.8, immune: ['fire', 'lava', 'drown'], fearless: true });

// ---- shulkers: hide in their shells on a block, shoot homing bullets ----------------------------------------------------------------------------------
class Shulker extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.peek = 0; this.peekGoal = 0; this.color = null; this.pos[0] = Math.floor(x) + 0.5; this.pos[2] = Math.floor(z) + 0.5; this.pos[1] = Math.floor(y); this.persistent = true; }
  extraSave() { return { col: this.color }; }
  extraLoad(o) { this.color = o.col || null; }
  wantsPlayer() { return this.game.difficulty > 0; }
  hurt(a, src) {
    if (this.peek < 0.1 && src && src.type === 'arrow') return false;
    const r = super.hurt(this.peek < 0.1 ? a * 0.2 : a, src);
    if (r && this.health < this.maxHealth / 2 && Math.random() < 0.25) this.teleport();
    return r;
  }
  teleport() {
    const w = this.world;
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(this.pos[0]) + randInt(-8, 8), y = Math.floor(this.pos[1]) + randInt(-8, 8), z = Math.floor(this.pos[2]) + randInt(-8, 8);
      if (w.getBlock(x, y, z) === 0 && SOLIDCUBE[w.getBlock(x, y - 1, z)]) { this.pos = [x + 0.5, y, z + 0.5]; this.savePrev(); this.sound('teleport'); return; }
    }
  }
  think(c) {
    if (Math.random() < 1 / 40) this.peekGoal = Math.random() < 0.3 ? Math.random() * 0.3 : 0;
    if (this.target) {
      const t = this.target; c.look = t; this.peekGoal = 1;
      if (this.attackCd <= 0 && this.distTo(t) < 16) { this.attackCd = 20 + randInt(0, 10) * 2; this.game.entities.push(new ShulkerBullet(this.game, this.pos[0], this.pos[1] + 0.5, this.pos[2], this, t)); this.sound('shoot'); }
    }
    this.findTarget();
  }
  moveBy() { this.vel = [0, 0, 0]; }
  afterMove() { const was = this.peek; this.peek += clamp(this.peekGoal - this.peek, -0.05, 0.05); if (was < 0.05 && this.peek >= 0.05) this.sound('open'); if (was >= 0.05 && this.peek < 0.05) this.sound('close'); this.T.armor = this.peek < 0.05 ? 20 : 0; }
  setupAnim(md, a) {
    const P = md.parts, k = (0.5 + this.peek) * Math.PI, t = this.age + a;
    if (P.lid) { P.lid.y = 24 - (-0.5 + Math.sin(k) * 0.5 + 0.5) * 16 * 0.5 - Math.sin(k) * 8 * 0 ; P.lid.y = 16 + (1 - this.peek) * 8 - this.peek * 0; P.lid.y = 24 - this.peek * 8; P.lid.yRot = this.peek > 0.3 ? Math.sin(t * 0.05) * 0.0 + this.peek * Math.PI * 0.05 * Math.sin(t * 0.1) : 0; }
    if (P.head) { P.head.xRot = -(this.pitch || 0); P.head.yRot = -(this.headYaw || 0); }
  }
  texKey(r) { return r.etex('entity/shulker/shulker' + (this.color ? '_' + this.color : '')); }
  preDraw(m) { }
}
// the homing bullet: drifts toward its target, gives levitation
class ShulkerBullet extends Entity {
  constructor(g, x, y, z, owner, target) { super(g, x, y, z, 0.3125, 0.3125); this.owner = owner; this.target = target; this.vel = [0, 0.15, 0]; this.spriteLayer = undefined; }
  tick() {
    this.savePrev(); this.age++;
    const t = this.target, v = this.vel;
    if (!t || t.dead || this.age > 300) { this.dead = true; return; }
    const dx = t.pos[0] - this.pos[0], dy = t.pos[1] + t.h * 0.5 - this.pos[1], dz = t.pos[2] - this.pos[2], l = Math.hypot(dx, dy, dz) || 1;
    v[0] += (dx / l * 0.15 - v[0]) * 0.2; v[1] += (dy / l * 0.15 - v[1]) * 0.2; v[2] += (dz / l * 0.15 - v[2]) * 0.2;
    this.noClip = false; this.move(v[0], v[1], v[2]);
    if (l < 0.6) { t.hurt(4, { type: 'mob', attacker: this.owner }); if (t.addEffect) t.addEffect('levitation', 0, 200); Sound.ev('entity.shulker_bullet.hit', this.pos, 1, 1); this.dead = true; return; }
    if (this.collidedH || this.onGround) { Sound.ev('entity.shulker_bullet.hit', this.pos, 1, 1); this.dead = true; }
    if (this.age % 2 === 0) this.game.particles.spawn('glint', this.pos[0], this.pos[1], this.pos[2], 0, 0, 0);
  }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, md = EM.get(r, 'shulker_bullet#main'), tex = r.etex('entity/shulker/spark'); if (!md || !tex) return;
    EM.reset(md);
    const m = M4.create(); M4.translate(m, ip[0], ip[1] + 0.15, ip[2]); M4.rotY(m, (this.age + a) * 0.3); M4.rotX(m, (this.age + a) * 0.2); M4.translate(m, 0, -0.15, 0);
    r.drawEM(md, tex, m, [1, 1], env, { bright: true, cull: false });
  }
}
defVMob('shulker', { cls: Shulker, xp: 5, shadowR: 0, T: { hostile: true }, stepSound: false, noDeathFlip: true });

// ---- piglin brutes and zoglins ----------------------------------------------------------------------------------------------------------------------------
defVMob('piglin_brute', { cls: Humanoid, hand: 'golden_axe', xp: 20, shadowR: 0.4, T: { hostile: true }, tex: () => 'entity/piglin/piglin_brute', zombieArms: false, layer: 'piglin_brute#main' });
VMOB.piglin_brute.anim = (md, e, a) => { emHumanoid(md, e, a, {}); const P = md.parts; if (P.right_ear) P.right_ear.zRot = 0.52 + Math.cos(e.age * 0.1) * 0.1; if (P.left_ear) P.left_ear.zRot = -0.52 - Math.cos(e.age * 0.1) * 0.1; if (e.target && P.right_arm) P.right_arm.xRot = -1.2 - (e.swingT > 0 ? Math.sin((1 - e.swingT / 6) * Math.PI) : 0); };
class Zoglin extends VMob {
  wantsPlayer() { return this.game.difficulty > 0; }
  huntTarget() { if ((this.age + this.id) % 20) return null; return this.game.entities.find(e => e instanceof Mob && e !== this && e.type !== 'zoglin' && e.type !== 'creeper' && !e.dead && e.distTo(this) < 16) || null; }
  melee(t) { super.melee(t); t.vel[1] += 0.4; this.atkT = 10; }
  afterMove() { if (this.atkT > 0) this.atkT--; }
  setupAnim(md, a) { const P = md.parts, [pos, spd] = emLimbs(this, a); emQuad(md, pos, spd); if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = 0.87 + (this.atkT > 0 ? -Math.sin((10 - this.atkT) / 10 * Math.PI) * 0.6 : 0); } }
  texKey(r) { return r.etex('entity/hoglin/zoglin' + (this.baby ? '_baby' : '')); }
}
defVMob('zoglin', { cls: Zoglin, xp: 5, shadowR: 0.7, T: { hostile: true } });

// ---- the wither: three heads, wither skulls, armour below half health ---------------------------------------------------------------------------------------
class Wither extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.invulT = 220; this.headTargets = [null, null]; this.skullCd = [0, 0, 0]; this.persistent = true; this.health = this.maxHealth / 3; this.blockCd = 0; }
  extraSave() { return { inv: this.invulT }; }
  extraLoad(o) { this.invulT = o.inv || 0; }
  get armored() { return this.health <= this.maxHealth / 2; }
  wantsPlayer() { return true; }
  hurt(a, src) {
    if (this.invulT > 0 || (src && src.type === 'drown')) return false;
    if (this.armored && src && (src.type === 'arrow' || src.projectile)) return false;
    return super.hurt(a, src);
  }
  think(c) {
    const g = this.game;
    if (this.invulT > 0) {
      // charging up after being built, then a big explosion
      this.invulT--; this.health = Math.min(this.maxHealth, this.health + this.maxHealth / 220 * (2 / 3));
      if (this.invulT === 0) { g.explode(this.pos[0], this.pos[1] + this.h / 2, this.pos[2], 7, this); Sound.ev('entity.wither.spawn', null, 1, 1); }
      return;
    }
    if (this.age % 20 === 0) this.health = Math.min(this.maxHealth, this.health + 1);
    // the extra heads look for any living thing that isn't undead
    for (let i = 0; i < 2; i++) if (!this.headTargets[i] || this.headTargets[i].dead || this.headTargets[i].deathTime || Math.random() < 0.005) this.headTargets[i] = g.entities.find(e => e instanceof Living && e !== this && !e.dead && !ENTITY_TAGS.undead.includes(e.type) && e.distTo(this) < 20 && !(e === g.player && g.player.creative)) || null;
    const t = this.target;
    for (let i = 0; i < 3; i++) {
      const ht = i === 0 ? t : this.headTargets[i - 1];
      if (!ht || --this.skullCd[i] > 0) continue;
      this.skullCd[i] = i === 0 ? 40 : 30 + randInt(0, 30);
      this.shootSkull(i, ht, i > 0 && Math.random() < 0.001);
    }
    // break blocks it gets stuck in
    if (--this.blockCd <= 0 && this.collidedH) { this.blockCd = 20; const x0 = Math.floor(this.pos[0]), y0 = Math.floor(this.pos[1]), z0 = Math.floor(this.pos[2]); for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 3; dy++) for (let dz = -1; dz <= 1; dz++) { const id = this.world.getBlock(x0 + dx, y0 + dy, z0 + dz); if (id && BLOCKS[id].hardness >= 0 && BLOCKS[id].hardness < 50 && !IS_FLUID[id]) this.world.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0); } }
    // fly: above the target, circling
    if (t) { c.look = t; const hh = this.armored ? 0 : 5; c.goal = [t.pos[0] + Math.cos(this.age * 0.02) * 6, t.pos[1] + hh, t.pos[2] + Math.sin(this.age * 0.02) * 6]; }
    else { this.findTarget(); if (!this.goal || this.near(this.goal, 2)) this.goal = this.randomGoal(10, 3); c.goal = this.goal; }
  }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || (this.target === this.game.player && this.game.player.creative))) this.target = null; if (!this.target) { const p = this.game.player; this.target = (!p.creative && this.distTo(p) < 40) ? p : this.headTargets[0]; } }
  headPos(i) { const a = this.bodyYaw + [0, -Math.PI / 2, Math.PI / 2][i], d = i ? 1.3 : 0; return [this.pos[0] + Math.cos(a) * d * (i ? 1 : 0), this.pos[1] + (i ? 2.2 : 3), this.pos[2] + Math.sin(a) * d * (i ? 1 : 0)]; }
  shootSkull(i, t, blue) {
    const g = this.game, [x, y, z] = this.headPos(i), dx = t.pos[0] - x, dy = t.pos[1] + t.h * 0.5 - y, dz = t.pos[2] - z, l = Math.hypot(dx, dy, dz) || 1;
    const sk = new WitherSkull(g, x, y, z, [dx / l * 0.4, dy / l * 0.4, dz / l * 0.4], this, blue);
    g.entities.push(sk); Sound.ev('entity.wither.shoot', this.pos, 1, 1);
  }
  onDeath() { Sound.ev('entity.wither.death', null, 1, 1); }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    if (P.ribcage) P.ribcage.xRot = (0.065 + 0.05 * Math.cos(t * 0.1)) * Math.PI;
    if (P.tail) { P.tail.xRot = (0.265 + 0.1 * Math.cos(t * 0.1)) * Math.PI; P.tail.y = 6.9 + Math.cos(P.ribcage.xRot) * 10; P.tail.z = -0.5 + Math.sin(P.ribcage.xRot) * 10; }
    if (P.center_head) { P.center_head.yRot = -(this.headYaw || 0); P.center_head.xRot = -(this.pitch || 0); }
    for (let i = 0; i < 2; i++) { const n = P[i ? 'left_head' : 'right_head'], ht = this.headTargets[i]; if (!n) continue; if (ht) { const dx = ht.pos[0] - this.pos[0], dz = ht.pos[2] - this.pos[2]; n.yRot = -angDelta(Math.atan2(-dx, -dz), this.bodyYaw) * 0.8; } }
  }
  renderScale() { return 2; }
  texKey(r) { return r.etex(this.invulT > 0 && Math.floor(this.invulT / 5) % 2 === 0 ? 'entity/wither/wither_invulnerable' : 'entity/wither/wither'); }
  drawLayers(g, r, md, m, a, env, lt) {
    if (!this.armored && this.invulT <= 0) return;
    const am = EM.get(r, 'wither#armor'), tex = r.etex('entity/wither/wither_armor'); if (!am || !tex) return;
    EM.reset(am); EM.copy(md, am);
    const gl = r.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL);
    r.drawEM(am, tex, m, [1, 1], env, { bright: true, alpha: 0.6 });
    gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
  }
}
class WitherSkull extends Entity {
  constructor(g, x, y, z, vel, owner, blue) { super(g, x, y, z, 0.3125, 0.3125); this.vel = vel; this.owner = owner; this.blue = blue; }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, v = this.vel, n = [this.pos[0] + v[0], this.pos[1] + v[1], this.pos[2] + v[2]];
    for (const e of g.entities) {
      if (e === this.owner || !(e instanceof Living) || e.dead) continue;
      const b = e.box(); if (n[0] > b[0] - 0.15 && n[0] < b[3] + 0.15 && n[1] > b[1] - 0.15 && n[1] < b[4] + 0.15 && n[2] > b[2] - 0.15 && n[2] < b[5] + 0.15) { this.hit(e); return; }
    }
    this.noClip = true; this.pos = n; this.noClip = false;
    if (SOLIDCUBE[this.world.getBlock(Math.floor(n[0]), Math.floor(n[1]), Math.floor(n[2]))] || this.age > 300) { this.hit(null); return; }
    if (this.age % 2 === 0) g.particles.spawn('smoke', n[0], n[1], n[2], 0, 0, 0);
  }
  hit(e) {
    const g = this.game;
    if (e) { if (e.hurt(8, { type: 'mob', attacker: this.owner, projectile: true })) { const d = g.difficulty; if (d >= 2 && e.addEffect) e.addEffect('wither', 1, (d === 3 ? 40 : 10) * 20); if (e.dead || e.deathTime) { if (this.owner) this.owner.health = Math.min(this.owner.maxHealth, this.owner.health + 5); } } }
    g.explode(this.pos[0], this.pos[1], this.pos[2], 1, this.owner);
    this.dead = true;
  }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer, md = EM.get(r, 'wither_skull#main'), tex = r.etex(this.blue ? 'entity/wither/wither_invulnerable' : 'entity/wither/wither'); if (!md || !tex) return;
    EM.reset(md);
    const m = M4.create(); M4.translate(m, ip[0], ip[1], ip[2]); M4.rotY(m, Math.atan2(-this.vel[0], -this.vel[2]));
    r.drawEM(md, tex, m, [l[0], 1], env, {});
  }
}
defVMob('wither', { cls: Wither, ai: 'fly', xp: 50, shadowR: 1, T: { hostile: true, flySpeed: 0.6 }, speed3: 1.6, stepSound: false, immune: ['fire', 'lava', 'drown', 'explosion', 'wither'], boss: true, noDeathFlip: true });
// building one: a T of soul sand / soul soil with three wither skeleton skulls on top
(() => {
  const _p = Game.prototype.placeAt;
  if (!_p) return;
  Game.prototype.placeAt = function (x, y, z, ...rest) {
    const r = _p.call(this, x, y, z, ...rest);
    const w = this.world, k = BLOCKS[w.getBlock(x, y, z)].key;
    if (k === 'wither_skeleton_skull') checkWitherBuild(this, x, y, z);
    return r;
  };
})();
function checkWitherBuild(g, x, y, z) {
  const w = g.world, soul = (a, b, c) => /^soul_(sand|soil)$/.test(BLOCKS[w.getBlock(a, b, c)].key), skull = (a, b, c) => BLOCKS[w.getBlock(a, b, c)].key === 'wither_skeleton_skull';
  for (const [ax, az] of [[1, 0], [0, 1]]) for (let o = -1; o <= 1; o++) {
    const cx = x - ax * o, cz = z - az * o, cy = y - 1;
    if (!skull(cx, y, cz) || !skull(cx + ax, y, cz + az) || !skull(cx - ax, y, cz - az)) continue;
    if (!soul(cx, cy, cz) || !soul(cx + ax, cy, cz + az) || !soul(cx - ax, cy, cz - az) || !soul(cx, cy - 1, cz)) continue;
    for (const [a, b, c] of [[cx, y, cz], [cx + ax, y, cz + az], [cx - ax, y, cz - az], [cx, cy, cz], [cx + ax, cy, cz + az], [cx - ax, cy, cz - az], [cx, cy - 1, cz]]) w.setBlock(a, b, c, 0, 0);
    spawnAt(g, 'wither', cx + 0.5, cy - 1, cz + 0.5);
    return true;
  }
  return false;
}
// skeleton and zombie horses are undead mounts (mobs_animals.js); here only their trap riders would go
