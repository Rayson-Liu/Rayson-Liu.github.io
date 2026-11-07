'use strict';
// ---------------------------------------------------------------------------
// Main-thread side of the vanilla structures (the worker places the blocks, see structgen.js):
// block entities with loot tables, template entities, structure references for /locate, and the
// vanilla loot-table evaluator used to fill structure chests.
// ---------------------------------------------------------------------------
const Loot = (function () {
  const strip = (s) => (typeof s === 'string' ? s.replace('minecraft:', '') : s);
  const num = (p, r) => {
    if (p === undefined) return 1;
    if (typeof p === 'number') return p;
    const t = strip(p.type || 'uniform');
    if (t === 'constant') return p.value;
    if (t === 'uniform') return num(p.min, r) + r() * (num(p.max, r) - num(p.min, r));
    if (t === 'binomial') { let n = 0; const k = num(p.n, r), q = num(p.p, r); for (let i = 0; i < k; i++) if (r() < q) n++; return n; }
    return 1;
  };
  const condOk = (conds, r) => !conds || conds.every((c) => {
    const t = strip(c.condition);
    if (t === 'random_chance') return r() < (typeof c.chance === 'number' ? c.chance : num(c.chance, r));
    if (t === 'inverted') return !condOk([c.term], r);
    return true;
  });
  const itemId = (k) => { k = strip(k); return ITEM_KEY[k] !== undefined ? ITEM_KEY[k] : BID[k] !== undefined && ITEMS[BID[k]] ? BID[k] : null; };
  function applyFns(stack, fns, r) {
    for (const f of fns || []) {
      if (!condOk(f.conditions, r)) continue;
      const t = strip(f.function);
      if (t === 'set_count') stack.count = Math.max(0, Math.floor(f.add ? stack.count + num(f.count, r) : num(f.count, r)));
      else if (t === 'set_damage' && ITEMS[stack.id] && ITEMS[stack.id].durability) stack.dmg = Math.floor(ITEMS[stack.id].durability * (1 - num(f.damage, r)));
    }
    return stack;
  }
  function expand(entry, r, out) {
    if (!condOk(entry.conditions, r)) return false;
    const t = strip(entry.type);
    switch (t) {
      case 'item': {
        const id = itemId(entry.name);
        if (id !== null) { const s = applyFns({ id, count: 1, dmg: 0 }, entry.functions, r); if (s.count > 0) out.push(s); }
        return true;
      }
      case 'empty': return true;
      case 'loot_table': { const v = typeof entry.value === 'string' ? strip(entry.value) : null; if (v) out.push(...roll(v, r)); return true; }
      case 'alternatives': for (const c of entry.children || []) if (expand(c, r, out)) return true; return false;
      case 'group': for (const c of entry.children || []) expand(c, r, out); return true;
      case 'sequence': for (const c of entry.children || []) if (!expand(c, r, out)) return false; return true;
    }
    return true;
  }
  function roll(name, r) {
    const T = self.STRUCT_DATA && self.STRUCT_DATA.loot[strip(name)];
    const out = [];
    if (!T) return out;
    for (const pool of T.pools || []) {
      if (!condOk(pool.conditions, r)) continue;
      const n = Math.floor(num(pool.rolls, r));
      for (let i = 0; i < n; i++) {
        const ents = pool.entries.filter((e) => condOk(e.conditions, () => 0.5));
        let tot = 0; for (const e of ents) tot += e.weight ?? 1;
        if (!tot) continue;
        let k = r() * tot, pick = ents[0];
        for (const e of ents) { k -= e.weight ?? 1; if (k < 0) { pick = e; break; } }
        const got = [];
        expand(pick, r, got);
        for (const s of got) out.push(applyFns(s, pool.functions, r));
      }
    }
    for (const s of out) applyFns(s, T.functions, r);
    return out.filter((s) => s.count > 0);
  }
  // LootTable.fill: split stacks over random empty slots
  function fill(slots, name, r) {
    const items = roll(name, r);
    const empty = [];
    for (let i = 0; i < slots.length; i++) if (!slots[i]) empty.push(i);
    for (let i = empty.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [empty[i], empty[j]] = [empty[j], empty[i]]; }
    const list = [];
    for (const s of items) { const max = maxStack(s.id); while (s.count > max) { list.push({ ...s, count: max }); s.count -= max; } list.push(s); }
    while (list.length < empty.length) {
      const big = list.filter((s) => s.count > 1);
      if (!big.length) break;
      const s = big[Math.floor(r() * big.length)], k = 1 + Math.floor(r() * (s.count / 2));
      s.count -= k; list.push({ ...s, count: k });
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    for (const s of list) { if (!empty.length) break; slots[empty.pop()] = s; }
  }
  return { roll, fill };
})();

// block entities / entities / references the worker reported for a finished chunk
Game.prototype.structureExtras = function (ch, saved) {
  const w = this.world, sx = ch.sx, minY = w.minY || 0;
  ch.sx = null;
  if (saved) return;
  for (const [x, vy, z, type, data] of sx.loot) {
    const y = vy - minY, ci = (y << 8) | ((z & 15) << 4) | (x & 15), id = ch.getB(ci), b = BLOCKS[id];
    if (!b) continue;
    if (type === 'loot' && (b.key === 'chest' || b.key === 'barrel' || b.key === 'trapped_chest')) {
      const k = `${x},${y},${z}`;
      if (!this.blockEntities.has(k)) this.blockEntities.set(k, { type: 'chest', pos: [x, y, z], slots: new Array(27).fill(null), loot: data });
      if (b.key === 'chest') ch.setM(ci, ch.getM(ci) | 8);
    }
  }
  // the chunk is saved from now on, so its structure mobs are not spawned again when it reloads
  if (sx.ent.length) ch.modified = true;
  for (const [x, vy, z, type, data] of sx.ent) {
    if (!MOB_TYPES[type]) continue;
    const m = createMob(this, type, x, vy - minY, z);
    if (!m) continue;
    m.persistent = true;
    if (data && data.profession) m.profession = data.profession;
    if (data && data.type) m.vtype = data.type;
    this.entities.push(m);
  }
};
// structure-feature elements (village decorations, ...) for one chunk, placed in its decoration step
Game.prototype.structureFeatures = function (ch, ctx, rand, place) {
  if (!ch.sx || !ch.sx.feat) return;
  for (const [x, y, z, f] of ch.sx.feat) place(ctx, f, rand, [x, y, z], f);
};
// nearest structure of a kind (from the references seen so far)
Game.prototype.nearestStructure = function (kind, x, z) {
  let best = null, bd = Infinity;
  for (const r of (this.world.structRefs || new Map()).values()) {
    if (kind && !r.name.startsWith(kind)) continue;
    const cx = (r.box[0] + r.box[3]) / 2, cz = (r.box[2] + r.box[5]) / 2, d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = { name: r.name, x: Math.round(cx), z: Math.round(cz), d }; }
  }
  return best;
};
