'use strict';
// ---------------------------------------------------------------------------
// Vanilla's special crafting recipes (the ones without a recipe file): shield decoration, banner and book
// copying, firework stars and their fade colours, firework rockets with stars, tipped arrows, dyed leather;
// shields drawn with their banner patterns; decorated pots with their sherds on the four sides; firework
// explosions in their stars' colours.
// ---------------------------------------------------------------------------
const STAR_SHAPE = { fire_charge: 'large_ball', gold_nugget: 'star', feather: 'burst' };
const isHead = (k) => /_(head|skull)$/.test(k);
const DYE_RGB_ARR = (c) => { const v = DYE_RGB[c] || 0xffffff; return v; };
// the special recipe for a grid, or null: { result, keep: grid index left in place }
function specialRecipe(grid) {
  const items = grid.map((s, i) => s ? { s, i, k: ITEMS[s.id] ? ITEMS[s.id].key : '' } : null).filter(Boolean);
  if (!items.length) return null;
  const by = (re) => items.filter(o => re.test(o.k));
  const dyes = by(/_dye$/);
  // shield + banner: the shield takes the banner's colour and patterns
  if (items.length === 2) {
    const sh = items.find(o => o.k === 'shield'), bn = items.find(o => /_banner$/.test(o.k));
    if (sh && bn && !sh.s.base) return { result: { ...sh.s, count: 1, base: bn.k.replace(/_banner$/, ''), patterns: (bn.s.patterns || []).map(p => [...p]) } };
    // banner copy: a patterned banner and a blank one of the same colour
    const bs = by(/_banner$/);
    if (bs.length === 2 && bs[0].k === bs[1].k) { const src = bs.find(o => o.s.patterns && o.s.patterns.length), blank = bs.find(o => !(o.s.patterns && o.s.patterns.length)); if (src && blank) return { result: { ...src.s, count: 1 }, keep: src.i }; }
  }
  // book copying: a written book (original or copy) and books and quills
  const wb = items.find(o => o.k === 'written_book'), wq = by(/^writable_book$/);
  if (wb && wq.length && wq.length + 1 === items.length && (wb.s.gen | 0) < 2) return { result: { ...wb.s, count: wq.length, gen: (wb.s.gen | 0) + 1 }, keep: wb.i };
  // filled map copying: a map and empty maps
  const fm = items.find(o => o.k === 'filled_map'), em = by(/^map$/);
  if (fm && em.length && em.length + 1 === items.length) return { result: { ...fm.s, count: em.length + 1 } };
  // tipped arrows: eight arrows round a lingering potion
  if (items.length === 9 && items[4].k === 'lingering_potion' && items.filter(o => o.k === 'arrow').length === 8) return { result: { ...makeStack('tipped_arrow', 8), pot: grid[4].pot } };
  // firework star: gunpowder, dyes, maybe a shape, a diamond (trail) and glowstone dust (twinkle)
  const gp = by(/^gunpowder$/);
  if (gp.length === 1 && dyes.length && !items.some(o => o.k === 'paper' || o.k === 'firework_star')) {
    const shapeIt = items.filter(o => STAR_SHAPE[o.k] || isHead(o.k));
    const rest = items.filter(o => !/_dye$/.test(o.k) && o.k !== 'gunpowder' && !STAR_SHAPE[o.k] && !isHead(o.k) && o.k !== 'diamond' && o.k !== 'glowstone_dust');
    if (shapeIt.length <= 1 && !rest.length && by(/^diamond$/).length <= 1 && by(/^glowstone_dust$/).length <= 1) {
      const sk = shapeIt[0] ? (STAR_SHAPE[shapeIt[0].k] || 'creeper') : 'small_ball';
      return { result: { ...makeStack('firework_star', 1), fw: { shape: sk, colors: dyes.map(o => o.k.replace(/_dye$/, '')), fade: [], trail: !!by(/^diamond$/).length, twinkle: !!by(/^glowstone_dust$/).length } } };
    }
  }
  // fade colours on a star
  const fs = items.filter(o => o.k === 'firework_star');
  if (fs.length === 1 && dyes.length && dyes.length + 1 === items.length && fs[0].s.fw) return { result: { ...fs[0].s, count: 1, fw: { ...fs[0].s.fw, fade: dyes.map(o => o.k.replace(/_dye$/, '')) } } };
  // rocket: paper, 1-3 gunpowder, any stars
  const pp = by(/^paper$/);
  if (pp.length === 1 && gp.length >= 1 && gp.length <= 3 && pp.length + gp.length + fs.length === items.length) return { result: { ...makeStack('firework_rocket', 3), flight: gp.length, explosions: fs.map(o => o.s.fw).filter(Boolean) } };
  // dyed leather (armour, horse armour, wolf armour): the colours averaged like vanilla
  const lt = items.filter(o => /^leather_(helmet|chestplate|leggings|boots|horse_armor)$|^wolf_armor$/.test(o.k));
  if (lt.length === 1 && dyes.length && dyes.length + 1 === items.length) {
    const cols = dyes.map(o => DYE_RGB_ARR(o.k.replace(/_dye$/, '')));
    if (lt[0].s.color != null) cols.push(lt[0].s.color);
    let r = 0, g = 0, b = 0, mx = 0;
    for (const c of cols) { const cr = c >> 16 & 255, cg = c >> 8 & 255, cb = c & 255; mx += Math.max(cr, cg, cb); r += cr; g += cg; b += cb; }
    const n = cols.length; r /= n; g /= n; b /= n; const avgMax = mx / n, cur = Math.max(r, g, b) || 1;
    r = r * avgMax / cur; g = g * avgMax / cur; b = b * avgMax / cur;
    return { result: { ...lt[0].s, count: 1, color: (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b) } };
  }
  return null;
}
(() => {
  const _ch = CraftingScreen.prototype.changed;
  CraftingScreen.prototype.changed = function () {
    _ch.call(this); this.specialKeep = null;
    if (this.result && !this.result.unk) {
      // a decorated pot keeps its sherds
      if (ITEMS[this.result.id].key === 'decorated_pot') { const at = (i) => this.grid[i] && ITEMS[this.grid[i].id].key; const s = this.size === 3 ? [at(1), at(3), at(5), at(7)] : null; if (s && s.some(k => k && /_pottery_sherd$/.test(k))) this.result = { ...this.result, sherds: s.map(k => k && /_pottery_sherd$/.test(k) ? k : 'brick') }; }
      return;
    }
    const sp = specialRecipe(this.grid);
    if (sp) { this.result = sp.result; if (sp.keep !== undefined) this.specialKeep = [sp.keep, { ...this.grid[sp.keep] }]; }
  };
  const _co = CraftingScreen.prototype.consume;
  CraftingScreen.prototype.consume = function () {
    const keep = this.specialKeep;
    _co.call(this);
    if (keep && !this.grid[keep[0]]) { this.grid[keep[0]] = keep[1]; this.changed(); }
    else if (keep && this.grid[keep[0]] && sameKind(this.grid[keep[0]], keep[1])) { this.grid[keep[0]].count++; this.changed(); }
  };
  const _il = UI.prototype.itemLines;
  UI.prototype.itemLines = function (st) {
    const lines = _il.call(this, st);
    const shapeCn = { small_ball: '小型球状', large_ball: '大型球状', star: '星形', creeper: '苦力怕状', burst: '爆裂状' };
    const fwLines = (fw, ind) => { lines.push({ text: ind + (shapeCn[fw.shape] || fw.shape), color: '#AAAAAA' }); if (fw.colors && fw.colors.length) lines.push({ text: ind + ' ' + fw.colors.map(c => zhT('item.minecraft.firework_star.' + c, c)).join('、'), color: '#AAAAAA' }); if (fw.fade && fw.fade.length) lines.push({ text: ind + ' 淡化成' + fw.fade.map(c => zhT('item.minecraft.firework_star.' + c, c)).join('、'), color: '#AAAAAA' }); if (fw.trail) lines.push({ text: ind + ' 踪迹', color: '#AAAAAA' }); if (fw.twinkle) lines.push({ text: ind + ' 闪烁', color: '#AAAAAA' }); };
    if (st.fw) fwLines(st.fw, '');
    if (st.flight) { lines.push({ text: '飞行时间：' + st.flight, color: '#AAAAAA' }); for (const e of st.explosions || []) fwLines(e, '  '); }
    if (st.color != null && ITEMS[st.id] && /leather|wolf_armor/.test(ITEMS[st.id].key)) lines.push({ text: '已染色', color: '#AAAAAA' });
    if (st.sherds) for (const s of st.sherds) lines.push({ text: ITEMS[ITEM_KEY[s]] ? ITEMS[ITEM_KEY[s]].cn : s, color: '#AAAAAA' });
    return lines;
  };
})();
// firework rockets burst in their stars' colours (and shapes, roughly)
(() => {
  if (typeof FireworkRocket === 'undefined') return;
  const _ctor = FireworkRocket.prototype.tick;
  FireworkRocket.prototype.tick = function () {
    const wasDead = this.dead;
    const ex = this.stackRef && this.stackRef.explosions;
    if (ex && ex.length && !wasDead && (this.age + 1 >= this.life || this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2])))) {
      this.dead = true; Sound.ev(ex.some(e => e.shape === 'large_ball') ? 'entity.firework_rocket.large_blast' : 'entity.firework_rocket.blast', this.pos, 3, 1);
      for (const e of ex) {
        const cols = (e.colors || ['white']).map(c => { const v = DYE_RGB[c] || 0xffffff; return [v >> 16 & 255, v >> 8 & 255, v & 255]; });
        const n = e.shape === 'large_ball' ? 120 : 60, s = e.shape === 'large_ball' ? 0.5 : 0.25;
        for (let i = 0; i < n; i++) {
          let a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), k = s;
          if (e.shape === 'star' && i % 2) k *= 0.5;
          const pt = this.game.particles.spawn('glint', ...this.pos, Math.sin(b) * Math.cos(a) * k, Math.cos(b) * k, Math.sin(b) * Math.sin(a) * k);
          if (pt) { pt.col = cols[i % cols.length]; pt.life = 30 + Math.random() * 20; pt.size = 0.12; pt.grav = 0.003; }
        }
        if (e.twinkle) Sound.ev('entity.firework_rocket.twinkle', this.pos, 3, 1);
      }
      return;
    }
    return _ctor.call(this);
  };
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const held = this.player.inv.held, before = new Set(this.entities);
    const r = _use.call(this);
    if (held && ITEMS[held.id] && ITEMS[held.id].key === 'firework_rocket') for (const e of this.entities) if (e instanceof FireworkRocket && !before.has(e)) e.stackRef = { ...held };
    return r;
  };
})();
// shields show their banner (equip.js draws them with this texture)
function shieldTex(r, st) {
  if (st && (st.base || (st.patterns && st.patterns.length))) { const t = r.patternTex('shield', st.base || 'white', st.patterns); if (t) return t; }
  return r.beTex('shield_base');
}
// decorated pots: placed with their sherds, broken back into a pot with them, each side drawn with its pattern
(() => {
  const _pa = Game.prototype.placeAt;
  Game.prototype.placeAt = function (x, y, z, id, meta, held, ...rest) {
    const r = _pa.call(this, x, y, z, id, meta, held, ...rest);
    if (held && held.sherds && BLOCKS[this.world.getBlock(x, y, z)].key === 'decorated_pot') this.getBlockEntity(x, y, z, 'pot').sherds = [...held.sherds];
    return r;
  };
  const _db = Game.prototype.dropBlockLoot;
  Game.prototype.dropBlockLoot = function (x, y, z, id, meta, tool, ...rest) {
    const k = x + ',' + y + ',' + z, be = this.blockEntities.get(k);
    if (BLOCKS[id] && BLOCKS[id].key === 'decorated_pot' && be && be.sherds) {
      this.blockEntities.delete(k);
      // broken with a tool (not silk touch): the sherds come out; otherwise the pot drops whole
      if (tool && !enchLevel(tool, 'silk_touch')) { for (const s of be.sherds) this.dropItem(x + 0.5, y + 0.5, z + 0.5, makeStack(s === 'brick' ? 'brick' : s, 1)); }
      else { const st = makeStack('decorated_pot', 1); st.sherds = be.sherds; this.dropItem(x + 0.5, y + 0.5, z + 0.5, st); }
      Sound.ev('block.decorated_pot.shatter', [x + 0.5, y + 0.5, z + 0.5], 1, 1); return;
    }
    return _db.call(this, x, y, z, id, meta, tool, ...rest);
  };
  const _bp = beParts;
  beParts = function (r, b, m, x, y, z) {
    const parts = _bp(r, b, m, x, y, z);
    if (b.be !== 'decorated_pot') return parts;
    const be = window.game && game.blockEntities && game.blockEntities.get(x + ',' + y + ',' + z);
    if (!be || !be.sherds) return parts;
    if (!r.models.be_pot_side1) {
      const side = (ry) => ({ parts: [{ name: 's', pivot: [0, 0, 0], rotY: ry, boxes: [[1, 0, -7, 0, -7, 14, 16, 0]], mesh: r.makeModelPart([[1, 0, -7, 0, -7, 14, 16, 0]], 16, 16) }] });
      [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((ry, i) => { r.models['be_pot_side' + i] = side(ry); });
    }
    const out = parts.filter(p => p[0] !== 'be_pot_sides'), t = parts.find(p => p[0] === 'be_pot_sides');
    // vanilla's side order: back, left, right, front
    const order = [3, 0, 1, 2];
    be.sherds.forEach((s, i) => {
      const pat = s === 'brick' ? null : 'entity/decorated_pot/' + s.replace(/_pottery_sherd$/, '') + '_pottery_pattern';
      const tex = pat ? r.etex(pat) : 'decorated_pot_side';
      if (t) out.push(['be_pot_side' + order[i], tex || 'decorated_pot_side', t[2]]);
    });
    return out;
  };
})();
// the creative inventory lists every painting and every goat horn like vanilla
(() => {
  const _ct = creativeTabItems;
  creativeTabItems = function (tab) {
    const c = creativeTabItems.cache || (creativeTabItems.cache = {});
    if (c[tab]) return c[tab];
    const list = _ct.call(this, tab).flatMap(k => {
      if (k === 'painting' && typeof PAINTINGS !== 'undefined') return ['painting', ...PAINTINGS.filter(v => PAINTING_PLACEABLE.has(v.key)).map(v => ({ key: 'painting', pv: v.key }))];
      if (k === 'goat_horn' && EXTRA.instrument) return Object.keys(EXTRA.instrument).map(i => ({ key: 'goat_horn', instrument: i }));
      return [k];
    });
    return (c[tab] = list);
  };
  creativeTabItems.cache = {};
})();
// the debug stick (creative): right click cycles the selected property of a block's state, sneak + right click
// picks the next property (vanilla uses the attack button for that; here it stays on the use button)
(() => {
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target, held = p.inv.held;
    // (an id not in ITEMS in the hand - telemetry 11-02/03, 'reading key': using anything threw here)
    if (held && ITEMS[held.id] && ITEMS[held.id].key === 'debug_stick' && t && !this.targetEntity && !this.net) {
      const w = this.world, [x, y, z] = t.pos, id = w.getBlock(x, y, z), b = BLOCKS[id];
      const st = b.states && b.states[w.getMeta(x, y, z)];
      if (!st || !Object.keys(st).length) { this.ui.actionBar = { text: 'minecraft:' + b.key + ' 没有属性', t: performance.now() }; p.swing(); return; }
      const props = Object.keys(st);
      held.dbg = held.dbg || {};
      let k = held.dbg[b.key] && props.includes(held.dbg[b.key]) ? held.dbg[b.key] : props[0];
      if (p.sneaking) { k = props[(props.indexOf(k) + 1) % props.length]; held.dbg[b.key] = k; this.ui.actionBar = { text: '已选择“' + k + '”（' + st[k] + '）', t: performance.now() }; p.swing(); return; }
      const vals = [...new Set(b.states.map(s => s[k]))];
      const nv = vals[(vals.indexOf(st[k]) + 1) % vals.length];
      w.setBlock(x, y, z, id, Features.withProp(id, w.getMeta(x, y, z), k, nv));
      held.dbg[b.key] = k;
      this.ui.actionBar = { text: '“' + k + '”设为' + nv, t: performance.now() };
      this.flushMesh && this.flushMesh(); p.swing(); return;
    }
    return _use.call(this);
  };
})();

// ---- campfires (vanilla CampfireBlockEntity): up to four raw foods on top, cooked in 30 s while lit and popped off;
// smoke rising, a burn for whoever stands in a lit one. None of it was there - "营火不能烤东西、没有烟、不烫", feedback
// 2026-11-01/02 (the drops of the block itself come from its loot table) ----
(() => {
  const CAMP = BLOCKS.map((b, i) => (b && (b.key === 'campfire' || b.key === 'soul_campfire') ? i : -1)).filter((i) => i >= 0);
  const isCamp = (id) => CAMP.includes(id);
  const lit = (w, x, y, z, id) => Features.propOf(id, w.getMeta(x, y, z), 'lit') !== 'false';
  // (broken without silk touch: 2 charcoal / 1 soul soil, vanilla's loot - it dropped itself)
  for (const id of CAMP) { const soul = BLOCKS[id].key === 'soul_campfire', it = ITEM_KEY[soul ? 'soul_soil' : 'charcoal']; if (it !== undefined) BLOCKS[id].drops = () => [[it, soul ? 1 : 2]]; }
  const beAt = (g, x, y, z) => {
    const k = x + ',' + y + ',' + z; let be = g.blockEntities.get(k);
    if (!be || be.type !== 'campfire') { be = { type: 'campfire', pos: [x, y, z], items: [null, null, null, null], times: [0, 0, 0, 0] }; g.blockEntities.set(k, be); }
    return be;
  };
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target, held = p.inv.held;
    if (t && !this.targetEntity && !this.net && !this.p2pGuest && held && isCamp(t.id) && COOKING.campfire_cooking[held.id]) {
      const [x, y, z] = t.pos, be = beAt(this, x, y, z), i = be.items.findIndex((s) => !s);
      if (i >= 0) { be.items[i] = { ...held, count: 1 }; be.times[i] = 0; useOne(this, p); p.swing(); this.markBlockEntity(be); return; }
    }
    return _use.call(this);
  };
  // cooking (with the furnaces), smoke and the burn
  const _tick = Game.prototype.tickFurnaces;
  Game.prototype.tickFurnaces = function () {
    _tick.call(this);
    if (this.net || this.p2pGuest) return;
    const w = this.world, p = this.player;
    for (const be of this.blockEntities.values()) {
      if (be.type !== 'campfire') continue;
      const [x, y, z] = be.pos; if (!w.isLoaded(x, z)) continue;
      const id = w.getBlock(x, y, z);
      if (!isCamp(id)) { for (const s of be.items) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s); this.blockEntities.delete(be.pos.join(',')); continue; }
      const on = lit(w, x, y, z, id);
      for (let i = 0; i < 4; i++) {
        const s = be.items[i]; if (!s) continue;
        const rec = COOKING.campfire_cooking[s.id];
        if (!on) { be.times[i] = Math.max(0, be.times[i] - 2); continue; }
        if (++be.times[i] >= (rec ? rec.time : 600)) {
          be.items[i] = null; be.times[i] = 0;
          if (rec) this.dropItem(x + 0.5, y + 1, z + 0.5, { id: rec.result, count: 1, dmg: 0 }, [0, 0.1, 0]);
          this.markBlockEntity(be);
        }
      }
    }
    // (the lit ones near the player, found per chunk like the spawners)
    if (!CAMP.length || !p) return;
    const px = Math.floor(p.pos[0]), pz = Math.floor(p.pos[2]);
    for (let cx = (px >> 4) - 2; cx <= (px >> 4) + 2; cx++) for (let cz = (pz >> 4) - 2; cz <= (pz >> 4) + 2; cz++) {
      const ch = w.getChunk(cx, cz); if (!ch) continue;
      if (!ch.campfires || this.tickCount - ch.campfiresT > 100) { ch.campfires = []; ch.campfiresT = this.tickCount; ch.findAll(CAMP, (i) => ch.campfires.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)])); }
      for (const [x, y, z] of ch.campfires) {
        const id = w.getBlock(x, y, z); if (!isCamp(id) || !lit(w, x, y, z, id)) continue;
        if (Math.random() < 0.12) this.particles.spawn('smoke', x + 0.3 + Math.random() * 0.4, y + 0.6, z + 0.3 + Math.random() * 0.4, 0, 0.07, 0);
        const P = p.pos;
        if (P[0] > x - 0.3 && P[0] < x + 1.3 && P[2] > z - 0.3 && P[2] < z + 1.3 && P[1] >= y && P[1] < y + 0.7 && !p.creative && p.deathTime === 0)
          p.hurt(BLOCKS[id].key === 'soul_campfire' ? 2 : 1, { type: 'fire' });
      }
    }
  };
  // the food on top: flat, one in each corner, turned to the campfire's sides (vanilla CampfireRenderer)
  const _dc = Game.prototype.drawChests;
  Game.prototype.drawChests = function (a, env) {
    const r = _dc.call(this, a, env);
    if (!this.blockEntities) return r;
    const p = this.player, w = this.world;
    for (const be of this.blockEntities.values()) {
      if (be.type !== 'campfire' || !be.items.some(Boolean)) continue;
      const [x, y, z] = be.pos;
      if (Math.abs(x - p.pos[0]) > 48 || Math.abs(z - p.pos[2]) > 48 || !isCamp(w.getBlock(x, y, z))) continue;
      const l = w.getLight(x, y + 1, z), L = [(l >> 4) / 15, Math.max(l & 15, 13) / 15];
      for (let i = 0; i < 4; i++) {
        const s = be.items[i]; if (!s) continue;
        const m = M4.create(); M4.translate(m, x + 0.5, y + 0.45, z + 0.5); M4.rotY(m, -i * Math.PI / 2);
        M4.translate(m, -0.3125, 0, -0.3125); M4.rotX(m, -Math.PI / 2); M4.scale(m, 0.75, 0.75, 0.75);
        this.drawItemFixed(s, m, L, env);
      }
    }
    return r;
  };
})();

// ---- shulker boxes and the ender chest: neither opened at all ("潜影盒、末影箱打不开", feedback 2026-11-01/02). A
// shulker box keeps its 27 slots in the item when broken (stack.sb) and gets them back when placed; the ender chest
// is the player's own 27 slots in this world (worldMeta.ender), the same from every ender chest. Sneaking still
// places a block against them, as vanilla ----
(() => {
  const SHULKER = new Set(BLOCKS.map((b, i) => (b && /(^|_)shulker_box$/.test(b.key) ? i : -1)).filter((i) => i >= 0));
  const ENDER = BLOCKS.findIndex((b) => b && b.key === 'ender_chest');
  const itemOf = (id) => ITEM_KEY[BLOCKS[id].key];
  const _use = Game.prototype.use;
  Game.prototype.use = function () {
    const p = this.player, t = this.target;
    if (t && !this.targetEntity && !this.net && !this.p2pGuest && !p.sneaking && (SHULKER.has(t.id) || (ENDER >= 0 && t.id === ENDER))) {
      const [x, y, z] = t.pos, b = BLOCKS[t.id], c = [x + 0.5, y + 0.5, z + 0.5];
      if (t.id === ENDER) {
        const m = this.worldMeta, slots = m.ender || (m.ender = new Array(27).fill(null));
        this.ui.open(new ChestScreen(this, [{ type: 'ender', pos: [x, y, z], slots }], b.cn));
        Sound.ev('block.ender_chest.open', c, 0.5, 0.9 + Math.random() * 0.1);
      } else {
        this.ui.open(new ChestScreen(this, [this.getBlockEntity(x, y, z, 'chest')], b.cn));
        Sound.ev('block.shulker_box.open', c, 0.5, 0.9 + Math.random() * 0.1);
      }
      p.swing(); return;
    }
    // a shulker box placed from an item with contents: they go into its block entity
    const held = p.inv.held, sb = held && held.sb;
    const r = _use.call(this);
    if (sb && t && !this.net) {
      const D = DIRS[t.face] || [0, 0, 0];
      for (const [x, y, z] of [[t.pos[0] + D[0], t.pos[1] + D[1], t.pos[2] + D[2]], t.pos]) {
        if (!SHULKER.has(this.world.getBlock(x, y, z))) continue;
        const be = this.getBlockEntity(x, y, z, 'chest');
        if (!be.slots.some(Boolean)) { be.slots = sb.map((s) => (s ? { ...s } : null)); while (be.slots.length < 27) be.slots.push(null); break; }
      }
    }
    return r;
  };
  // broken (by hand, in a blast): the box drops with what it holds
  const _dl = Game.prototype.dropBlockLoot;
  Game.prototype.dropBlockLoot = function (x, y, z, id, meta, tool) {
    if (!SHULKER.has(id) || itemOf(id) === undefined) return _dl.call(this, x, y, z, id, meta, tool);
    const k = x + ',' + y + ',' + z, be = this.blockEntities.get(k), st = makeStack(itemOf(id), 1);
    if (be && be.slots && be.slots.some(Boolean)) st.sb = be.slots.map((s) => (s ? { ...s } : null));
    this.blockEntities.delete(k);
    this.dropItem(x + 0.5, y + 0.3, z + 0.5, st);
  };
  // (creative: no loot, but a box that holds something still drops, as vanilla)
  const _bb = Game.prototype.breakBlock;
  Game.prototype.breakBlock = function (x, y, z, natural, silent) {
    const id = this.world.getBlock(x, y, z);
    if (SHULKER.has(id) && this.mode === 'creative' && !natural && !this.net) {
      const be = this.blockEntities.get(x + ',' + y + ',' + z);
      if (be && be.slots && be.slots.some(Boolean)) this.dropBlockLoot(x, y, z, id, this.world.getMeta(x, y, z), null);
    }
    return _bb.call(this, x, y, z, natural, silent);
  };
})();

// ---- anvils and concrete powder fall, as vanilla (FallingBlock) - "铁砧不会下落", feedback 2026-11-01/02 ----
for (const b of BLOCKS) if (b && (/^(chipped_|damaged_)?anvil$/.test(b.key) || /_concrete_powder$/.test(b.key))) b.gravity = true;
// (the wandering trader walks at 0.35 of its 0.7 speed, as vanilla's goals ask - at the full 0.7 it ran three times a
// villager's pace and snapped its llamas' leads: "流浪商人跑得比闪电侠还快", feedback 2026-11-01/02)
if (typeof MOB_TYPES !== 'undefined' && MOB_TYPES.wandering_trader && MOB_TYPES.wandering_trader.speed > 0.5) MOB_TYPES.wandering_trader.speed = 0.245;

// ---- bubble columns: the bubbles themselves (vanilla's bubble_column_up / whirlpool particles) - they only pushed,
// nothing showed, "灵魂沙上面没有气泡柱", feedback 2026-11-01/02. Soul sand and magma blocks under water near the
// player, found per chunk now and then ----
(() => {
  const _tick = Game.prototype.tickFurnaces;
  Game.prototype.tickFurnaces = function () {
    _tick.call(this);
    const p = this.player, w = this.world; if (!p || BID.soul_sand === undefined || BID.magma_block === undefined) return;
    const px = Math.floor(p.pos[0]), pz = Math.floor(p.pos[2]), ids = [BID.soul_sand, BID.magma_block];
    for (let cx = (px >> 4) - 1; cx <= (px >> 4) + 1; cx++) for (let cz = (pz >> 4) - 1; cz <= (pz >> 4) + 1; cz++) {
      const ch = w.getChunk(cx, cz); if (!ch) continue;
      if (!ch.bubbleSrc || this.tickCount - ch.bubbleSrcT > 100) {
        ch.bubbleSrc = []; ch.bubbleSrcT = this.tickCount;
        ch.findAll(ids, (i) => { const x = cx * 16 + (i & 15), y = i >> 8, z = cz * 16 + ((i >> 4) & 15); if (w.getBlock(x, y + 1, z) === WATER) ch.bubbleSrc.push([x, y, z]); });
      }
      for (const [x, y, z] of ch.bubbleSrc) {
        if (Math.abs(x - px) > 24 || Math.abs(z - pz) > 24 || Math.random() > 0.5) continue;
        const up = w.getBlock(x, y, z) === BID.soul_sand;
        let top = y + 1; while (top < y + 64 && w.getBlock(x, top + 1, z) === WATER && w.getMeta(x, top + 1, z) === 0) top++;
        if (!w.bubbleColumnAt(x, y + 1, z)) continue;
        const yy = y + 1 + Math.random() * (top - y);
        this.particles.spawn('bubble', x + 0.3 + Math.random() * 0.4, yy, z + 0.3 + Math.random() * 0.4, 0, up ? 0.12 : -0.08, 0);
      }
    }
  };
})();

// ---- fluids in a newly generated chunk that have somewhere to go (springs in cave walls, aquifer edges, lava in
// ravines): their flow is scheduled, as vanilla's spring feature and aquifers do - they stood still until something
// next to them changed, "新区块的水和岩浆不流动", feedback 2026-11-01/02. Sections without a fluid are skipped ----
(() => {
  const _fc = Game.prototype.finishChunk;
  Game.prototype.finishChunk = function (ch, saved) {
    const r = _fc.call(this, ch, saved);
    if (saved || this.net || this.p2pGuest || !ch || !ch.bs) return r;
    const w = this.world, x0 = ch.cx * 16, z0 = ch.cz * 16;
    const free = (x, y, z) => { if (y < 0) return false; const lx = x - x0, lz = z - z0, id = lx >= 0 && lx < 16 && lz >= 0 && lz < 16 ? ch.getB((y << 8) | (lz << 4) | lx) : w.isLoaded(x, z) ? w.getBlock(x, y, z) : -1; return id === 0 || (id > 0 && !!REPLACEABLE[id] && !IS_FLUID[id] && !WLOG[id]); };
    let n = 0;
    for (let si = 0; si < ch.bs.length && n < 400; si++) {
      const s = ch.bs[si]; if (!s || !s.p.some((id) => IS_FLUID[id])) continue;
      for (let j = 0; j < 4096 && n < 400; j++) {
        const i = (si << 12) | j, id = ch.getB(i); if (!IS_FLUID[id]) continue;
        const y = i >> 8, x = x0 + (i & 15), z = z0 + ((i >> 4) & 15);
        if (free(x, y - 1, z) || free(x + 1, y, z) || free(x - 1, y, z) || free(x, y, z + 1) || free(x, y, z - 1)) { w.schedule(x, y, z, id === WATER ? 5 : 30); n++; }
      }
    }
    return r;
  };
})();

// ---- pointed dripstone has a collision shape, as vanilla's (by its thickness; the tip short at the free end) - it had
// none, things passed through it: "滴水石锥没有碰撞", feedback 2026-11-01/02 ----
(() => {
  const id = BLOCKS.findIndex((b) => b && b.key === 'pointed_dripstone'); if (id < 0) return;
  const b = BLOCKS[id], W = { tip_merge: 5, tip: 5, frustum: 4, middle: 3, base: 2 };
  b.solid = true;
  b.collide = (m) => {
    const st = (b.states && b.states[m]) || {}, a = W[st.thickness] ?? 3, e = 16 - a;
    if (st.thickness === 'tip') return st.vertical_direction === 'up' ? [[a, 0, a, e, 11, e]] : [[a, 5, a, e, 16, e]];
    return [[a, 0, a, e, 16, e]];
  };
})();
