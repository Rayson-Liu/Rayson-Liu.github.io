'use strict';
// ---------------------------------------------------------------------------
// Land animals and other friendly mobs drawn with the vanilla models (vmobs.js): horses, donkeys, mules,
// skeleton / zombie horses, camels, llamas, wolves, foxes, goats, pandas, polar bears, rabbits, ocelots,
// parrots, bats, bees, armadillos, sniffers, mooshrooms, frogs, tadpoles, turtles, allays, snow golems, copper
// golems, the wandering trader and its llamas, happy ghasts.
// Behaviour follows the vanilla mechanics in a simplified form; the numbers (health, speed, size) are the jar's.
// ---------------------------------------------------------------------------
const biomeName = (g, x, z) => { const v = g.vbiomeAt && g.vbiomeAt(Math.floor(x), Math.floor(z)); return (v && v.name) || 'plains'; };
const lerpRot = (a, b, t) => a + angDelta(b, a) * t;

// ---- horses, donkeys, mules, skeleton and zombie horses ------------------------------------------------
const HORSE_COLORS = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'];
const HORSE_MARKS = [null, 'white', 'whitefield', 'whitedots', 'blackdots'];
const HORSE_ARMOR = { leather_horse_armor: ['leather', 3], copper_horse_armor: ['copper', 4], iron_horse_armor: ['iron', 5], golden_horse_armor: ['gold', 7], diamond_horse_armor: ['diamond', 11], netherite_horse_armor: ['netherite', 19] };
class Horse extends VMob {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    this.tame = false; this.temper = 0; this.saddled = false; this.armorItem = null; this.chest = false; this.chestInv = null;
    this.eatT = 0; this.rearT = 0; this.mouthT = 0; this.tailT = 0; this.jumpCharge = 0; this.jumping = false;
    // vanilla: random speed, jump strength and health within the breed's range
    if (type === 'horse') {
      this.variant = randInt(0, 6) + randInt(0, 4) * 8;
      this.maxHealth = this.health = 15 + randInt(0, 8) + randInt(0, 9);
      this.spd = (0.45 + Math.random() * 0.3 + Math.random() * 0.3 + Math.random() * 0.3) * 0.25;
      this.jumpStr = 0.4 + Math.random() * 0.2 + Math.random() * 0.2 + Math.random() * 0.2;
    } else if (type === 'donkey' || type === 'mule') { this.spd = 0.175; this.jumpStr = 0.5; this.maxHealth = this.health = randInt(15, 30); }
    else { this.spd = 0.2; this.jumpStr = 0.4 + Math.random() * 0.6; if (type === 'skeleton_horse') this.tame = true; }
  }
  extraSave() { return { tame: this.tame, temper: this.temper, sad: this.saddled, arm: this.armorItem, ch: this.chest, inv: this.chestInv, spd: this.spd, js: this.jumpStr, mh: this.maxHealth }; }
  extraLoad(o) { this.tame = o.tame; this.temper = o.temper || 0; this.saddled = o.sad; this.armorItem = o.arm || null; this.chest = !!o.ch; this.chestInv = o.inv || null; if (o.spd) this.spd = o.spd; if (o.js) this.jumpStr = o.js; if (o.mh) this.maxHealth = o.mh; if (this.tame) this.persistent = true; }
  get undead() { return this.type === 'skeleton_horse' || this.type === 'zombie_horse'; }
  canBreed() { return this.tame && !this.undead; }
  seat() { return [this.pos[0], this.pos[1] + (this.baby ? 0.5 : 1.1) - (this.type === 'donkey' ? 0.2 : 0), this.pos[2]]; }
  dropsOnDeath() { return [this.armorItem, this.chest ? makeStack('chest', 1) : null, ...(this.chestInv || [])]; }
  hurt(a, src) { if (this.armorItem && HORSE_ARMOR[ITEMS[this.armorItem.id].key]) a *= 1 - HORSE_ARMOR[ITEMS[this.armorItem.id].key][1] / 25; const r = super.hurt(a, src); if (r && !this.rider) this.rearT = 20; return r; }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (this.baby && !this.undead && held && isFood('horse_food', held.id)) return false;
    if (p.sneaking && this.tame) { g.ui.open(new HorseScreen(g, this)); return true; }
    if (k === 'saddle' && this.tame && !this.saddled && !this.baby) { this.saddled = true; useOne(g, p); Sound.ev('entity.horse.saddle', this.pos, 0.5, 1); return true; }
    if (k && HORSE_ARMOR[k] && this.type === 'horse' && this.tame && !this.armorItem && !this.baby) { this.armorItem = { ...held, count: 1 }; useOne(g, p); Sound.ev('entity.horse.armor', this.pos, 0.5, 1); return true; }
    if (k === 'chest' && (this.type === 'donkey' || this.type === 'mule') && this.tame && !this.chest && !this.baby) { this.chest = true; this.chestInv = new Array(15).fill(null); useOne(g, p); Sound.ev('entity.donkey.chest', this.pos, 1, 1); return true; }
    if (held && isFood(this.type === 'zombie_horse' ? 'zombie_horse_food' : 'horse_food', held.id)) {
      // feeding: heals, makes it friendlier; golden apples and carrots let tamed ones breed
      const heal = { sugar: 1, wheat: 2, apple: 3, carrot: 3, golden_carrot: 4, golden_apple: 10, enchanted_golden_apple: 10, hay_block: 20, red_mushroom: 2 }[k] || 2;
      const temper = { sugar: 3, wheat: 3, apple: 3, carrot: 3, golden_carrot: 5, golden_apple: 10, enchanted_golden_apple: 10 }[k] || 0;
      let used = false;
      if (this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + heal); used = true; }
      if (!this.tame && temper && this.temper < 100) { this.temper = Math.min(100, this.temper + temper); used = true; }
      if (this.tame && (k === 'golden_carrot' || k === 'golden_apple' || k === 'enchanted_golden_apple') && this.breedCd <= 0 && !this.loveT && !this.undead) { this.loveT = 600; used = true; }
      if (used) { useOne(g, p); this.sound('eat'); this.eatT = 20; this.mouthT = 10; return true; }
      return false;
    }
    if (!this.baby && !p.vehicle && (!held || !ITEMS[held.id].spawnEgg)) { p.mount(this); p.yaw = this.yaw; return true; }
    return false;
  }
  ridden(c, inp) {
    const p = this.rider;
    if (!this.tame) {
      // breaking it in: bucks the rider off unless its temper says yes
      if (this.age % 10 === 0 && Math.random() < 0.15) {
        if (Math.random() * 100 < this.temper) { this.tame = true; this.persistent = true; this.owner = p; for (let i = 0; i < 7; i++) this.game.particles.spawn('heart', this.pos[0] + (Math.random() - 0.5), this.pos[1] + this.h, this.pos[2] + (Math.random() - 0.5), 0, 0.02, 0); }
        else { this.temper = Math.min(100, this.temper + 5); p.dismount(); this.rearT = 20; this.sound('angry'); }
      }
      c.fwd = 0; this.limbAmt *= 0.9;
      return;
    }
    if (!this.saddled) return;
    this.yaw = p.yaw; this.bodyYaw = p.yaw; this.headYaw = 0; this.pitch = p.pitch * 0.5;
    c.fwd = inp.fwd > 0 ? 1 : inp.fwd < 0 ? -0.25 : 0; c.strafe = (inp.strafe || 0) * 0.5;
    this.riderSpeed = this.spd;
    // jump: hold to charge (the jump bar), release to leap
    if (inp.jump && this.onGround) { this.jumpCharge = Math.min(1, this.jumpCharge + 0.1); this.chargingJump = true; }
    else if (this.chargingJump) {
      this.chargingJump = false;
      if (this.onGround && this.jumpCharge > 0) { const pw = this.jumpCharge >= 0.9 ? 1 : 0.4 + 0.4 * this.jumpCharge / 0.9; this.vel[1] = this.jumpStr * pw; this.vel[0] += -Math.sin(this.yaw) * 0.4 * pw * (c.fwd > 0 ? 1 : 0); this.vel[2] += -Math.cos(this.yaw) * 0.4 * pw * (c.fwd > 0 ? 1 : 0); this.sound('jump', 0.4); this.mouthT = 10; }
      this.jumpCharge = 0;
    }
  }
  moveBy(c) {
    if (this.rider && this.tame && this.saddled) {
      // the rider steers: like vanilla, the horse's own speed attribute
      this.travel(c.fwd, c.strafe, this.spd * this.spd * 4.6, false);
      return;
    }
    super.moveBy(c);
  }
  afterMove() {
    if (this.eatT > 0) this.eatT--;
    if (this.rearT > 0) this.rearT--;
    if (this.mouthT > 0) this.mouthT--;
    if (!this.rider && !this.target && this.onGround && this.ctl.fwd === 0 && Math.random() < 0.002) this.eatT = 40;
  }
  get T2() { return this.T; }
  setupAnim(md, a) { horseAnim(md, this, a); }
  texKey(r) {
    if (this.type !== 'horse') return r.etex('entity/horse/' + ({ donkey: 'donkey', mule: 'mule', skeleton_horse: 'horse_skeleton', zombie_horse: 'horse_zombie' }[this.type]) + (this.baby ? '_baby' : ''));
    const b = this.baby ? '_baby' : '', col = HORSE_COLORS[this.variant & 7] || 'white', mk = HORSE_MARKS[this.variant >> 3];
    return mk ? r.etexMix(['entity/horse/horse_' + col + b, 'entity/horse/horse_markings_' + mk + b]) : r.etex('entity/horse/horse_' + col + b);
  }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (this.armorItem && !this.baby) {
      const am = EM.get(r, this.undead ? 'undead_horse_armor#main' : 'horse_armor#main'), k = HORSE_ARMOR[ITEMS[this.armorItem.id].key];
      if (am && k) {
        EM.reset(am); EM.copy(md, am);
        const t = r.etex('entity/equipment/horse_body/' + k[0]);
        r.drawEM(am, t, m, lt, env, { overlay, tint: k[0] === 'leather' ? dyeTintOf(this.armorItem, [160 / 255, 101 / 255, 64 / 255]) : null });
        if (k[0] === 'leather') r.drawEM(am, r.etex('entity/equipment/horse_body/leather_overlay'), m, lt, env, { overlay });
      }
    }
    if (this.saddled && !this.baby) {
      const sm = EM.get(r, this.type + '#saddle');
      if (sm) { EM.reset(sm); EM.copy(md, sm); const show = !!this.rider; for (const n of ['left_saddle_line', 'right_saddle_line']) if (sm.parts[n]) sm.parts[n].visible = show; r.drawEM(sm, r.etex('entity/equipment/' + this.type + '_saddle/saddle'), m, lt, env, { overlay }); }
    }
  }
}
// the leather colour of a dyed stack (dyed_color component from the server), or the default brown
function dyeTintOf(st, def) { if (st && st.color != null) return [(st.color >> 16 & 255) / 255, (st.color >> 8 & 255) / 255, (st.color & 255) / 255]; return def; }
function horseAnim(md, e, a) {
  const P = md.parts, [pos, spd] = emLimbs(e, a), t = e.age + a;
  const eat = e.eatT > 0 ? Math.min(1, (40 - e.eatT + a) / 6, e.eatT / 6) : 0;
  const rear = e.rearT > 0 ? Math.sin(Math.min(1, (20 - e.rearT + a) / 20) * Math.PI) : 0;
  const hp = P.head_parts;
  if (hp) {
    hp.xRot = 0.5235988 + (-(e.pitch || 0)) * (1 - eat) + eat * 2.18 - rear * 0.4;
    hp.yRot = -(e.headYaw || 0) * (1 - eat);
    hp.y = 4 + eat * 7 - rear * 4; hp.z = -12 + eat * 0 - rear * 2;
  }
  if (P.body) { P.body.xRot = -rear * 0.785; }
  const ph = pos * 0.6662, amp = spd * 1.0;
  const back = rear > 0 ? -rear * 0.785 : 0;
  if (P.left_hind_leg) { P.left_hind_leg.xRot = Math.cos(ph) * amp * (1 - rear) - back * 0.6; }
  if (P.right_hind_leg) { P.right_hind_leg.xRot = Math.cos(ph + Math.PI) * amp * (1 - rear) - back * 0.6; }
  if (P.left_front_leg) { P.left_front_leg.xRot = Math.cos(ph + Math.PI) * amp * (1 - rear) - rear * (1.6 + Math.cos(t * 0.6) * 0.4); P.left_front_leg.y = 14 - rear * 6; P.left_front_leg.z = -10 + rear * 8; }
  if (P.right_front_leg) { P.right_front_leg.xRot = Math.cos(ph) * amp * (1 - rear) - rear * (1.6 + Math.sin(t * 0.6) * 0.4); P.right_front_leg.y = 14 - rear * 6; P.right_front_leg.z = -10 + rear * 8; }
  if (rear > 0) { for (const n of ['left_hind_leg', 'right_hind_leg']) if (P[n]) P[n].y = 14 + rear * 0.5; }
  if (P.tail) { P.tail.xRot = 0.5235988 + spd * 0.75 + (rear * 0.4); P.tail.yRot = e.tailT > 0 ? Math.cos(t * 0.7) : 0; }
  if (P.upper_mouth && e.mouthT > 0) P.upper_mouth.xRot = -0.2;
  if (P.left_chest) P.left_chest.visible = !!e.chest;
  if (P.right_chest) P.right_chest.visible = !!e.chest;
}
for (const t of ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse']) {
  defVMob(t, { cls: Horse, food: t === 'zombie_horse' ? 'zombie_horse_food' : 'horse_food', babyTempt: true, xp: 2, T: { hostile: false, passive: true }, sounds: t === 'horse' ? { ambient: 'entity.horse.ambient' } : null, shadowR: 0.75 });
}
// the horse's screen: saddle and armour slots, a donkey or mule's chest (llamas: carpet and chest), its picture
class HorseScreen extends ContainerScreen {
  constructor(game, horse) {
    super(game, 'gui_horse', 176, 166, horse.customName || horse.T.cn);
    this.h = horse;
    const llama = horse instanceof Llama;
    if (!llama) this.slots.push({ x: 8, y: 18, group: 'container', max: 1, emptyIcon: 'slot_saddle', accept: (s) => ITEMS[s.id].key === 'saddle', get: () => horse.saddled ? makeStack('saddle', 1) : null, set: (s) => { horse.saddled = !!s; } });
    if (horse.type === 'horse') this.slots.push({ x: 8, y: 36, group: 'container', max: 1, emptyIcon: 'slot_horse_armor', accept: (s) => !!HORSE_ARMOR[ITEMS[s.id].key], get: () => horse.armorItem, set: (s) => { horse.armorItem = s; } });
    if (llama) this.slots.push({ x: 8, y: 36, group: 'container', max: 1, emptyIcon: 'slot_llama_armor', accept: (s) => /_carpet$/.test(ITEMS[s.id].key), get: () => horse.carpet, set: (s) => { horse.carpet = s; } });
    this.cols = llama ? horse.strength : 5;
    if (horse.chest) for (let i = 0; i < horse.chestInv.length; i++) this.slots.push({ x: 80 + (i % this.cols) * 18, y: 18 + Math.floor(i / this.cols) * 18, group: 'container', get: () => horse.chestInv[i], set: (s) => { horse.chestInv[i] = s; } });
    this.addPlayerSlots(84, 142);
  }
  changed() { }
  stillValid() { if (this.h.dead || this.h.distTo(this.game.player) > 8) this.game.ui.close(); }
  drawExtra(ui) {
    Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 72, '#404040', false);
    if (this.h.chest) ui.ctx.drawImage(ui.img.horse_chest_slots, 0, 0, this.cols * 18, 54, this.x + 79, this.y + 17, this.cols * 18, 54);
    for (const s of this.slots) if (s.group === 'container' && s.emptyIcon) ui.sprite('slot_frame', this.x + s.x - 1, this.y + s.y - 1);
    const pv = this.game.renderer.mobPreview(this.game, this.h, ui, this.x + 26, this.y + 18, 52, 52);
    if (pv) ui.ctx.drawImage(pv, this.x + 26, this.y + 18, 52, 52);
  }
}

// ---- camels (and camel husks): two-humped mounts that sit down and dash ------------------------------
class Camel extends Horse {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    this.tame = true; this.spd = 0.14; this.jumpStr = 0.42; this.sit = false; this.sitT = 0; this.dashCd = 0;
    this.maxHealth = this.health = this.T.hp;
  }
  extraSave() { return { ...super.extraSave(), sit: this.sit }; }
  extraLoad(o) { super.extraLoad(o); this.sit = !!o.sit; }
  seat() { return [this.pos[0], this.pos[1] + (this.sit ? 0.6 : 1.85) * (this.baby ? 0.5 : 1), this.pos[2]]; }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (held && isFood(this.D.food, held.id)) return false;
    if (k === 'saddle' && !this.saddled && !this.baby) { this.saddled = true; useOne(g, p); this.sound('saddle', 0.5, 1); return true; }
    if (p.sneaking) { g.ui.open(new HorseScreen(g, this)); return true; }
    if (!this.baby && !p.vehicle && (!held || !ITEMS[held.id].spawnEgg)) { if (this.sit) this.standUp(); p.mount(this); p.yaw = this.yaw; return true; }
    return false;
  }
  sitDown() { if (this.sit) return; this.sit = true; this.anims = { 'CAMEL_SIT': this.age }; this.sitT = 40; this.sound('sit'); }
  standUp() { if (!this.sit) return; this.sit = false; this.anims = { 'CAMEL_STANDUP': this.age }; this.sitT = 52; this.sound('stand'); }
  think(c) {
    if (this.sitT > 0) { this.sitT--; return; }
    if (this.sit) { if (this.panic > 0 || Math.random() < 1 / 2000) this.standUp(); return; }
    if (!this.target && this.panic <= 0 && !this.loveT && Math.random() < 1 / 3000) { this.sitDown(); return; }
    VMob.prototype.think.call(this, c);
  }
  ridden(c, inp) {
    if (this.sitT > 0) { this.sitT--; return; }
    if (this.sit) { if (inp.fwd || inp.jump) this.standUp(); return; }
    if (!this.saddled) return;
    const p = this.rider;
    this.yaw = p.yaw; this.bodyYaw = p.yaw; this.headYaw = 0;
    c.fwd = inp.fwd > 0 ? (inp.sprint ? 1.6 : 1) : inp.fwd < 0 ? -0.3 : 0;
    if (this.dashCd > 0) { this.dashCd--; if (this.dashCd === 0) this.sound('dash_ready'); }
    // dash: jump while moving, then a cooldown
    if (inp.jump && this.onGround && this.dashCd <= 0 && c.fwd > 0) {
      this.vel[0] += -Math.sin(this.yaw) * 1.2; this.vel[2] += -Math.cos(this.yaw) * 1.2; this.vel[1] = 0.6;
      this.dashCd = 55; this.anims['CAMEL_DASH'] = this.age; this.sound('dash');
    }
  }
  moveBy(c) {
    if (this.rider && this.saddled) { if (!this.sit && this.sitT <= 0) this.travel(c.fwd, 0, this.spd * this.spd * 4.6, false); else this.travel(0, 0, 0, false); return; }
    if (this.sit || this.sitT > 0) { this.travel(0, 0, 0, false); return; }
    VMob.prototype.moveBy.call(this, c);
  }
  hurt(a, src) { const r = super.hurt(a, src); if (r && this.sit) this.standUp(); return r; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), pre = this.baby ? 'CamelBabyAnimation.CAMEL_BABY_' : 'CamelAnimation.CAMEL_';
    if (P.head) { P.head.yRot = clamp(-(this.headYaw || 0), -0.52, 0.52); P.head.xRot = clamp(-(this.pitch || 0), -0.44, 0.44); }
    if (!this.sit && this.sitT <= 0) EM.walk(md, pre + 'WALK', pos, spd, 2, 2.5);
    for (const k in this.anims) EM.anim(md, pre + k.slice(6), (this.age - this.anims[k] + a) / 20);
    if (this.sit && this.sitT <= 0) EM.anim(md, pre + 'SIT_POSE', 0);
    if (!this.sit && this.sitT <= 0 && spd < 0.05) EM.anim(md, pre + 'IDLE', (this.age + a) / 20);
  }
  texKey(r) { return r.etex(this.type === 'camel_husk' ? 'entity/camel/camel_husk' : this.baby ? 'entity/camel/camel_baby' : 'entity/camel/camel'); }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (!this.saddled || this.baby) return;
    const sm = EM.get(r, (this.type === 'camel_husk' ? 'camel_husk' : 'camel') + '#saddle');
    if (sm) { EM.reset(sm); EM.copy(md, sm); if (sm.parts.reins) sm.parts.reins.visible = !!this.rider; r.drawEM(sm, r.etex('entity/equipment/' + this.type + '_saddle/saddle'), m, lt, env, { overlay }); }
  }
}
defVMob('camel', { cls: Camel, food: 'camel_food', layer: 'camel#main', xp: 2, shadowR: 0.7 });
defVMob('camel_husk', { cls: Camel, food: 'camel_husk_food', layer: 'camel#main', xp: 5, T: { hostile: false, passive: true }, shadowR: 0.7 });

// ---- llamas and trader llamas: carpets, chests, spit ---------------------------------------------------
const LLAMA_COLORS = ['creamy', 'white', 'brown', 'gray'];
class Llama extends Horse {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    this.variant = randInt(0, 3); this.strength = Math.max(1, Math.min(5, randInt(1, 3) + (Math.random() < 0.04 ? 2 : 0)));
    this.carpet = null; this.spd = 0.175; this.maxHealth = this.health = randInt(15, 30);
    if (type === 'trader_llama') this.tame = true;
  }
  extraSave() { return { ...super.extraSave(), str: this.strength, carpet: this.carpet }; }
  extraLoad(o) { super.extraLoad(o); this.strength = o.str || 3; this.carpet = o.carpet || null; }
  dropsOnDeath() { return [this.carpet, this.chest ? makeStack('chest', 1) : null, ...(this.chestInv || [])]; }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (held && isFood('llama_food', held.id)) {
      let used = false;
      if (this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + (k === 'hay_block' ? 10 : 2)); used = true; }
      if (!this.tame && this.temper < 100) { this.temper = Math.min(100, this.temper + (k === 'hay_block' ? 6 : 3)); used = true; }
      if (this.tame && k === 'hay_block' && this.breedCd <= 0 && !this.loveT && !this.baby) { this.loveT = 600; used = true; }
      if (used) { useOne(g, p); this.sound('eat'); return true; }
      return false;
    }
    if (p.sneaking && this.tame) { g.ui.open(new HorseScreen(g, this)); return true; }
    if (k && /_carpet$/.test(k) && this.tame && !this.carpet && !this.baby) { this.carpet = { ...held, count: 1 }; useOne(g, p); Sound.ev('entity.llama.swag', this.pos, 0.5, 1); return true; }
    if (k === 'chest' && this.tame && !this.chest && !this.baby) { this.chest = true; this.chestInv = new Array(3 * this.strength).fill(null); useOne(g, p); this.sound('chest'); return true; }
    if (!this.baby && !p.vehicle && (!held || !ITEMS[held.id].spawnEgg)) { p.mount(this); p.yaw = this.yaw; return true; }
    return false;
  }
  // llamas can't be steered: a tamed one's rider just sits on it
  ridden(c, inp) { if (!this.tame) return super.ridden(c, inp); VMob.prototype.think.call(this, c); }
  moveBy(c) { VMob.prototype.moveBy.call(this, c); }
  seat() { return [this.pos[0], this.pos[1] + (this.baby ? 0.6 : 1.2), this.pos[2]]; }
  // spits at whatever hurt it
  ranged(c, t, d) {
    if (d > 8) c.goal = [t.pos[0], t.pos[1], t.pos[2]];
    if (this.attackCd <= 0 && d < 10 && this.canSee(t)) { this.attackCd = 40; spitAt(this, t); }
    if (this.anger <= 0) this.target = null;
  }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || this.anger <= 0)) this.target = null; }
  onAttacked(src) { this.panic = 0; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a); emQuad(md, pos, spd);
    if (P.right_chest) P.right_chest.visible = !!this.chest;
    if (P.left_chest) P.left_chest.visible = !!this.chest;
  }
  texKey(r) { return r.etex('entity/llama/llama_' + LLAMA_COLORS[this.variant | 0] + (this.baby ? '_baby' : '')); }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    const dec = this.type === 'trader_llama' ? 'trader_llama' + (this.baby ? '_baby' : '') : this.carpet && !this.baby ? ITEMS[this.carpet.id].key.replace(/_carpet$/, '') : null;
    if (!dec) return;
    const dm = EM.get(r, (this.baby ? 'llama_baby' : 'llama') + '#decor');
    if (dm) { EM.reset(dm); EM.copy(md, dm); r.drawEM(dm, r.etex('entity/equipment/llama_body/' + dec), m, lt, env, { overlay }); }
  }
}
// a projectile a mob throws or spits (llama spit, snowballs): flies under gravity, hurts what it hits
class MobShot extends Entity {
  constructor(g, x, y, z, vel, owner, o = {}) {
    super(g, x, y, z, 0.25, 0.25);
    this.vel = vel; this.owner = owner; this.o = o; this.spriteLayer = o.layer ?? (T(o.sprite) ?? T('p_generic_0'));
  }
  tick() {
    this.savePrev(); this.age++;
    const v = this.vel, g = this.game;
    const n = [this.pos[0] + v[0], this.pos[1] + v[1], this.pos[2] + v[2]];
    for (const e of g.entities) {
      if (e === this || e === this.owner || !(e instanceof Living) || e.dead || e.deathTime) continue;
      const b = e.box();
      if (n[0] > b[0] - 0.2 && n[0] < b[3] + 0.2 && n[1] > b[1] - 0.2 && n[1] < b[4] + 0.2 && n[2] > b[2] - 0.2 && n[2] < b[5] + 0.2) {
        if (this.o.onHit) this.o.onHit(e, this); else e.hurt(this.o.dmg ?? 1, { type: 'mob', attacker: this.owner, knockFrom: this.pos, knock: this.o.knock ?? 0.1 });
        this.dead = true; return;
      }
    }
    this.move(v[0], v[1], v[2]);
    if (this.collidedH || this.onGround || (this.vel[1] === 0 && v[1] !== 0) || this.age > 200) { if (this.o.onBlock) this.o.onBlock(this); this.dead = true; return; }
    v[0] *= 0.99; v[1] = v[1] * 0.99 - (this.o.grav ?? 0.06); v[2] *= 0.99;
  }
}
function shootAt(e, t, speed, o) {
  const g = e.game, sx = e.pos[0] - Math.sin(e.bodyYaw) * e.w * 0.6, sy = e.pos[1] + e.h * (o.yk || 0.8), sz = e.pos[2] - Math.cos(e.bodyYaw) * e.w * 0.6;
  const dx = t.pos[0] - sx, dy = t.pos[1] + t.h * 0.5 - sy, dz = t.pos[2] - sz, d = Math.hypot(dx, dz);
  const ly = dy + d * (o.arc ?? 0.2), l = Math.hypot(dx, ly, dz) || 1;
  const s = new MobShot(g, sx, sy, sz, [dx / l * speed, ly / l * speed, dz / l * speed], e, o);
  g.entities.push(s);
  return s;
}
function spitAt(e, t) { shootAt(e, t, 1.5, { sprite: 'p_generic_2', dmg: 1, grav: 0.06 }); e.sound('spit'); }
defVMob('llama', { cls: Llama, food: 'llama_food', babyTempt: true, xp: 2, layer: 'llama#main', shadowR: 0.6 });
defVMob('trader_llama', { cls: Llama, food: 'llama_food', xp: 2, layer: 'llama#main', soundType: 'llama', shadowR: 0.6 });

// ---- tameable pets: sitting, following the owner, fighting for it -------------------------------------
// (wolves, parrots; cats and ocelots keep their own code)
const PetMixin = {
  followOwner(c) {
    const o = this.owner;
    if (!o || this.sitting || o.dead || o.vehicle && this.ai !== 'fly') return false;
    const d = this.distTo(o);
    if (d > 12 && o.onGround) { // too far: teleport next to the owner
      for (let k = 0; k < 10; k++) {
        const x = Math.floor(o.pos[0]) + randInt(-3, 3), z = Math.floor(o.pos[2]) + randInt(-3, 3), y = Math.floor(o.pos[1]);
        if (Math.abs(x - o.pos[0]) < 2 && Math.abs(z - o.pos[2]) < 2) continue;
        if (BLOCKS[this.world.getBlock(x, y - 1, z)].solid && !BLOCKS[this.world.getBlock(x, y, z)].solid && !BLOCKS[this.world.getBlock(x, y + 1, z)].solid) { this.pos = [x + 0.5, y, z + 0.5]; this.savePrev(); this.goal = null; return true; }
      }
    }
    if (d > (this.ai === 'fly' ? 4 : 6)) { c.goal = [o.pos[0], o.pos[1] + (this.ai === 'fly' ? 1 : 0), o.pos[2]]; c.mod = 1.2; c.look = o; return true; }
    return false;
  },
  // an owner's enemies: what attacked it, what it attacked
  huntTarget() {
    const o = this.owner; if (!o || this.sitting) return null;
    const t = o.lastHurtBy || o.lastAttacked;
    if (t && t !== this && !t.dead && !t.deathTime && t.distTo && t.distTo(this) < 16 && !(t.owner === o) && t.type !== 'creeper') return t;
    return null;
  },
};
// the player's last attacker / victim, for pets
(() => {
  const _h = Player.prototype.hurt;
  Player.prototype.hurt = function (a, src) { const r = _h.call(this, a, src); if (r && src && src.attacker && src.attacker !== this) { this.lastHurtBy = src.attacker; this.lastHurtT = this.age; } return r; };
  const _a = Game.prototype.attack;
  Game.prototype.attack = function (e, ...rest) { const r = _a.call(this, e, ...rest); if (e && e instanceof Living) this.player.lastAttacked = e; return r; };
})();
const tryTame = (e, p, chance) => {
  const g = e.game;
  if (Math.random() < chance) {
    e.owner = p; e.persistent = true; e.sitting = true; e.target = null; e.panic = 0;
    for (let i = 0; i < 7; i++) g.particles.spawn('heart', e.pos[0] + (Math.random() - 0.5) * e.w, e.pos[1] + e.h * 0.8, e.pos[2] + (Math.random() - 0.5) * e.w, 0, 0.02, 0);
    if (e.onTamed) e.onTamed();
  } else for (let i = 0; i < 7; i++) g.particles.spawn('smoke', e.pos[0] + (Math.random() - 0.5) * e.w, e.pos[1] + e.h * 0.8, e.pos[2] + (Math.random() - 0.5) * e.w, 0, 0.02, 0);
};

// ---- wolves ---------------------------------------------------------------------------------------------
const WOLF_BY_BIOME = [[/^snowy_taiga/, 'ashen'], [/old_growth_pine_taiga/, 'black'], [/old_growth_spruce_taiga/, 'chestnut'], [/sparse_jungle/, 'rusty'],
  [/^grove/, 'snowy'], [/savanna_plateau/, 'spotted'], [/wooded_badlands/, 'striped'], [/^forest/, 'woods'], [/taiga/, 'pale']];
class Wolf extends VMob {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    const b = biomeName(g, x, z); this.variant = (WOLF_BY_BIOME.find(([re]) => re.test(b)) || [0, 'pale'])[1];
    this.collar = 'red'; this.armor = null; this.persistent = false; this.beg = 0;
  }
  extraSave() { return { collar: this.collar, arm: this.armor }; }
  extraLoad(o) { this.collar = o.collar || 'red'; this.armor = o.arm || null; if (this.owner) this.persistent = true; }
  get angry() { return !!this.target && this.anger > 0; }
  canBreed() { return !!this.owner && this.health >= this.maxHealth; }
  wantsPlayer() { return false; }
  hurt(a, src) {
    if (this.armor && src && src.type !== 'void' && src.type !== 'drown') {
      // wolf armour takes the hit until it breaks
      const max = 64; this.armor.dmg = (this.armor.dmg || 0) + Math.max(1, Math.round(a));
      if (this.armor.dmg >= max) { this.armor = null; Sound.ev('item.wolf_armor.break', this.pos, 1, 1); } else Sound.ev('item.wolf_armor.damage', this.pos, 1, 1);
      this.hurtTime = 10; return true;
    }
    const r = super.hurt(a, src);
    if (r && src && src.attacker && !this.owner) for (const e of this.game.entities) if (e instanceof Wolf && !e.owner && e !== this && e.distTo(this) < 12) { e.target = src.attacker; e.anger = 400; }
    return r;
  }
  dropsOnDeath() { return [this.armor]; }
  huntTarget() {
    const t = PetMixin.huntTarget.call(this);
    if (t) { this.anger = 400; return t; }
    // wild wolves hunt sheep, rabbits, foxes, baby turtles and skeletons
    if (!this.owner && (this.age + this.id) % 40 === 0) {
      const prey = this.game.entities.find(e => !e.dead && !e.deathTime && ((e.type === 'sheep' || e.type === 'rabbit' || e.type === 'fox' || e.type === 'skeleton' || e.type === 'stray' || (e.type === 'turtle' && e.baby))) && e.distTo(this) < 10);
      if (prey && Math.random() < 0.3) { this.anger = 300; return prey; }
    }
    return null;
  }
  findTarget() {
    if (this.target && (this.target.dead || this.target.deathTime || this.anger <= 0 || this.target === this.owner)) this.target = null;
    if (!this.target && this.huntTarget) this.target = this.huntTarget();
  }
  postInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (this.owner === p) {
      if (k && /_dye$/.test(k)) { this.collar = k.replace(/_dye$/, ''); useOne(g, p); return true; }
      if (k === 'wolf_armor' && !this.armor && !this.baby) { this.armor = { ...held, count: 1 }; useOne(g, p); Sound.ev('item.armor.equip_wolf', this.pos, 1, 1); return true; }
      if (k === 'shears' && this.armor) { g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], this.armor); this.armor = null; Sound.ev('item.armor.unequip_wolf', this.pos, 1, 1); return true; }
      if (k === 'armadillo_scute' && this.armor && this.armor.dmg) { this.armor.dmg = Math.max(0, this.armor.dmg - 16); useOne(g, p); Sound.ev('item.wolf_armor.repair', this.pos, 1, 1); return true; }
      if (held && isFood('wolf_food', held.id) && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + (ITEMS[held.id].food ? ITEMS[held.id].food[0] : 2)); useOne(g, p); this.sound('eat'); return true; }
      if (!held || !isFood('wolf_food', held.id)) { this.sitting = !this.sitting; this.target = null; this.goal = null; return true; }
    } else if (!this.owner && k === 'bone' && !this.angry) { useOne(g, p); tryTame(this, p, 1 / 3); return true; }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), t = this.age + a;
    emHead(P.head, this, a);
    if (P.head && this.beg > 0) P.head.zRot = 0.4 * this.beg;
    if (this.sitting) {
      if (P.upper_body) { P.upper_body.xRot = 2 * Math.PI / 5; P.upper_body.y = 16; P.upper_body.z = -3; }
      if (P.body) { P.body.xRot = Math.PI / 4; P.body.y = 18; P.body.z = 0; }
      if (P.tail) { P.tail.y = 21; P.tail.z = 6; }
      for (const n of ['right_hind_leg', 'left_hind_leg']) if (P[n]) { P[n].xRot = 3 * Math.PI / 2; P[n].y = 22.7; P[n].z = 2; }
      for (const n of ['right_front_leg', 'left_front_leg']) if (P[n]) { P[n].xRot = 5.811947; P[n].y = 17; P[n].z = -4; }
      if (P.right_hind_leg) P.right_hind_leg.x = -2.5; if (P.left_hind_leg) P.left_hind_leg.x = 0.5;
      if (P.right_front_leg) P.right_front_leg.x = -2.49; if (P.left_front_leg) P.left_front_leg.x = 0.51;
    } else emQuad(md, pos, spd);
    if (P.tail) P.tail.xRot = this.angry ? 1.5393804 : this.owner ? (0.55 - (this.maxHealth - this.health) * 0.02) * Math.PI : 0.62831855;
    if (P.tail && !this.sitting) P.tail.yRot = Math.cos(pos * 0.6662) * 1.4 * spd;
  }
  texKey(r) {
    const b = this.baby ? '_baby' : '', base = 'entity/wolf/wolf' + (this.variant === 'pale' ? '' : '_' + this.variant) + (this.owner ? '_tame' : this.angry ? '_angry' : '');
    if (!this.owner) return r.etex(base + b);
    return r.etexMix([base + b, { p: 'entity/wolf/wolf_collar' + b, c: dyeRGB(this.collar) }]);
  }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (!this.armor || this.baby) return;
    const am = EM.get(r, 'wolf_armor#main'); if (!am) return;
    EM.reset(am); EM.copy(md, am);
    r.drawEM(am, r.etex('entity/equipment/wolf_body/armadillo_scute'), m, lt, env, { overlay });
    if (this.armor.color != null) r.drawEM(am, r.etex('entity/equipment/wolf_body/armadillo_scute_overlay'), m, lt, env, { overlay, tint: dyeTintOf(this.armor) });
    const cr = (this.armor.dmg || 0) / 64;
    if (cr > 0.25) r.drawEMOver(am, r.etex('entity/wolf/wolf_armor_crackiness_' + (cr > 0.75 ? 'high' : cr > 0.5 ? 'medium' : 'low')), m, lt, env, {});
  }
}
Object.assign(Wolf.prototype, { followOwner: PetMixin.followOwner });
defVMob('wolf', { cls: Wolf, food: 'wolf_food', tameToBreed: true, fights: true, xp: 2, reach: 0.4, T: { attack: 4 }, shadowR: 0.5, chaseMod: 1.3 });

// ---- foxes: sleep by day, pounce, carry things in their mouths -------------------------------------------
class Fox extends VMob {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    this.variant = /snowy|frozen|grove|ice/.test(biomeName(g, x, z)) ? 'snow' : 'red';
    this.mouth = Math.random() < 0.2 ? makeStack(pickW([['emerald', 5], ['rabbit_foot', 10], ['rabbit_hide', 10], ['egg', 15], ['wheat', 20], ['leather', 20], ['feather', 20]]), 1) : null;
    this.sleeping = false; this.crouch = 0; this.trusts = null;
  }
  extraSave() { return { var: this.variant, mouth: this.mouth, trust: this.trusts ? 1 : 0 }; }
  extraLoad(o) { this.variant = o.var || 'red'; this.mouth = o.mouth || null; if (o.trust) this.trusts = this.game.player; }
  dropsOnDeath() { return [this.mouth]; }
  wantsPlayer() { return false; }
  avoid(c) {
    const p = this.game.player;
    if (this.trusts === p || p.sneaking || p.creative) return false;
    if (this.distTo(p) < 8) { this.sleeping = false; const dx = this.pos[0] - p.pos[0], dz = this.pos[2] - p.pos[2], d = Math.hypot(dx, dz) || 1; c.goal = [this.pos[0] + dx / d * 6, this.pos[1], this.pos[2] + dz / d * 6]; c.mod = 1.6; return true; }
    return false;
  }
  think(c) {
    const g = this.game;
    if (g.isDay() && !this.target && this.panic <= 0 && this.world.skyAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 1), Math.floor(this.pos[2])) < 15 + 1 && Math.random() < 0.01) this.sleeping = true;
    if (!g.isDay() || this.panic > 0 || this.target) this.sleeping = false;
    if (this.sleeping) return;
    // hunting chickens, rabbits, fish
    if (!this.target && (this.age + this.id) % 60 === 0) {
      const prey = g.entities.find(e => !e.dead && !e.deathTime && (e.type === 'chicken' || e.type === 'rabbit' || e.type === 'cod' || e.type === 'salmon' || e.type === 'tropical_fish' || (e.type === 'turtle' && e.baby)) && e.distTo(this) < 10);
      if (prey && Math.random() < 0.3) { this.target = prey; this.anger = 200; }
    }
    // pick up food or items lying near
    if (!this.mouth && this.age % 20 === 0) {
      const it = g.entities.find(e => e instanceof ItemEntity && !e.dead && e.distTo(this) < 1.5);
      if (it) { this.mouth = { ...it.stack, count: 1 }; it.stack.count--; if (!it.stack.count) it.dead = true; }
    }
    if (this.mouth && ITEMS[this.mouth.id].food && this.health < this.maxHealth && Math.random() < 0.01) { this.mouth = null; this.health = Math.min(this.maxHealth, this.health + 4); this.sound('eat'); }
    VMob.prototype.think.call(this, c);
  }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || this.anger <= 0)) this.target = null; }
  fight(c) {
    const t = this.target, d = this.distTo(t);
    // pounce from a few blocks away
    if (d < 5 && d > 2 && this.onGround && this.crouch === 0) this.crouch = 20;
    if (this.crouch > 0) { this.crouch--; c.look = t; if (this.crouch === 1) { const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], l = Math.hypot(dx, dz) || 1; this.vel[0] = dx / l * 0.6; this.vel[2] = dz / l * 0.6; this.vel[1] = 0.6; this.sound('bite'); } return; }
    VMob.prototype.fight.call(this, c);
  }
  hurt(a, src) { this.sleeping = false; return super.hurt(a, src); }
  postInteract(p, held) {
    if (held && isFood('fox_food', held.id) && !this.trusts && this.loveT > 0) this.trusts = p;
    return false;
  }
  spawnChild(m) { const b = super.spawnChild(m); b.variant = Math.random() < 0.5 ? this.variant : m.variant; b.trusts = this.game.player; return b; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    if (this.sleeping) {
      if (P.body) { P.body.zRot = -Math.PI / 2; P.body.y = 21; }
      if (P.head) { P.head.x = 1; P.head.y = 19.49; P.head.zRot = -2.0943952; P.head.yRot = 0; P.head.xRot = 0; }
      if (P.tail) { P.tail.x = -1; P.tail.y = 4; P.tail.z = -1; P.tail.xRot = -2.1816616; }
      for (const n of ['right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg']) if (P[n]) P[n].visible = false;
      return;
    }
    emHead(P.head, this, a); emQuad(md, pos, spd);
    if (this.crouch > 0 && P.body) { P.body.y += 2; if (P.head) P.head.y += 2; }
  }
  texKey(r) { return r.etex('entity/fox/fox' + (this.variant === 'snow' ? '_snow' : '') + (this.sleeping ? '_sleep' : '') + (this.baby ? '_baby' : '')); }
  attachments(g, md, lt, env) {
    if (!this.mouth || this.sleeping) return null;
    const st = this.mouth;
    return { head: (am) => { M4.translate(am, 1 / 16, 1.5 / 16, -0.4); M4.rotX(am, -Math.PI / 2); M4.scale(am, 0.75, 0.75, 0.75); g.drawGroundItem ? g.drawGroundItem(am, st, lt, env) : g.drawHeldItem(am, st, false, lt, env, this, null); } };
  }
}
defVMob('fox', { cls: Fox, food: 'fox_food', xp: 2, T: { attack: 2 }, shadowR: 0.4 });

// ---- goats: high jumps, ramming, milk and horns ---------------------------------------------------------
class Goat extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.screaming = Math.random() < 0.02; this.horns = [true, true]; this.ramT = 0; this.ramCd = 600 + randInt(0, 1200); }
  extraSave() { return { scr: this.screaming, horns: this.horns }; }
  extraLoad(o) { this.screaming = !!o.scr; this.horns = o.horns || [true, true]; }
  sound(kind, v, p) { super.sound(kind, v, p); }
  ambientKind() { return this.screaming ? 'screaming.ambient' : 'ambient'; }
  wantsPlayer() { return false; }
  think(c) {
    if (this.ramCd > 0) this.ramCd--;
    if (this.ramT > 0) {
      // the charge: lower the head, run at the target; a solid block knocks a horn off
      this.ramT--;
      const t = this.ramTarget;
      if (this.ramT > 20) { c.look = t; c.face = Math.atan2(-(t.pos[0] - this.pos[0]), -(t.pos[2] - this.pos[2])); return; }
      c.fwd = 1; c.mod = 3;
      if (t && !t.dead && this.distTo(t) < 1.5) {
        t.hurt(this.baby ? 1 : 2, { type: 'mob', attacker: this, knockFrom: this.pos, knock: 1.6 }); t.vel[1] = 0.4; this.sound(this.screaming ? 'screaming.ram_impact' : 'ram_impact'); this.ramT = 0;
      } else if (this.collidedH) {
        this.ramT = 0; this.sound(this.screaming ? 'screaming.ram_impact' : 'ram_impact');
        const i = this.horns[0] ? 0 : this.horns[1] ? 1 : -1;
        if (i >= 0 && Math.random() < 0.5) { this.horns[i] = false; this.game.dropItem(this.pos[0], this.pos[1] + 1, this.pos[2], makeStack('goat_horn', 1)); this.sound('horn_break'); }
      }
      return;
    }
    if (this.ramCd <= 0 && !this.baby) {
      const p = this.game.player, t = (!p.creative && this.distTo(p) < 12 && this.canSee(p)) ? p : this.game.entities.find(e => e instanceof Mob && e !== this && e.type !== 'goat' && e.distTo(this) < 12 && !e.dead);
      if (t) { this.ramTarget = t; this.ramT = 60; this.ramCd = this.screaming ? 100 + randInt(0, 200) : 600 + randInt(0, 1200); this.sound(this.screaming ? 'screaming.prepare_ram' : 'prepare_ram'); return; }
    }
    if (this.onGround && Math.random() < 0.003 && !this.target) { this.vel[1] = 0.8; this.vel[0] += (Math.random() - 0.5) * 0.4; this.vel[2] += (Math.random() - 0.5) * 0.4; this.sound(this.screaming ? 'screaming.long_jump' : 'long_jump'); }
    VMob.prototype.think.call(this, c);
  }
  postInteract(p, held) {
    if (held && ITEMS[held.id].key === 'bucket' && !this.baby) { swapHeld(this.game, p, 'milk_bucket'); this.sound(this.screaming ? 'screaming.milk' : 'milk'); return true; }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a); emQuad(md, pos, spd);
    if (P.head && this.ramT > 0) P.head.xRot = this.ramT > 20 ? Math.min(1, (60 - this.ramT) / 10) * 0.6 : 0.6;
    if (P.left_horn) P.left_horn.visible = this.horns[0] && !this.baby;
    if (P.right_horn) P.right_horn.visible = this.horns[1] && !this.baby;
  }
  texKey(r) { return r.etex('entity/goat/goat' + (this.baby ? '_baby' : '')); }
}
defVMob('goat', { cls: Goat, food: 'goat_food', xp: 2, jump: 0.5, fearless: true, shadowR: 0.45 });

// ---- pandas: genes, bamboo, rolling and sneezing --------------------------------------------------------
const PANDA_GENES = [['normal', 15], ['lazy', 1], ['worried', 1], ['playful', 1], ['brown', 1], ['weak', 1], ['aggressive', 1]];
class Panda extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.main = pickW(PANDA_GENES); this.hidden = pickW(PANDA_GENES); this.sit = 0; this.rollT = 0; this.sneezeT = 0; this.eatT = 0; this.holding = null; }
  extraSave() { return { m: this.main, h: this.hidden }; }
  extraLoad(o) { this.main = o.m || 'normal'; this.hidden = o.h || 'normal'; }
  get gene() { const m = this.main, h = this.hidden; if ((m === 'brown' || m === 'weak') && m !== h) return 'normal'; return m; }
  wantsPlayer() { return false; }
  fight(c) { if (this.gene !== 'aggressive' && !this.attacked) { this.target = null; return; } VMob.prototype.fight.call(this, c); }
  onAttacked() { this.attacked = true; if (this.gene !== 'aggressive') { this.target = null; this.panic = 60; } }
  think(c) {
    const g = this.game;
    if (this.rollT > 0) { this.rollT--; c.fwd = 1; return; }
    if (this.sit > 0) { this.sit--; if (this.eatT > 0 && --this.eatT === 0) { this.holding = null; this.health = Math.min(this.maxHealth, this.health + 2); } return; }
    if (this.gene === 'playful' && this.onGround && Math.random() < 1 / 500) { this.rollT = 32; this.sound('pre_sneeze'); return; }
    if (this.baby && (this.gene === 'weak' || Math.random() < 1 / 6000) && Math.random() < 1 / 300) { this.sneezeT = 20; this.sound('pre_sneeze'); }
    if (this.sneezeT > 0 && --this.sneezeT === 0) { this.sound('sneeze'); if (Math.random() < 1 / 700 * 7) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('slime_ball', 1)); for (const e of g.entities) if (e instanceof Panda && e !== this && e.distTo(this) < 10 && e.onGround) e.vel[1] = 0.4; }
    // eat bamboo lying around
    if (!this.holding && this.age % 20 === 0) {
      const it = g.entities.find(e => e instanceof ItemEntity && !e.dead && ITEMS[e.stack.id].key === 'bamboo' && e.distTo(this) < 6);
      if (it) { if (it.distTo(this) < 1.5) { this.holding = { ...it.stack, count: 1 }; it.stack.count--; if (!it.stack.count) it.dead = true; this.sit = 200; this.eatT = 200; this.sound('eat'); return; } c.goal = [...it.pos]; return; }
    }
    if (this.gene === 'lazy' && Math.random() < 1 / 400) { this.sit = 200; return; }
    VMob.prototype.think.call(this, c);
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a); emQuad(md, pos, spd);
    if (this.sit > 0 && P.body) {
      P.body.xRot = 0.9; P.body.y = 14; P.body.z = 2;
      if (P.head) { P.head.y = 5; P.head.z = -6; }
      for (const n of ['right_front_leg', 'left_front_leg']) if (P[n]) { P[n].xRot = -0.6 + (this.eatT > 0 ? Math.sin((this.age + a) * 0.6) * 0.3 : 0); P[n].y = 9; P[n].z = -4; }
      for (const n of ['right_hind_leg', 'left_hind_leg']) if (P[n]) { P[n].xRot = -1.4; P[n].y = 21; P[n].z = 6; }
    }
    if (this.sneezeT > 0 && P.head) P.head.xRot = -0.6 * (1 - this.sneezeT / 20);
  }
  preDraw(m, a) { if (this.rollT > 0) { M4.translate(m, 0, 0.6, 0); M4.rotX(m, -((32 - this.rollT + a) / 32) * Math.PI * 2); M4.translate(m, 0, -0.6, 0); } }
  texKey(r) { const ge = this.gene, b = this.baby; return r.etex(ge === 'normal' ? (b ? 'entity/panda/panda_baby' : 'entity/panda/panda') : b ? 'entity/panda/' + ge + '_panda_baby' : 'entity/panda/panda_' + ge); }
  inheritFrom(b, m) { b.main = Math.random() < 0.5 ? this.main : this.hidden; b.hidden = Math.random() < 0.5 ? m.main : m.hidden; if (Math.random() < 1 / 32) b.main = pickW(PANDA_GENES); }
  attachments(g, md, lt, env) {
    if (!this.holding) return null;
    const st = this.holding;
    return { head: (am) => { M4.translate(am, 0, 0.3, -0.5); M4.rotX(am, -Math.PI / 2); g.drawHeldItem(am, st, false, lt, env, this, null); } };
  }
}
defVMob('panda', { cls: Panda, food: 'panda_food', xp: 2, T: { attack: 6 }, shadowR: 0.8 });

// ---- polar bears: protective mothers -------------------------------------------------------------------
class PolarBear extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.stand = 0; }
  wantsPlayer() { return false; }
  findTarget() {
    super.findTarget();
    const p = this.game.player;
    if (!this.target && !this.baby && !p.creative && this.distTo(p) < 8 && this.game.entities.some(e => e instanceof PolarBear && e.baby && e.distTo(this) < 10)) { this.target = p; this.anger = 200; }
    if (this.target === p && this.anger <= 0 && !this.game.entities.some(e => e instanceof PolarBear && e.baby && e.distTo(this) < 10)) this.target = null;
  }
  onAttacked(src) { if (this.baby) { this.target = null; this.panic = 60; for (const e of this.game.entities) if (e instanceof PolarBear && !e.baby && e.distTo(this) < 16) { e.target = src.attacker; e.anger = 400; } } }
  melee(t) { super.melee(t); this.stand = 20; this.sound('warning'); }
  afterMove() { if (this.stand > 0) this.stand--; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a); emQuad(md, pos, spd);
    const s = this.stand > 0 ? Math.sin(Math.min(1, (20 - this.stand + a) / 10) * Math.PI / 2) * (this.stand / 20) : 0;
    if (s > 0 && P.body) {
      P.body.xRot = Math.PI / 2 - s * Math.PI * 0.35; P.body.y -= s * 9;
      if (P.head) { P.head.y -= s * 24; P.head.z += s * 13; }
      for (const n of ['right_front_leg', 'left_front_leg']) if (P[n]) { P[n].y -= s * 20; P[n].z += s * 4; P[n].xRot -= s * Math.PI * 0.45; }
    }
  }
  texKey(r) { return r.etex('entity/bear/polarbear' + (this.baby ? '_baby' : '')); }
}
defVMob('polar_bear', { cls: PolarBear, xp: 2, fights: true, shadowR: 0.7 });

// blocks with a random tick of their own (eggs hatching, frogspawn, dried ghasts): key -> fn(game, x, y, z, id, meta)
const BLOCK_RANDOM_TICK = {};
(() => {
  const _rt = Game.prototype.onRandomTick;
  Game.prototype.onRandomTick = function (x, y, z, id, ch) {
    const f = BLOCKS[id] && BLOCK_RANDOM_TICK[BLOCKS[id].key];
    if (f) { f(this, x, y, z, id, this.world.getMeta(x, y, z)); return; }
    return _rt.call(this, x, y, z, id, ch);
  };
})();
const bprop = (w, x, y, z, k) => { const id = w.getBlock(x, y, z); return Features.propOf(id, w.getMeta(x, y, z), k); };
const bsetProp = (w, x, y, z, k, v) => { const id = w.getBlock(x, y, z); w.setBlock(x, y, z, id, Features.withProp(id, w.getMeta(x, y, z), k, v)); };
function spawnAt(g, type, x, y, z, baby) { const m = createMob(g, type, x, y, z); if (baby && m.makeBaby) m.makeBaby(); m.persistent = true; g.entities.push(m); return m; }

// ---- rabbits: hop everywhere, raid carrot farms ----------------------------------------------------------
class Rabbit extends VMob {
  constructor(g, type, x, y, z) {
    super(g, type, x, y, z);
    const b = biomeName(g, x, z), r = Math.random() * 100;
    this.variant = /desert/.test(b) ? 'gold' : /snowy|frozen|ice|grove|jagged/.test(b) ? (r < 80 ? 'white' : 'white_splotched') : r < 50 ? 'brown' : r < 90 ? 'salt' : 'black';
    this.hopT = 0; this.persistent = false;
  }
  extraSave() { return { var: this.variant }; }
  extraLoad(o) { this.variant = o.var || 'brown'; }
  avoid(c) {
    const p = this.game.player;
    if (p.creative || p.sneaking || this.distTo(p) > 8 || (p.inv.held && isFood('rabbit_food', p.inv.held.id))) return false;
    const dx = this.pos[0] - p.pos[0], dz = this.pos[2] - p.pos[2], d = Math.hypot(dx, dz) || 1;
    c.goal = [this.pos[0] + dx / d * 6, this.pos[1], this.pos[2] + dz / d * 6]; c.mod = 2.2; return true;
  }
  idle(c) {
    // nibble ripe carrots
    if (this.age % 40 === 0 && Math.random() < 0.1) {
      const x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1]), z = Math.floor(this.pos[2]), id = this.world.getBlock(x, y, z);
      if (BLOCKS[id] && BLOCKS[id].key === 'carrots') { const ag = +(Features.propOf(id, this.world.getMeta(x, y, z), 'age') || 0); if (ag > 0) bsetProp(this.world, x, y, z, 'age', ag - 1); else this.world.setBlock(x, y, z, 0, 0); }
    }
    return false;
  }
  moveBy(c) {
    if (this.hopT > 0) this.hopT--;
    if ((c.goal || c.fwd) && this.onGround && this.hopT <= 0) { this.vel[1] = 0.5; this.hopT = 10; this.anims.HOP = this.age; this.sound('jump', 0.4); }
    if (!this.onGround || c.goal && this.hopT > 6) VMob.prototype.moveBy.call(this, c);
    else { c.goal = null; c.fwd = 0; VMob.prototype.moveBy.call(this, c); }
  }
  setupAnim(md, a) {
    const P = md.parts;
    if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = 0.39 - (this.pitch || 0); }
    const pre = this.baby ? 'BabyRabbitAnimation.' : 'RabbitAnimation.';
    if (this.anims.HOP != null) EM.anim(md, pre + 'HOP', (this.age - this.anims.HOP + a) / 20);
  }
  texKey(r) {
    const n = this.customName === 'Toast' ? 'toast' : this.variant === 'evil' ? 'caerbannog' : this.variant;
    return r.etex('entity/rabbit/rabbit_' + n + (this.baby ? '_baby' : ''));
  }
  spawnChild(m) { const b = super.spawnChild(m); b.variant = Math.random() < 0.5 ? this.variant : m.variant; return b; }
}
defVMob('rabbit', { cls: Rabbit, food: 'rabbit_food', xp: 2, shadowR: 0.3, stepSound: false });

// ---- ocelots: shy jungle cats --------------------------------------------------------------------------
class Ocelot extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.trusting = false; this.persistent = false; }
  extraSave() { return { trust: this.trusting }; }
  extraLoad(o) { this.trusting = !!o.trust; if (this.trusting) this.persistent = true; }
  canBreed() { return this.trusting; }
  avoid(c) {
    const p = this.game.player;
    if (this.trusting || p.creative || this.distTo(p) > 10) return false;
    if (p.inv.held && isFood('ocelot_food', p.inv.held.id) && (p.sneaking || Math.hypot(p.vel[0], p.vel[2]) < 0.05)) return false;
    const dx = this.pos[0] - p.pos[0], dz = this.pos[2] - p.pos[2], d = Math.hypot(dx, dz) || 1;
    c.goal = [this.pos[0] + dx / d * 8, this.pos[1], this.pos[2] + dz / d * 8]; c.mod = 1.6; return true;
  }
  huntTarget() {
    if ((this.age + this.id) % 60) return null;
    const prey = this.game.entities.find(e => !e.dead && !e.deathTime && (e.type === 'chicken' || (e.type === 'turtle' && e.baby)) && e.distTo(this) < 10);
    if (prey) { this.anger = 200; return prey; }
    return null;
  }
  wantsPlayer() { return false; }
  preInteract(p, held) {
    if (!this.trusting && held && isFood('ocelot_food', held.id)) {
      useOne(this.game, p); this.sound('eat');
      if (Math.random() < 1 / 3) { this.trusting = true; this.persistent = true; for (let i = 0; i < 7; i++) this.game.particles.spawn('heart', this.pos[0] + (Math.random() - 0.5), this.pos[1] + 0.6, this.pos[2] + (Math.random() - 0.5), 0, 0.02, 0); }
      else for (let i = 0; i < 7; i++) this.game.particles.spawn('smoke', this.pos[0] + (Math.random() - 0.5), this.pos[1] + 0.6, this.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
      return true;
    }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a);
    emQuad(md, pos, spd);
    if (P.tail2) P.tail2.xRot = 1.7278761 + Math.PI / 4 * Math.cos(pos) * spd;
  }
  texKey(r) { return r.etex('entity/cat/ocelot'); }
}
defVMob('ocelot', { cls: Ocelot, food: 'ocelot_food', xp: 2, scale: 1, shadowR: 0.4, T: { attack: 3 }, stepSound: false });

// ---- mooshrooms: shear for mushrooms, bowl for stew, milk -----------------------------------------------
const STEW_FLOWERS = { dandelion: ['saturation', 7], poppy: ['night_vision', 100], blue_orchid: ['saturation', 7], allium: ['fire_resistance', 80], azure_bluet: ['blindness', 160],
  red_tulip: ['weakness', 180], orange_tulip: ['weakness', 180], white_tulip: ['weakness', 180], pink_tulip: ['weakness', 180], oxeye_daisy: ['regeneration', 160],
  cornflower: ['jump_boost', 120], lily_of_the_valley: ['poison', 240], wither_rose: ['wither', 160], torchflower: ['night_vision', 100], open_eyeblossom: ['blindness', 220],
  closed_eyeblossom: ['nausea', 140], cactus_flower: ['nausea', 140], golden_dandelion: ['saturation', 7] };
class Mooshroom extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.variant = 'red'; this.stew = null; }
  extraSave() { return { var: this.variant, stew: this.stew }; }
  extraLoad(o) { this.variant = o.var || 'red'; this.stew = o.stew || null; }
  compVal(k) { return k === 'mooshroom/variant' ? this.variant : undefined; }
  postInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (k === 'shears' && !this.baby) {
      // sheared: becomes a cow, five mushrooms drop
      const cow = createMob(g, 'cow', this.pos[0], this.pos[1], this.pos[2]); cow.yaw = cow.bodyYaw = this.bodyYaw; cow.health = this.health; cow.persistent = true;
      if (this.customName) cow.customName = this.customName;
      g.entities.push(cow); this.dead = true; Sound.ev('entity.mooshroom.shear', this.pos, 1, 1);
      for (let i = 0; i < 5; i++) g.dropItem(this.pos[0], this.pos[1] + this.h, this.pos[2], makeStack(this.variant + '_mushroom', 1));
      particleBurst(g, 'explosion', this.pos[0], this.pos[1] + 0.5, this.pos[2], 1, 0.2);
      Sound.ev('entity.mooshroom.shear', this.pos, 1, 1); g.damageHeld(1); return true;
    }
    if (k === 'bowl' && !this.baby) {
      if (this.stew) { swapHeld(g, p, 'suspicious_stew', { stew: this.stew }); this.stew = null; Sound.ev('entity.mooshroom.suspicious_milk', this.pos, 1, 1); }
      else { swapHeld(g, p, 'mushroom_stew'); Sound.ev('entity.mooshroom.milk', this.pos, 1, 1); }
      return true;
    }
    if (k === 'bucket' && !this.baby) { swapHeld(g, p, 'milk_bucket'); Sound.ev('entity.cow.milk', this.pos, 1, 1); return true; }
    if (k && STEW_FLOWERS[k] && this.variant === 'brown' && !this.stew) { this.stew = STEW_FLOWERS[k]; useOne(g, p); Sound.ev('entity.mooshroom.eat', this.pos, 1, 1); for (let i = 0; i < 4; i++) g.particles.spawn('smoke', this.pos[0], this.pos[1] + this.h, this.pos[2], 0, 0.05, 0); return true; }
    return false;
  }
  spawnChild(m) { const b = super.spawnChild(m); b.variant = this.variant === m.variant ? (Math.random() < 1 / 1024 ? (this.variant === 'red' ? 'brown' : 'red') : this.variant) : Math.random() < 0.5 ? this.variant : m.variant; return b; }
  texKey(r) { return r.etex('entity/cow/mooshroom_' + this.variant + (this.baby ? '_baby' : '')); }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (this.baby || !g.blockMesh) return;
    const id = BID[this.variant + '_mushroom']; if (id === undefined) return;
    const mesh = g.blockMesh(id, 0);
    // two mushrooms on the back, one on the head (vanilla's mushroom layer)
    const D = Math.PI / 180;
    const draw = (steps, head) => {
      const mm = M4.copy(m); M4.scale(mm, -1, -1, 1); M4.translate(mm, 0, -1.501, 0);
      if (head) { M4.translate(mm, head.x / 16, head.y / 16, head.z / 16); if (head.zRot) M4.rotZ(mm, head.zRot); if (head.yRot) M4.rotY(mm, head.yRot); if (head.xRot) M4.rotX(mm, head.xRot); }
      for (const [t, v] of steps) if (t === 't') M4.translate(mm, v[0], v[1], v[2]); else M4.rotY(mm, v * D);
      M4.scale(mm, -1, -1, 1); M4.translate(mm, -0.5, -0.5, -0.5);
      r.drawMesh(mesh, mm, env, lt);
    };
    draw([['t', [0.2, -0.35, 0.5]], ['r', -48]]);
    draw([['t', [0.2, -0.35, 0.5]], ['r', 42], ['t', [0.1, 0, -0.6]], ['r', -48]]);
    if (md.parts.head) draw([['t', [0, -0.7, -0.2]], ['r', -78]], md.parts.head);
  }
}
defVMob('mooshroom', { cls: Mooshroom, food: 'cow_food', xp: 2, shadowR: 0.7 });

// ---- armadillos: roll up when scared, shed scutes, brushed for scutes ---------------------------------------
class Armadillo extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.st = 'idle'; this.stT = 0; this.shedT = 6000 + randInt(0, 6000); }
  extraSave() { return { st: this.st }; }
  extraLoad(o) { if (o.st === 'scared') this.st = 'scared'; }
  get pre() { return this.baby ? 'BabyArmadilloAnimation.ARMADILLO_BABY_' : 'ArmadilloAnimation.ARMADILLO_'; }
  threatened() {
    const p = this.game.player;
    if (this.lastHurtT && this.age - this.lastHurtT < 100) return true;
    if (!p.creative && this.distTo(p) < 7 && (p.sprinting || p.vehicle || p.flying)) return true;
    // (the distance before the list of undead, squared and in a plain loop: each tick it ran the 17-name list for every
    // mob of the world - with a few armadillos among ~120 mobs 2-3% of the game tick, 2026-11-04)
    const x = this.pos[0], y = this.pos[1], z = this.pos[2];
    for (const e of this.game.entities) {
      if (e === this || !(e instanceof Mob)) continue;
      const dx = e.pos[0] - x, dy = e.pos[1] - y, dz = e.pos[2] - z;
      if (dx * dx + dy * dy + dz * dz < 49 && ENTITY_TAGS.undead.includes(e.type)) return true;
    }
    return false;
  }
  roll(st) { this.st = st; this.stT = 0; this.anims = { [st]: this.age }; }
  think(c) {
    this.stT++;
    if (--this.shedT <= 0 && !this.baby) { this.shedT = 6000 + randInt(0, 6000); for (const st of rollLoot('gameplay/armadillo_shed', { e: this })) this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], st); this.sound('scute_drop'); }
    const t = this.threatened();
    if (this.st === 'idle' && t) { this.roll('rolling'); this.sound('roll'); return; }
    if (this.st === 'rolling') { if (this.stT > 10) this.st = 'scared'; return; }
    if (this.st === 'scared') { if (!t && this.stT > 100 && Math.random() < 0.02) { this.roll('unrolling'); this.sound('unroll_start'); } if (this.stT % 50 === 0 && !t) this.anims.peek = this.age; return; }
    if (this.st === 'unrolling') { if (t) { this.roll('rolling'); return; } if (this.stT > 30) { this.st = 'idle'; this.anims = {}; this.sound('unroll_finish'); } return; }
    VMob.prototype.think.call(this, c);
  }
  hurt(a, src) { if (this.st === 'scared') a = Math.max(0, (a - 1) / 2); const r = super.hurt(a, src); if (r) { this.lastHurtT = this.age; this.panic = 0; } return r; }
  postInteract(p, held) {
    if (held && ITEMS[held.id].key === 'brush' && !this.baby) { this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], makeStack('armadillo_scute', 1)); this.sound('brush'); this.game.damageHeld(16); return true; }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), rolled = this.st === 'scared';
    if (P.cube) P.cube.visible = rolled;
    for (const n of ['body', 'right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg']) if (P[n]) P[n].visible = !rolled;
    if (this.st === 'idle') {
      if (P.head) { P.head.yRot = clamp(-(this.headYaw || 0), -0.55, 0.55); P.head.xRot = clamp(-(this.pitch || 0), -0.4, 0.4); }
      EM.walk(md, this.pre + 'WALK', pos, spd, 16.5, 2.5);
    } else if (this.st === 'rolling') EM.anim(md, this.pre + 'ROLL_UP', (this.stT + a) / 20);
    else if (this.st === 'unrolling') EM.anim(md, this.pre + 'ROLL_OUT', (this.stT + a) / 20);
    else if (this.anims.peek != null) { if (P.cube) P.cube.visible = false; for (const n of ['body']) if (P[n]) P[n].visible = true; EM.anim(md, this.pre + 'PEEK', (this.age - this.anims.peek + a) / 20); }
  }
  texKey(r) { return r.etex('entity/armadillo/armadillo' + (this.baby ? '_baby' : '')); }
}
defVMob('armadillo', { cls: Armadillo, food: 'armadillo_food', xp: 2, shadowR: 0.4, stepSound: false });

// ---- sniffers: sniff out and dig up ancient seeds; their eggs hatch into snifflets ------------------------------
class Sniffer extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.st = 'idle'; this.stT = 0; this.digCd = 0; }
  get pre() { return 'SnifferAnimation.SNIFFER_'; }
  think(c) {
    this.stT++;
    if (this.digCd > 0) this.digCd--;
    if (this.st === 'sniff') { if (this.stT > 60) { this.st = this.canDig() ? 'dig' : 'idle'; this.stT = 0; if (this.st === 'dig') this.sound('digging'); } return; }
    if (this.st === 'dig') {
      if (this.stT === 100) { const x = this.pos[0] - Math.sin(this.bodyYaw) * 2.2, z = this.pos[2] - Math.cos(this.bodyYaw) * 2.2; for (const st of rollLoot('gameplay/sniffer_digging', { e: this })) this.game.dropItem(x, this.pos[1] + 0.2, z, st); this.sound('drop_seed'); }
      if (this.stT > 160) { this.st = 'idle'; this.stT = 0; this.digCd = 4800; this.sound('digging_stop'); }
      return;
    }
    if (this.st === 'idle' && !this.baby && this.digCd <= 0 && this.panic <= 0 && !this.loveT && Math.random() < 1 / 400) { this.st = 'sniff'; this.stT = 0; this.sound('scenting'); return; }
    if (this.st === 'idle' && Math.random() < 1 / 600) { this.anims.SNIFFSNIFF = this.age; this.sound('sniffing'); }
    VMob.prototype.think.call(this, c);
  }
  canDig() {
    const x = Math.floor(this.pos[0] - Math.sin(this.bodyYaw) * 2.2), z = Math.floor(this.pos[2] - Math.cos(this.bodyYaw) * 2.2), y = Math.floor(this.pos[1]) - 1;
    const k = BLOCKS[this.world.getBlock(x, y, z)].key;
    return /^(dirt|grass_block|podzol|coarse_dirt|rooted_dirt|moss_block|pale_moss_block|mud|muddy_mangrove_roots)$/.test(k);
  }
  spawnChild(m) {
    // sniffers lay an egg instead of having a baby
    const g = this.game, x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1]), z = Math.floor(this.pos[2]);
    if (BID.sniffer_egg !== undefined && this.world.getBlock(x, y, z) === 0) { this.world.setBlock(x, y, z, BID.sniffer_egg, 0); Sound.ev('block.sniffer_egg.plop', this.pos, 1, 1); }
    g.dropXp(this.pos[0], this.pos[1] + 0.5, this.pos[2], randInt(1, 7));
    return null;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    if (P.head) { P.head.yRot = clamp(-(this.headYaw || 0), -0.5, 0.5); P.head.xRot = clamp(-(this.pitch || 0), -0.3, 0.3); }
    if (this.st === 'sniff') EM.anim(md, this.pre + 'SNIFF_SEARCH', (this.stT + a) / 20);
    else if (this.st === 'dig') EM.anim(md, this.pre + 'DIG', (this.stT + a) / 20);
    else {
      EM.walk(md, this.pre + 'WALK', pos, spd, 9, 100);
      if (this.anims.SNIFFSNIFF != null) EM.anim(md, this.pre + 'SNIFFSNIFF', (this.age - this.anims.SNIFFSNIFF + a) / 20);
    }
  }
  texKey(r) { return r.etex(this.baby ? 'entity/sniffer/snifflet' : 'entity/sniffer/sniffer'); }
}
defVMob('sniffer', { cls: Sniffer, food: 'sniffer_food', xp: 2, shadowR: 1.4, turn: 0.15 });
BLOCK_RANDOM_TICK.sniffer_egg = (g, x, y, z, id, m) => {
  const w = g.world, h = +(Features.propOf(id, m, 'hatch') || 0), moss = BLOCKS[w.getBlock(x, y - 1, z)].key === 'moss_block';
  if (Math.random() > (moss ? 0.5 : 0.25)) return;
  if (h < 2) { bsetProp(w, x, y, z, 'hatch', String(h + 1)); Sound.ev('block.sniffer_egg.crack', [x + 0.5, y, z + 0.5], 1, 1); return; }
  w.setBlock(x, y, z, 0, 0); Sound.ev('block.sniffer_egg.hatch', [x + 0.5, y, z + 0.5], 1, 1);
  spawnAt(g, 'sniffer', x + 0.5, y, z + 0.5, true);
};

// ---- turtles: return to their home beach to lay eggs; babies drop a scute when they grow -----------------------
class Turtle extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.homeP = [Math.floor(x), Math.floor(y), Math.floor(z)]; this.hasEgg = false; this.digT = 0; this.waterBreather = true; }
  extraSave() { return { home: this.homeP, egg: this.hasEgg }; }
  extraLoad(o) { if (o.home) this.homeP = o.home; this.hasEgg = !!o.egg; }
  get ai() { return 'amph'; }
  spawnChild(m) { this.hasEgg = true; this.game.dropXp(this.pos[0], this.pos[1] + 0.5, this.pos[2], randInt(1, 7)); return null; }
  think(c) {
    if (this.hasEgg) {
      const [hx, hy, hz] = this.homeP, d = Math.hypot(hx + 0.5 - this.pos[0], hz + 0.5 - this.pos[2]);
      if (d > 3 || this.inWater) { c.goal = [hx + 0.5, hy, hz + 0.5]; c.mod = 1.2; return; }
      const x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1]), z = Math.floor(this.pos[2]);
      if (/sand$/.test(BLOCKS[this.world.getBlock(x, y - 1, z)].key) && this.world.getBlock(x, y, z) === 0) {
        if (++this.digT > 200) { this.world.setBlock(x, y, z, BID.turtle_egg, Features.withProp(BID.turtle_egg, 0, 'eggs', String(randInt(1, 4)))); Sound.ev('entity.turtle.lay_egg', this.pos, 0.3, 1); this.hasEgg = false; this.digT = 0; }
        return;
      }
    }
    // land turtles head back to the water now and then
    if (!this.inWater && !this.hasEgg && Math.random() < 0.01) { const gq = this.findWater(); if (gq) { this.goal = gq; this.wanderT = 200; } }
    VMob.prototype.think.call(this, c);
  }
  findWater() {
    for (let k = 0; k < 20; k++) { const x = Math.floor(this.pos[0]) + randInt(-10, 10), z = Math.floor(this.pos[2]) + randInt(-10, 10), y = Math.floor(this.pos[1]); for (let dy = 2; dy >= -3; dy--) if (this.world.getBlock(x, y + dy, z) === WATER) return [x + 0.5, y + dy, z + 0.5]; }
    return null;
  }
  onGrown() { this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], makeStack('turtle_scute', 1)); }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a);
    if (this.inWater) {
      for (const [n, s] of [['right_hind_leg', 1], ['left_hind_leg', -1]]) if (P[n]) P[n].xRot = Math.cos(pos * 0.6662 * 0.6) * 0.5 * spd * s;
      for (const [n, s] of [['right_front_leg', 1], ['left_front_leg', -1]]) if (P[n]) { P[n].zRot = Math.cos(pos * 0.6662 * 0.6 + Math.PI) * 0.5 * spd * s; P[n].xRot = 0; }
    } else {
      for (const [n, s] of [['right_hind_leg', 1], ['left_hind_leg', -1]]) if (P[n]) P[n].xRot = Math.cos(pos * 0.6662 * 5) * 2 * spd * s;
      for (const [n, s] of [['right_front_leg', 1], ['left_front_leg', -1]]) if (P[n]) { P[n].yRot = Math.cos(pos * 0.6662 * 5 + Math.PI) * 8 * spd * s * 0.1; P[n].zRot = 0; }
    }
    if (P.egg_belly) P.egg_belly.visible = this.hasEgg && !this.baby;
    if (this.digT > 0 && P.egg_belly) P.egg_belly.visible = true;
  }
  texKey(r) { return r.etex('entity/turtle/turtle' + (this.baby ? '_baby' : '')); }
}
// on land vanilla turtles plod at a quarter of their speed (TurtleMoveControl): landSpeedMul
defVMob('turtle', { cls: Turtle, food: 'turtle_food', xp: 2, shadowR: 0.6, speed3: 1.2, landSpeedMul: 0.12, waterOk: true, sinks: true, walkUnderwater: false, stepSound: false });
BLOCK_RANDOM_TICK.turtle_egg = (g, x, y, z, id, m) => {
  const w = g.world, h = +(Features.propOf(id, m, 'hatch') || 0), n = +(Features.propOf(id, m, 'eggs') || 1);
  if (!/sand$/.test(BLOCKS[w.getBlock(x, y - 1, z)].key)) return;
  const night = !g.isDay();
  if (!(night || Math.random() < 1 / 500)) return;
  if (h < 2) { bsetProp(w, x, y, z, 'hatch', String(h + 1)); Sound.ev('entity.turtle.egg_crack', [x + 0.5, y, z + 0.5], 0.7, 0.9 + Math.random() * 0.2); return; }
  w.setBlock(x, y, z, 0, 0); Sound.ev('entity.turtle.egg_hatch', [x + 0.5, y, z + 0.5], 0.7, 1);
  for (let i = 0; i < n; i++) { const t = spawnAt(g, 'turtle', x + 0.3 + i * 0.1, y, z + 0.3, true); t.homeP = [x, y, z]; }
};

// ---- frogs and tadpoles: frogspawn in water, tadpoles grow into frogs of the biome's kind --------------------------
const frogVariantAt = (g, x, z) => { const b = biomeName(g, x, z); return /desert|badlands|jungle|savanna|mangrove|warm|nether|crimson|warped|basalt|soul/.test(b) ? 'warm' : /snowy|frozen|ice|grove|jagged|deep_dark|peaks|cold/.test(b) ? 'cold' : 'temperate'; };
class Frog extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.variant = frogVariantAt(g, x, z); this.tongueT = 0; this.jumpT = 0; this.croakT = 0; }
  extraSave() { return { var: this.variant }; }
  extraLoad(o) { this.variant = o.var || 'temperate'; }
  compVal(k) { return k === 'frog/variant' ? 'minecraft:' + this.variant : undefined; }
  get ai() { return 'amph'; }
  wantsPlayer() { return false; }
  huntTarget() {
    if ((this.age + this.id) % 20) return null;
    return this.game.entities.find(e => !e.dead && !e.deathTime && ((e.type === 'slime' && (e.size || 1) === 1) || (e.type === 'magma_cube' && (e.size || 1) === 1)) && e.distTo(this) < 10) || null;
  }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime)) this.target = null; if (!this.target) this.target = this.huntTarget(); }
  fight(c) {
    const t = this.target, d = this.distTo(t);
    c.look = t;
    if (this.tongueT > 0) {
      if (--this.tongueT === 5 && !t.dead) {
        // swallowed: the prey's loot (froglights from small magma cubes)
        t.dead = true;
        const out = rollLoot(t.type, { e: t, src: { attacker: this }, player: false });
        for (const st of out) this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], st);
        this.sound('eat'); this.target = null;
      }
      return;
    }
    if (d < 3) { this.tongueT = 10; this.anims = { TONGUE: this.age }; this.sound('tongue'); return; }
    c.goal = [t.pos[0], t.pos[1], t.pos[2]]; c.mod = 1.2;
  }
  moveBy(c) {
    if (this.inWater) return VMob.prototype.moveBy.call(this, c);
    if (this.jumpT > 0) this.jumpT--;
    // on land: hops toward the goal
    if (c.goal && this.onGround && this.jumpT <= 0 && Math.hypot(c.goal[0] - this.pos[0], c.goal[2] - this.pos[2]) > 1.5 && Math.random() < 0.08) {
      const dx = c.goal[0] - this.pos[0], dz = c.goal[2] - this.pos[2], l = Math.hypot(dx, dz);
      this.yaw = Math.atan2(-dx, -dz); this.vel[0] = dx / l * 0.35; this.vel[2] = dz / l * 0.35; this.vel[1] = 0.5; this.jumpT = 30; this.anims = { JUMP: this.age }; this.sound('long_jump');
      return this.travel(0, 0, 0, false);
    }
    if (!this.onGround) return this.travel(0, 0, 0, false);
    VMob.prototype.moveBy.call(this, c);
  }
  afterMove() { if (Math.random() < 1 / 400 && this.onGround && !this.inWater) { this.anims.CROAK = this.age; this.sound('ambient'); } }
  spawnChild(m) {
    // frogs lay frogspawn on a nearby water surface
    const g = this.game, w = this.world, x0 = Math.floor(this.pos[0]), y0 = Math.floor(this.pos[1]), z0 = Math.floor(this.pos[2]);
    for (let k = 0; k < 40; k++) {
      const x = x0 + randInt(-4, 4), z = z0 + randInt(-4, 4);
      for (let y = y0 + 2; y >= y0 - 3; y--) if (w.getBlock(x, y, z) === WATER && w.getBlock(x, y + 1, z) === 0 && BID.frogspawn !== undefined) { w.setBlock(x, y + 1, z, BID.frogspawn, 0); Sound.ev('entity.frog.lay_spawn', [x, y, z], 1, 1); g.dropXp(this.pos[0], this.pos[1] + 0.5, this.pos[2], randInt(1, 7)); return null; }
    }
    return null;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    if (this.inWater) { EM.walk(md, spd > 0.1 ? 'FrogAnimation.FROG_SWIM' : 'FrogAnimation.FROG_IDLE_WATER', spd > 0.1 ? pos : this.age + a, spd > 0.1 ? spd : 1, 1, 2.5); }
    else EM.walk(md, 'FrogAnimation.FROG_WALK', pos, spd, 1.5, 2.5);
    for (const k in this.anims) EM.anim(md, 'FrogAnimation.FROG_' + k, (this.age - this.anims[k] + a) / 20);
    if (P.croaking_body && this.anims.CROAK == null) P.croaking_body.visible = false;
  }
  texKey(r) { return r.etex('entity/frog/frog_' + this.variant); }
}
defVMob('frog', { cls: Frog, food: 'frog_food', xp: 2, shadowR: 0.3, waterOk: true, speed3: 1.5, stepSound: false });
class Tadpole extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.grow = 24000; this.waterBreather = true; }
  extraSave() { return { grow: this.grow }; }
  extraLoad(o) { if (o.grow) this.grow = o.grow; }
  think(c) {
    if (--this.grow <= 0) {
      const f = createMob(this.game, 'frog', this.pos[0], this.pos[1], this.pos[2]); f.variant = frogVariantAt(this.game, this.pos[0], this.pos[2]); f.persistent = true;
      this.game.entities.push(f); this.dead = true; Sound.ev('entity.tadpole.grow_up', this.pos, 0.15, 1); return;
    }
    VMob.prototype.think.call(this, c);
  }
  preInteract(p, held) {
    if (held && ITEMS[held.id].key === 'slime_ball') { this.grow -= Math.floor(24000 * 0.1); useOne(this.game, p); this.game.particles.spawn('happy_villager', this.pos[0], this.pos[1] + 0.3, this.pos[2], 0, 0.05, 0); return true; }
    if (held && ITEMS[held.id].key === 'water_bucket') { swapHeld(this.game, p, 'tadpole_bucket', { mob: { grow: this.grow } }); this.dead = true; Sound.ev('item.bucket.fill_tadpole', this.pos, 1, 1); return true; }
    return false;
  }
  setupAnim(md, a) { const P = md.parts; if (P.tail) P.tail.yRot = -Math.sin((this.age + a) * (this.inWater ? 1.3 : 1.7)) * 0.25 * (this.inWater ? 1 : 2); }
  texKey(r) { return r.etex('entity/tadpole/tadpole'); }
}
defVMob('tadpole', { cls: Tadpole, ai: 'swim', xp: 0, shadowR: 0.15, dryOut: 100, stepSound: false });
BLOCK_RANDOM_TICK.frogspawn = (g, x, y, z) => {
  if (Math.random() > 0.15) return;
  g.world.setBlock(x, y, z, 0, 0); Sound.ev('block.frogspawn.hatch', [x + 0.5, y, z + 0.5], 1, 1);
  for (let i = 0, n = randInt(2, 6); i < n; i++) spawnAt(g, 'tadpole', x + Math.random(), y - 0.5, z + Math.random());
};

// ---- bats: hang from cave ceilings, flutter about in the dark ------------------------------------------------
class Bat extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.resting = false; this.persistent = false; }
  think(c) {
    const w = this.world, x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1] + this.h + 0.1), z = Math.floor(this.pos[2]);
    if (this.resting) {
      this.vel = [0, 0, 0];
      const p = this.game.player;
      if (!SOLIDCUBE[w.getBlock(x, y, z)] || (!p.sneaking && this.distTo(p) < 4 && !p.creative) || Math.random() < 1 / 2000) { this.resting = false; this.anims = {}; this.sound('takeoff', 0.05); }
      return;
    }
    // erratic flight; settles under a ceiling now and then
    if (!this.goal || this.near(this.goal, 2) || Math.random() < 0.03) this.goal = [this.pos[0] + randInt(-7, 7), this.pos[1] + randInt(-2, 4), this.pos[2] + randInt(-7, 7)];
    c.goal = this.goal;
    if (SOLIDCUBE[w.getBlock(x, y, z)] && Math.random() < 0.01) { this.resting = true; this.pos[1] = y - this.h; this.goal = null; }
  }
  setupAnim(md, a) {
    if (this.resting) EM.anim(md, 'BatAnimation.BAT_RESTING', (this.age + a) / 20);
    else EM.anim(md, 'BatAnimation.BAT_FLYING', (this.age + a) / 20);
    const P = md.parts;
    if (P.head && !this.resting) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = -(this.pitch || 0); }
  }
  texKey(r) { return r.etex('entity/bat/bat'); }
  preDraw(m, a) { if (!this.resting) M4.translate(m, 0, Math.cos((this.age + a) * 0.3) * 0.1, 0); }
}
defVMob('bat', { cls: Bat, ai: 'fly', xp: 0, scale: 0.35 / 0.35, shadowR: 0.2, speed3: 1.4, idleT: 80, stepSound: false, vol: 0.1 });

// ---- parrots: fly, perch on shoulders, dance to music, imitate mobs ----------------------------------------------
const PARROT_COLORS = ['red_blue', 'blue', 'green', 'yellow_blue', 'grey'];
class Parrot extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.variant = randInt(0, 4); this.flapT = 0; this.dance = false; }
  extraSave() { return { var: this.variant }; }
  extraLoad(o) { this.variant = o.var | 0; if (this.owner) this.persistent = true; }
  get ai() { return this.onGround && !this.goal && !this.owner || this.sitting ? 'ground' : 'fly'; }
  wantsPlayer() { return false; }
  canBreed() { return false; }
  think(c) {
    const g = this.game, p = g.player;
    // a jukebox playing within 3.5 blocks: dance
    this.dance = !!(g.jukeboxes && [...g.jukeboxes.values()].some(j => j.playing && Math.hypot(j.x + 0.5 - this.pos[0], j.y - this.pos[1], j.z + 0.5 - this.pos[2]) < 3.5));
    if (this.dance) return;
    if (this.sitting) return;
    // tamed: hop onto the owner's shoulder when it lands nearby
    if (this.owner === p && !p.shoulder && this.distTo(p) < 2 && p.onGround && !p.inWater && !this.baby && Math.random() < 0.05 && this.age > (this.offShoulderT || 0) + 60) {
      p.shoulder = { variant: this.variant, name: this.customName, health: this.health }; this.dead = true; Sound.ev('entity.parrot.step', this.pos, 0.5, 1); return;
    }
    if (this.owner && PetMixin.followOwner.call(this, c)) return;
    if (!this.goal || this.near(this.goal, 1.5) || Math.random() < 0.01) this.goal = this.randomGoal(8, 4);
    c.goal = this.goal;
    // imitate a nearby monster now and then
    if (Math.random() < 1 / 400) { const m = g.entities.find(e => e instanceof Mob && e.T.hostile && e.distTo(this) < 20); if (m) Sound.ev('entity.parrot.imitate.' + m.type, this.pos, 0.7, 1.8); }
  }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (k === 'cookie') { useOne(g, p); this.hurt(1000, { type: 'poison', attacker: p }); return true; }
    if (!this.owner && held && isFood('parrot_food', held.id)) { useOne(g, p); this.sound('eat'); tryTame(this, p, 1 / 10); return true; }
    if (this.owner === p && (!held || !isFood('parrot_food', held.id))) { this.sitting = !this.sitting; this.goal = null; return true; }
    return false;
  }
  setupAnim(md, a) { parrotAnim(md, this, a, this.dance ? 'party' : this.sitting ? 'sit' : this.onGround ? 'stand' : 'fly'); }
  texKey(r) { return r.etex('entity/parrot/parrot_' + PARROT_COLORS[this.variant | 0]); }
}
function parrotAnim(md, e, a, st) {
  const P = md.parts, t = (e.age || 0) + a, [pos, spd] = emLimbs(e, a);
  if (P.head) { P.head.xRot = -(e.pitch || 0); P.head.yRot = -(e.headYaw || 0); }
  if (st === 'fly') {
    const f = Math.sin(t * 0.9) * 0.6 + 0.7;
    if (P.left_wing) P.left_wing.zRot = -0.0873 - f; if (P.right_wing) P.right_wing.zRot = 0.0873 + f;
    if (P.left_leg) P.left_leg.xRot = 0.7; if (P.right_leg) P.right_leg.xRot = 0.7;
  } else if (st === 'sit' || st === 'shoulder') {
    for (const n of ['head', 'body', 'tail', 'left_wing', 'right_wing']) if (P[n]) P[n].y += 1.9;
    for (const n of ['left_leg', 'right_leg']) if (P[n]) { P[n].y += 1.9; P[n].xRot = Math.PI / 2; P[n].z -= 1; }
    if (P.tail) P.tail.xRot += Math.PI / 6;
  } else if (st === 'party') {
    const b = Math.sin(t * 0.4) * 0.15;
    for (const n of ['head', 'body', 'tail', 'left_wing', 'right_wing']) if (P[n]) { P[n].y += b * 8; P[n].x += Math.cos(t * 0.4) * 1.2; }
    if (P.head) P.head.zRot = Math.cos(t * 0.4) * 0.4;
  } else {
    if (P.left_leg) P.left_leg.xRot = Math.cos(pos * 0.6662) * 1.4 * spd;
    if (P.right_leg) P.right_leg.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd;
  }
}
defVMob('parrot', { cls: Parrot, food: 'parrot_food', xp: 2, shadowR: 0.3, speed3: 1, hover: true, stepSound: false });
// the parrot on the owner's shoulder: drawn on the player, steps off when the player jumps high, falls, swims or gets hurt
(() => {
  const _t = Player.prototype.tick;
  Player.prototype.tick = function (input) {
    const r = _t.call(this, input);
    const s = this.shoulder;
    if (s && (this.inWater || this.flying || this.fallDist > 0.5 || this.hurtTime > 0 || (this.sneaking && input && input.jump) || this.deathTime)) {
      const p = createMob(this.game, 'parrot', this.pos[0], this.pos[1] + 1.5, this.pos[2]);
      p.variant = s.variant; p.owner = this; p.persistent = true; if (s.name) p.customName = s.name; if (s.health) p.health = s.health;
      p.offShoulderT = p.age; this.game.entities.push(p); this.shoulder = null;
    }
    return r;
  };
  const _dm = Game.prototype.drawMob;
  Game.prototype.drawMob = function (e, ip, a, env, l) {
    const res = _dm.call(this, e, ip, a, env, l);
    if (e === this.player && e.shoulder && (this.perspective !== 0)) {
      const r = this.renderer, md = EM.get(r, 'parrot#main'), tex = r.etex('entity/parrot/parrot_' + PARROT_COLORS[e.shoulder.variant | 0]);
      if (md && tex) {
        const m = M4.create(); M4.translate(m, ip[0], ip[1], ip[2]); M4.rotY(m, e.yaw);
        if (e.sneaking) M4.translate(m, 0, -0.2, 0);
        M4.translate(m, 0.4, 1.4 * 0.9375 + 0.05, 0);
        EM.reset(md); parrotAnim(md, { age: this.player.age, pitch: 0, headYaw: 0, limbAmt: 0, limbSwing: 0 }, a, 'shoulder');
        r.drawEM(md, tex, m, [l[0], l[1]], env, {});
      }
    }
    return res;
  };
})();

// ---- bees: pollinate flowers, fill hives with honey, sting when angered ------------------------------------------
const isFlower = (k) => /^(dandelion|poppy|blue_orchid|allium|azure_bluet|\w+_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|torchflower|pitcher_plant|pink_petals|wildflowers|flowering_azalea|flowering_azalea_leaves|spore_blossom|cherry_leaves|mangrove_propagule|chorus_flower|open_eyeblossom|cactus_flower|golden_dandelion)$/.test(k);
const isHive = (k) => k === 'beehive' || k === 'bee_nest';
class Bee extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.nectar = false; this.stung = false; this.hive = null; this.flower = null; this.pollT = 0; this.stingT = 0; this.persistent = true; }
  extraSave() { return { nec: this.nectar, hive: this.hive, st: this.stung }; }
  extraLoad(o) { this.nectar = !!o.nec; this.hive = o.hive || null; this.stung = !!o.st; }
  get angry() { return this.anger > 0 && !!this.target; }
  wantsPlayer() { return false; }
  onAttacked(src) { for (const e of this.game.entities) if (e instanceof Bee && e !== this && e.distTo(this) < 16 && !e.stung) { e.target = src.attacker; e.anger = 400; } }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || this.anger <= 0)) { this.target = null; } }
  melee(t) {
    if (this.stung) return;
    this.attackCd = 20;
    if (t.hurt(2, { type: 'mob', attacker: this, knockFrom: this.pos })) {
      const df = this.game.difficulty;
      if (df >= 2 && t.addEffect) t.addEffect('poison', 0, (df === 3 ? 18 : 10) * 20);
      this.stung = true; this.stingT = 1200 + randInt(0, 100); this.target = null; this.anger = 0; this.sound('sting');
    }
  }
  think(c) {
    const g = this.game, w = this.world;
    if (this.stung && --this.stingT <= 0) { this.hurt(1000, { type: 'generic' }); return; }
    if (this.target) { this.fight(c); return; }
    // find a hive close by
    if (!this.hive && this.age % 100 === 0) {
      const x0 = Math.floor(this.pos[0]), y0 = Math.floor(this.pos[1]), z0 = Math.floor(this.pos[2]);
      for (let dx = -10; dx <= 10 && !this.hive; dx++) for (let dy = -5; dy <= 5 && !this.hive; dy++) for (let dz = -10; dz <= 10 && !this.hive; dz++) if (isHive(BLOCKS[w.getBlock(x0 + dx, y0 + dy, z0 + dz)].key)) this.hive = [x0 + dx, y0 + dy, z0 + dz];
    }
    const night = !g.isDay() || g.weather > 0.5;
    if (this.hive && (this.nectar || night)) {
      const [hx, hy, hz] = this.hive;
      if (!isHive(BLOCKS[w.getBlock(hx, hy, hz)].key)) { this.hive = null; return; }
      if (Math.hypot(hx + 0.5 - this.pos[0], hy + 0.5 - this.pos[1], hz + 0.5 - this.pos[2]) < 1.6) { beeEnterHive(g, this); return; }
      c.goal = [hx + 0.5, hy + 0.5, hz + 0.5]; return;
    }
    // collecting nectar from a flower
    if (!this.nectar && !night) {
      if (this.flower) {
        const [fx, fy, fz] = this.flower;
        if (!isFlower(BLOCKS[w.getBlock(fx, fy, fz)].key)) { this.flower = null; return; }
        const d = Math.hypot(fx + 0.5 - this.pos[0], fy + 0.6 - this.pos[1], fz + 0.5 - this.pos[2]);
        c.goal = [fx + 0.5, fy + 0.6, fz + 0.5];
        if (d < 0.8 && ++this.pollT > 400) { this.nectar = true; this.flower = null; this.pollT = 0; }
        return;
      } else if (this.age % 40 === 0) {
        const x0 = Math.floor(this.pos[0]), y0 = Math.floor(this.pos[1]), z0 = Math.floor(this.pos[2]);
        for (let k = 0; k < 40; k++) { const x = x0 + randInt(-8, 8), y = y0 + randInt(-3, 3), z = z0 + randInt(-8, 8); if (isFlower(BLOCKS[w.getBlock(x, y, z)].key)) { this.flower = [x, y, z]; break; } }
      }
    }
    // with nectar: crops it flies over grow
    if (this.nectar && this.age % 30 === 0) {
      const x = Math.floor(this.pos[0]), z = Math.floor(this.pos[2]);
      for (let dy = 1; dy <= 2; dy++) { const y = Math.floor(this.pos[1]) - dy, id = w.getBlock(x, y, z), ag = Features.propOf(id, w.getMeta(x, y, z), 'age'); if (ag != null && /^(wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|sweet_berry_bush|cave_vines)$/.test(BLOCKS[id].key) && Math.random() < 0.3) { const mx = BLOCKS[id].key === 'beetroots' || BLOCKS[id].key === 'sweet_berry_bush' ? 3 : 7; if (+ag < mx) bsetProp(w, x, y, z, 'age', String(+ag + 1)); } }
    }
    if (!this.goal || this.near(this.goal, 1.2) || Math.random() < 0.01) this.goal = this.randomGoal(8, 3);
    c.goal = this.goal;
  }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    const f = Math.cos(t * 2.1) * Math.PI * 0.15;
    if (P.right_wing) { P.right_wing.xRot = 0; P.right_wing.zRot = f; }
    if (P.left_wing) { P.left_wing.xRot = 0; P.left_wing.zRot = -f; }
    for (const n of ['front_legs', 'middle_legs', 'back_legs']) if (P[n]) P[n].xRot = Math.PI / 4;
    if (P.bone && !this.angry) { P.bone.xRot = 0.1 + Math.cos(t * 0.18) * 0.05; P.bone.y = 19 - Math.cos(t * 0.18) * 0.9; }
    if (P.stinger) P.stinger.visible = !this.stung;
  }
  texKey(r) { return r.etex('entity/bee/bee' + (this.angry ? '_angry' : '') + (this.nectar ? '_nectar' : '') + (this.baby ? '_baby' : '')); }
  ambientKind() { return this.angry ? 'loop_aggressive' : 'loop'; }
}
defVMob('bee', { cls: Bee, ai: 'fly', food: 'bee_food', xp: 2, shadowR: 0.3, speed3: 1, idleT: 60, stepSound: false, vol: 0.3 });
// a bee in its hive: the hive keeps it (and fills with honey when it brought nectar); it leaves again by day
function beeEnterHive(g, bee) {
  const [x, y, z] = bee.hive, be = g.getBlockEntity(x, y, z, 'hive');
  be.bees = be.bees || [];
  if (be.bees.length >= 3) { bee.goal = null; return; }
  be.bees.push({ nec: bee.nectar, t: 0, name: bee.customName, h: bee.health });
  if (bee.nectar) { const lv = +(bprop(g.world, x, y, z, 'honey_level') || 0); if (lv < 5) bsetProp(g.world, x, y, z, 'honey_level', String(lv + 1)); }
  bee.dead = true; Sound.ev('block.beehive.enter', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
}
(() => {
  const _t = Game.prototype.tick;
  Game.prototype.tick = function (...args) {
    const r = _t.apply(this, args);
    if (this.net || !this.blockEntities || this.tickCount % 20) return r;
    const day = this.isDay() && this.weather < 0.5;
    for (const be of this.blockEntities.values()) {
      if (be.type !== 'hive' || !be.bees || !be.bees.length) continue;
      const [x, y, z] = be.pos;
      if (!this.world.isLoaded(x, z) || !isHive(BLOCKS[this.world.getBlock(x, y, z)].key)) continue;
      for (const b of be.bees) b.t += 20;
      if (!day) continue;
      const out = be.bees.filter(b => b.t > 600);
      be.bees = be.bees.filter(b => b.t <= 600);
      for (const b of out) {
        const bee = createMob(this, 'bee', x + 0.5, y + 1.1, z + 0.5);
        bee.hive = [x, y, z]; bee.nectar = false; if (b.name) bee.customName = b.name; if (b.h) bee.health = b.h;
        this.entities.push(bee); Sound.ev('block.beehive.exit', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
      }
    }
    return r;
  };
})();

// ---- allays: bring the player items like the one they were given ---------------------------------------------
class Allay extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.item = null; this.liked = null; this.throwCd = 0; this.dance = false; this.persistent = true; }
  extraSave() { return { item: this.item, liked: this.liked ? 1 : 0 }; }
  extraLoad(o) { this.item = o.item || null; if (o.liked) this.liked = this.game.player; }
  wantsPlayer() { return false; }
  hurt(a, src) { if (src && src.attacker === this.liked) return false; return super.hurt(a, src); }
  think(c) {
    const g = this.game;
    this.dance = !!(g.jukeboxes && [...g.jukeboxes.values()].some(j => j.playing && Math.hypot(j.x + 0.5 - this.pos[0], j.y - this.pos[1], j.z + 0.5 - this.pos[2]) < 8));
    if (this.throwCd > 0) this.throwCd--;
    const p = this.liked;
    if (this.item && p && !p.dead) {
      // look for matching items; when carrying some, fly them to the player and drop them
      const held = this.carried;
      if (held && this.distTo(p) < 2.5 && this.throwCd <= 0) { g.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], held, [(p.pos[0] - this.pos[0]) * 0.1, 0.2, (p.pos[2] - this.pos[2]) * 0.1]); this.carried = null; this.throwCd = 60; this.sound('throw'); return; }
      if (!held || held.count < maxStack(held.id)) {
        const it = g.entities.find(e => e instanceof ItemEntity && !e.dead && e.pickup <= 0 && sameKind(e.stack, this.item) && e.distTo(this) < 32);
        if (it) {
          if (this.distTo(it) < 1.2) { if (held) held.count += it.stack.count; else this.carried = { ...it.stack }; it.dead = true; this.sound('item_taken'); return; }
          c.goal = [it.pos[0], it.pos[1] + 0.5, it.pos[2]]; return;
        }
      }
      if (this.distTo(p) > 3) { c.goal = [p.pos[0], p.pos[1] + 1.5, p.pos[2]]; c.mod = held ? 1.4 : 1; return; }
      c.look = p; return;
    }
    if (!this.goal || this.near(this.goal, 1.2) || Math.random() < 0.01) this.goal = this.randomGoal(8, 3);
    c.goal = this.goal;
  }
  preInteract(p, held) {
    const g = this.game;
    if (!this.item && held) { this.item = { ...held, count: 1 }; this.liked = p; useOne(g, p); this.sound('item_given'); return true; }
    if (this.item && !held) { g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], this.item); if (this.carried) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], this.carried); this.item = null; this.carried = null; this.liked = null; this.sound('item_taken'); return true; }
    return false;
  }
  dropsOnDeath() { return [this.item, this.carried]; }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a, f = Math.cos(t * 0.9) * 0.5 + 0.6;
    if (P.right_wing) { P.right_wing.yRot = -0.785 + f * 0.4; P.right_wing.xRot = 0.43; P.right_wing.zRot = -0.47; }
    if (P.left_wing) { P.left_wing.yRot = 0.785 - f * 0.4; P.left_wing.xRot = 0.43; P.left_wing.zRot = 0.47; }
    if (P.head) { P.head.yRot = -(this.headYaw || 0); P.head.xRot = -(this.pitch || 0); }
    if (P.body) P.body.xRot = 0.2;
    if (this.item) for (const n of ['right_arm', 'left_arm']) if (P[n]) { P[n].xRot = -1.0; P[n].yRot = n === 'right_arm' ? 0.2 : -0.2; }
    if (this.dance && P.head) { P.head.zRot = Math.sin(t * 0.5) * 0.3; if (P.body) P.body.yRot = Math.sin(t * 0.25) * 0.4; }
    if (P.root) P.root.y = 23.5 + Math.cos(t * 0.15) * 0.8;
  }
  texKey(r) { return r.etex('entity/allay/allay'); }
  attachments(g, md, lt, env) {
    const st = this.carried || this.item; if (!st) return null;
    return { body: (am) => { M4.translate(am, 0, 0.3, -0.3); M4.scale(am, 0.6, 0.6, 0.6); g.drawHeldItem(am, st, false, lt, env, this, null); } };
  }
}
defVMob('allay', { cls: Allay, ai: 'fly', xp: 0, shadowR: 0.25, bright: false, stepSound: false });

// ---- snow golems: throw snowballs at monsters, leave snow behind, melt in the heat ---------------------------
class SnowGolem extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.pumpkin = true; }
  extraSave() { return { pk: this.pumpkin }; }
  extraLoad(o) { this.pumpkin = o.pk !== false; }
  wantsPlayer() { return false; }
  huntTarget() {
    if ((this.age + this.id) % 10) return null;
    return this.game.entities.find(e => e instanceof Mob && e.T.hostile && e.type !== 'creeper' && !e.dead && !e.deathTime && e.distTo(this) < 10 && this.canSee(e)) || null;
  }
  findTarget() { if (this.target && (this.target.dead || this.target.deathTime || this.distTo(this.target) > 16)) this.target = null; if (!this.target) this.target = this.huntTarget(); }
  ranged(c, t, d) {
    if (d > 8) c.goal = [t.pos[0], t.pos[1], t.pos[2]];
    if (this.attackCd <= 0 && d < 10) {
      this.attackCd = 20;
      shootAt(this, t, 1.6, { layer: ITEMS[ITEM_KEY.snowball].tex, grav: 0.03, arc: 0.2, yk: 0.85, onHit: (e) => { e.hurt(e.type === 'blaze' ? 3 : 0.0001, { type: 'mob', attacker: this, knockFrom: this.pos, knock: 0.4 }); } });
      Sound.ev('entity.snow_golem.shoot', this.pos, 1, 0.4 / (Math.random() * 0.4 + 0.8));
    }
  }
  afterMove() {
    const g = this.game, w = this.world, x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1]), z = Math.floor(this.pos[2]);
    const b = biomeName(g, x, z);
    const hot = /desert|badlands|savanna|jungle|nether|crimson|warped|basalt|soul|mangrove|warm/.test(b);
    if ((hot || this.inWater || (g.weather > 0.5 && w.skyAt(x, y + 2, z) >= 15)) && this.age % 20 === 0) this.hurt(1, { type: 'melt' });
    // snow trail
    if (!hot && BID.snow !== undefined && w.getBlock(x, y, z) === 0 && SOLIDCUBE[w.getBlock(x, y - 1, z)] && this.age % 4 === 0) w.setBlock(x, y, z, BID.snow, 0);
  }
  postInteract(p, held) {
    if (held && ITEMS[held.id].key === 'shears' && this.pumpkin) { this.pumpkin = false; this.game.dropItem(this.pos[0], this.pos[1] + 1.7, this.pos[2], makeStack('carved_pumpkin', 1)); Sound.ev('entity.snow_golem.shear', this.pos, 1, 1); this.game.damageHeld(1); return true; }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts;
    emHead(P.head, this, a);
    if (P.upper_body) P.upper_body.yRot = (P.head ? P.head.yRot : 0) * 0.25;
    const s = Math.sin(P.upper_body ? P.upper_body.yRot : 0), c2 = Math.cos(P.upper_body ? P.upper_body.yRot : 0);
    if (P.left_arm) { P.left_arm.x = c2 * 5; P.left_arm.z = -s * 5; P.left_arm.yRot = P.upper_body.yRot; }
    if (P.right_arm) { P.right_arm.x = -c2 * 5; P.right_arm.z = s * 5; P.right_arm.yRot = P.upper_body.yRot + Math.PI; }
  }
  texKey(r) { return r.etex('entity/snow_golem/snow_golem'); }
  drawLayers(g, r, md, m, a, env, lt) {
    if (!this.pumpkin || !g.blockMesh || BID.carved_pumpkin === undefined) return;
    const H = md.parts.head; if (!H) return;
    const mm = M4.copy(m); M4.scale(mm, -1, -1, 1); M4.translate(mm, 0, -1.501, 0);
    M4.translate(mm, H.x / 16, H.y / 16, H.z / 16); M4.rotY(mm, H.yRot); M4.rotX(mm, H.xRot);
    M4.translate(mm, 0, -0.34375, 0); M4.rotY(mm, Math.PI); M4.scale(mm, 0.625, -0.625, -0.625); M4.translate(mm, -0.5, -0.5, -0.5);
    r.drawMesh(g.blockMesh(BID.carved_pumpkin, 0), mm, env, lt);
  }
}
defVMob('snow_golem', { cls: SnowGolem, xp: 0, shadowR: 0.4, T: { passive: false, hostile: false }, immune: ['fall'] });

// ---- copper golems: carry items from copper chests to other chests; oxidize unless waxed -------------------------
const GOLEM_OX = ['', '_exposed', '_weathered', '_oxidized'];
class CopperGolem extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.ox = 0; this.waxed = false; this.oxT = 24000 + randInt(0, 24000); this.carry = null; this.task = null; this.taskT = 0; }
  extraSave() { return { ox: this.ox, wax: this.waxed, carry: this.carry }; }
  extraLoad(o) { this.ox = o.ox | 0; this.waxed = !!o.wax; this.carry = o.carry || null; }
  wantsPlayer() { return false; }
  dropsOnDeath() { return [this.carry]; }
  chestsNear(copper) {
    const g = this.game, out = [];
    for (const be of g.blockEntities.values()) {
      if (be.type !== 'chest' || !be.slots) continue;
      const [x, y, z] = be.pos;
      if (Math.abs(x - this.pos[0]) > 16 || Math.abs(y - this.pos[1]) > 8 || Math.abs(z - this.pos[2]) > 16) continue;
      const k = BLOCKS[this.world.getBlock(x, y, z)].key;
      if (/copper_chest$/.test(k) === copper && /chest$/.test(k)) out.push(be);
    }
    return out.sort((a, b) => Math.hypot(a.pos[0] - this.pos[0], a.pos[2] - this.pos[2]) - Math.hypot(b.pos[0] - this.pos[0], b.pos[2] - this.pos[2]));
  }
  think(c) {
    if (!this.waxed && this.ox < 3 && --this.oxT <= 0) { this.ox++; this.oxT = 24000 + randInt(0, 24000); }
    if (this.ox === 3 && !this.waxed && Math.random() < 1 / 20000 && BID.oxidized_copper_golem_statue !== undefined) { const x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1]), z = Math.floor(this.pos[2]); if (this.world.getBlock(x, y, z) === 0) { this.world.setBlock(x, y, z, BID.oxidized_copper_golem_statue, 0); this.dead = true; return; } }
    if (this.taskT > 0) { this.taskT--; return; }
    const spd = [1, 0.9, 0.8, 0.7][this.ox];
    if (this.age % 20 === 0 && !this.task) {
      if (!this.carry) { const src = this.chestsNear(true).find(be => be.slots.some(s => s)); if (src) this.task = { be: src, take: true }; }
      else {
        const dst = this.chestsNear(false).find(be => be.slots.some(s => s && sameKind(s, this.carry) && s.count < maxStack(s.id)) || be.slots.every(s => !s)) || this.chestsNear(false).find(be => be.slots.some(s => !s));
        if (dst) this.task = { be: dst, take: false };
      }
    }
    if (this.task) {
      const be = this.task.be, [x, y, z] = be.pos;
      if (Math.hypot(x + 0.5 - this.pos[0], z + 0.5 - this.pos[2]) < 1.8 && Math.abs(y - this.pos[1]) < 2) {
        c.look = [x + 0.5, y + 0.5, z + 0.5];
        if (this.task.take) { const i = be.slots.findIndex(s => s); if (i >= 0) { const s = be.slots[i], n = Math.min(16, s.count); this.carry = { ...s, count: n }; s.count -= n; if (!s.count) be.slots[i] = null; this.anims = { 'CHEST_INTERACTION_NOITEM_GET': this.age }; Sound.ev('entity.copper_golem.item_get', this.pos, 1, 1); } }
        else { const left = chestInsert(be.slots, this.carry); this.carry = left ? { ...this.carry, count: left } : null; this.anims = { 'CHEST_INTERACTION_ITEM_DROP': this.age }; Sound.ev('entity.copper_golem.item_drop', this.pos, 1, 1); }
        this.task = null; this.taskT = 60; return;
      }
      c.goal = [x + 0.5, y, z + 0.5]; c.mod = spd; return;
    }
    VMob.prototype.think.call(this, c);
    c.mod *= spd;
  }
  postInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (k === 'honeycomb' && !this.waxed) { this.waxed = true; useOne(g, p); Sound.ev('item.honeycomb.wax_on', this.pos, 1, 1); return true; }
    if (k && /_axe$/.test(k)) {
      if (this.waxed) { this.waxed = false; Sound.ev('item.axe.wax_off', this.pos, 1, 1); g.damageHeld(1); return true; }
      if (this.ox > 0) { this.ox--; Sound.ev('item.axe.scrape', this.pos, 1, 1); g.damageHeld(1); return true; }
    }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a), pre = 'CopperGolemAnimation.COPPER_GOLEM_';
    emHead(P.head, this, a);
    if (spd > 0.05) EM.walk(md, pre + (this.carry ? 'WALK_ITEM' : 'WALK'), pos, spd, 2, 2.5);
    else EM.anim(md, pre + 'IDLE', (this.age + a) / 20);
    for (const k in this.anims) EM.anim(md, pre + k, (this.age - this.anims[k] + a) / 20);
  }
  texKey(r) { return r.etex('entity/copper_golem/copper_golem' + GOLEM_OX[this.ox]); }
  drawLayers(g, r, md, m, a, env) { const t = r.etex('entity/copper_golem/copper_golem_eyes' + GOLEM_OX[this.ox]), em = EM.get(r, 'copper_golem#eyes'); if (t && em) { EM.reset(em); EM.copy(md, em); r.drawEMGlow(em, t, m, env, {}); } }
  attachments(g, md, lt, env) {
    const st = this.carry; if (!st) return null;
    return { body: (am) => { M4.translate(am, 0, 0.1, -0.35); M4.scale(am, 0.7, 0.7, 0.7); g.drawHeldItem(am, st, false, lt, env, this, null); } };
  }
}
function chestInsert(slots, st) {
  let n = st.count;
  for (const s of slots) if (s && sameKind(s, st) && s.count < maxStack(s.id)) { const k = Math.min(n, maxStack(s.id) - s.count); s.count += k; n -= k; if (!n) return 0; }
  for (let i = 0; i < slots.length; i++) if (!slots[i]) { slots[i] = { ...st, count: n }; return 0; }
  return n;
}
defVMob('copper_golem', { cls: CopperGolem, xp: 0, shadowR: 0.35, T: { passive: true } });

// ---- the wandering trader: odd trades for emeralds, two llamas on leads, leaves after a while ----------------------
const WT_SELL = [['sea_pickle', 1, 2], ['slime_ball', 1, 4], ['glowstone', 1, 2], ['nautilus_shell', 5, 1], ['fern', 1, 1], ['sugar_cane', 1, 1], ['pumpkin', 1, 1],
  ['kelp', 3, 1], ['cactus', 3, 1], ['dandelion', 1, 1], ['poppy', 1, 1], ['blue_orchid', 1, 1], ['allium', 1, 1], ['azure_bluet', 1, 1], ['red_tulip', 1, 1],
  ['orange_tulip', 1, 1], ['white_tulip', 1, 1], ['pink_tulip', 1, 1], ['oxeye_daisy', 1, 1], ['cornflower', 1, 1], ['lily_of_the_valley', 1, 1], ['open_eyeblossom', 1, 1],
  ['wheat_seeds', 1, 1], ['beetroot_seeds', 1, 1], ['pumpkin_seeds', 1, 1], ['melon_seeds', 1, 1], ['acacia_sapling', 5, 1], ['birch_sapling', 5, 1], ['dark_oak_sapling', 5, 1],
  ['jungle_sapling', 5, 1], ['oak_sapling', 5, 1], ['spruce_sapling', 5, 1], ['cherry_sapling', 5, 1], ['pale_oak_sapling', 5, 1], ['mangrove_propagule', 5, 1],
  ['red_dye', 1, 3], ['white_dye', 1, 3], ['blue_dye', 1, 3], ['pink_dye', 1, 3], ['black_dye', 1, 3], ['green_dye', 1, 3], ['light_gray_dye', 1, 3], ['magenta_dye', 1, 3],
  ['yellow_dye', 1, 3], ['gray_dye', 1, 3], ['purple_dye', 1, 3], ['light_blue_dye', 1, 3], ['lime_dye', 1, 3], ['orange_dye', 1, 3], ['brown_dye', 1, 3], ['cyan_dye', 1, 3],
  ['brain_coral_block', 3, 1], ['bubble_coral_block', 3, 1], ['fire_coral_block', 3, 1], ['horn_coral_block', 3, 1], ['tube_coral_block', 3, 1], ['vine', 1, 3],
  ['brown_mushroom', 1, 3], ['red_mushroom', 1, 3], ['lily_pad', 1, 5], ['small_dripleaf', 1, 2], ['sand', 1, 8], ['red_sand', 1, 4], ['pointed_dripstone', 1, 2],
  ['rooted_dirt', 1, 2], ['moss_block', 1, 2], ['pale_moss_block', 1, 2], ['firefly_bush', 1, 1], ['wildflowers', 1, 1], ['leaf_litter', 1, 1], ['packed_ice', 3, 1],
  ['blue_ice', 6, 1], ['gunpowder', 1, 1], ['podzol', 3, 3], ['name_tag', 5, 1], ['tropical_fish_bucket', 5, 1], ['pufferfish_bucket', 5, 1]];
const WT_BUY = [['water_bucket', 1, 2], ['milk_bucket', 1, 2], ['fermented_spider_eye', 1, 3], ['baked_potato', 4, 1], ['hay_block', 1, 1]];
class WanderingTrader extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.despawnT = 48000; this.trades = null; this.profession = 'none'; this.vlevel = 1; this.drinkT = 0; this.invis = false; }
  extraSave() { return { dt: this.despawnT, tr: this.trades }; }
  extraLoad(o) { this.despawnT = o.dt || 24000; this.trades = o.tr || null; }
  offers() {
    if (!this.trades) {
      const has = (k) => ITEM_KEY[k] !== undefined, pick = (l, n) => l.filter(t => has(t[0])).sort(() => Math.random() - 0.5).slice(0, n);
      this.trades = [...pick(WT_BUY, 2).map(([k, n, e]) => ({ a: k, an: n, r: 'emerald', rn: e, uses: 2, used: 0, xp: 1 })), ...pick(WT_SELL, 5).map(([k, e, n]) => ({ a: 'emerald', an: e, r: k, rn: n, uses: 8, used: 0, xp: 1 }))];
    }
    return this.trades;
  }
  gainXp() { }
  wantsPlayer() { return false; }
  think(c) {
    const g = this.game;
    if (--this.despawnT <= 0 && !this.customName) { this.dead = true; for (const e of g.entities) if (e.leashHolder === this) { e.leashHolder = null; e.dead = true; } return; }
    // invisibility at night, milk again in the morning
    if (this.drinkT > 0) { if (--this.drinkT === 0) this.invis = !g.isDay(); return; }
    if (!g.isDay() !== this.invis && Math.random() < 0.05) { this.drinkT = 32; Sound.ev(this.invis ? 'entity.wandering_trader.drink_milk' : 'entity.wandering_trader.drink_potion', this.pos, 1, 1); return; }
    if (g.ui.screen instanceof MerchantScreen && g.ui.screen.v === this) { c.look = g.player; return; }
    VMob.prototype.think.call(this, c);
  }
  preInteract(p, held) { if (held && ITEMS[held.id].spawnEgg) return false; if (held && ITEMS[held.id].key === 'name_tag') return false; this.game.ui.open(new TraderScreen(this.game, this)); this.sound('trade'); return true; }
  setupAnim(md, a) {
    const P = md.parts, [pos, spd] = emLimbs(this, a);
    emHead(P.head, this, a);
    if (P.right_leg) P.right_leg.xRot = Math.cos(pos * 0.6662) * 1.4 * spd * 0.5;
    if (P.left_leg) P.left_leg.xRot = Math.cos(pos * 0.6662 + Math.PI) * 1.4 * spd * 0.5;
    if (P.head && this.drinkT > 0) P.head.xRot = -0.6;
  }
  texKey(r) { return r.etex('entity/wandering_trader/wandering_trader'); }
  drawVM(g, r, m, a, env, lt, overlay) { if (this.invis && this.drinkT <= 0) return; super.drawVM(g, r, m, a, env, lt, overlay); }
}
class TraderScreen extends MerchantScreen { get title2() { return '流浪商人'; } }
defVMob('wandering_trader', { cls: WanderingTrader, xp: 0, shadowR: 0.4, T: { passive: true }, panicMod: 1.6 });
// a trader turns up near the player now and then with two llamas in tow (vanilla: a 2.5% .. 7.5% chance each 20 minutes)
Game.prototype.trySpawnTrader = function () {
  const p = this.player, w = this.world;
  if (this.dim !== 'overworld' && this.dim) return;
  if (this.entities.some(e => e instanceof WanderingTrader)) return;
  this.traderChance = Math.min(75, (this.traderChance || 25) + 25);
  if (Math.random() * 1000 >= this.traderChance) return;
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(p.pos[0]) + randInt(-32, 32), z = Math.floor(p.pos[2]) + randInt(-32, 32);
    if (!w.isLoaded(x, z) || Math.hypot(x - p.pos[0], z - p.pos[2]) < 12) continue;
    const y = w.surfaceY(x, z) + 1;
    if (IS_FLUID[w.getBlock(x, y - 1, z)] || w.getBlock(x, y, z) !== 0) continue;
    const t = spawnAt(this, 'wandering_trader', x + 0.5, y, z + 0.5);
    for (let i = 0; i < 2; i++) { const l = spawnAt(this, 'trader_llama', x + 0.5 + (i ? 2 : -2), y, z + 0.5); l.leashHolder = t; }
    this.traderChance = 25;
    return;
  }
};

// ---- happy ghasts: gentle flying mounts with a harness; ghastlings come from dried ghasts in water -------------------
class HappyGhast extends VMob {
  constructor(g, type, x, y, z) { super(g, type, x, y, z); this.harness = null; this.persistent = true; }
  extraSave() { return { har: this.harness }; }
  extraLoad(o) { this.harness = o.har || null; }
  wantsPlayer() { return false; }
  seat() { return [this.pos[0], this.pos[1] + this.h + 0.05, this.pos[2]]; }
  dropsOnDeath() { return [this.harness]; }
  think(c) {
    const p = this.game.player;
    // follows a player holding snowballs or a harness
    if (p.inv.held && (ITEMS[p.inv.held.id].key === 'snowball' || /_harness$/.test(ITEMS[p.inv.held.id].key)) && this.distTo(p) < 16 && this.distTo(p) > 4) { c.goal = [p.pos[0], p.pos[1] + 2, p.pos[2]]; c.look = p; return; }
    if (this.harness && this.distTo(p) < 8) { c.look = p; return; }
    if (!this.goal || this.near(this.goal, 2) || Math.random() < 0.005) this.goal = this.randomGoal(12, 4);
    c.goal = this.goal; c.mod = 0.6;
  }
  ridden(c, inp) {
    const p = this.rider;
    this.yaw = p.yaw;
    const f = inp.fwd || 0, s = inp.strafe || 0, sy = Math.sin(p.pitch);
    const sp = 0.035;
    const ax = (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * s) * Math.cos(p.pitch), az = (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * s) * Math.cos(p.pitch);
    this.vel[0] += ax * sp; this.vel[2] += az * sp; this.vel[1] += (f * sy + (inp.jump ? 0.6 : 0)) * sp;
  }
  moveBy(c) {
    if (this.rider && this.harness) { this.move(this.vel[0], this.vel[1], this.vel[2]); for (let i = 0; i < 3; i++) this.vel[i] *= 0.91; this.bodyYaw += angDelta(this.yaw, this.bodyYaw) * 0.3; return; }
    VMob.prototype.moveBy.call(this, c);
  }
  preInteract(p, held) {
    const g = this.game, k = held && ITEMS[held.id].key;
    if (k === 'snowball' && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + 1); useOne(g, p); this.sound('eat'); return true; }
    if (k && /_harness$/.test(k) && !this.harness && !this.baby) { this.harness = { ...held, count: 1 }; useOne(g, p); Sound.ev('entity.happy_ghast.equip', this.pos, 1, 1); return true; }
    if (k === 'shears' && this.harness && !this.rider) { g.dropItem(this.pos[0], this.pos[1] + 1, this.pos[2], this.harness); this.harness = null; Sound.ev('entity.happy_ghast.unequip', this.pos, 1, 1); return true; }
    if (this.harness && !p.vehicle && !this.rider) { p.mount(this); return true; }
    return false;
  }
  setupAnim(md, a) {
    const P = md.parts, t = this.age + a;
    for (let i = 0; i < 9; i++) { const n = P['tentacle' + i]; if (n) n.xRot = 0.2 * Math.sin(t * 0.3 + i) + 0.4; }
  }
  texKey(r) { return r.etex('entity/ghast/happy_ghast' + (this.baby ? '_baby' : '')); }
  drawLayers(g, r, md, m, a, env, lt, overlay) {
    if (!this.harness || this.baby) return;
    const hm = EM.get(r, 'happy_ghast_harness#main'), col = ITEMS[this.harness.id].key.replace(/_harness$/, '');
    if (hm) { EM.reset(hm); if (hm.parts.goggles) hm.parts.goggles.y = this.rider ? 14 : 14 - 1.5; r.drawEM(hm, r.etex('entity/equipment/happy_ghast_body/' + col + '_harness'), m, lt, env, { overlay }); }
    if (this.rider) { const rm = EM.get(r, 'happy_ghast_ropes#main'); if (rm) { EM.reset(rm); EM.copy(md, rm); r.drawEM(rm, r.etex('entity/ghast/happy_ghast_ropes'), m, lt, env, { overlay }); } }
  }
}
defVMob('happy_ghast', { cls: HappyGhast, ai: 'fly', food: 'happy_ghast_food', xp: 0, scale: 1, shadowR: 2, T: { passive: true, hostile: false }, speed3: 0.6, babyTempt: true });
BLOCK_RANDOM_TICK.dried_ghast = (g, x, y, z, id, m) => {
  const w = g.world, h = +(Features.propOf(id, m, 'hydration') || 0), wet = Features.propOf(id, m, 'waterlogged') === 'true' || w.getBlock(x, y + 1, z) === WATER;
  if (!wet) { if (h > 0 && Math.random() < 0.3) bsetProp(w, x, y, z, 'hydration', String(h - 1)); return; }
  if (Math.random() > 0.4) return;
  if (h < 3) { bsetProp(w, x, y, z, 'hydration', String(h + 1)); Sound.ev('block.dried_ghast.transition', [x + 0.5, y, z + 0.5], 1, 1); return; }
  w.setBlock(x, y, z, WATER, 0); Sound.ev('entity.ghastling.spawn', [x + 0.5, y, z + 0.5], 1, 1);
  spawnAt(g, 'happy_ghast', x + 0.5, y, z + 0.5, true);
};
