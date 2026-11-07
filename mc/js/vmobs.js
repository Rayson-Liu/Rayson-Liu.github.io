'use strict';
// ---------------------------------------------------------------------------
// Mobs drawn with the vanilla models (emodel.js): the framework.
//  - VMOB: each type's settings (model layer, texture, animation, behaviour); sizes, health, speed, attack and
//    names come from the vanilla entity data (ENTITY_DATA.types)
//  - VMob: a mob with a small goal-based brain: walk / swim / fly to a goal, fight, flee, follow food, its
//    parent or its owner, breed; the subclasses in mobs_*.js add what each kind does
//  - drops from the vanilla loot tables (rollLoot)
// ---------------------------------------------------------------------------
const VMOB = {};
const VMOB_CLASS = {};
// register a type: o = { cls, layer, tex(e, r) -> etex key, anim(md, e, a), scale, ... }
function defVMob(type, o = {}) {
  const T = ENTITY_DATA.types[type] || { w: 0.6, h: 1.8, cat: 'creature', a: {} }, A = T.a || {};
  const cat = o.cat || T.cat;
  VMOB[type] = o;
  if (o.cls) VMOB_CLASS[type] = o.cls;
  MOB_TYPES[type] = Object.assign({
    cn: T.cn || type, hp: A.max_health || 10, w: T.w, h: T.h, eye: T.eye, speed: A.movement_speed || 0.25, model: 'vm',
    passive: cat === 'creature' || cat === 'water_creature' || cat === 'water_ambient' || cat === 'ambient' || cat === 'axolotls' || cat === 'underground_water_creature' || cat === 'misc',
    hostile: cat === 'monster', attack: A.attack_damage || 0, fireproof: !!T.fire, drops: [], scale: 1, cat,
    follow: A.follow_range || 16, flySpeed: A.flying_speed || 0, kbRes: A.knockback_resistance || 0, armor: A.armor || 0, step: A.step_height || 0.6,
  }, o.T || {});
  const egg = ITEM_KEY[type + '_spawn_egg'];
  if (egg !== undefined) ITEMS[egg].spawnEgg = type;
}
(() => {
  const prev = createMob;
  createMob = function (game, type, x, y, z) {
    if (VMOB[type] && !(typeof type === 'string' && type.includes(':'))) {
      const C = VMOB_CLASS[type] || VMob;
      return new C(game, type, x, y, z);
    }
    return prev(game, type, x, y, z);
  };
})();
const foodIds = (tag) => new Set(itemIds('#' + tag));
const _foodCache = {};
const isFood = (tag, id) => { if (!_foodCache[tag]) _foodCache[tag] = foodIds(tag); return _foodCache[tag].has(id); };
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pickW = (list) => { let t = 0; for (const e of list) t += e[1]; let r = Math.random() * t; for (const e of list) if ((r -= e[1]) < 0) return e[0]; return list[0][0]; };
const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const dyeRGB = (c) => { const v = DYE_RGB[c] || 0xffffff; return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

// ---- loot tables -------------------------------------------------------------------------------------
// ctx: { e: the dead entity, src: the damage source, looting, player (killed by a player), fire }
function lootNum(n) {
  if (typeof n === 'number') return n;
  if (!n) return 1;
  const t = (n.type || '').replace('minecraft:', '');
  if (t === 'uniform') return lootNum(n.min) + Math.random() * (lootNum(n.max) - lootNum(n.min));
  if (t === 'binomial') { let k = 0; const N = lootNum(n.n), p = lootNum(n.p); for (let i = 0; i < N; i++) if (Math.random() < p) k++; return k; }
  if (t === 'constant') return n.value;
  return 1;
}
// a whole number, as vanilla's getInt: a uniform range includes its top (floor of a float in [min, max) never reached
// it - an iron golem dropped 3-4 ingots instead of 3-5, poppies 1 instead of 0-2; players' feedback 2026-10-31)
function lootInt(n) {
  if (n && typeof n === 'object' && (n.type || '').replace('minecraft:', '') === 'uniform') { const a = Math.floor(lootNum(n.min)), b = Math.floor(lootNum(n.max)); return a + Math.floor(Math.random() * (b - a + 1)); }
  return Math.floor(lootNum(n));
}
function lootEntityMatch(e, pred, ctx) {
  if (!e) return false;
  for (const k in pred) {
    const v = pred[k], key = k.replace('minecraft:', '');
    if (key === 'flags') {
      if (v.is_on_fire !== undefined && (e.fire > 0) !== v.is_on_fire) return false;
      if (v.is_baby !== undefined && !!e.baby !== v.is_baby) return false;
    } else if (key === 'entity_type') {
      const want = String(v).replace('minecraft:', '');
      if (want[0] === '#') { if (!(ENTITY_TAGS[want.slice(1)] || []).includes(e.type)) return false; }
      else if (e.type !== want) return false;
    } else if (key === 'components') {
      for (const ck in v) if (String(e.comp ? e.comp(ck.replace('minecraft:', '')) : '').replace('minecraft:', '') !== String(v[ck]).replace('minecraft:', '')) return false;
    } else if (key.startsWith('type_specific')) {
      const ts = v;
      if (ts.sheared !== undefined && !!e.sheared !== ts.sheared) return false;
      if (ts.size) { const s = e.size || 1; if ((ts.size.min != null && s < ts.size.min) || (ts.size.max != null && s > ts.size.max)) return false; }
      // (a raider is a captain when it carries the ominous banner: a patrol's or a raid wave's leader)
      if (ts.is_captain !== undefined && !!(e.patrolLeader || e.raidLeader) !== ts.is_captain) return false;
    } else if (key === 'equipment') {
      const held = e.inv ? e.inv.held : null;
      const mh = v.mainhand;
      if (mh && mh.predicates && mh.predicates['minecraft:enchantments']) {
        const ok = mh.predicates['minecraft:enchantments'].some(q => {
          const want = String(q.enchantments || '');
          if (!held || !held.e) return false;
          if (want === '#minecraft:smelts_loot') return held.e.some(([k]) => k === 'fire_aspect');
          return held.e.some(([k]) => 'minecraft:' + k === want || k === want);
        });
        if (!ok) return false;
      } else if (mh) return false;
    } else if (key === 'vehicle') {
      if (!e.vehicle || !lootEntityMatch(e.vehicle, v, ctx)) return false;
    } else return false;
  }
  return true;
}
function lootCond(c, ctx) {
  const t = c.condition.replace('minecraft:', '');
  switch (t) {
    case 'killed_by_player': return !!ctx.player;
    case 'random_chance': return Math.random() < lootNum(c.chance);
    case 'random_chance_with_enchanted_bonus': {
      const L = ctx.looting || 0, ec = c.enchanted_chance;
      const p = L <= 0 ? lootNum(c.unenchanted_chance) : typeof ec === 'number' ? ec : (ec.base || 0) + (ec.per_level_above_first || 0) * (L - 1);
      return Math.random() < p;
    }
    case 'entity_properties': {
      const who = c.entity === 'this' ? ctx.e : (c.entity === 'attacker' || c.entity === 'direct_attacker') ? (ctx.src && ctx.src.attacker) : null;
      return lootEntityMatch(who, c.predicate || {}, ctx);
    }
    case 'damage_source_properties': {
      const p = c.predicate || {}, a = ctx.src && ctx.src.attacker;
      if (p.source_entity && !lootEntityMatch(a, p.source_entity, ctx)) return false;
      if (p.direct_entity && !lootEntityMatch(ctx.src && (ctx.src.direct || a), p.direct_entity, ctx)) return false;
      if (p.tags) return false;
      return !!(p.source_entity || p.direct_entity);
    }
    case 'any_of': return c.terms.some(q => lootCond(q, ctx));
    case 'all_of': return c.terms.every(q => lootCond(q, ctx));
    case 'inverted': return !lootCond(c.term, ctx);
  }
  return false;
}
const condsOk = (o, ctx) => !o.conditions || o.conditions.every(c => lootCond(c, ctx));
function lootEntry(en, ctx, out) {
  const t = en.type.replace('minecraft:', '');
  if (t === 'empty') return;
  if (t === 'loot_table') { rollLoot(String(en.value).replace('minecraft:', '').replace(/^entities\//, ''), ctx, out); return; }
  if (t === 'alternatives') { for (const ch of en.children) if (condsOk(ch, ctx)) { lootEntry(ch, ctx, out); return; } return; }
  let key;
  if (t === 'tag') { const ids = itemIds('#' + en.name.replace('minecraft:', '')); if (!ids.length) return; key = ITEMS[ids[(Math.random() * ids.length) | 0]].key; }
  else if (t === 'item') key = en.name.replace('minecraft:', '');
  else return;
  if (ITEM_KEY[key] === undefined) return;
  let n = 1; const st = { id: ITEM_KEY[key], count: 1, dmg: 0 };
  for (const f of en.functions || []) {
    if (!condsOk(f, ctx)) continue;
    const fn = f.function.replace('minecraft:', '');
    if (fn === 'set_count') n = f.add ? n + lootInt(f.count) : lootInt(f.count);
    else if (fn === 'enchanted_count_increase' || fn === 'looting_enchant') { n += Math.round(lootNum(f.count) * (ctx.looting || 0)); if (f.limit > 0) n = Math.min(n, f.limit); }
    else if (fn === 'furnace_smelt') { const r = COOKING.smelting && COOKING.smelting[st.id]; if (r) st.id = r.result; }
    else if (fn === 'set_potion') st.pot = String(f.id).replace('minecraft:', '');
    else if (fn === 'set_ominous_bottle_amplifier') { const a = f.amplifier; st.amp = a && /uniform/.test(a.type || '') ? randInt(lootNum(a.min), lootNum(a.max)) : Math.floor(lootNum(a)); }
  }
  n = Math.floor(n);
  if (n <= 0) return;
  const mx = maxStack(st.id);
  while (n > 0) { const k = Math.min(mx, n); out.push({ ...st, count: k }); n -= k; }
}
// the stacks a loot table gives (name: 'zombie', 'sheep/white', 'gameplay/fishing')
function rollLoot(name, ctx = {}, out = []) {
  const L = ENTITY_DATA.loot[name]; if (!L || !L.pools) return out;
  for (const pool of L.pools) {
    if (!condsOk(pool, ctx)) continue;
    const rolls = Math.floor(lootInt(pool.rolls) + (pool.bonus_rolls ? lootNum(pool.bonus_rolls) * (ctx.luck || 0) : 0));
    for (let i = 0; i < rolls; i++) {
      const ok = pool.entries.filter(en => condsOk(en, ctx));
      if (!ok.length) continue;
      const tot = ok.reduce((s, en) => s + (en.weight ?? 1) + (en.quality || 0) * (ctx.luck || 0), 0);
      let r = Math.random() * tot, pick = ok[0];
      for (const en of ok) { if ((r -= (en.weight ?? 1) + (en.quality || 0) * (ctx.luck || 0)) < 0) { pick = en; break; } }
      lootEntry(pick, ctx, out);
    }
  }
  return out;
}
const ENTITY_TAGS = {
  skeletons: ['skeleton', 'stray', 'wither_skeleton', 'skeleton_horse', 'bogged', 'parched'],
  zombies: ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin', 'zombie_horse', 'zombie_nautilus', 'camel_husk'],
  raiders: ['evoker', 'pillager', 'ravager', 'vindicator', 'illusioner', 'witch'],
  undead: ['skeleton', 'stray', 'wither_skeleton', 'skeleton_horse', 'bogged', 'parched', 'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin', 'zombie_horse', 'phantom', 'wither', 'zoglin', 'zombie_nautilus', 'camel_husk'],
  arthropod: ['spider', 'cave_spider', 'bee', 'silverfish', 'endermite'],
};

// ---- the mob ---------------------------------------------------------------------------------------------
class VMob extends Mob {
  constructor(game, type, x, y, z) {
    super(game, type, x, y, z);
    this.D = VMOB[type]; this.vm = true;
    this.anims = {};
    this.stepHeight = this.T.step || 0.6;
    this.persistent = !this.T.hostile;
    this.home = [x, y, z];
    this.breedCd = 0; this.loveT = 0; this.anger = 0; this.owner = null;
    this.ctl = { fwd: 0, strafe: 0, jump: false, mod: 1, look: null, goal: null, up: 0 };
    if (this.D.init) this.D.init(this);
  }
  get ai() { return this.D.ai || 'ground'; }
  // ---- saving
  saveData() { const o = { v: this.variant, own: this.owner ? 1 : 0, sit: this.sitting ? 1 : 0, name: this.customName, love: this.breedCd, ...(this.extraSave ? this.extraSave() : {}) }; return o; }
  loadData(o) {
    if (!o) return;
    if (o.v !== undefined) this.variant = o.v;
    if (o.own) this.owner = this.game.player;
    if (o.sit) this.sitting = true;
    if (o.name) this.customName = o.name;
    if (o.love) this.breedCd = o.love;
    if (this.extraLoad) this.extraLoad(o);
  }
  // a component the loot tables ask about (sheep/color, frog/variant ...)
  comp(k) { return this.compVal ? this.compVal(k) : undefined; }
  makeBaby() { super.makeBaby(); this.growT = 24000; if (this.D.babyW) { this.w = this.D.babyW; this.h = this.D.babyH; } return this; }
  // ---- damage, death, loot
  hurt(a, src) {
    if (this.D.immune && src && this.D.immune.includes(src.type)) return false;
    // (natural armour and breach: Mob.hurt)
    const kb = src && src.knockFrom && this.T.kbRes ? { ...src, knock: (src.knock ?? 0.4) * (1 - this.T.kbRes) } : src;
    const r = super.hurt(a, kb);
    if (r) {
      if (src && src.attacker && src.attacker !== this) {
        this.lastAttacker = src.attacker;
        if (this.T.passive && !this.D.fights) { this.panic = 80 + randInt(0, 40); }
        else { this.anger = 400; this.target = src.attacker; }
        if (this.onAttacked) this.onAttacked(src);
      }
      if (this.sitting && !this.D.keepSitting) this.sitting = false;
    }
    return r;
  }
  die(src) {
    Living.prototype.die.call(this, src);
    const g = this.game;
    if (src && (src.attacker === g.player || src.player)) g.stats.kills++;
    const looting = src && src.looting || 0;
    if (!this.baby || this.D.babyLoot) {
      const out = rollLoot(this.D.loot || this.type, { e: this, src, looting, player: !!(src && (src.attacker === g.player || src.player)), fire: this.fire > 0 });
      for (const st of out) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], st);
    }
    if (this.saddled) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('saddle', 1));
    if (this.dropsOnDeath) for (const st of this.dropsOnDeath()) if (st) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], st);
    if (this.rider && this.rider.dismount) this.rider.dismount();
    if (src && (src.attacker === g.player || src.player)) {
      if (this.T.hostile) g.grant && g.grant('kill');
      if (!this.baby) g.dropXp(this.pos[0], this.pos[1] + 0.5, this.pos[2], this.D.xp ?? (this.T.hostile ? 5 : randInt(1, 3)));
    }
    if (this.onDeath) this.onDeath(src);
  }
  // ---- the tick
  tick() {
    this.savePrev();
    this.baseTick();
    if (this.deathTick()) return;
    const g = this.game, p = g.player, c = this.ctl;
    if (this.despawn()) return;
    if (this.D.burns && this.burnsNow()) this.fire = Math.max(this.fire, 160);
    if (this.age % 20 === 0 && Sound.warmMob && this.distTo(p) < 32) Sound.warmMob(this.D.soundType || this.type);
    if (--this.idleSound < 0) { this.idleSound = (this.D.idleT || 200) + Math.random() * 400; if (this.distTo(p) < 24 && !this.silentNow) this.sound(this.ambientKind ? this.ambientKind() : 'ambient'); }
    if (this.attackCd > 0) this.attackCd--;
    if (this.anger > 0) this.anger--;
    if (this.breedCd > 0) this.breedCd--;
    c.fwd = 0; c.strafe = 0; c.jump = false; c.mod = 1; c.look = null; c.goal = null; c.up = 0; c.face = null;
    if (this.rider && this.rider.rideInput && this.ridden) this.ridden(c, this.rider.rideInput);
    else this.think(c);
    this.moveBy(c);
    if (this.afterMove) this.afterMove();
    this.turnHead(c.look);
    if (this.loveT > 0) { this.loveT--; if (this.age % 10 === 0) g.particles.spawn('heart', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + this.h, this.pos[2] + (Math.random() - 0.5) * this.w, 0, 0.02, 0); }
    if (this.baby && --this.growT <= 0) this.grownUp();
    if (this.swingT > 0) this.swingT--;
    if (this.leashHolder && this.leashTick) this.leashTick();
    if (this.rider) this.rider.followVehicle(this);
    this.animate();
    if (this.onGround && this.limbAmt > 0.3 && this.D.stepSound !== false && Math.floor(this.limbSwing / 2.4) !== Math.floor((this.limbSwing - this.limbAmt) / 2.4)) this.sound('step', 0.15);
  }
  grownUp() { this.baby = false; this.w = this.T.w; this.h = this.T.h; if (this.onGrown) this.onGrown(); }
  sound(kind, vol = 1, pitch) {
    const n = (this.D.sounds && this.D.sounds[kind]) || 'entity.' + (this.D.soundType || this.type) + '.' + kind;
    Sound.ev(n, this.pos, vol * (this.D.vol || 1), pitch ?? ((this.baby ? 1.5 : 1) + (Math.random() - Math.random()) * 0.2));
  }
  despawn() {
    if (this.persistent || this.customName || this.leashHolder || this.rider) return false;
    const d = this.distTo(this.game.player);
    if (d > 128 || (d > 32 && this.age > 600 && Math.random() < 1 / 800)) { this.dead = true; return true; }
    return false;
  }
  burnsNow() {
    const g = this.game;
    if (!g.isDay() || this.inWater || this.age % 20 || g.weather >= 0.5 || this.fire > 0) return false;
    if (this.armorItems && this.armorItems[0]) return false;
    return this.world.skyAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + this.h), Math.floor(this.pos[2])) >= 15;
  }
  // ---- the brain (subclasses add to it or replace it)
  think(c) {
    if (this.sitting) return;
    this.findTarget();
    if (this.target) { this.fight(c); return; }
    if (this.panic > 0) { this.panic--; c.mod = this.D.panicMod || 1.4; if (!this.goal || this.age % 20 === 0 || this.near(this.goal, 1.2)) this.goal = this.randomGoal(8, 4); c.goal = this.goal; return; }
    if (this.avoid && this.avoid(c)) return;
    if (this.breedTick(c)) return;
    if (this.tempt(c)) return;
    if (this.followOwner && this.followOwner(c)) return;
    if (this.followParent(c)) return;
    if (this.raid && this.raidGoal && this.raidGoal(c)) return; // (raids.js)
    if (this.idle) { if (this.idle(c)) return; }
    this.wanderTick(c);
  }
  near(pt, r) { return Math.hypot(pt[0] - this.pos[0], (pt[1] - this.pos[1]) * (this.ai === 'ground' ? 0 : 1), pt[2] - this.pos[2]) < r; }
  findTarget() {
    const p = this.game.player, T = this.T;
    const ok = (t) => t && !t.dead && t.deathTime === 0 && !(t === p && (p.creative || p.spectator || this.game.difficulty === 0 && T.hostile));
    if (this.target && (!ok(this.target) || this.distTo(this.target) > T.follow * 1.5 || (this.target === p && this.anger <= 0 && !this.wantsPlayer()))) this.target = null;
    if (!this.target && this.wantsPlayer() && ok(p) && this.distTo(p) < seenWithin(p, T.follow) && (this.age + this.id) % 10 === 0 && this.canSee(p)) this.target = p;
    if (!this.target && this.huntTarget) this.target = this.huntTarget();
  }
  wantsPlayer() { return this.T.hostile && !this.D.neutral && this.game.difficulty > 0; }
  fight(c) {
    const t = this.target, d = Math.hypot(t.pos[0] - this.pos[0], t.pos[2] - this.pos[2]);
    c.look = t;
    if (this.ranged) { this.ranged(c, t, d); return; }
    this.chase(c, t, d);
  }
  // run at the target and hit it when in reach
  chase(c, t = this.target, d = Math.hypot(t.pos[0] - this.pos[0], t.pos[2] - this.pos[2])) {
    c.look = t;
    c.goal = [t.pos[0], t.pos[1], t.pos[2]]; c.mod = this.D.chaseMod || 1.2;
    if (this.ai !== 'ground') c.goal[1] += t.h * 0.5 - this.h * 0.5;
    const reach = this.w / 2 + t.w / 2 + (this.D.reach || 0.7);
    // (on the ground: the bodies overlap in height, counted from where a jump started - see Mob's melee in entity.js)
    const base = Math.min(this.pos[1], this.jumpFromY ?? this.pos[1]);
    const high = this.ai !== 'ground' ? Math.abs(t.pos[1] - this.pos[1]) < Math.max(1.8, this.h) : t.pos[1] < base + Math.max(this.h, 1.2) && t.pos[1] + t.h > base;
    if (d < reach && high && this.attackCd <= 0) this.melee(t);
  }
  melee(t) {
    this.attackCd = this.D.attackCd || 20; this.swingT = 6;
    // an axe knocks a raised shield down for 5 seconds (vanilla)
    const g = this.game;
    if (t === g.player && t.usingItem === ITEM_KEY.shield && this.hand && /_axe$/.test(ITEMS[this.hand.id].key)) { t.shieldCd = g.tickCount + 100; t.usingItem = null; Sound.ev('item.shield.break', t.pos, 0.8, 0.8 + Math.random() * 0.4); }
    let dmg = this.T.attack || 2;
    const df = this.game.difficulty; if (t === this.game.player) dmg = df === 1 ? Math.min(dmg / 2 + 1, dmg) : df === 3 ? dmg * 1.5 : dmg;
    if (t.hurt(dmg, { type: 'mob', attacker: this, knockFrom: this.pos, knock: 0.4 + (this.D.knock || 0) })) {
      this.sound('attack', 1); if (this.onMeleeHit) this.onMeleeHit(t);
    }
  }
  tempt(c) {
    if (!this.D.food || this.baby && !this.D.babyTempt) return false;
    const p = this.game.player, held = p.inv.held;
    const off = p.inv.slots[40];
    if (!((held && isFood(this.D.food, held.id)) || (off && isFood(this.D.food, off.id)))) return false;
    const d = this.distTo(p);
    if (d > 10 || p.deathTime) return false;
    c.look = p;
    if (d > 2.5) { c.goal = [p.pos[0], p.pos[1], p.pos[2]]; c.mod = this.D.temptMod || 1.0; }
    return true;
  }
  breedTick(c) {
    if (this.loveT <= 0) return false;
    const mate = this.game.entities.find(o => o !== this && o.type === this.type && o.loveT > 0 && !o.baby && o.distTo(this) < 8 && !o.dead);
    if (!mate) return false;
    c.look = mate; c.goal = [mate.pos[0], mate.pos[1], mate.pos[2]];
    if (this.distTo(mate) < 3) {
      this.breedT = (this.breedT || 0) + 1;
      if (this.breedT > 60 && this.id < mate.id) {
        this.loveT = 0; mate.loveT = 0; this.breedT = 0; this.breedCd = mate.breedCd = 6000;
        this.spawnChild(mate);
      }
    }
    return true;
  }
  spawnChild(mate) {
    const g = this.game, b = createMob(g, this.type, (this.pos[0] + mate.pos[0]) / 2, this.pos[1], (this.pos[2] + mate.pos[2]) / 2);
    b.makeBaby(); b.persistent = true;
    if (this.inheritFrom) this.inheritFrom(b, mate);
    if (this.owner) b.owner = this.owner;
    g.entities.push(b);
    for (let i = 0; i < 7; i++) g.particles.spawn('heart', b.pos[0] + (Math.random() - 0.5), b.pos[1] + 0.5 + Math.random() * 0.5, b.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
    g.dropXp(b.pos[0], b.pos[1] + 0.5, b.pos[2], randInt(1, 7));
    return b;
  }
  followParent(c) {
    if (!this.baby || this.age % 40 && !this.parentRef) return false;
    if (!this.parentRef || this.parentRef.dead || this.age % 40 === 0) this.parentRef = this.game.entities.find(o => o.type === this.type && !o.baby && o.distTo(this) < 8);
    const P = this.parentRef;
    if (!P || this.distTo(P) < 3) return false;
    c.goal = [P.pos[0], P.pos[1], P.pos[2]]; c.mod = 1.1;
    return true;
  }
  // (a land mob fallen into water makes for dry ground at once - vanilla WaterAvoidingRandomStrollGoal in water -
  // rather than floating there until it happens to pick a place)
  get avoidsWater() { return this.ai === 'ground' && !this.D.waterOk; }
  wanderTick(c) {
    if (this.goal && (this.near(this.goal, this.ai === 'ground' ? 0.8 : 1) || --this.wanderT <= 0)) this.goal = null;
    const ashore = this.avoidsWater && this.inWater;
    if (!this.goal && (ashore ? this.age % 10 === 0 : Math.random() < (this.D.wanderChance || (this.ai === 'ground' ? 1 / 120 : 1 / 40)))) { this.goal = this.randomGoal(ashore ? 14 : this.D.wanderR || 10, this.D.wanderY || 7); this.wanderT = 200; }
    if (this.goal) { c.goal = this.goal; c.mod = this.D.wanderMod || 1; }
  }
  // a random place to go: on the ground, in the water or in the air
  randomGoal(r, ry) {
    const w = this.world;
    for (let k = 0; k < 10; k++) {
      const x = this.pos[0] + (Math.random() * 2 - 1) * r, z = this.pos[2] + (Math.random() * 2 - 1) * r;
      let y = this.pos[1] + (Math.random() * 2 - 1) * ry;
      const fx = Math.floor(x), fz = Math.floor(z);
      if (!w.isLoaded(fx, fz)) continue;
      // (a swimmer's goal is all under water, not at the surface it could flop out over)
      if (this.ai === 'swim') { if (w.waterAt(fx, Math.floor(y), fz) && w.waterAt(fx, Math.floor(y + this.h + 0.3), fz)) return [x, y, z]; continue; }
      if (this.ai === 'fly') {
        if (this.D.flyHeight) { let gy = Math.floor(this.pos[1]); while (gy > 0 && !BLOCKS[w.getBlock(fx, gy, fz)].solid && this.pos[1] - gy < 30) gy--; y = Math.min(y, gy + 1 + this.D.flyHeight); }
        if (!BLOCKS[w.getBlock(fx, Math.floor(y), fz)].solid) return [x, y, z];
        continue;
      }
      let fy = Math.floor(this.pos[1] + 2);
      for (let i = 0; i < 8 && !BLOCKS[w.getBlock(fx, fy - 1, fz)].solid; i++) fy--;
      if (!BLOCKS[w.getBlock(fx, fy - 1, fz)].solid || BLOCKS[w.getBlock(fx, fy, fz)].solid) continue;
      if (this.avoidsWater && (w.waterAt(fx, fy, fz) || w.waterAt(fx, fy - 1, fz) || w.getBlock(fx, fy - 1, fz) === LAVA)) continue;
      return [x, fy, z];
    }
    return null;
  }
  // ---- moving toward the goal
  moveBy(c) {
    const D = this.D, g = c.goal;
    if (c.face != null) this.turnTo(c.face, 0.5);
    if (this.ai === 'fly' || (this.ai === 'swim' && this.inWater) || (this.ai === 'amph' && this.inWater && !this.D.walkUnderwater)) {
      this.move3d(c);
      return;
    }
    if (this.ai === 'swim' && !this.inWater) { this.flop(); return; }
    if (g) {
      const dx = g[0] - this.pos[0], dz = g[2] - this.pos[2], d = Math.hypot(dx, dz);
      if (d > 0.3) { this.turnTo(Math.atan2(-dx, -dz), D.turn || 0.35); c.fwd = Math.max(c.fwd, 1); }
    }
    // obstacles: don't walk off cliffs or into lava; jump up blocks; climb (spiders)
    if (c.fwd > 0) {
      const ax = this.pos[0] - Math.sin(this.yaw) * (this.w / 2 + 0.5), az = this.pos[2] - Math.cos(this.yaw) * (this.w / 2 + 0.5);
      const fx = Math.floor(ax), fz = Math.floor(az), fy = Math.floor(this.pos[1]);
      let drop = 0;
      while (drop < 5 && !BLOCKS[this.world.getBlock(fx, fy - 1 - drop, fz)].solid && !IS_FLUID[this.world.getBlock(fx, fy - 1 - drop, fz)]) drop++;
      const danger = this.world.getBlock(fx, fy - 1 - drop, fz) === LAVA || this.world.getBlock(fx, fy, fz) === LAVA;
      // (on land, a land mob doesn't stroll into water - following its owner or food it may swim, as in vanilla)
      const wet = this.avoidsWater && !this.target && !this.inWater && c.goal === this.goal && (this.world.waterAt(fx, fy, fz) || this.world.waterAt(fx, fy - 1 - drop, fz));
      if ((danger && !this.T.fireproof) || wet || (drop > (this.target ? 4 : 3) && !D.fearless)) { c.fwd = 0; this.goal = null; }
      if (this.collidedH && this.onGround) c.jump = true;
      if (this.collidedH && D.climbs) { this.vel[1] = 0.2; this.fallDist = 0; }
      if (fwdStuck(this)) { if (++this.stuck > 40) { this.goal = null; this.stuck = 0; this.yaw += (Math.random() - 0.5) * 2; } } else this.stuck = 0;
    }
    if (this.inWater && !D.sinks && (this.vel[1] < 0.02 || this.collidedH)) c.jump = true;
    if (this.inLava && this.T.fireproof && D.lavaWalker) c.jump = true;
    if (c.jump && this.onGround && !this.inWater) { this.vel[1] = D.jump || 0.42; this.jumpFromY = this.pos[1]; }
    else if (this.onGround) this.jumpFromY = undefined;
    const s = this.T.speed * c.mod * (this.baby && D.babyFast ? 1.2 : 1);
    this.travel(c.fwd, c.strafe, s * s * (D.landSpeedMul || 1), c.jump);
    const d = angDelta(this.yaw, this.bodyYaw);
    this.bodyYaw += d * (D.bodyTurn || 0.3);
  }
  // swimming or flying straight toward the goal (no gravity), turning to face where it goes
  move3d(c) {
    const D = this.D, v = this.vel, g = c.goal, fly = this.ai === 'fly';
    const sp = (fly ? (this.T.flySpeed || 0.6) * 0.1 : this.T.speed * 0.12) * c.mod * (D.speed3 || 1);
    if (g) {
      const dx = g[0] - this.pos[0], dy = g[1] - this.pos[1], dz = g[2] - this.pos[2], d = Math.hypot(dx, dy, dz);
      if (d > 0.2) {
        v[0] += dx / d * sp; v[1] += dy / d * sp * (D.vert || 1); v[2] += dz / d * sp;
        const h = Math.hypot(dx, dz);
        if (h > 0.3 && c.face == null) this.turnTo(Math.atan2(-dx, -dz), D.turn || 0.25);
        this.pitch3 = Math.atan2(dy, h);
      }
    }
    if (c.up) v[1] += c.up;
    if (fly) this.fallDist = 0;
    if (fly && D.hover !== false && !g) v[1] *= 0.6;
    if (!fly && !g) v[1] -= D.sink ?? 0.002;
    this.move(v[0], v[1], v[2]);
    const drag = fly ? (D.airDrag || 0.91) : (D.waterDrag || 0.9);
    v[0] *= drag; v[1] *= drag; v[2] *= drag;
    if (fly && D.gravity) v[1] -= D.gravity;
    this.bodyYaw += angDelta(this.yaw, this.bodyYaw) * (D.bodyTurn || 0.5);
    if (this.collidedH && fly) v[1] += 0.05;
  }
  // a fish out of water: flops about
  flop() {
    const v = this.vel;
    if (this.onGround && Math.random() < 0.1) { v[1] = 0.4; v[0] += (Math.random() - 0.5) * 0.1; v[2] += (Math.random() - 0.5) * 0.1; this.sound('flop', 0.6); }
    this.travel(0, 0, 0, false);
    this.outOfWater = (this.outOfWater || 0) + 1;
    if (this.outOfWater > (this.D.dryOut || 300) && this.age % 20 === 0) this.hurt(1, { type: 'drown' });
  }
  turnHead(look) {
    if (look) {
      const lx = look.pos ? look.pos : look, ly = look.pos ? look.pos[1] + (look.eyeH || look.h * 0.85 || 1) : look[1];
      const dx = lx[0] - this.pos[0], dz = lx[2] - this.pos[2];
      const hy = angDelta(Math.atan2(-dx, -dz), this.bodyYaw), lim = this.D.headYaw || 1.2;
      this.headYaw += (clamp(hy, -lim, lim) - this.headYaw) * 0.3;
      const dy = ly - (this.pos[1] + (this.T.eye || this.h * 0.85));
      this.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.8, 0.8);
      if (Math.abs(hy) > lim && this.ai !== 'fly' && this.ctl.fwd === 0) this.bodyYaw += angDelta(this.bodyYaw + hy, this.bodyYaw) * 0.1;
    } else { this.headYaw *= 0.9; this.pitch *= 0.9; if (this.ai !== 'ground' && this.pitch3) this.pitch = 0; }
  }
  // ---- feeding, taming and the like (right click); returns true when it used the click
  interact(p, held) {
    const g = this.game;
    if (this.preInteract && this.preInteract(p, held)) return true;
    if (held && this.D.food && isFood(this.D.food, held.id)) {
      if (this.health < this.maxHealth && this.D.healFood) { this.health = Math.min(this.maxHealth, this.health + this.D.healFood); useOne(g, p); this.sound('eat'); return true; }
      if (this.baby) { this.growT -= Math.floor(this.growT * 0.1); useOne(g, p); g.particles.spawn('happy_villager', this.pos[0], this.pos[1] + this.h, this.pos[2], 0, 0.05, 0); return true; }
      if (this.breedCd <= 0 && this.loveT <= 0 && this.canBreed()) { this.loveT = 600; useOne(g, p); this.sound('eat'); return true; }
    }
    if (this.postInteract && this.postInteract(p, held)) return true;
    return false;
  }
  canBreed() { return !this.D.tameToBreed || !!this.owner; }
  // ---- drawing
  layerKey() {
    const D = this.D, base = D.layer || this.type + '#main';
    if (this.baby) { const bk = D.babyLayer || base.replace('#', '_baby#'); if (EM.has(bk)) return bk; }
    return base;
  }
  texKey(r) {
    const t = this.D.tex ? this.D.tex(this, r) : 'entity/' + this.type + '/' + this.type;
    if (!t) return null;
    if (typeof t === 'string') return t[0] === '@' ? t : r.etex(t);
    return r.etexMix(t);
  }
  setupAnim(md, a) {
    if (this.D.anim) this.D.anim(md, this, a);
    else { emHead(md.parts.head, this, a); const [pos, spd] = emLimbs(this, a); emQuad(md, pos, spd); }
  }
  // babies without a baby model of their own are the adult model at half size
  renderScale() { return (this.attrScale || 1) * (this.D.scale || 1) * (this.baby && this.layerKey() === (this.D.layer || this.type + '#main') ? 0.5 : 1); }
  drawVM(g, r, m, a, env, lt, overlay) {
    const md = EM.get(r, this.layerKey()); if (!md) return;
    EM.reset(md); this.setupAnim(md, a);
    const tex = this.texKey(r);
    const att = this.attachments ? this.attachments(g, md, lt, env) : null;
    r.drawEM(md, tex, m, lt, env, { overlay, attach: att, cull: this.D.cull, bright: this.D.bright });
    if (this.drawLayers) this.drawLayers(g, r, md, m, a, env, lt, overlay);
    if (this.D.glow) { const gt = r.etex(typeof this.D.glow === 'function' ? this.D.glow(this) : this.D.glow); if (gt) r.drawEMGlow(md, gt, m, env, {}); }
  }
}
function angDelta(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function fwdStuck(e) { return Math.hypot(e.pos[0] - e.prev[0], e.pos[2] - e.prev[2]) < 0.01; }
function useOne(g, p, toItem) {
  if (g.mode === 'creative') return;
  const h = p.inv.held; if (!h) return;
  h.count--; if (!h.count) p.inv.slots[p.inv.sel] = null;
  if (toItem) { const st = makeStack(toItem, 1); if (!p.inv.slots[p.inv.sel]) p.inv.slots[p.inv.sel] = st; else if (p.inv.add(st)) g.dropItem(p.pos[0], p.pos[1] + 1, p.pos[2], st); }
}
// swap the held stack for another item (milking, filling buckets): one off the stack, the new one in its place or the inventory
function swapHeld(g, p, key, extra) {
  const st = { ...makeStack(key, 1), ...(extra || {}) };
  if (g.mode === 'creative') { if (!p.inv.slots.some(s => s && sameKind(s, st))) p.inv.add(st); return; }
  const h = p.inv.held;
  if (h.count <= 1) { p.inv.slots[p.inv.sel] = st; return; }
  h.count--;
  if (p.inv.add(st)) g.dropItem(p.pos[0], p.pos[1] + 1, p.pos[2], st);
}

// ---- drawing a vanilla-model mob (called from Game.drawMob) ----------------------------------------------
Game.prototype.drawVMob = function (e, ip, a, env, l) {
  const r = this.renderer;
  let m = M4.create();
  if (e.displayMatrix) m = M4.copy(e.displayMatrix);
  else {
    M4.translate(m, ip[0], ip[1], ip[2]);
    let by = e.bodyYaw;
    if (e.prevBodyYaw !== undefined) by = e.prevBodyYaw + angDelta(e.bodyYaw, e.prevBodyYaw) * a;
    M4.rotY(m, by);
  }
  if (e.deathTime > 0 && !e.D.noDeathFlip) M4.rotZ(m, Math.min(1, Math.sqrt((e.deathTime + a) / 20)) * Math.PI / 2);
  if (e.preDraw) e.preDraw(m, a);
  const sc = e.renderScale(a);
  M4.scale(m, sc, sc, sc);
  const overlay = e.hurtTime > 0 || e.deathTime > 0 ? [1, 0, 0, 0.4] : (e.whiteFlash ? e.whiteFlash(a) : null);
  const lt = [l[0], l[1]];
  if (e.fire > 0 || e.D.bright) lt[1] = 1;
  e.drawVM(this, r, m, a, env, lt, overlay);
  if (e.customName && this.player && e.distTo(this.player) < 32 && this.drawNameTag) this.drawNameTag(e, ip, e.customName);
  if (e.deathTime === 0 && !e.displayMatrix && e.D.shadow !== false) {
    const fx = Math.floor(ip[0]), fz = Math.floor(ip[2]);
    let gy = Math.floor(ip[1] + 0.01);
    for (let k = 0; k < 6 && gy > 0 && !SOLIDCUBE[this.world.getBlock(fx, gy - 1, fz)] && !BLOCKS[this.world.getBlock(fx, gy - 1, fz)].solid; k++) gy--;
    const h = ip[1] - gy, rad = (e.D.shadowR || e.w * 0.6) * (e.baby ? 0.5 : 1) * (e.D.scale || 1);
    if (h < 5) r.drawShadow(ip[0], gy, ip[2], rad * (1 - h / 10), 0.55 * (1 - h / 5));
  }
};
(() => {
  const _dm = Game.prototype.drawMob;
  Game.prototype.drawMob = function (e, ip, a, env, l) {
    if (e.vm && e.drawVM) return this.drawVMob(e, ip, a, env, l);
    return _dm.call(this, e, ip, a, env, l);
  };
})();

// a mob drawn into a small picture for a screen (the horse's inventory), turned toward the mouse like vanilla's.
// Read back like main.js's playerPreview: into a pixel buffer, fenced, copied out once the GPU is past it (the first
// picture at once) - a plain readPixels made the CPU wait for the whole frame, the world behind the screen included,
// each time the mouse moved. The key: what changes the picture (JSON of saveData each frame took in a donkey's whole
// chest, and breedCd, counting down every tick, drew the horse again each tick)
const mobLookKey = (e) => {
  const st = (s) => s ? s.id + ':' + (s.color ?? '') : '';
  return [e.type, e.variant, e.baby ? 1 : 0, e.saddled ? 1 : 0, e.rider ? 1 : 0, st(e.armorItem), e.chest ? 1 : 0, st(e.carpet), e.sit ? 1 : 0, e.sitting ? 1 : 0, e.cvar ?? '', e.sheared ? 1 : 0].join('/');
};
Renderer.prototype.mobPreview = function (game, e, ui, x, y, w, h) {
  const gl = this.gl, S = Math.max(2, ui.scale), W = w * S, H = h * S;
  const key = e.id + ',' + Math.round(ui.mouse.x / 2) + ',' + Math.round(ui.mouse.y / 2) + ',' + W + ',' + H + ',' + mobLookKey(e);
  // (asked for every frame while its screen is open: a gap means the screen was opened again)
  const now = performance.now(), gap = this.mpv ? now - (this.mpv.at || 0) : 1e9;
  if (this.mpv) this.mpv.at = now;
  if (this.mpv && this.mpv.sync && this.mpv.W === W && this.mpv.H === H) {
    const pv = this.mpv;
    if (pv.eid !== e.id) { gl.deleteSync(pv.sync); pv.sync = null; pv.key = null; } // (another mob's picture on its way: not wanted)
    else {
      if (gl.getSyncParameter(pv.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return pv.cv;
      gl.deleteSync(pv.sync); pv.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pv.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pv.px);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      for (let r = 0; r < H; r++) pv.img.data.set(pv.px.subarray((H - 1 - r) * W * 4, (H - r) * W * 4), r * W * 4);
      pv.ctx.putImageData(pv.img, 0, 0);
      pv.key = pv.pendingKey;
    }
  }
  if (this.mpv && this.mpv.key === key) return this.mpv.cv;
  if (!this.mpv || this.mpv.W !== W || this.mpv.H !== H) {
    if (this.mpv) {
      gl.deleteFramebuffer(this.mpv.fb); gl.deleteTexture(this.mpv.tex); gl.deleteRenderbuffer(this.mpv.rb);
      if (this.mpv.pbo) gl.deleteBuffer(this.mpv.pbo);
      if (this.mpv.sync) gl.deleteSync(this.mpv.sync);
    }
    const fb = gl.createFramebuffer(), tex = gl.createTexture(), rb = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.mpv = { fb, tex, rb, pbo, W, H, cv, ctx: cv.getContext('2d'), px: new Uint8Array(W * H * 4), img: cv.getContext('2d').createImageData(W, H), first: true };
  }
  const pv = this.mpv;
  gl.bindFramebuffer(gl.FRAMEBUFFER, pv.fb);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  const size = Math.max(e.w, e.h) * (e.D.scale || 1) * 0.62 + 0.1;
  const vp = M4.create(); M4.ortho(vp, -size, size, -size * 0.25, size * 1.75, -8, 8);
  const mx = (ui.mouse.x - (x + w / 2)) / 40;
  const m = M4.create(); M4.rotY(m, Math.PI * 0.8 - Math.atan(mx) * 0.7);
  const env = { day: 1, fogColor: [0, 0, 0], fogNear: 1e8, fogFar: 2e8, nightTint: [1, 1, 1] };
  const savedCam = this.camPos, savedVP = this.vp; this.camPos = [0, 0, 0]; this.vp = vp;
  const hy = e.headYaw, pt = e.pitch, la = e.limbAmt; e.headYaw = 0; e.pitch = 0; e.limbAmt = 0;
  const sc = e.renderScale(1); M4.scale(m, sc, sc, sc);
  try { e.drawVM(game, this, m, 1, env, [1, 0], null); } catch (err) { }
  e.headYaw = hy; e.pitch = pt; e.limbAmt = la;
  this.vp = savedVP; this.camPos = savedCam;
  const done = e.texKey && e.texKey(this) ? key : null; // (drawn again once its texture has loaded)
  if (pv.first || pv.eid !== e.id || gap > 500) {
    // the first picture of a screen (another mob, or opened again) is read at once: never a frame of the last one
    pv.first = false;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pv.px);
    for (let r = 0; r < H; r++) pv.img.data.set(pv.px.subarray((H - 1 - r) * W * 4, (H - r) * W * 4), r * W * 4);
    pv.ctx.putImageData(pv.img, 0, 0);
    pv.key = done;
  } else {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pv.pbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pv.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    pv.pendingKey = done;
  }
  pv.eid = e.id; pv.at = now;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  return pv.cv;
};

if (ITEM_KEY.ender_dragon_spawn_egg !== undefined) ITEMS[ITEM_KEY.ender_dragon_spawn_egg].spawnEgg = 'ender_dragon';
