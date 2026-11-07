'use strict';
// ---------------------------------------------------------------------------
// Everyday right-click uses of items in single player: axes strip logs and scrape copper (oxidation, wax),
// shovels make dirt paths, honeycomb waxes copper, glass bottles fill with water, dye colours sheep; bottles
// o' enchanting, wind charges and coloured eggs are thrown; ominous bottles are drunk; fireworks fly from the
// ground. Also the drops vanilla gives that the block list left out (kelp, creaking hearts, mushroom blocks).
// ---------------------------------------------------------------------------
const IU_STAGES = ['', 'exposed_', 'weathered_', 'oxidized_'];
// a copper block's family: { stage 0-3, waxed, key(stage, waxed) }
function copperInfo(key) {
  const m = /^(waxed_)?(exposed_|weathered_|oxidized_)?(.*copper.*)$/.exec(key);
  if (!m) return null;
  const rest = m[3], stage = IU_STAGES.indexOf(m[2] || '');
  const name = (st, wx) => {
    let k = rest === 'copper' || rest === 'copper_block' ? (st === 0 ? 'copper_block' : IU_STAGES[st] + 'copper') : IU_STAGES[st] + rest;
    if (wx) k = 'waxed_' + k;
    return BID[k] !== undefined ? k : null;
  };
  if (!name(stage, !!m[1]) || (!name(1, false) && !name(0, true))) return null;
  return { stage, waxed: !!m[1], name };
}
// replace a block keeping its state (facing, axis, half ...)
Game.prototype.swapBlock = function (x, y, z, newKey) {
  const w = this.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z), b = BLOCKS[id], nid = BID[newKey];
  if (nid === undefined) return false;
  let nm = m;
  if (b.states && BLOCKS[nid].states) { const r = Features.stateOf({ Name: newKey, Properties: b.states[m] || {} }); if (r) nm = r[1]; }
  w.setBlock(x, y, z, nid, nm);
  // a door's other half too
  if (b.door) { const oy = (m & 8) ? y - 1 : y + 1; if (w.getBlock(x, oy, z) === id) w.setBlock(x, oy, z, nid, w.getMeta(x, oy, z)); }
  this.flushMesh();
  return true;
};
const STRIP = /^(.*_(log|wood|stem|hyphae)|bamboo_block)$/;
const PATHABLE = new Set(['grass_block', 'dirt', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt']);
const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

Game.prototype.useOnBlockItem = function (held, def) {
  const p = this.player, t = this.target, w = this.world, k = def.key;
  if (!t || p.sneaking && false) return false;
  const [x, y, z] = t.pos, tb = BLOCKS[t.id], tk = tb.key, c = [x + 0.5, y + 0.5, z + 0.5];
  // axes: strip logs, scrape a copper stage off, take wax off
  if (def.tool && def.tool.type === 'axe') {
    if (STRIP.test(tk) && !tk.startsWith('stripped_') && BID['stripped_' + tk] !== undefined) { this.swapBlock(x, y, z, 'stripped_' + tk); Sound.ev('item.axe.strip', c, 1, 1); this.damageHeld(1); p.swing(); return true; }
    const cu = copperInfo(tk);
    if (cu && cu.waxed) { this.swapBlock(x, y, z, cu.name(cu.stage, false)); Sound.ev('item.axe.wax_off', c, 1, 1); this.particles.spawn('crit', ...c, 0, 0.1, 0); this.damageHeld(1); p.swing(); return true; }
    if (cu && cu.stage > 0) { this.swapBlock(x, y, z, cu.name(cu.stage - 1, false)); Sound.ev('item.axe.scrape', c, 1, 1); this.damageHeld(1); p.swing(); return true; }
  }
  // shovels: a path from grass or dirt (with air above)
  if (def.tool && def.tool.type === 'shovel' && PATHABLE.has(tk) && t.face !== 2 && !w.getBlock(x, y + 1, z) && BID.dirt_path !== undefined) {
    w.setBlock(x, y, z, BID.dirt_path, 0); Sound.ev('item.shovel.flatten', c, 1, 1); this.damageHeld(1); p.swing(); this.flushMesh(); return true;
  }
  // honeycomb: wax copper
  if (k === 'honeycomb') {
    const cu = copperInfo(tk);
    if (cu && !cu.waxed && cu.name(cu.stage, true)) {
      this.swapBlock(x, y, z, cu.name(cu.stage, true)); Sound.ev('item.honeycomb.wax_on', c, 1, 1);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      p.swing(); return true;
    }
  }
  return false;
};
// throwables: bottles o' enchanting, wind charges, coloured eggs
class Thrown extends Arrow {
  constructor(game, x, y, z, vel, shooter, kind) { super(game, x, y, z, vel, shooter); this.kind = kind; this.snowball = ITEM_KEY[kind]; this.gravity = kind === 'wind_charge' ? 0 : undefined; }
  tick() {
    const was = this.dead;
    if (this.kind === 'wind_charge') { this.vel[1] += 0.05; } // no gravity: Arrow's fall taken back (it falls 0.05 a tick)
    super.tick();
    if (!was && (this.dead || this.stuck)) this.burst();
  }
  breakSnowball() { this.burst(); }
  burst() {
    if (this.burst_) return; this.burst_ = true; this.dead = true;
    const g = this.game, [x, y, z] = this.pos;
    if (this.kind === 'experience_bottle') {
      Sound.ev('entity.splash_potion.break', this.pos, 1, 1);
      for (let i = 0; i < 12; i++) g.particles.spawn('effect', x, y, z, (Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4, { col: [60, 140, 255] });
      g.dropXp(x, y, z, 3 + Math.floor(Math.random() * 5) + Math.floor(Math.random() * 5));
    } else if (this.kind === 'wind_charge') {
      // a burst of wind: everything near is thrown away from it, no blocks broken
      Sound.ev('entity.wind_charge.wind_burst', this.pos, 1, 1);
      for (let i = 0; i < 16; i++) g.particles.spawn('poof', x, y, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6);
      for (const e of [g.player, ...g.entities]) {
        if (!e || e.dead || !e.vel) continue;
        const dx = e.pos[0] - x, dy = e.pos[1] + (e.h || 1) / 2 - y, dz = e.pos[2] - z, d = Math.hypot(dx, dy, dz);
        if (d > 2.4 || d < 1e-3) continue;
        const f = (1 - d / 2.4) * 1.22;
        e.vel[0] += dx / d * f; e.vel[1] += dy / d * f + 0.3; e.vel[2] += dz / d * f;
        if (e === g.player) e.fallDist = 0;
      }
    } else { // eggs: a chick now and then
      for (let i = 0; i < 8; i++) g.particles.spawn('poof', x, y, z, (Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2);
      if (Math.random() < 0.125) { const ch = new Mob(g, 'chicken', x, y, z).makeBaby(); ch.persistent = true; g.addEntity(ch); }
    }
  }
}
const _iuUseEquipment = Game.prototype.useEquipment;
Game.prototype.useEquipment = function (held, def) {
  const p = this.player, k = def && def.key;
  if (!held) return _iuUseEquipment.call(this, held, def);
  if (this.useOnBlockItem(held, def)) return true;
  const throwIt = (kind, speed, sound) => {
    const d = this.lookDir();
    const a = new Thrown(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], d.map(v => v * speed), p, kind);
    this.entities.push(a);
    Sound.ev(sound, p.pos, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing();
  };
  if (k === 'experience_bottle') { throwIt(k, 0.7, 'entity.experience_bottle.throw'); return true; }
  if (k === 'wind_charge') { if ((p.windCd || 0) > this.tickCount) return true; p.windCd = this.tickCount + 10; throwIt(k, 1.5, 'entity.wind_charge.throw'); return true; }
  if (k === 'blue_egg' || k === 'brown_egg') { throwIt(k, 1.5, 'entity.egg.throw'); return true; }
  // glass bottle: water from a source (or a water cauldron)
  if (k === 'glass_bottle') {
    const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]], ft = this.raycast(eye, this.lookDir(), this.reach(), true);
    const w = this.world;
    let ok = false;
    if (ft && ft.id === WATER) ok = true;
    else if (ft && BLOCKS[ft.id].key === 'water_cauldron') { const lv = +Features.propOf(ft.id, w.getMeta(...ft.pos), 'level') || 1; if (lv > 1) w.setMeta(...ft.pos, Features.withProp(ft.id, w.getMeta(...ft.pos), 'level', lv - 1)); else w.setBlock(...ft.pos, BID.cauldron, 0); ok = true; }
    if (ok) {
      const pot = { id: ITEM_KEY.potion, count: 1, dmg: 0, pot: 'water' };
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = pot; else if (p.inv.add(pot)) this.dropFromPlayer(pot); }
      Sound.ev('item.bottle.fill', p.pos, 1, 1); p.swing();
    }
    return true;
  }
  // ominous bottle: drunk (32 ticks), gives bad omen
  if (k === 'ominous_bottle') { this.startUsing(held, 'main'); return true; }
  // a firework from the ground: up it goes, and bursts
  if (k === 'firework_rocket' && !p.gliding && this.target) {
    const t = this.target, D = DIRS[t.face], pt = t.point || [t.pos[0] + 0.5, t.pos[1] + 1, t.pos[2] + 0.5];
    this.entities.push(new FireworkRocket(this, pt[0] + D[0] * 0.1, pt[1] + D[1] * 0.1, pt[2] + D[2] * 0.1, held));
    Sound.ev('entity.firework_rocket.launch', pt, 3, 1);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing(); return true;
  }
  return _iuUseEquipment.call(this, held, def);
};
const _iuUsingTick = Game.prototype.usingTick;
Game.prototype.usingTick = function (st) {
  _iuUsingTick.call(this, st);
  const p = this.player;
  if (ITEMS[st.id].key === 'ominous_bottle') {
    if (p.useT % 4 === 0 && p.useT > 6) Sound.ev('entity.generic.drink', p.pos, 0.5, 1);
    if (p.useT >= 32) {
      p.addEffect('bad_omen', st.amp || 0, 120000);
      Sound.ev('item.ominous_bottle.dispose', p.pos, 1, 1);
      if (this.mode !== 'creative') { st.count--; if (!st.count) p.inv.slots[p.inv.sel] = null; }
      p.usingItem = null; p.useT = 0;
    }
  }
};
// a firework rocket: flies up for its flight time, then bursts
class FireworkRocket extends Entity {
  constructor(game, x, y, z, stack) {
    super(game, x, y, z, 0.25, 0.25);
    this.life = 10 * ((stack && stack.flight) || 1) + 6 + Math.floor(Math.random() * 6) + Math.floor(Math.random() * 7);
    this.vel = [(Math.random() - 0.5) * 0.023, 0.05, (Math.random() - 0.5) * 0.023];
    this.spriteLayer = T('i_firework_rocket');
  }
  tick() {
    this.savePrev(); this.age++;
    this.vel[0] *= 1.15; this.vel[2] *= 1.15; this.vel[1] += 0.04;
    for (let i = 0; i < 3; i++) this.pos[i] += this.vel[i];
    if (this.age % 2 === 0) this.game.particles.spawn('smoke', this.pos[0], this.pos[1] - 0.3, this.pos[2], 0, -0.05, 0);
    if (this.age >= this.life || this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2]))) {
      this.dead = true;
      Sound.ev('entity.firework_rocket.blast', this.pos, 3, 1);
      for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), s = 0.3; this.game.particles.spawn('crit', ...this.pos, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s); }
    }
  }
}
// dye on a sheep
const _iuMobInteract = Mob.prototype.interact;
Mob.prototype.interact = function (p, held) {
  const k = held && ITEMS[held.id] ? ITEMS[held.id].key : '';
  if (this.type === 'sheep' && /_dye$/.test(k) && !this.sheared) {
    const c = DYE_COLORS.indexOf(k.replace(/_dye$/, ''));
    if (c >= 0 && this.woolColor !== c) {
      this.woolColor = c; Sound.ev('item.dye.use', this.pos, 1, 1);
      if (this.game.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      return true;
    }
  }
  return _iuMobInteract ? _iuMobInteract.call(this, p, held) : false;
};
// drops the block list doesn't give: kelp drops kelp, a creaking heart 1-3 resin clumps, mushroom blocks 0-2 mushrooms
for (const [k, fn] of [
  ['kelp', () => [['kelp', 1]]], ['kelp_plant', () => [['kelp', 1]]],
  ['creaking_heart', (m, r) => [['resin_clump', 1 + Math.floor(r() * 3)]]],
  ['brown_mushroom_block', (m, r) => [['brown_mushroom', Math.max(0, Math.floor(r() * 9) - 6)]]],
  ['red_mushroom_block', (m, r) => [['red_mushroom', Math.max(0, Math.floor(r() * 9) - 6)]]],
]) if (BID[k] !== undefined && (k !== 'creaking_heart' || ITEM_KEY.resin_clump !== undefined)) BLOCKS[BID[k]].drops = fn;

// ---- cakes (vanilla CakeBlock / CandleCakeBlock): right-clicked with anything (empty hand or not) a slice is eaten
// when the player can eat (hungry, or in creative): 2 food, 0.4 saturation, bites 0 -> 6 and then gone. An uneaten
// cake takes a candle; a candle cake is eaten like a whole cake and drops its candle, its lit candle is blown out by
// an empty hand clicking it (the upper half); flint and steel / a fire charge go on to light it
function eatCake(g, x, y, z, bites) {
  const p = g.player;
  if (!(p.creative || p.food < 20)) return false;
  p.food = Math.min(20, p.food + 2); p.saturation = Math.min(p.food, p.saturation + 2 * 0.1 * 2);
  const cake = BID.cake;
  if (bites < 6) g.world.setBlock(x, y, z, cake, Features.withProp(cake, 0, 'bites', String(bites + 1)));
  else g.world.setBlock(x, y, z, 0, 0);
  g.flushMesh && g.flushMesh();
  return true;
}
if (BID.cake !== undefined) BLOCKS[BID.cake].onUse = (g, x, y, z) => {
  const p = g.player, held = p.inv.held, k = keyOfStack(held), w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  const bites = +Features.propOf(id, m, 'bites') || 0;
  if (k && /^(.+_)?candle$/.test(k) && BID[k + '_cake'] !== undefined) {
    if (bites !== 0) return false;
    w.setBlock(x, y, z, BID[k + '_cake'], Features.withProp(BID[k + '_cake'], 0, 'lit', 'false'));
    if (g.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    Sound.ev('block.cake.add_candle', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
    return true;
  }
  return eatCake(g, x, y, z, bites);
};
for (const k in BID) if (/^(.+_)?candle_cake$/.test(k)) BLOCKS[BID[k]].onUse = (g, x, y, z, t) => {
  const p = g.player, held = p.inv.held, hk = keyOfStack(held), w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  if (hk === 'flint_and_steel' || hk === 'fire_charge') return false;
  if (!held && t && t.point && t.point[1] - y > 0.5 && Features.propOf(id, m, 'lit') === 'true') {
    w.setBlock(x, y, z, id, Features.withProp(id, m, 'lit', 'false'));
    Sound.ev('block.candle.extinguish', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
    return true;
  }
  if (!eatCake(g, x, y, z, 0)) return false;
  g.dropItem(x + 0.5, y + 0.5, z + 0.5, makeStack(BLOCKS[id].key.replace(/_cake$/, ''), 1));
  return true;
};
