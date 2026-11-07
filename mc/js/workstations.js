'use strict';
// ---------------------------------------------------------------------------
// The processing blocks in single player, laid out like vanilla's screens: the enchanting table, anvil, grindstone,
// stonecutter, smithing table and brewing stand (with its block entity and the vanilla brewing recipes).
// Their own slots hold items only while open (given back on closing), except the brewing stand's.
// ---------------------------------------------------------------------------

// the Standard Galactic Alphabet (font/ascii_sga.png, the enchanting table's words): glyph widths read from the image
const SGA = {
  words: 'the elder scrolls klaatu berata niktu xyzzy bless curse light darkness fire air earth water hot dry cold wet ignite snuff embiggen twist shorten stretch fiddle destroy imbue galvanize enchant free limited range of towards inside sphere cube self other ball mental physical grow shrink demon elemental spirit animal creature beast humanoid undead fresh stale phnglui mglwnafh cthulhu rlyeh wgahnagl fhtagnbaguette'.split(' '),
  cache: new Map(),
  init(img) {
    if (this.img === img) return;
    this.img = img; this.cell = img.width / 16; this.wd = new Array(256).fill(0);
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const k = cv.getContext('2d'); k.drawImage(img, 0, 0);
    const d = k.getImageData(0, 0, img.width, img.height).data, c = this.cell;
    for (let ch = 0; ch < 256; ch++) {
      let r = -1;
      for (let x = 0; x < c; x++) for (let y = 0; y < c; y++) if (d[(((ch >> 4) * c + y) * img.width + (ch & 15) * c + x) * 4 + 3]) r = Math.max(r, x);
      this.wd[ch] = ch === 32 ? 4 : r < 0 ? 0 : Math.round((r + 1) * 8 / c) + 1;
    }
  },
  width(s) { let w = 0; for (const ch of s) w += this.wd[ch.charCodeAt(0) & 255]; return w; },
  // a few random words (seeded), wrapped into lines no wider than w
  name(seed, w) {
    const r = new JRandom(seed), n = r.nextInt(2) + 3, words = [];
    for (let i = 0; i < n; i++) words.push(this.words[r.nextInt(this.words.length)]);
    const lines = []; let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (this.width(t) > w && cur) { lines.push(cur); cur = wd; } else cur = t; }
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  },
  draw(c, s, x, y, color) {
    const key = s + '|' + color;
    let cv = this.cache.get(key);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = Math.max(1, this.width(s)); cv.height = 8;
      const k = cv.getContext('2d'), C = this.cell; let px = 0;
      k.imageSmoothingEnabled = false;
      for (const ch of s) { const o = ch.charCodeAt(0) & 255; k.drawImage(this.img, (o & 15) * C, (o >> 4) * C, C, C, px, 0, 8, 8); px += this.wd[o]; }
      k.globalCompositeOperation = 'source-in'; k.fillStyle = color; k.fillRect(0, 0, cv.width, 8);
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(key, cv);
    }
    c.drawImage(cv, x, y);
  },
};

// the player's experience levels: taken away keeping the progress into the level (vanilla giveExperienceLevels)
Game.prototype.addLevels = function (n) {
  const p = this.player, l = this.xpLevel(), prog = (p.xp - this.xpTotalFor(l)) / this.xpNeeded(l), nl = Math.max(0, l + n);
  p.xp = Math.max(0, Math.round(this.xpTotalFor(nl) + prog * this.xpNeeded(nl)));
};

// a screen's own slot: an item kept in this.held[i] while it is open
class StationScreen extends ContainerScreen {
  constructor(game, bg, title, pos) { super(game, bg, 176, 166, title); this.pos = pos; this.held = []; this.invLabelY = 72; }
  // the item in one of the screen's slots (its own, or the server's window when on a server)
  S(i) { return this.slots[i].get(); }
  own(i, x, y, o = {}) { this.slots.push({ x, y, group: 'container', get: () => this.held[i] || null, set: (s) => { this.held[i] = s; }, ...o }); }
  drawExtra(ui) { Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + this.invLabelY, '#404040', false); this.drawMore && this.drawMore(ui); }
  close() { for (const s of this.held) if (s) this.game.ui.returnStack(s); this.held = []; this.result = null; } // (see CraftingScreen.close)
  // the screen closes when its block is gone or the player walks off (vanilla stillValid: 8 blocks)
  stillValid() {
    if (!this.pos || this.net) return;
    const p = this.game.player, [x, y, z] = this.pos;
    if (this.game.world.getBlock(x, y, z) !== this.blockId || Math.hypot(p.pos[0] - x - 0.5, p.pos[1] - y - 0.5, p.pos[2] - z - 0.5) > 8) this.game.ui.close();
  }
}

// ---- the enchanting table ----
class EnchantingScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_enchanting_table', title || '附魔', pos);
    this.own(0, 15, 47, { max: 1, accept: (st) => st.count === 1 || maxStack(st.id) === 1 || ITEMS[st.id].key === 'book' });
    this.own(1, 35, 47, { emptyIcon: 'slot_lapis_lazuli', accept: (st) => st.id === ITEM_KEY.lapis_lazuli });
    this.addPlayerSlots(84, 142);
    this.shelves = pos ? countBookshelves(game.world, ...pos) : 0;
    this.changed();
  }
  changed() {
    const p = this.game.player;
    if (p.enchSeed === undefined) p.enchSeed = (Math.random() * 2 ** 31) | 0;
    this.offers = enchantOffers(this.S(0), this.shelves, p.enchSeed);
  }
  // the item slot takes one item at a time
  maxIn(s, st) { return s === this.slots[0] ? 1 : super.maxIn(s, st); }
  btn(i) { return { x: this.x + 60, y: this.y + 14 + 19 * i, w: 108, h: 19 }; }
  usable(i) {
    const o = this.offers[i], g = this.game, lapis = this.S(1) ? this.S(1).count : 0;
    return !!o && (g.player.creative || (lapis >= i + 1 && g.xpLevel() >= o.cost));
  }
  drawMore(ui) {
    const c = ui.ctx, g = this.game;
    SGA.init(ui.img.font_sga);
    // the book (a still picture of vanilla's moving one)
    c.save(); c.translate(this.x + 28, this.y + 16); c.scale(2, 2); ui.drawItem({ id: ITEM_KEY.enchanted_book, count: 1, g: false }, 0, 0); c.restore();
    let tip = null;
    for (let i = 0; i < 3; i++) {
      const o = this.offers[i], r = this.btn(i);
      if (!o) { ui.sprite('enchanting_table_enchantment_slot_disabled', r.x, r.y); continue; }
      const s = String(o.cost), n = 86 - Font.width(s), lines = SGA.name((this.seed ?? g.player.enchSeed) + i, n);
      let col;
      if (!this.usable(i)) {
        ui.sprite('enchanting_table_enchantment_slot_disabled', r.x, r.y);
        ui.sprite('enchanting_table_level_' + (i + 1) + '_disabled', r.x + 1, r.y + 1);
        lines.forEach((l, k) => SGA.draw(c, l, r.x + 20, r.y + 2 + k * 8, '#342F25'));
        col = '#407F10';
      } else {
        const hov = ui.hit(r);
        ui.sprite(hov ? 'enchanting_table_enchantment_slot_highlighted' : 'enchanting_table_enchantment_slot', r.x, r.y);
        ui.sprite('enchanting_table_level_' + (i + 1), r.x + 1, r.y + 1);
        lines.forEach((l, k) => SGA.draw(c, l, r.x + 20, r.y + 2 + k * 8, hov ? '#FFFF80' : '#685E4A'));
        col = '#80FF20';
      }
      Font.draw(c, s, r.x + 20 + 86 - Font.width(s), r.y + 9, col);
      if (ui.hit(r) && !ui.cursor) tip = i;
    }
    if (tip !== null) {
      const o = this.offers[tip], E = o.clue, lapis = this.S(1) ? this.S(1).count : 0;
      const lines = E ? [{ text: (NET_ENCH_CN[E[0]] || E[0]) + (ENCH[E[0]] && ENCH[E[0]].max === 1 ? '' : ' ' + romanNum(E[1])) + '…？', color: '#FFFFFF' }] : [];
      if (!g.player.creative) {
        lines.push({ text: '' });
        if (g.xpLevel() < o.cost) lines.push({ text: '等级要求：' + o.cost, color: '#FF5555' });
        else {
          lines.push({ text: tip === 0 ? '花费：1颗青金石' : '花费：' + (tip + 1) + '颗青金石', color: lapis >= tip + 1 ? '#AAAAAA' : '#FF5555' });
          lines.push({ text: tip === 0 ? '+ 1级经验' : '+ ' + (tip + 1) + '级经验', color: '#AAAAAA' });
        }
      }
      ui.tooltip(lines, ui.mouse.x, ui.mouse.y);
    }
  }
  mouseDown(ui, mx, my, button, shift) {
    const i = this.offerAt(mx, my); if (i >= 0) { this.pick(i); return; }
    super.mouseDown(ui, mx, my, button, shift);
  }
  offerAt(mx, my) { for (let i = 0; i < 3; i++) if (this.game.ui.hit(this.btn(i), mx, my)) return i; return -1; }
  pick(i) { if (this.usable(i)) this.enchant(i); }
  enchant(i) {
    const g = this.game, p = g.player, o = this.offers[i], st = this.held[0];
    const out = { ...st, e: o.list.map(x => [...x]) };
    if (ITEMS[st.id].key === 'book') out.id = ITEM_KEY.enchanted_book;
    this.held[0] = out;
    if (!p.creative) {
      g.addLevels(-(i + 1));
      this.held[1].count -= i + 1; if (!this.held[1].count) this.held[1] = null;
    }
    p.enchSeed = (Math.random() * 2 ** 31) | 0;
    g.grant && g.grant('enchant_item');
    Sound.ev('block.enchantment_table.use', [this.pos[0] + 0.5, this.pos[1] + 0.5, this.pos[2] + 0.5], 1, Math.random() * 0.1 + 0.9);
    this.changed();
  }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    if (s.group !== 'container' && st.id === ITEM_KEY.lapis_lazuli) { const t = this.slots[1], ts = t.get(); if (!ts) { t.set(st); s.set(null); return; } if (sameKind(ts, st)) { const k = Math.min(st.count, maxStack(st.id) - ts.count); ts.count += k; st.count -= k; if (!st.count) s.set(null); return; } }
    if (s.group !== 'container' && !this.held[0]) { this.held[0] = { ...st, count: 1 }; st.count--; if (!st.count) s.set(null); return; }
    super.quickMove(s);
  }
}

// ---- the anvil ----
const ANVIL_NEXT = { anvil: 'chipped_anvil', chipped_anvil: 'damaged_anvil', damaged_anvil: null };
class AnvilScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_anvil', title || '修复和命名', pos);
    this.titleX = 60; this.name = '';
    this.own(0, 27, 47); this.own(1, 76, 47);
    this.slots.push({ x: 134, y: 47, output: true, get: () => this.result, set: () => { }, onTake: () => this.take() });
    this.addPlayerSlots(84, 142);
    this.changed();
  }
  layout() {
    super.layout();
    const u = this.game.ui;
    u.showInput(this.x + 62, this.y + 24, 103, 12, this.name, () => { }, { onInput: (v) => { this.name = v; this.changed(); if (this.onName) this.onName(v); }, onEsc: () => u.close(), max: 50 });
  }
  changed() {
    const L = this.held[0];
    // a new item in the left slot: the name field shows its name
    if (L !== this.lastLeft) {
      this.lastLeft = L; this.name = L ? L.name || ITEMS[L.id].cn : '';
      const inp = this.game.ui.input; if (inp && this.x !== undefined) inp.value = this.name;
    }
    const r = anvilResult(L, this.held[1], L ? this.name : null, this.game.player.creative);
    this.res = r; this.result = r && r.stack ? r.stack : null;
  }
  canTake() { const r = this.res; return r && r.stack && (this.game.player.creative || this.game.xpLevel() >= r.cost); }
  takeOutput(ui, s, shift) { if (this.canTake()) super.takeOutput(ui, s, shift); }
  take() {
    const g = this.game, r = this.res;
    if (!g.player.creative) g.addLevels(-r.cost);
    this.held[0] = null;
    const R = this.held[1];
    if (R && r.used) { R.count -= r.used; if (R.count <= 0) this.held[1] = null; } else this.held[1] = null;
    this.lastLeft = null;
    // 12% of the times the anvil gets more damaged (and breaks when it was damaged already)
    const [x, y, z] = this.pos, w = g.world, id = w.getBlock(x, y, z), b = BLOCKS[id], c = [x + 0.5, y + 0.5, z + 0.5];
    if (!g.player.creative && Math.random() < 0.12) {
      const nx = ANVIL_NEXT[b.key];
      if (nx === null) { w.setBlock(x, y, z, 0, 0); g.flushMesh(); Sound.ev('block.anvil.destroy', c, 1, 1); g.ui.close(); return; }
      if (nx && BID[nx] !== undefined) { const m = w.getMeta(x, y, z); w.setBlock(x, y, z, BID[nx], Features.withProp(BID[nx], 0, 'facing', Features.propOf(id, m, 'facing'))); this.blockId = BID[nx]; g.flushMesh(); }
    }
    Sound.ev('block.anvil.use', c, 1, Math.random() * 0.1 + 0.9);
  }
  drawMore(ui) {
    const c = ui.ctx, L = this.S(0);
    if (this.net) this.netLeft(L);
    ui.sprite(L ? 'anvil_text_field' : 'anvil_text_field_disabled', this.x + 59, this.y + 20);
    if (L && this.S(1) && !this.S(2)) ui.sprite('anvil_error', this.x + 99, this.y + 45);
    const r = this.res;
    if (r && r.cost > 0) {
      const g = this.game, too = r.tooExpensive, s = too ? '过于昂贵！' : '附魔花费：' + r.cost;
      const col = too || (!g.player.creative && g.xpLevel() < r.cost) ? '#FF6060' : '#80FF20';
      const tx = this.x + 176 - 8 - Font.width(s) - 2;
      c.fillStyle = 'rgba(0,0,0,0.31)'; c.fillRect(tx - 2, this.y + 67, this.x + 176 - 8 - (tx - 2), 12);
      Font.draw(c, s, tx, this.y + 69, col);
    }
  }
  close() { super.close(); this.game.ui.hideInput(); }
  key(ui, ev) { if (document.activeElement === ui.input) return true; return super.key(ui, ev); }
}

// ---- the grindstone ----
class GrindstoneScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_grindstone', title || '修复和祛魔', pos);
    const ok = (st) => !!ITEMS[st.id].durability || !!(st.e && st.e.length);
    this.own(0, 49, 19, { accept: ok }); this.own(1, 49, 40, { accept: ok });
    this.slots.push({ x: 129, y: 34, output: true, get: () => this.result, set: () => { }, onTake: () => this.take() });
    this.addPlayerSlots(84, 142);
    this.changed();
  }
  changed() { this.result = grindstoneResult(this.held[0], this.held[1]); }
  take() {
    const g = this.game, xp = grindstoneXp(this.held[0], this.held[1]), [x, y, z] = this.pos;
    for (const i of [0, 1]) { const s = this.held[i]; if (s) { s.count--; if (!s.count) this.held[i] = null; } }
    if (xp) g.dropXp(x + 0.5, y + 0.5, z + 0.5, xp);
    Sound.ev('block.grindstone.use', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
  }
  drawMore(ui) { if ((this.S(0) || this.S(1)) && !this.S(2)) ui.sprite('grindstone_error', this.x + 92, this.y + 31); }
}

// ---- the stonecutter ----
class StonecutterScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_stonecutter', title || '切石机', pos);
    this.sel = -1; this.scroll = 0;
    this.own(0, 20, 33);
    this.slots.push({ x: 143, y: 33, output: true, get: () => this.result, set: () => { }, onTake: () => this.take() });
    this.addPlayerSlots(84, 142);
    this.changed();
  }
  recipes() { const s = this.S(0); return s ? STONECUTTING[s.id] || [] : []; }
  changed() {
    const s = this.held[0];
    if ((s && s.id) !== this.lastId) { this.lastId = s && s.id; this.sel = -1; this.scroll = 0; }
    const r = this.recipes()[this.sel];
    this.result = r ? { id: r.result, count: r.count, dmg: 0 } : null;
  }
  rows() { return Math.ceil(this.recipes().length / 4); }
  take() {
    const s = this.held[0]; if (!s) return;
    s.count--; if (!s.count) this.held[0] = null;
    Sound.ev('ui.stonecutter.take_result', null, 1, 1);
  }
  cell(i) { const k = i - this.scroll * 4; return { x: this.x + 52 + (k % 4) * 16, y: this.y + 14 + Math.floor(k / 4) * 18 + 1, w: 16, h: 18 }; }
  drawMore(ui) {
    const list = this.recipes(), max = Math.max(0, this.rows() - 3);
    const sy = this.y + 15 + (max ? Math.round(this.scroll / max * 41) : 0);
    ui.sprite(max ? 'stonecutter_scroller' : 'stonecutter_scroller_disabled', this.x + 119, sy);
    let tip = null;
    for (let i = this.scroll * 4; i < Math.min(list.length, this.scroll * 4 + 12); i++) {
      const r = this.cell(i), hov = ui.hit(r);
      ui.sprite(i === this.sel ? 'stonecutter_recipe_selected' : hov ? 'stonecutter_recipe_highlighted' : 'stonecutter_recipe', r.x, r.y);
      ui.drawItem({ id: list[i].result, count: list[i].count }, r.x, r.y + 1);
      if (hov && !ui.cursor) tip = list[i];
    }
    if (tip) ui.tooltip(ui.itemLines({ id: tip.result, count: tip.count }), ui.mouse.x, ui.mouse.y);
  }
  mouseDown(ui, mx, my, button, shift) {
    const list = this.recipes();
    const i = this.offerAt(mx, my); if (i >= 0) { this.pick(i); return; }
    super.mouseDown(ui, mx, my, button, shift);
  }
  offerAt(mx, my) { const list = this.recipes(); for (let i = this.scroll * 4; i < Math.min(list.length, this.scroll * 4 + 12); i++) if (this.game.ui.hit(this.cell(i), mx, my)) return i; return -1; }
  pick(i) { this.sel = i; this.changed(); Sound.ev('ui.stonecutter.select_recipe', null, 1, 1); }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy), 0, Math.max(0, this.rows() - 3)); }
}

// ---- the smithing table ----
const TRIM_CN = { amethyst: '紫水晶质', copper: '铜质', diamond: '钻石质', emerald: '绿宝石质', gold: '金质', iron: '铁质', lapis: '青金石质', netherite: '下界合金质', quartz: '石英质', redstone: '红石质', resin: '树脂质' };
const TRIM_MAT_OF = { amethyst_shard: 'amethyst', copper_ingot: 'copper', diamond: 'diamond', emerald: 'emerald', gold_ingot: 'gold', iron_ingot: 'iron', lapis_lazuli: 'lapis', netherite_ingot: 'netherite', quartz: 'quartz', redstone: 'redstone', resin_brick: 'resin' };
const TRIM_COLOR = { amethyst: '#9A5CC6', copper: '#B4684D', diamond: '#6EECD2', emerald: '#11A036', gold: '#DEB12D', iron: '#ECECEC', lapis: '#416E97', netherite: '#625859', quartz: '#E3D4C4', redstone: '#971607', resin: '#FC7812' };
const TRIM_PATTERN_CN = { bolt: '镶铆', coast: '海岸', dune: '沙丘', eye: '眼眸', flow: '涡流', host: '雇主', raiser: '牧民', rib: '肋骨', sentry: '哨兵', shaper: '塑造', silence: '幽静', snout: '猪鼻', spire: '尖塔', tide: '潮汐', vex: '恼鬼', ward: '监守', wayfinder: '向导', wild: '荒野' };
function smithingRecipe(t, b, a) {
  if (!t || !b || !a) return null;
  return SMITHING.find(r => r.template.includes(t.id) && r.base.includes(b.id) && r.addition.includes(a.id)) || null;
}
class SmithingScreen extends StationScreen {
  constructor(game, pos, title) {
    super(game, 'gui_smithing', title || '升级装备', pos);
    this.titleX = 44; this.titleY = 15;
    this.own(0, 8, 48, { emptyIcon: 'slot_smithing_template_netherite_upgrade', accept: (st) => SMITHING.some(r => r.template.includes(st.id)) });
    this.own(1, 26, 48, { max: 1 });
    this.own(2, 44, 48, { emptyIcon: 'slot_ingot' });
    this.slots.push({ x: 98, y: 48, output: true, get: () => this.result, set: () => { }, onTake: () => this.take() });
    this.addPlayerSlots(84, 142);
    this.changed();
  }
  changed() {
    const [t, b, a] = this.held, r = smithingRecipe(t, b, a);
    if (!r) { this.result = null; return; }
    if (r.trim) {
      const mat = TRIM_MAT_OF[ITEMS[a.id].key], trim = { pattern: r.pattern, material: mat };
      this.result = b.trim && b.trim.pattern === trim.pattern && b.trim.material === mat ? null : { ...b, count: 1, trim };
    } else this.result = { ...b, id: r.result, count: 1 };
  }
  take() {
    for (const i of [0, 1, 2]) { const s = this.held[i]; if (s) { s.count--; if (!s.count) this.held[i] = null; } }
    Sound.ev('block.smithing_table.use', [this.pos[0] + 0.5, this.pos[1] + 0.5, this.pos[2] + 0.5], 1, 1);
  }
  drawBase(ui) {
    ui.dim(0.6);
    ui.ctx.drawImage(ui.img[this.bg], 0, 0, this.gw, this.gh, this.x, this.y, this.gw, this.gh);
    Font.draw(ui.ctx, this.title, this.x + 44, this.y + 15, '#404040', false);
  }
  drawMore(ui) {
    const t = this.S(0), b = this.S(1), a = this.S(2), res = this.S(3);
    if (t && b && a && !res) ui.sprite('smithing_error', this.x + 65, this.y + 46);
    // the armour stand's place: the item being worked on, big
    const show = res || b;
    if (show) { ui.ctx.save(); ui.ctx.translate(this.x + 125, this.y + 28); ui.ctx.scale(2, 2); ui.drawItem({ ...show, count: 1 }, 0, 0); ui.ctx.restore(); }
  }
}

// ---- the brewing stand ----
// vanilla's mixes (PotionBrewing): [from, ingredient, to]; any potion + gunpowder -> splash, splash + dragon's breath -> lingering
const BREW_MIXES = [];
(function () {
  const add = (a, i, b) => BREW_MIXES.push([a, i, b]);
  for (const i of ['glistering_melon_slice', 'ghast_tear', 'rabbit_foot', 'blaze_powder', 'spider_eye', 'sugar', 'magma_cream', 'redstone']) add('water', i, 'mundane');
  add('water', 'glowstone_dust', 'thick'); add('water', 'nether_wart', 'awkward'); add('water', 'fermented_spider_eye', 'weakness');
  add('awkward', 'breeze_rod', 'wind_charged'); add('awkward', 'slime_block', 'oozing'); add('awkward', 'stone', 'infested'); add('awkward', 'cobweb', 'weaving');
  add('awkward', 'golden_carrot', 'night_vision'); add('night_vision', 'redstone', 'long_night_vision');
  add('night_vision', 'fermented_spider_eye', 'invisibility'); add('long_night_vision', 'fermented_spider_eye', 'long_invisibility'); add('invisibility', 'redstone', 'long_invisibility');
  add('awkward', 'magma_cream', 'fire_resistance'); add('fire_resistance', 'redstone', 'long_fire_resistance');
  add('awkward', 'rabbit_foot', 'leaping'); add('leaping', 'redstone', 'long_leaping'); add('leaping', 'glowstone_dust', 'strong_leaping');
  add('leaping', 'fermented_spider_eye', 'slowness'); add('long_leaping', 'fermented_spider_eye', 'long_slowness');
  add('slowness', 'redstone', 'long_slowness'); add('slowness', 'glowstone_dust', 'strong_slowness');
  add('awkward', 'turtle_helmet', 'turtle_master'); add('turtle_master', 'redstone', 'long_turtle_master'); add('turtle_master', 'glowstone_dust', 'strong_turtle_master');
  add('swiftness', 'fermented_spider_eye', 'slowness'); add('long_swiftness', 'fermented_spider_eye', 'long_slowness');
  add('awkward', 'sugar', 'swiftness'); add('swiftness', 'redstone', 'long_swiftness'); add('swiftness', 'glowstone_dust', 'strong_swiftness');
  add('awkward', 'pufferfish', 'water_breathing'); add('water_breathing', 'redstone', 'long_water_breathing');
  add('awkward', 'glistering_melon_slice', 'healing'); add('healing', 'glowstone_dust', 'strong_healing');
  add('healing', 'fermented_spider_eye', 'harming'); add('strong_healing', 'fermented_spider_eye', 'strong_harming'); add('harming', 'glowstone_dust', 'strong_harming');
  add('poison', 'fermented_spider_eye', 'harming'); add('long_poison', 'fermented_spider_eye', 'harming'); add('strong_poison', 'fermented_spider_eye', 'strong_harming');
  add('awkward', 'spider_eye', 'poison'); add('poison', 'redstone', 'long_poison'); add('poison', 'glowstone_dust', 'strong_poison');
  add('awkward', 'ghast_tear', 'regeneration'); add('regeneration', 'redstone', 'long_regeneration'); add('regeneration', 'glowstone_dust', 'strong_regeneration');
  add('awkward', 'blaze_powder', 'strength'); add('strength', 'redstone', 'long_strength'); add('strength', 'glowstone_dust', 'strong_strength');
  add('weakness', 'redstone', 'long_weakness');
  add('awkward', 'phantom_membrane', 'slow_falling'); add('slow_falling', 'redstone', 'long_slow_falling');
})();
const POTION_ITEMS = new Set(['potion', 'splash_potion', 'lingering_potion']);
const isPotion = (st) => st && POTION_ITEMS.has(ITEMS[st.id].key);
const BREW_INGREDIENTS = new Set([...BREW_MIXES.map(m => m[1]), 'gunpowder', 'dragon_breath']);
// what a bottle becomes with an ingredient (null: nothing)
function brewResult(bottle, ing) {
  if (!isPotion(bottle) || !ing) return null;
  const k = ITEMS[ing.id].key, bk = ITEMS[bottle.id].key;
  if (k === 'gunpowder') return bk === 'potion' ? { ...bottle, id: ITEM_KEY.splash_potion } : null;
  if (k === 'dragon_breath') return bk === 'splash_potion' ? { ...bottle, id: ITEM_KEY.lingering_potion } : null;
  const m = BREW_MIXES.find(([a, i]) => a === (bottle.pot || 'water') && i === k);
  return m ? { ...bottle, pot: m[2] } : null;
}
function canBrew(be) { return !!be.ingredient && be.bottles.some(b => brewResult(b, be.ingredient)); }
Game.prototype.tickBrewing = function (be) {
  const [x, y, z] = be.pos, w = this.world;
  if (be.fuelLeft <= 0 && be.fuel && be.fuel.id === ITEM_KEY.blaze_powder) {
    be.fuelLeft = 20; be.fuel.count--; if (!be.fuel.count) be.fuel = null;
  }
  const ok = canBrew(be), ingId = be.ingredient && be.ingredient.id;
  if (be.brewTime > 0) {
    be.brewTime--;
    if (be.brewTime === 0 && ok) {
      be.bottles = be.bottles.map(b => brewResult(b, be.ingredient) || b);
      const k = ITEMS[be.ingredient.id].key;
      be.ingredient.count--; if (!be.ingredient.count) be.ingredient = k === 'dragon_breath' ? makeStack('glass_bottle') : null;
      Sound.ev('block.brewing_stand.brew', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
    } else if (!ok || ingId !== be.ingId) be.brewTime = 0;
  } else if (ok && be.fuelLeft > 0) { be.fuelLeft--; be.brewTime = 400; be.ingId = ingId; }
  // the block shows which bottles it holds
  const id = w.getBlock(x, y, z);
  if (id === BID.brewing_stand) {
    let m = w.getMeta(x, y, z);
    for (let i = 0; i < 3; i++) m = Features.withProp(id, m, 'has_bottle_' + i, be.bottles[i] ? 'true' : 'false');
    if (m !== w.getMeta(x, y, z)) w.setMeta(x, y, z, m);
  }
};
const _tickFurnaces = Game.prototype.tickFurnaces;
Game.prototype.tickFurnaces = function () {
  _tickFurnaces.call(this);
  for (const be of this.blockEntities.values()) if (be.type === 'brewing' && this.world.isLoaded(be.pos[0], be.pos[2])) this.tickBrewing(be);
};
class BrewingScreen extends ContainerScreen {
  constructor(game, be, title) {
    super(game, 'gui_brewing_stand', 176, 166, title || '酿造台');
    this.be = be;
    const bottle = (i, x, y) => this.slots.push({ x, y, group: 'container', emptyIcon: 'slot_potion', max: 1, get: () => be.bottles[i], set: (s) => { be.bottles[i] = s; }, accept: (st) => isPotion(st) || st.id === ITEM_KEY.glass_bottle });
    bottle(0, 56, 51); bottle(1, 79, 58); bottle(2, 102, 51);
    this.slots.push({ x: 79, y: 17, group: 'container', get: () => be.ingredient, set: (s) => { be.ingredient = s; }, accept: (st) => BREW_INGREDIENTS.has(ITEMS[st.id].key) });
    this.slots.push({ x: 17, y: 17, group: 'container', emptyIcon: 'slot_brewing_fuel', get: () => be.fuel, set: (s) => { be.fuel = s; }, accept: (st) => st.id === ITEM_KEY.blaze_powder });
    this.addPlayerSlots(84, 142);
  }
  maxIn(s, st) { return s.max || super.maxIn(s, st); }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    if (s.group !== 'container') {
      const key = ITEMS[st.id].key;
      const t = key === 'blaze_powder' && (!this.be.fuel || this.be.fuel.count < 64) ? this.slots[4] : BREW_INGREDIENTS.has(key) ? this.slots[3] : null;
      if (t) { const ts = t.get(); if (!ts) { t.set(st); s.set(null); return; } if (sameKind(ts, st)) { const k = Math.min(st.count, maxStack(st.id) - ts.count); ts.count += k; st.count -= k; if (!st.count) s.set(null); return; } }
      if (isPotion(st)) for (const b of this.slots.slice(0, 3)) if (!b.get()) { b.set({ ...st, count: 1 }); st.count--; if (!st.count) { s.set(null); return; } }
      return;
    }
    super.quickMove(s);
  }
  drawExtra(ui) {
    const be = this.be, c = ui.ctx;
    const f = clamp(Math.floor((18 * be.fuelLeft + 20 - 1) / 20), 0, 18);
    if (f > 0) c.drawImage(ui.img.brewing_stand_fuel_length, 0, 0, f, 4, this.x + 60, this.y + 44, f, 4);
    if (be.brewTime > 0) {
      const h = Math.floor(28 * (1 - be.brewTime / 400));
      if (h > 0) c.drawImage(ui.img.brewing_stand_brew_progress, 0, 0, 9, h, this.x + 97, this.y + 16, 9, h);
      const bh = [29, 24, 20, 16, 11, 6, 0][Math.floor(be.brewTime / 2) % 7];
      if (bh > 0) c.drawImage(ui.img.brewing_stand_bubbles, 0, 29 - bh, 12, bh, this.x + 63, this.y + 14 + 29 - bh, 12, bh);
    }
    Font.draw(c, '物品栏', this.x + 8, this.y + 72, '#404040', false);
  }
  close() { this.game.markBlockEntity(this.be); }
}

// ---- opening them ----
const WORKSTATIONS = {
  enchanting: (g, pos, b) => new EnchantingScreen(g, pos, b.cn),
  anvil: (g, pos) => new AnvilScreen(g, pos),
  grindstone: (g, pos) => new GrindstoneScreen(g, pos),
  stonecutter: (g, pos) => new StonecutterScreen(g, pos),
  smithing: (g, pos) => new SmithingScreen(g, pos),
  brewing: (g, pos, b) => {
    const be = g.getBlockEntity(...pos, 'brewing');
    if (!be.bottles) Object.assign(be, { bottles: [null, null, null], ingredient: null, fuel: null, fuelLeft: 0, brewTime: 0 });
    return new BrewingScreen(g, be, b.cn);
  },
};
for (const [k, use] of [['enchanting_table', 'enchanting'], ['anvil', 'anvil'], ['chipped_anvil', 'anvil'], ['damaged_anvil', 'anvil'], ['grindstone', 'grindstone'],
  ['stonecutter', 'stonecutter'], ['smithing_table', 'smithing'], ['brewing_stand', 'brewing']]) if (BID[k] !== undefined) BLOCKS[BID[k]].onUse = use;
Game.prototype.openWorkstation = function (b, x, y, z) {
  const sc = WORKSTATIONS[b.onUse](this, [x, y, z], b);
  sc.blockId = this.world.getBlock(x, y, z);
  this.ui.open(sc);
};
