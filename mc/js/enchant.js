'use strict';
// ---------------------------------------------------------------------------
// Enchantments in single player: vanilla 26.2's list (recipedata.js, from the jar's data/minecraft/enchantment:
// levels, weights, costs, which items, which exclude each other), what the enchanting table offers, the anvil and
// the grindstone, and the enchantments' effects. A stack keeps them as e: [[key, level], ...] (as on a server, net.js);
// rc is its anvil repair cost.
// ---------------------------------------------------------------------------
const ENCH = {}, ENCH_LIST = [];
for (const [key, max, weight, anvil, minC, maxC, sup, prim, ex, fl] of (self.RECIPE_DATA && RECIPE_DATA.enchantments) || []) {
  const E = { key, max, weight, anvil, minC, maxC, ex: new Set(ex), treasure: fl.includes('t'), curse: fl.includes('c'), table: fl.includes('e'), trade: fl.includes('r') };
  E.sup = new Set(itemIds(sup)); E.prim = prim ? new Set(itemIds(prim)) : E.sup;
  ENCH[key] = E; ENCH_LIST.push(E);
}
const enchMinCost = (E, l) => E.minC[0] + E.minC[1] * (l - 1);
const enchMaxCost = (E, l) => E.maxC[0] + E.maxC[1] * (l - 1);
const enchCompatible = (a, b) => a !== b && !ENCH[a].ex.has(b) && !ENCH[b].ex.has(a);
// the level of an enchantment on a stack (0 without it)
function enchLevel(stack, key) {
  if (!stack || !stack.e) return 0;
  for (const [k, l] of stack.e) if (k === key) return l;
  return 0;
}
// the highest level of it on the player's armour (or the held item) - what most effects use
function armorEnch(p, key, slots = [36, 37, 38, 39]) { let m = 0; for (const i of slots) m = Math.max(m, enchLevel(p.inv.slots[i], key)); return m; }
const heldEnch = (p, key) => enchLevel(p.inv && p.inv.held, key);
const isBook = (st) => st && ITEMS[st.id] && ITEMS[st.id].key === 'enchanted_book';
function sameEnchants(a, b) {
  const x = a.e || [], y = b.e || [];
  return x.length === y.length && x.every(([k, l]) => enchLevel(b, k) === l);
}

// ---- the enchanting table (EnchantmentMenu / EnchantmentHelper) ----
// a seeded random like java.util.Random, so the same table and item show the same offers until one is taken
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, this.s >> BigInt(48 - bits))); }
  nextInt(n) {
    if ((n & -n) === n) return Number((BigInt(n) * BigInt(this.next(31))) >> 31n);
    let b, v; do { b = this.next(31); v = b % n; } while (b - v + (n - 1) < 0 || b - v + (n - 1) > 2147483647); return v;
  }
  nextFloat() { return this.next(24) / (1 << 24); }
}
// the cost shown on each of the three slots
function enchantCost(rand, slot, shelves, ench) {
  if (ench <= 0) return 0;
  shelves = Math.min(shelves, 15);
  const i = rand.nextInt(8) + 1 + (shelves >> 1) + rand.nextInt(shelves + 1);
  return slot === 0 ? Math.max(Math.floor(i / 3), 1) : slot === 1 ? Math.floor(i * 2 / 3) + 1 : Math.max(i, shelves * 2);
}
// the enchantments a level gives (getAvailableEnchantmentResults + selectEnchantment)
function availableEnchants(level, id, treasure) {
  const book = ITEMS[id].key === 'book', out = [];
  for (const E of ENCH_LIST) {
    if (!treasure && (!E.table || E.treasure)) continue; // the table: only its own; loot may give any
    if (!book && !E.prim.has(id)) continue;
    for (let l = E.max; l >= 1; l--) if (level >= enchMinCost(E, l) && level <= enchMaxCost(E, l)) { out.push([E.key, l]); break; }
  }
  return out;
}
function weightedPick(rand, list) {
  let t = 0; for (const [k] of list) t += ENCH[k].weight;
  let r = rand.nextInt(t);
  for (const x of list) { r -= ENCH[x[0]].weight; if (r < 0) return x; }
  return list[0];
}
function selectEnchants(rand, id, level, treasure = false) {
  const e = ITEMS[id].enchantability || (ITEMS[id].key === 'book' ? 1 : 0), out = [];
  if (e <= 0) return out;
  level += 1 + rand.nextInt((e >> 2) + 1) + rand.nextInt((e >> 2) + 1);
  const f = (rand.nextFloat() + rand.nextFloat() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * f));
  let list = availableEnchants(level, id, treasure);
  if (!list.length) return out;
  out.push(weightedPick(rand, list));
  while (rand.nextInt(50) <= level) {
    const last = out[out.length - 1][0];
    list = list.filter(([k]) => enchCompatible(k, last) && !out.some(([o]) => o === k));
    if (!list.length) break;
    out.push(weightedPick(rand, list));
    level = Math.floor(level / 2);
  }
  return out;
}
// the three offers for an item with this many bookshelves: [{ cost, clue: [key, level], list }]
function enchantOffers(stack, shelves, seed) {
  if (!stack || stack.e && stack.e.length) return [];
  const def = ITEMS[stack.id];
  if (!(def.enchantability > 0 || def.key === 'book')) return [];
  const r = new JRandom(seed), costs = [0, 1, 2].map(i => enchantCost(r, i, shelves, def.enchantability || 1));
  return costs.map((c, i) => {
    if (c < i + 1) return null;
    const rr = new JRandom(seed + i), list = selectEnchants(rr, stack.id, c);
    if (def.key === 'book' && list.length > 1) list.splice(rr.nextInt(list.length), 1);
    // the hint: one of them, drawn by the same random (vanilla reuses the menu's seeded random)
    return list.length ? { cost: c, clue: list[rr.nextInt(list.length)], list } : null;
  });
}
// bookshelves around a table: two blocks away, on its level or one up, with air (or anything see-through) between
function countBookshelves(world, x, y, z) {
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
    for (let dy = 0; dy <= 1; dy++) {
      if (world.getBlock(x + dx, y + dy, z + dz) !== BID.bookshelf) continue;
      const m = world.getBlock(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2));
      if (!m || REPLACEABLE[m]) n++;
    }
  }
  return n;
}

// ---- the anvil (AnvilMenu.createResult): repair, combine, rename; the cost in levels (40 and over: too expensive) ----
function anvilResult(left, right, name, creative) {
  if (!left) return null;
  const def = ITEMS[left.id], out = { ...left, e: left.e ? left.e.map(x => [...x]) : undefined };
  let cost = 0, renameCost = 0, used = 0;
  const base = (left.rc || 0) + (right ? right.rc || 0 : 0);
  if (right) {
    const book = isBook(right);
    const repairs = def.durability && def.repair && itemIds(def.repair).includes(right.id);
    if (repairs) {
      let l = Math.min(left.dmg || 0, Math.floor(def.durability / 4));
      if (l <= 0) return null;
      let m = 0;
      for (; l > 0 && m < right.count; m++) { out.dmg -= l; cost++; l = Math.min(out.dmg, Math.floor(def.durability / 4)); }
      used = m;
    } else {
      if (!book && (right.id !== left.id || !def.durability) && !(isBook(left) && book)) return null;
      if (def.durability && !book) {
        const k = def.durability - (left.dmg || 0), l = def.durability - (right.dmg || 0) + Math.floor(def.durability * 12 / 100);
        const o = Math.max(0, def.durability - (k + l));
        if (o < (out.dmg || 0)) { out.dmg = o; cost += 2; }
      }
      let some = false, bad = false;
      for (const [k, l2] of right.e || []) {
        const E = ENCH[k]; if (!E) continue;
        const l1 = enchLevel(out, k);
        let lvl = l1 === l2 ? l2 + 1 : Math.max(l1, l2);
        let ok = creative || isBook(left) || E.sup.has(left.id);
        for (const [o] of out.e || []) if (o !== k && !enchCompatible(o, k)) { ok = false; cost++; }
        if (!ok) { bad = true; continue; }
        some = true;
        lvl = Math.min(lvl, E.max);
        out.e = (out.e || []).filter(([o]) => o !== k); out.e.push([k, lvl]);
        let c = E.anvil; if (book) c = Math.max(1, c >> 1);
        cost += c * lvl;
        if (left.count > 1) cost = 40;
      }
      if (bad && !some) return null;
    }
  }
  if (name !== undefined && name !== null) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== (left.name || def.cn)) { renameCost = 1; cost += 1; out.name = trimmed; }
    else if (!trimmed && left.name) { renameCost = 1; cost += 1; delete out.name; }
  }
  if (cost <= 0) return null;
  let total = base + cost;
  if (renameCost === cost && renameCost > 0 && total >= 40) total = 39;
  if (total >= 40 && !creative) return { tooExpensive: true, cost: total };
  if (out.e && !out.e.length) delete out.e;
  let rc = Math.max(out.rc || 0, right ? right.rc || 0 : 0);
  if (renameCost !== cost || renameCost === 0) rc = rc * 2 + 1;
  out.rc = rc;
  return { stack: out, cost: total, used };
}

// ---- the grindstone: takes the enchantments off (not curses) and gives some of their experience back; two of the
// same item are combined (5% bonus durability) ----
function grindstoneResult(a, b) {
  if (!a && !b) return null;
  if (a && b) {
    if (a.id !== b.id || !ITEMS[a.id].durability || a.count > 1 || b.count > 1) return null;
    const D = ITEMS[a.id].durability, dur = (D - (a.dmg || 0)) + (D - (b.dmg || 0)) + Math.floor(D * 5 / 100);
    const out = { id: a.id, count: 1, dmg: Math.max(0, D - dur) };
    const curses = [...(a.e || []), ...(b.e || [])].filter(([k]) => ENCH[k] && ENCH[k].curse);
    const e = []; for (const [k, l] of curses) if (!e.some(([o]) => o === k)) e.push([k, l]);
    if (e.length) out.e = e;
    return finishGrind(out);
  }
  const s = a || b;
  if (!s.e || !s.e.some(([k]) => ENCH[k] && !ENCH[k].curse)) return null;
  const out = { ...s, count: 1, e: s.e.filter(([k]) => ENCH[k] && ENCH[k].curse) };
  if (isBook(s) && !out.e.length) { out.id = ITEM_KEY.book; delete out.e; }
  if (out.e && !out.e.length) delete out.e;
  return finishGrind(out);
}
function finishGrind(out) {
  let rc = 0; for (let i = 0; i < (out.e || []).length; i++) rc = rc * 2 + 1;
  if (rc) out.rc = rc; else delete out.rc;
  return out;
}
// the experience a grindstone gives back for what it took off
function grindstoneXp(...stacks) {
  let n = 0;
  for (const s of stacks) if (s) for (const [k, l] of s.e || []) if (ENCH[k] && !ENCH[k].curse) n += enchMinCost(ENCH[k], l);
  if (!n) return 0;
  const h = Math.ceil(n / 2);
  return h + Math.floor(Math.random() * h);
}

// ---- effects ----
// unbreaking: tools take damage only 1 in (level + 1) times; armour 60% + 40% / (level + 1) of the times
function unbreakingSkips(stack, armor) {
  const u = enchLevel(stack, 'unbreaking'); if (!u) return false;
  return armor ? Math.random() >= 0.6 + 0.4 / (u + 1) : Math.random() >= 1 / (u + 1);
}
// the protection enchantments' total against a damage (EPF, at most 20; each point takes 4% off)
function protectionPoints(p, src) {
  const t = src && src.type;
  if (t === 'void' || t === 'starve') return 0;
  let n = 0;
  for (let i = 36; i < 40; i++) {
    const s = p.inv.slots[i]; if (!s || !s.e) continue;
    for (const [k, l] of s.e) {
      if (k === 'protection') n += l;
      else if (k === 'fire_protection' && (t === 'fire' || t === 'lava' || t === 'fireball' || t === 'hotFloor')) n += 2 * l;
      else if (k === 'blast_protection' && t === 'explosion') n += 2 * l;
      else if (k === 'projectile_protection' && (t === 'arrow' || t === 'fireball' || t === 'trident')) n += 2 * l;
      else if (k === 'feather_falling' && t === 'fall') n += 3 * l;
    }
  }
  return Math.min(n, 20);
}
// the extra melee damage of the held weapon's enchantments against a mob
const UNDEAD = new Set(['zombie', 'skeleton', 'zombified_piglin', 'wither_skeleton', 'husk', 'stray', 'drowned', 'zombie_villager', 'phantom', 'wither', 'zoglin', 'skeleton_horse', 'zombie_horse', 'bogged']);
const ARTHROPOD = new Set(['spider', 'cave_spider', 'bee', 'silverfish', 'endermite']);
function enchantAttackBonus(stack, e) {
  let b = 0; const t = e && e.type;
  const sh = enchLevel(stack, 'sharpness'); if (sh) b += 0.5 * sh + 0.5;
  const sm = enchLevel(stack, 'smite'); if (sm && UNDEAD.has(t)) b += 2.5 * sm;
  const ba = enchLevel(stack, 'bane_of_arthropods'); if (ba && ARTHROPOD.has(t)) b += 2.5 * ba;
  return b;
}
// fortune: an ore's drops multiplied by 1 to level + 1 (vanilla's ore_drops formula)
function fortuneCount(n, lvl) {
  if (!lvl) return n;
  const bonus = Math.max(0, Math.floor(Math.random() * (lvl + 2)) - 1);
  return n * (bonus + 1);
}
// silk touch takes these as they are (others than this list drop themselves when they have an item)
const NO_SILK = new Set(['spawner', 'budding_amethyst', 'reinforced_deepslate', 'farmland', 'dirt_path', 'frosted_ice', 'trial_spawner', 'vault']);

// ---- creative: enchanted books of every enchantment and level (vanilla's ingredients tab) ----
const _ctItems = creativeTabItems;
creativeTabItems = function (tab) {
  const c = creativeTabItems.cache || (creativeTabItems.cache = {});
  if (!c[tab]) {
    c[tab] = _ctItems.call(this, tab);
    if (tab === 'ingredients') {
      const i = c[tab].indexOf('enchanted_book');
      if (i >= 0) c[tab].splice(i, 1, ...ENCH_LIST.flatMap(E => Array.from({ length: E.max }, (_, l) => ({ key: 'enchanted_book', e: [[E.key, l + 1]] }))));
    }
  }
  return c[tab];
};

// ---- the enchantments that move the player, and frost walker (26.2's enchantment data) ----
// soul speed (boots): on soul sand / soul soil (and in the air after leaving it) 0.0405 + 0.0105 a level faster and the
// sand no longer slows; wears the boots (4% a tick) and throws up souls while running
const SOUL_SPEED_BLOCKS = new Set(['soul_sand', 'soul_soil']);
Player.prototype.speedBonus = function () {
  const l = enchLevel(this.inv.slots[39], 'soul_speed');
  if (!l || this.vehicle || this.flying) { this.soulSpeedOn = false; return 0; }
  const below = BLOCKS[this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.5), Math.floor(this.pos[2]))];
  this.soulSpeedOn = this.onGround ? !!(below && SOUL_SPEED_BLOCKS.has(below.key)) : !!this.soulSpeedOn;
  return this.soulSpeedOn ? 0.0405 + 0.0105 * (l - 1) : 0;
};
// swift sneak (leggings): sneaking at 0.3 + 0.15 a level of the walking speed
Player.prototype.sneakSpeed = function () { return Math.min(1, 0.3 + 0.15 * enchLevel(this.inv.slots[38], 'swift_sneak')); };
// depth strider (boots): a third of the way to walking speed in water a level
Player.prototype.waterEfficiency = function () { return Math.min(1, enchLevel(this.inv.slots[39], 'depth_strider') / 3); };
(() => {
  const _tick = Player.prototype.tick;
  Player.prototype.tick = function (input) {
    const r = _tick.call(this, input), g = this.game;
    if (g.net || this.deathTime > 0) return r;
    const boots = this.inv.slots[39];
    // soul speed's wear and souls
    if (this.soulSpeedOn && this.onGround && boots && (Math.abs(this.pos[0] - this.prev[0]) + Math.abs(this.pos[2] - this.prev[2]) > 0.01)) {
      if (Math.random() < 0.04 && !this.creative && ITEMS[boots.id].durability && !unbreakingSkips(boots, true)) {
        boots.dmg = (boots.dmg || 0) + 1;
        if (boots.dmg >= ITEMS[boots.id].durability) { this.inv.slots[39] = null; Sound.block('break', 'metal', this.pos); }
      }
      if (Math.random() < 0.3) { g.particles.spawn('soul', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + 0.1, this.pos[2] + (Math.random() - 0.5) * this.w, -this.vel[0] * 0.2, 0.1, -this.vel[2] * 0.2); Sound.ev('particle.soul_escape', this.pos, 0.6 + Math.random() * 0.4, 0.6 + Math.random() * 0.4); }
    }
    // frost walker (boots): standing on the ground, the still water round the feet (radius 2 + level) freezes to frosted ice
    const fw = enchLevel(boots, 'frost_walker');
    if (fw && this.onGround && !this.vehicle && (this.pos[0] !== this.prev[0] || this.pos[2] !== this.prev[2])) {
      const w = this.world, R = Math.min(16, 3 + (fw - 1)), y = Math.floor(this.pos[1]) - 1, cx = Math.floor(this.pos[0]), cz = Math.floor(this.pos[2]);
      const ice = BID.frosted_ice;
      if (ice !== undefined) for (let x = cx - R; x <= cx + R; x++) for (let z = cz - R; z <= cz + R; z++) {
        if ((x + 0.5 - this.pos[0]) ** 2 + (z + 0.5 - this.pos[2]) ** 2 >= R * R) continue;
        if (w.getBlock(x, y + 1, z) !== 0 || w.getBlock(x, y, z) !== WATER || w.getMeta(x, y, z) !== 0 || (w.isWaterlogged && w.isWaterlogged(x, y, z))) continue;
        if (g.entities.some((e) => e instanceof Living && !e.dead && Math.floor(e.pos[0]) === x && Math.floor(e.pos[2]) === z && Math.floor(e.pos[1]) === y)) continue;
        w.setBlock(x, y, z, ice, 0);
        (g.frostedIce || (g.frostedIce = new Map())).set(`${x},${y},${z}`, g.tickCount + randInt(60, 120));
      }
    }
    return r;
  };
  // frost walker's boots keep magma blocks from burning (damage_immunity: burn_from_stepping)
  const _hurt = Player.prototype.hurt;
  Player.prototype.hurt = function (a, src) {
    if (src && src.type === 'hotFloor' && enchLevel(this.inv.slots[39], 'frost_walker')) return false;
    return _hurt.call(this, a, src);
  };
  // frosted ice (vanilla FrostedIceBlock): every 1-2 seconds a 1 in 3 chance (always with fewer than 4 frosted
  // neighbours) of ageing when it is light enough; past age 3 it melts back to water
  const _gt = Game.prototype.tick;
  Game.prototype.tick = function () {
    const r = _gt.call(this), fi = this.frostedIce;
    if (!fi || !fi.size || this.net || this.state !== 'play' || (this.ui.screen && this.ui.screen.pauses)) return r;
    const w = this.world, ice = BID.frosted_ice;
    for (const [k, t] of fi) {
      if (t > this.tickCount) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (w.getBlock(x, y, z) !== ice) { fi.delete(k); continue; }
      let near = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getBlock(x + dx, y, z + dz) === ice) near++;
      const age = +(Features.propOf(ice, w.getMeta(x, y, z), 'age') || 0), l = w.getLight(x, y + 1, z);
      const bright = Math.max(l & 15, (l >> 4) - (this.daylight ? Math.round((1 - this.daylight()) * 11) : 0));
      if ((randInt(0, 2) === 0 || near < 4) && bright > 11 - age - 1) {
        if (age < 3) { w.setBlock(x, y, z, ice, Features.withProp(ice, w.getMeta(x, y, z), 'age', String(age + 1))); fi.set(k, this.tickCount + randInt(20, 40)); }
        else { w.setBlock(x, y, z, WATER, 0); fi.delete(k); }
      } else fi.set(k, this.tickCount + randInt(20, 40));
    }
    return r;
  };
})();

// ---- the sword's sweep (vanilla Player.attack): a full-strength hit on the ground, not sprinting or critting and
// barely moving also hits everything else within a block of the target (and 3 blocks of the player) for
// 1 + sweeping ratio x the damage (sweeping edge: level / (level + 1)), knocking it back a little ----
(() => {
  const _attack = Game.prototype.attack;
  Game.prototype.attack = function (e) {
    const p = this.player, held = p.inv.held, def = held && ITEMS[held.id];
    const sword = !!(def && def.tool && def.tool.type === 'sword');
    const str = this.attackStrength(), moved = Math.hypot(p.pos[0] - p.prev[0], p.pos[2] - p.prev[2]);
    const crit = str > 0.9 && p.vel[1] < -0.05 && !p.onGround && !p.inWater;
    const sweep = sword && str > 0.9 && !crit && !p.sprinting && p.onGround && moved < 0.1 && !this.net && e instanceof Living;
    const base = Math.max(0, (def && def.attack ? def.attack : 1) + effectAttackBonus(p)) * (0.2 + str * str * 0.8);
    const r = _attack.call(this, e);
    if (!sweep) return r;
    const se = enchLevel(held, 'sweeping_edge'), dmg = 1 + (se / (se + 1)) * base, b = e.box();
    for (const o of this.entities) {
      if (o === e || o === p || !(o instanceof Living) || o.dead || o.deathTime > 0 || o.isVehicle) continue;
      if (o.owner === p) continue; // (vanilla isAlliedTo: one's own pets)
      const ob = o.box();
      if (ob[3] < b[0] - 1 || ob[0] > b[3] + 1 || ob[4] < b[1] - 0.25 || ob[1] > b[4] + 0.25 || ob[5] < b[2] - 1 || ob[2] > b[5] + 1) continue;
      if ((o.pos[0] - p.pos[0]) ** 2 + (o.pos[1] - p.pos[1]) ** 2 + (o.pos[2] - p.pos[2]) ** 2 >= 9) continue;
      o.hurt(dmg + enchantAttackBonus(held, o) * str, { type: 'player', attacker: p, player: true, knockFrom: p.pos, knock: 0.4, looting: heldEnch(p, 'looting') });
    }
    Sound.ev('entity.player.attack.sweep', p.pos, 1, 1);
    this.particles.spawn('sweep', p.pos[0] - Math.sin(p.yaw), p.pos[1] + p.eye() * 0.5, p.pos[2] - Math.cos(p.yaw), 0, 0, 0);
    return r;
  };
})();
