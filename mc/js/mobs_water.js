'use strict';
// ---------------------------------------------------------------------------
// Water mobs drawn with the vanilla models (vmobs.js): cod, salmon, pufferfish, tropical fish, squid and glow
// squid, dolphins, axolotls, nautiluses and zombie nautiluses, guardians and elder guardians.
// ---------------------------------------------------------------------------
const inWaterAt = (w, x, y, z) => w.waterAt(Math.floor(x), Math.floor(y), Math.floor(z));
// a fish out of water lies on its side (vanilla fish renderers turn it 90 degrees)
const fishFlop = (e, m, a) => { if (!e.inWater) { M4.translate(m, 0.1, 0.1, -0.1); M4.rotZ(m, Math.PI / 2); } };
const finWag = (e, a, k = 1) => -(e.inWater ? 1 : 1.5) * 0.45 * Math.sin((e.inWater ? 0.6 : 1.7) * (e.age + a)) * k;

// ---- fish ---------------------------------------------------------------------------------------------------
class Fish extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.waterBreather = true; this.persistent = false; this.fromBucket = false; }
  extraSave() { return { fb: this.fromBucket }; }
  extraLoad(o) { this.fromBucket = !!o.fb; if (this.fromBucket) this.persistent = true; }
  despawn() { if (this.fromBucket) return false; return super.despawn(); }
  think(c) {
    // schools: follow a nearby fish of the same kind
    if (this.age % 40 === 0 && !this.leader) this.leader = this.game.entities.find(e => e !== this && e.type === this.type && !e.dead && e.distTo(this) < 8 && !e.leader);
    if (this.leader && (this.leader.dead || this.leader.distTo(this) > 12)) this.leader = null;
    if (this.leader && this.distTo(this.leader) > 2.5) { c.goal = [...this.leader.pos]; return; }
    VMob.prototype.think.call(this, c);
  }
  bucketData() { return {}; }
  preInteract(p, held) {
    if (held && ITEMS[held.id].key === 'water_bucket' && ITEM_KEY[this.type + '_bucket'] !== undefined) {
      swapHeld(this.game, p, this.type + '_bucket', { mob: this.bucketData() }); this.dead = true;
      Sound.ev('item.bucket.fill_fish', this.pos, 1, 1); return true;
    }
    return false;
  }
  preDraw(m, a) { fishFlop(this, m, a); }
  ambientKind() { return this.inWater ? 'ambient' : 'flop'; }
}
class Cod extends Fish {
  setupAnim(md, a) { if (md.parts.tail_fin) md.parts.tail_fin.yRot = finWag(this, a); }
  texKey(r) { return r.etex('entity/fish/cod'); }
}
defVMob('cod', { cls: Cod, ai: 'swim', xp: 1, shadowR: 0.2, stepSound: false, panicMod: 2 });
const SALMON_SIZE = { small: 0.5, medium: 1, large: 1.5 };
class Salmon extends Fish {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.size = pickW([['small', 30], ['medium', 50], ['large', 20]]); }
  extraSave() { return { ...super.extraSave(), sz: this.size }; }
  extraLoad(o) { super.extraLoad(o); this.size = o.sz || 'medium'; }
  bucketData() { return { sz: this.size }; }
  layerKey() { return this.size === 'small' ? 'salmon_small#main' : this.size === 'large' ? 'salmon_large#main' : 'salmon#main'; }
  setupAnim(md, a) { const w = finWag(this, a); if (md.parts.body_back) md.parts.body_back.yRot = w * 0.6; }
  texKey(r) { return r.etex('entity/fish/salmon'); }
}
defVMob('salmon', { cls: Salmon, ai: 'swim', xp: 1, shadowR: 0.2, stepSound: false, panicMod: 2 });
class Pufferfish extends Fish {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.puff = 0; this.puffT = 0; this.deflT = 0; }
  layerKey() { return ['pufferfish_small#main', 'pufferfish_medium#main', 'pufferfish_big#main'][this.puff]; }
  afterMove() {
    const g = this.game, near = g.entities.filter(e => e !== this && e instanceof Living && !e.dead && e.distTo(this) < 2.5 && !(e instanceof Fish) && e.type !== 'axolotl' && !(e === g.player && (g.player.creative || g.player.spectator)));
    if (near.length && this.inWater) { this.deflT = 0; if (this.puff < 2 && ++this.puffT > (this.puff ? 40 : 1)) { this.puff++; this.puffT = 0; this.sound('blow_up'); } }
    else if (this.puff > 0 && ++this.deflT > 60) { this.puff--; this.deflT = 0; this.puffT = 0; this.sound('blow_out'); }
    if (this.puff > 0) for (const e of near) if (e.distTo(this) < 0.6 + this.puff * 0.4) {
      if (e.hurt(1 + this.puff, { type: 'mob', attacker: this, knockFrom: this.pos })) { if (e.addEffect) e.addEffect('poison', 0, 60 * this.puff); this.sound('sting'); }
    }
  }
  setupAnim(md, a) { const P = md.parts, t = this.age + a; for (const n of ['left_blue_fin', 'right_blue_fin', 'left_fin', 'right_fin']) if (P[n]) P[n].zRot = (n.startsWith('left') ? -1 : 1) * (0.2 + Math.cos(t * 1.3) * Math.PI * 0.05); }
  texKey(r) { return r.etex('entity/fish/pufferfish'); }
}
defVMob('pufferfish', { cls: Pufferfish, ai: 'swim', xp: 1, shadowR: 0.2, stepSound: false, panicMod: 2 });
// tropical fish: two shapes, six patterns each, a body and a pattern colour (vanilla's packed variant number)
class TropicalFish extends Fish {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    this.shape = randInt(0, 1); this.pattern = randInt(0, 5); this.base = randInt(0, 15); this.pcol = randInt(0, 15);
  }
  extraSave() { return { ...super.extraSave(), v: [this.shape, this.pattern, this.base, this.pcol] }; }
  extraLoad(o) { super.extraLoad(o); if (o.v) [this.shape, this.pattern, this.base, this.pcol] = o.v; }
  bucketData() { return { v: [this.shape, this.pattern, this.base, this.pcol] }; }
  get packed() { return this.shape | this.pattern << 8 | this.base << 16 | this.pcol << 24; }
  layerKey() { return this.shape ? 'tropical_fish_large#main' : 'tropical_fish_small#main'; }
  setupAnim(md, a) { if (md.parts.tail) md.parts.tail.yRot = finWag(this, a); }
  texKey(r) { const s = this.shape ? 'b' : 'a'; return r.etexMix([{ p: 'entity/fish/tropical_' + s, c: dyeRGB(DYES[this.base]) }, { p: 'entity/fish/tropical_' + s + '_pattern_' + (this.pattern + 1), c: dyeRGB(DYES[this.pcol]) }]); }
}
defVMob('tropical_fish', { cls: TropicalFish, ai: 'swim', xp: 1, shadowR: 0.15, stepSound: false, panicMod: 2 });

// ---- squid and glow squid: drift with their tentacles, squirt ink when hurt -------------------------------------
class Squid extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.waterBreather = true; this.tent = 0; this.tentSpd = 0.1 + Math.random() * 0.1; this.bodyPitch = 0; this.darkT = 0; this.persistent = false; }
  think(c) {
    this.tent += this.tentSpd;
    if (this.tent > Math.PI * 2) { this.tent -= Math.PI * 2; if (Math.random() < 0.1) this.tentSpd = 0.1 + Math.random() * 0.1; }
    if (this.panic > 0) { this.panic--; c.mod = 3; if (!this.goal || this.age % 10 === 0) this.goal = this.randomGoal(8, 4); c.goal = this.goal; return; }
    // a push each tentacle stroke, then drift
    if (this.tent < Math.PI && this.inWater) { if (!this.goal || this.near(this.goal, 1.5) || Math.random() < 0.01) this.goal = this.randomGoal(10, 4); c.goal = this.goal; }
  }
  hurt(a, src) {
    const r = super.hurt(a, src);
    if (r && this.inWater) { for (let i = 0; i < 30; i++) { const p = this.game.particles.spawn('smoke', this.pos[0], this.pos[1] + 0.5, this.pos[2], (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3); if (p) p.col = this.type === 'glow_squid' ? [60, 220, 210] : [10, 10, 20]; } this.sound('squirt'); if (this.type === 'glow_squid') this.darkT = 100; }
    return r;
  }
  afterMove() { if (this.darkT > 0) this.darkT--; const v = this.vel; this.bodyPitch += (Math.atan2(Math.hypot(v[0], v[2]), v[1] + 0.001) * (this.inWater ? 1 : 0) - this.bodyPitch) * 0.1; }
  setupAnim(md, a) {
    const P = md.parts, t = this.tent + this.tentSpd * a;
    const ang = this.inWater ? (Math.abs(Math.sin(t)) < 0.5 ? 0 : 0) + (1 - Math.cos(t * 2) * 0.5 - 0.5) * Math.PI * 0.25 + 0.15 : 0.0;
    for (let i = 0; i < 8; i++) if (P['tentacle' + i]) P['tentacle' + i].xRot = this.inWater ? ang : Math.PI / 2 * 0.0 + 0.1;
  }
  preDraw(m, a) {
    // pitched along the way it swims, around the middle of the body
    M4.translate(m, 0, 0.5, 0); M4.rotX(m, -(this.bodyPitch - Math.PI / 2) * 0.6 * (this.inWater ? 1 : 0)); M4.translate(m, 0, -0.5, 0);
  }
  texKey(r) { return r.etex('entity/squid/' + this.type + (this.baby ? '_baby' : '')); }
}
defVMob('squid', { cls: Squid, ai: 'swim', xp: 2, shadowR: 0.4, stepSound: false, speed3: 1.2 });
defVMob('glow_squid', { cls: Squid, ai: 'swim', xp: 2, shadowR: 0.4, stepSound: false, speed3: 1.2, bright: true });
Object.defineProperty(VMOB.glow_squid, 'bright', { get() { return true; } });

// ---- dolphins: fast swimmers that need air, leap out of the water, give the player Dolphin's Grace -------------------
class Dolphin extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.waterBreather = true; this.breath = 4800; this.persistent = false; this.fed = false; }
  wantsPlayer() { return false; }
  think(c) {
    const g = this.game, p = g.player, w = this.world;
    if (!this.inWater) { this.flop(); return; }
    this.breath--;
    if (this.breath < 400) {
      // swim up for air
      let y = Math.floor(this.pos[1]); while (y < 320 && inWaterAt(w, this.pos[0], y + 1, this.pos[2])) y++;
      c.goal = [this.pos[0], y + 1.5, this.pos[2]]; c.mod = 1.5;
      if (!inWaterAt(w, this.pos[0], this.pos[1] + this.h + 0.2, this.pos[2])) this.breath = 4800;
      return;
    }
    if (this.breath <= 0 && this.age % 20 === 0) this.hurt(2, { type: 'drown' });
    // swim alongside a swimming player, grant Dolphin's Grace
    if (p.inWater && !p.creative && this.distTo(p) < 10) {
      if (p.addEffect && (p.swimming || p.sprinting) && this.age % 20 === 0) p.addEffect('dolphins_grace', 0, 100);
      if (this.distTo(p) > 3) { c.goal = [p.pos[0], p.pos[1], p.pos[2]]; c.mod = 1.5; c.look = p; return; }
    }
    // leap out of the water now and then
    if (Math.random() < 1 / 300 && !inWaterAt(w, this.pos[0], this.pos[1] + 2, this.pos[2]) && inWaterAt(w, this.pos[0], this.pos[1], this.pos[2])) {
      this.vel[1] = 0.8; this.vel[0] += -Math.sin(this.yaw) * 0.6; this.vel[2] += -Math.cos(this.yaw) * 0.6; this.sound('jump');
    }
    VMob.prototype.think.call(this, c);
  }
  moveBy(c) { if (!this.inWater) { this.travel(0, 0, 0, false); this.dry = (this.dry || 0) + 1; if (this.dry > 2400 && this.age % 20 === 0) this.hurt(1, { type: 'drown' }); return; } this.dry = 0; VMob.prototype.moveBy.call(this, c); }
  preInteract(p, held) {
    if (held && /^(cod|salmon)$/.test(ITEMS[held.id].key)) { useOne(this.game, p); this.sound('eat'); this.fed = true; for (let i = 0; i < 7; i++) this.game.particles.spawn('happy_villager', this.pos[0] + (Math.random() - 0.5), this.pos[1] + 0.5, this.pos[2] + (Math.random() - 0.5), 0, 0.02, 0); return true; }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), v = this.vel;
    if (P.body) P.body.xRot = clamp(-Math.atan2(v[1], Math.hypot(v[0], v[2]) + 0.001), -1, 1) * (this.inWater ? 1 : 0.3);
    if (P.head) P.head.yRot = -(this.headYaw || 0) * 0.3;
    const sw = Math.hypot(v[0], v[2]) > 1e-4 ? 1 : 0.2;
    if (P.tail) P.tail.xRot = -0.1 * Math.cos((this.age + a) * 0.3) * sw;
    if (P.tail_fin) P.tail_fin.xRot = -0.2 * Math.cos((this.age + a) * 0.3) * sw;
  }
  texKey(r) { return r.etex('entity/dolphin/dolphin' + (this.baby ? '_baby' : '')); }
  ambientKind() { return this.inWater ? 'ambient_water' : 'ambient'; }
}
defVMob('dolphin', { cls: Dolphin, ai: 'swim', xp: 2, shadowR: 0.5, stepSound: false, speed3: 2.4, fights: true, T: { attack: 3 } });

// ---- axolotls: play dead, hunt fish and drowned, help players fight underwater --------------------------------------
const AXOLOTL_COLORS = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
class Axolotl extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.variant = Math.random() < 1 / 1200 ? 4 : randInt(0, 3); this.deadT = 0; this.dry = 0; this.fromBucket = false; this.waterBreather = true; }
  extraSave() { return { var: this.variant, fb: this.fromBucket }; }
  extraLoad(o) { this.variant = o.var | 0; this.fromBucket = !!o.fb; if (this.fromBucket) this.persistent = true; }
  compVal(k) { return k === 'axolotl/variant' ? AXOLOTL_COLORS[this.variant] : undefined; }
  get ai() { return 'amph'; }
  wantsPlayer() { return false; }
  huntTarget() {
    if ((this.age + this.id) % 20) return null;
    return this.game.entities.find(e => !e.dead && !e.deathTime && e.inWater && /^(cod|salmon|pufferfish|tropical_fish|squid|glow_squid|drowned|guardian|elder_guardian|tadpole)$/.test(e.type) && e.distTo(this) < 8) || null;
  }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || !this.target.inWater)) this.target = null; if (!this.target) this.target = this.huntTarget(); }
  hurt(a, src) {
    const r = super.hurt(a, src);
    // plays dead when badly hurt in water: regenerates and stops being a target
    if (r && this.health > 0 && this.health < this.maxHealth / 2 && this.inWater && Math.random() < 1 / 3 && this.deadT <= 0) { this.deadT = 200; if (this.addEffect) this.addEffect('regeneration', 0, 200); this.target = null; }
    return r;
  }
  onDeath(src) { const p = this.game.player; if (src && src.attacker && src.attacker !== p && p.inWater && this.distTo(p) < 16 && p.addEffect) p.addEffect('regeneration', 0, 100); }
  think(c) {
    if (this.deadT > 0) { this.deadT--; this.health = Math.min(this.maxHealth, this.health + 0.025); return; }
    if (!this.inWater) { if (++this.dry > 6000 && this.age % 20 === 0) this.hurt(1, { type: 'drown' }); } else this.dry = 0;
    VMob.prototype.think.call(this, c);
  }
  melee(t) { super.melee(t); if (t.dead || t.deathTime) { const p = this.game.player; if (p.inWater && this.distTo(p) < 16 && p.addEffect) p.addEffect('regeneration', 0, 100); } }
  preInteract(p, held) {
    if (held && ITEMS[held.id].key === 'water_bucket' && ITEM_KEY.axolotl_bucket !== undefined) { swapHeld(this.game, p, 'axolotl_bucket', { mob: { var: this.variant, baby: this.baby ? this.growT : 0 } }); this.dead = true; Sound.ev('item.bucket.fill_axolotl', this.pos, 1, 1); return true; }
    if (held && isFood('axolotl_food', held.id)) {
      // fed with a bucket of tropical fish: the empty water bucket comes back
      if (this.baby) { this.growT -= Math.floor(this.growT * 0.1); swapHeld(this.game, p, 'water_bucket'); return true; }
      if (this.breedCd <= 0 && !this.loveT) { this.loveT = 600; swapHeld(this.game, p, 'water_bucket'); this.sound('eat'); return true; }
      return false;
    }
    return false;
  }
  spawnChild(m) { const b = super.spawnChild(m); b.variant = Math.random() < 1 / 1200 ? 4 : Math.random() < 0.5 ? this.variant : m.variant; return b; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), t = this.age + a;
    if (this.baby) {
      const B = 'BabyAxolotlAnimation.';
      if (this.deadT > 0) EM.anim(md, B + 'BABY_AXOLOTL_PLAY_DEAD', t / 20);
      else if (this.inWater) EM.anim(md, spd > 0.05 ? B + 'BABY_AXOLOTL_SWIM' : B + 'IDLE_UNDERWATER', t / 20);
      else EM.walk(md, spd > 0.05 ? B + 'AXOLOTL_WALK_FLOOR' : B + 'BABY_AXOLOTL_IDLE_FLOOR', spd > 0.05 ? pos : t, spd > 0.05 ? spd : 1, 1, 2);
      return;
    }
    if (P.head) { P.head.yRot = -(this.headYaw || 0) * 0.5; }
    if (this.deadT > 0) {
      if (P.body) P.body.zRot = Math.PI / 2 * 0.9;
      for (const n of ['right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg']) if (P[n]) { P[n].xRot = 0.5; P[n].zRot = n.startsWith('right') ? -0.6 : 0.6; }
      return;
    }
    if (this.inWater) {
      const s = spd > 0.05 ? 1 : 0.3, k = t * (spd > 0.05 ? 0.33 : 0.09);
      if (P.body) P.body.xRot = clamp(-this.vel[1] * 4, -0.6, 0.6);
      if (P.tail) P.tail.yRot = Math.sin(k) * 0.5 * s;
      if (P.head) P.head.yRot += Math.sin(k + 1) * 0.15 * s;
      for (const [n, sg] of [['right_front_leg', 1], ['left_front_leg', -1], ['right_hind_leg', 1], ['left_hind_leg', -1]]) if (P[n]) { P[n].xRot = spd > 0.05 ? 1.88 : 0.2; P[n].zRot = sg * (spd > 0.05 ? 0 : 0.6 + Math.cos(k) * 0.1); }
    } else {
      emQuad(md, pos * 1.5, spd);
      if (P.tail) P.tail.yRot = Math.sin(pos * 0.6662) * 0.3 * spd;
    }
    for (const n of ['top_gills', 'left_gills', 'right_gills']) if (P[n]) { const f = Math.sin(t * 0.1) * 0.15; if (n === 'top_gills') P[n].xRot = -0.2 + f; else P[n].yRot = (n === 'left_gills' ? -1 : 1) * (0.3 + f); }
  }
  texKey(r) { return r.etex('entity/axolotl/axolotl_' + AXOLOTL_COLORS[this.variant | 0] + (this.baby ? '_baby' : '')); }
  ambientKind() { return this.inWater ? 'idle_water' : 'idle_air'; }
}
// on land vanilla axolotls crawl (their stroll speed there is 0.15 of the 0.5 they swim with): landSpeedMul
defVMob('axolotl', { cls: Axolotl, food: 'axolotl_food', xp: 2, shadowR: 0.3, stepSound: false, waterOk: true, speed3: 1.6, landSpeedMul: 0.015, fights: true, T: { attack: 2 } });

// ---- nautiluses: saddled underwater mounts that dash; zombie nautiluses carry drowned ------------------------------------
const NAUTILUS_ARMOR = { copper_nautilus_armor: 'copper', iron_nautilus_armor: 'iron', golden_nautilus_armor: 'gold', diamond_nautilus_armor: 'diamond', netherite_nautilus_armor: 'netherite' };
class Nautilus extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.waterBreather = true; this.saddled = false; this.armorItem = null; this.tame = type === 'nautilus' ? false : true; this.dashCd = 0; this.coral = type === 'zombie_nautilus' && Math.random() < 0.5; }
  extraSave() { return { sad: this.saddled, arm: this.armorItem, tame: this.tame, cor: this.coral }; }
  extraLoad(o) { this.saddled = !!o.sad; this.armorItem = o.arm || null; this.tame = !!o.tame; this.coral = !!o.cor; }
  dropsOnDeath() { return [this.armorItem]; }
  seat() { return [this.pos[0], this.pos[1] + this.h * 0.8, this.pos[2]]; }
  get ai() { return 'swim'; }
  wantsPlayer() { return this.type === 'zombie_nautilus' && !this.tame && this.game.difficulty > 0 && !this.rider; }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (held && isFood('nautilus_food', held.id)) {
      if (!this.tame) { swapBucketFood(g, p, held); tryTame(this, p, 1 / 3); this.tame = !!this.owner; this.sitting = false; return true; }
      if (this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + 3); swapBucketFood(g, p, held); this.sound('eat'); return true; }
      if (this.breedCd <= 0 && !this.loveT && !this.baby) { this.loveT = 600; swapBucketFood(g, p, held); return true; }
    }
    if (!this.tame) return false;
    if (k === 'saddle' && !this.saddled && !this.baby) { this.saddled = true; useOne(g, p); Sound.ev('entity.nautilus.saddle', this.pos, 1, 1); return true; }
    if (k && NAUTILUS_ARMOR[k] && !this.armorItem && !this.baby) { this.armorItem = { ...held, count: 1 }; useOne(g, p); Sound.ev('item.armor.equip_nautilus', this.pos, 1, 1); return true; }
    if (this.saddled && !p.vehicle) { p.mount(this); p.yaw = this.yaw; return true; }
    return false;
  }
  ridden(c, inp) {
    const p = this.rider;
    if (!this.saddled) return;
    this.yaw = p.yaw;
    const f = inp.fwd || 0;
    if (this.inWater) {
      const sp = 0.035 * (this.armorItem ? 1 : 1);
      this.vel[0] += -Math.sin(p.yaw) * Math.cos(p.pitch) * f * sp; this.vel[2] += -Math.cos(p.yaw) * Math.cos(p.pitch) * f * sp; this.vel[1] += Math.sin(p.pitch) * f * sp + (inp.jump ? 0.02 : 0);
      if (this.dashCd > 0) this.dashCd--;
      if (inp.sprint && this.dashCd <= 0 && f > 0) { this.vel[0] += -Math.sin(p.yaw) * 1.2; this.vel[2] += -Math.cos(p.yaw) * 1.2; this.vel[1] += Math.sin(p.pitch) * 1.2; this.dashCd = 40; this.sound('dash'); }
    } else c.fwd = f > 0 ? 0.3 : 0;
  }
  moveBy(c) {
    if (this.rider && this.saddled && this.inWater) { this.move(this.vel[0], this.vel[1], this.vel[2]); for (let i = 0; i < 3; i++) this.vel[i] *= 0.9; this.bodyYaw += angDelta(this.yaw, this.bodyYaw) * 0.4; return; }
    if (!this.inWater) { this.travel(c.fwd, 0, 0.02, false); return; }
    VMob.prototype.moveBy.call(this, c);
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    EM.walk(md, 'NautilusAnimation.SWIMMING', this.age + a, 1, 1, Math.max(0.2, spd * 3));
    if (P.body) P.body.yRot = -(this.headYaw || 0) * 0.3;
  }
  texKey(r) { return r.etex(this.type === 'zombie_nautilus' ? 'entity/nautilus/zombie_nautilus' : 'entity/nautilus/nautilus' + (this.baby ? '_baby' : '')); }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (this.coral) { const cm = EM.get(r, 'zombie_nautilus_coral#main'); if (cm) { EM.reset(cm); EM.copy(md, cm); r.drawEM(cm, r.etex('entity/nautilus/zombie_nautilus_coral'), m, lt, env, { overlay, cull: false }); } }
    if (this.armorItem && !this.baby) { const am = EM.get(r, 'nautilus_armor#main'); if (am) { EM.reset(am); EM.copy(md, am); r.drawEM(am, r.etex('entity/equipment/nautilus_body/' + NAUTILUS_ARMOR[ITEMS[this.armorItem.id].key]), m, lt, env, { overlay }); } }
    if (this.saddled && !this.baby) { const sm = EM.get(r, 'nautilus#saddle'); if (sm) { EM.reset(sm); EM.copy(md, sm); r.drawEM(sm, r.etex('entity/equipment/nautilus_saddle/saddle'), m, lt, env, { overlay }); } }
  }
}
// food from a bucket of fish leaves the water bucket behind
function swapBucketFood(g, p, held) { if (/_bucket$/.test(ITEMS[held.id].key)) swapHeld(g, p, 'water_bucket'); else useOne(g, p); }
defVMob('nautilus', { cls: Nautilus, food: 'nautilus_food', xp: 2, shadowR: 0.5, stepSound: false, speed3: 1.4 });
defVMob('zombie_nautilus', { cls: Nautilus, xp: 5, shadowR: 0.5, stepSound: false, speed3: 1.4, T: { hostile: true } });

// ---- guardians and elder guardians: charge a laser at what they see in the water -----------------------------------------
class Guardian extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.waterBreather = true; this.beamT = -1; this.spikes = 0; this.tailT = 0; this.persistent = type === 'elder_guardian'; this.curseT = 0; }
  get elder() { return this.type === 'elder_guardian'; }
  get beamTime() { return this.elder ? 60 : 80; }
  despawn() { return this.elder ? false : super.despawn(); }
  hurt(a, src) {
    const r = super.hurt(a, src);
    // thorns from the spikes when hit up close while they're out
    if (r && src && src.attacker && src.type === 'mob' && this.beamT < 0 && src.attacker.hurt && Math.random() < 0.6) src.attacker.hurt(2, { type: 'thorns', attacker: this });
    return r;
  }
  findTarget() {
    const p = this.game.player;
    if (this.target && (this.target.dead || this.target.deathTime || this.distTo(this.target) > 16 || !this.canSee(this.target))) { this.target = null; this.beamT = -1; }
    if (!this.target && (this.age + this.id) % 10 === 0) {
      if (!p.creative && this.game.difficulty > 0 && p.inWater && this.distTo(p) < 16 && this.canSee(p)) this.target = p;
      else this.target = this.game.entities.find(e => (e.type === 'squid' || e.type === 'glow_squid' || e.type === 'axolotl') && !e.dead && e.distTo(this) < 16 && this.canSee(e)) || null;
    }
  }
  ranged(c, t, d) {
    c.look = t; c.face = Math.atan2(-(t.pos[0] - this.pos[0]), -(t.pos[2] - this.pos[2]));
    if (this.beamT < 0) { this.beamT = 0; this.sound(this.inWater ? 'attack' : 'attack', 1); }
    if (++this.beamT >= this.beamTime) {
      const df = this.game.difficulty;
      t.hurt(1 + (df === 3 ? 2 : 0), { type: 'magic', attacker: this });
      t.hurt((this.elder ? 5 : 6) * (df === 1 ? 0.5 : df === 3 ? 1.5 : 1), { type: 'mob', attacker: this });
      this.beamT = -1; this.target = this.target === this.game.player ? this.target : null; this.attackCd = 40;
    }
  }
  think(c) {
    if (!this.inWater) { this.flop(); return; }
    // elder guardians curse players near them with Mining Fatigue
    if (this.elder && --this.curseT <= 0) { this.curseT = 1200; const p = this.game.player; if (!p.creative && this.distTo(p) < 50 && p.addEffect) { p.addEffect('mining_fatigue', 2, 6000); Sound.ev('entity.elder_guardian.curse', p.pos, 1, 1); } }
    VMob.prototype.think.call(this, c);
  }
  afterMove() { this.spikes += ((this.ctl.goal && this.inWater && this.beamT < 0 ? 0 : 1) - this.spikes) * 0.06; this.tailT += this.ctl.goal ? 0.3 : 0.06; }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    // spikes out while still, in while swimming; the eye follows the target
    const ext = (1 - this.spikes) * 0 + this.spikes;
    for (let i = 0; i < 12; i++) { const n = P['spike' + i]; if (n) { const k = 1 + (1 - ext) * -0.15 + Math.sin(t * 0.1 + i) * 0.02; n.x *= k; n.y = 16 + (n.y - 16) * k; n.z *= k; } }
    if (P.eye) { P.eye.z = -8.25; const lk = this.target || this.ctl.look; if (lk) { P.eye.x = clamp(-(this.headYaw || 0) * 2, -1.5, 1.5); P.eye.y = clamp(-(this.pitch || 0) * 4, -1.5, 1.5); } }
    const wag = Math.sin(this.tailT) * Math.PI * 0.05;
    if (P.tail0) P.tail0.yRot = wag; if (P.tail1) P.tail1.yRot = wag; if (P.tail2) P.tail2.yRot = wag;
  }
  texKey(r) { return r.etex(this.elder ? 'entity/guardian/guardian_elder' : 'entity/guardian/guardian'); }
  ambientKind() { return this.inWater ? 'ambient' : 'ambient_land'; }
  drawLayers(g, r, md, m, a, env, lt) {
    if (this.beamT < 0 || !this.target) return;
    // the beam: from the eye to the target, a strip that brightens as it charges
    const t = this.target, k = this.beamT / this.beamTime;
    const s = this.D.scale || 1, e0 = [this.pos[0], this.pos[1] + this.h * 0.5, this.pos[2]], e1 = [t.pos[0], t.pos[1] + t.h * 0.5, t.pos[2]];
    if (g.drawBeam) g.drawBeam(e0, e1, 0.2 * s, [64 + k * 191, 32 + k * 191, 128 - k * 64].map(v => v / 255), 'entity/guardian/guardian_beam', this.age + a);
  }
}
defVMob('guardian', { cls: Guardian, ai: 'swim', xp: 10, shadowR: 0.5, stepSound: false, speed3: 1, T: { hostile: true } });
defVMob('elder_guardian', { cls: Guardian, layer: 'elder_guardian#main', ai: 'swim', xp: 10, shadowR: 1.2, stepSound: false, speed3: 0.6, T: { hostile: true } });
