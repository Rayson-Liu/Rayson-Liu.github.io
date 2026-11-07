'use strict';
// ---------------------------------------------------------------------------
// Villager trading: the vanilla trade tables (VillagerTrades, Java Edition) restricted to items this
// game has, villager levels / experience, restocking, and the vanilla merchant screen layout.
// ---------------------------------------------------------------------------
// items the village needs
defItem('potato', '马铃薯', { food: [1, 0.6], places: 'potatoes' });
defItem('beetroot', '甜菜根', { food: [1, 1.2] });
defItem('beetroot_seeds', '甜菜种子', { places: 'beetroots' });
defItem('cod', '生鳕鱼', { food: [2, 0.4] });
defItem('cooked_cod', '熟鳕鱼', { food: [5, 6] });
defItem('salmon', '生鲑鱼', { food: [2, 0.4] });
defItem('cooked_salmon', '熟鲑鱼', { food: [6, 9.6] });
defItem('glass_bottle', '玻璃瓶');
smelt('potato', 'baked_potato', 0.35); smelt('cod', 'cooked_cod', 0.35); smelt('salmon', 'cooked_salmon', 0.35);
if (ITEMS[ITEM_KEY.carrot]) ITEMS[ITEM_KEY.carrot].places = 'carrots';
// crops: vanilla drops by age
(() => {
  const age = (id, m) => +((BLOCKS[id].states && BLOCKS[id].states[m] && BLOCKS[id].states[m].age) || 0);
  if (BID.carrots !== undefined) BLOCKS[BID.carrots].drops = (m, r) => age(BID.carrots, m) >= 7 ? [['carrot', 2 + (r() * 3 | 0)]] : [['carrot', 1]];
  if (BID.potatoes !== undefined) BLOCKS[BID.potatoes].drops = (m, r) => age(BID.potatoes, m) >= 7 ? [['potato', 2 + (r() * 3 | 0)]] : [['potato', 1]];
  if (BID.beetroots !== undefined) BLOCKS[BID.beetroots].drops = (m, r) => age(BID.beetroots, m) >= 3 ? [['beetroot', 1], ['beetroot_seeds', 1 + (r() * 3 | 0)]] : [['beetroot_seeds', 1]];
})();

// [cost A, count, cost B, count, result, count, max uses, villager xp]; E = emerald
const T_ = (a, an, r, rn, uses = 12, xp = 1, b = null, bn = 0) => ({ a, an, b, bn, r, rn, uses, xp });
const E = 'emerald';
const TRADES = {
  armorer: [
    [T_('coal', 15, E, 1, 16, 2), T_(E, 5, 'iron_leggings', 1, 12, 1), T_(E, 9, 'iron_chestplate', 1, 12, 1), T_(E, 5, 'iron_helmet', 1, 12, 1), T_(E, 4, 'iron_boots', 1, 12, 1)],
    [T_('iron_ingot', 4, E, 1, 12, 10), T_(E, 36, 'bell', 1, 12, 5)],
    [T_('lava_bucket', 1, E, 1, 12, 20), T_('diamond', 1, E, 1, 12, 20)],
    [T_(E, 19, 'diamond_leggings', 1, 3, 15), T_(E, 13, 'diamond_boots', 1, 3, 15)],
    [T_(E, 13, 'diamond_helmet', 1, 3, 30), T_(E, 21, 'diamond_chestplate', 1, 3, 30)],
  ],
  butcher: [
    [T_('chicken', 14, E, 1, 16, 2), T_('porkchop', 7, E, 1, 16, 2)],
    [T_('coal', 15, E, 1, 16, 2), T_(E, 1, 'cooked_porkchop', 5, 16, 5), T_(E, 1, 'cooked_chicken', 8, 16, 5)],
    [T_('mutton', 7, E, 1, 16, 20), T_('beef', 10, E, 1, 16, 20)],
    [T_('coal', 15, E, 1, 12, 30)],
    [T_('sweet_berry_bush', 10, E, 1, 12, 30)],
  ],
  cartographer: [
    [T_('paper', 24, E, 1, 16, 2)],
    [T_('glass_pane', 11, E, 1, 16, 10)],
    [T_('paper', 24, E, 1, 12, 20)],
    [T_(E, 7, 'white_carpet', 1, 12, 15)],
    [T_(E, 8, 'book', 1, 12, 30)],
  ],
  cleric: [
    [T_('rotten_flesh', 32, E, 1, 16, 2), T_(E, 1, 'redstone', 2, 12, 1)],
    [T_('gold_ingot', 3, E, 1, 12, 10), T_(E, 1, 'lapis_lazuli', 1, 12, 5)],
    [T_(E, 4, 'glowstone', 1, 12, 10)],
    [T_('glass_bottle', 9, E, 1, 12, 30), T_(E, 5, 'ender_pearl', 1, 12, 15)],
    [T_('nether_wart', 22, E, 1, 12, 30)],
  ],
  farmer: [
    [T_('wheat', 20, E, 1, 16, 2), T_('potato', 26, E, 1, 16, 2), T_('carrot', 22, E, 1, 16, 2), T_('beetroot', 15, E, 1, 16, 2), T_(E, 1, 'bread', 6, 16, 1)],
    [T_('pumpkin', 6, E, 1, 12, 10), T_(E, 1, 'pumpkin_pie', 4, 12, 5), T_(E, 1, 'apple', 4, 16, 5)],
    [T_(E, 1, 'cookie', 18, 12, 10), T_('melon', 4, E, 1, 12, 20)],
    [T_(E, 1, 'pumpkin_pie', 4, 12, 15)],
    [T_(E, 3, 'golden_apple', 1, 12, 30)],
  ],
  fisherman: [
    [T_('string', 20, E, 1, 16, 2), T_('coal', 10, E, 1, 16, 2), T_(E, 1, 'cooked_cod', 6, 16, 1, 'cod', 6)],
    [T_('cod', 15, E, 1, 16, 10), T_(E, 1, 'cooked_salmon', 6, 16, 5, 'salmon', 6), T_(E, 2, 'campfire', 1, 12, 5)],
    [T_('salmon', 13, E, 1, 16, 20)],
    [T_('cod', 15, E, 1, 12, 30)],
    [T_('salmon', 13, E, 1, 12, 30)],
  ],
  fletcher: [
    [T_('stick', 32, E, 1, 16, 2), T_(E, 1, 'arrow', 16, 12, 1), T_(E, 1, 'flint', 10, 12, 1, 'gravel', 10)],
    [T_('flint', 26, E, 1, 12, 10), T_(E, 2, 'bow', 1, 12, 5)],
    [T_('string', 14, E, 1, 16, 20)],
    [T_('feather', 24, E, 1, 16, 30)],
    [T_('tripwire_hook', 8, E, 1, 12, 30)],
  ],
  leatherworker: [
    [T_('leather', 6, E, 1, 16, 2), T_(E, 3, 'leather_leggings', 1, 12, 1), T_(E, 7, 'leather_chestplate', 1, 12, 1)],
    [T_('flint', 26, E, 1, 12, 10), T_(E, 5, 'leather_helmet', 1, 12, 5), T_(E, 4, 'leather_boots', 1, 12, 5)],
    [T_('leather', 9, E, 1, 12, 20)],
    [T_(E, 6, 'leather_helmet', 1, 12, 15)],
    [T_(E, 6, 'leather_boots', 1, 12, 30)],
  ],
  librarian: [
    [T_('paper', 24, E, 1, 16, 2), T_(E, 9, 'bookshelf', 1, 12, 1)],
    [T_('book', 4, E, 1, 12, 10), T_(E, 1, 'lantern', 1, 12, 5)],
    [T_(E, 1, 'glass', 4, 12, 10)],
    [T_('book', 4, E, 1, 12, 15)],
    [T_(E, 20, 'golden_apple', 1, 12, 30)],
  ],
  mason: [
    [T_('clay_ball', 10, E, 1, 16, 2), T_(E, 1, 'bricks', 10, 16, 1)],
    [T_('stone', 20, E, 1, 16, 10), T_(E, 1, 'chiseled_stone_bricks', 4, 16, 5)],
    [T_('granite', 16, E, 1, 16, 20), T_('andesite', 16, E, 1, 16, 20), T_('diorite', 16, E, 1, 16, 20), T_(E, 1, 'polished_andesite', 4, 16, 10), T_(E, 1, 'polished_diorite', 4, 16, 10), T_(E, 1, 'polished_granite', 4, 16, 10)],
    [T_('quartz', 12, E, 1, 12, 30), T_(E, 1, 'orange_terracotta', 1, 12, 15), T_(E, 1, 'white_glazed_terracotta', 1, 12, 15), T_(E, 1, 'light_blue_glazed_terracotta', 1, 12, 15)],
    [T_(E, 1, 'quartz_block', 1, 12, 30)],
  ],
  shepherd: [
    [T_('white_wool', 18, E, 1, 16, 2), T_('brown_wool', 18, E, 1, 16, 2), T_('black_wool', 18, E, 1, 16, 2), T_('gray_wool', 18, E, 1, 16, 2), T_(E, 2, 'shears', 1, 12, 1)],
    [T_(E, 1, 'white_wool', 1, 16, 5), T_(E, 1, 'red_wool', 1, 16, 5), T_(E, 1, 'white_carpet', 4, 16, 5), T_(E, 1, 'red_carpet', 4, 16, 5)],
    [T_(E, 3, 'white_bed', 1, 12, 10), T_(E, 3, 'red_bed', 1, 12, 10), T_(E, 3, 'blue_bed', 1, 12, 10)],
    [T_(E, 3, 'yellow_bed', 1, 12, 15)],
    [T_(E, 2, 'black_carpet', 4, 12, 30)],
  ],
  toolsmith: [
    [T_('coal', 15, E, 1, 16, 2), T_(E, 1, 'stone_axe', 1, 12, 1), T_(E, 1, 'stone_shovel', 1, 12, 1), T_(E, 1, 'stone_pickaxe', 1, 12, 1), T_(E, 1, 'stone_hoe', 1, 12, 1)],
    [T_('iron_ingot', 4, E, 1, 12, 10), T_(E, 36, 'bell', 1, 12, 5)],
    [T_('flint', 30, E, 1, 12, 20), T_(E, 4, 'diamond_hoe', 1, 3, 10)],
    [T_('diamond', 1, E, 1, 12, 30), T_(E, 17, 'diamond_axe', 1, 3, 15), T_(E, 10, 'diamond_shovel', 1, 3, 15)],
    [T_(E, 18, 'diamond_pickaxe', 1, 3, 30)],
  ],
  weaponsmith: [
    [T_('coal', 15, E, 1, 16, 2), T_(E, 3, 'iron_axe', 1, 12, 1), T_(E, 2, 'iron_sword', 1, 12, 1)],
    [T_('iron_ingot', 4, E, 1, 12, 10), T_(E, 36, 'bell', 1, 12, 5)],
    [T_('flint', 24, E, 1, 12, 20)],
    [T_('diamond', 1, E, 1, 12, 30), T_(E, 17, 'diamond_axe', 1, 3, 15)],
    [T_(E, 13, 'diamond_sword', 1, 3, 30)],
  ],
};
const LEVEL_XP = [0, 10, 70, 150, 250];
const LEVEL_CN = ['新手', '学徒', '老手', '专家', '大师'];
const hasItem = (k) => ITEM_KEY[k] !== undefined;

// a villager's offers: two random trades per level reached (the order is kept once chosen)
Villager.prototype.offers = function () {
  if (!this.trades) { this.trades = []; this.vlevel = 1; this.vxp = 0; this.addLevelTrades(1); }
  return this.trades;
};
Villager.prototype.addLevelTrades = function (lvl) {
  const L = (TRADES[this.profession] || [])[lvl - 1] || [];
  const pool = L.filter(t => hasItem(t.a) && hasItem(t.r) && (!t.b || hasItem(t.b)));
  for (let n = 0; n < 2 && pool.length; n++) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    this.trades.push({ ...t, used: 0 });
  }
};
Villager.prototype.gainXp = function (xp) {
  this.vxp += xp;
  while (this.vlevel < 5 && this.vxp >= LEVEL_XP[this.vlevel]) {
    this.vlevel++; this.addLevelTrades(this.vlevel);
    for (let i = 0; i < 8; i++) this.game.particles.spawn('happy_villager', this.pos[0] + (Math.random() - 0.5), this.pos[1] + 1 + Math.random(), this.pos[2] + (Math.random() - 0.5), 0, 0.05, 0);
  }
};
// restock at most twice a day (vanilla: at the workstation)
Villager.prototype.restock = function () {
  const day = Math.floor((this.game.time || 0) / 12000);
  if (this.restockDay === day) return;
  this.restockDay = day;
  for (const t of this.trades || []) t.used = 0;
};

class MerchantScreen extends ContainerScreen {
  constructor(game, v) {
    super(game, 'villager_gui', 276, 166, null);
    this.v = v; v.restock && v.restock(); v.offers();
    this.sel = 0; this.scroll = 0;
    this.pay = [null, null]; this.out = null;
    this.slots.push({ x: 136, y: 37, get: () => this.pay[0], set: (s) => { this.pay[0] = s; this.update(); }, group: 'container' });
    this.slots.push({ x: 162, y: 37, get: () => this.pay[1], set: (s) => { this.pay[1] = s; this.update(); }, group: 'container' });
    this.slots.push({ x: 220, y: 37, output: true, get: () => this.out, set: (s) => { this.out = s; }, onTake: (st) => this.trade() });
    const inv = game.player.inv;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const i = 9 + r * 9 + c; this.slots.push({ x: 108 + c * 18, y: 84 + r * 18, get: () => inv.slots[i], set: (s) => { inv.slots[i] = s; }, group: 'main', idx: i }); }
    for (let c = 0; c < 9; c++) this.slots.push({ x: 108 + c * 18, y: 142, get: () => inv.slots[c], set: (s) => { inv.slots[c] = s; }, group: 'hotbar', idx: c });
    this.pick(0);
  }
  get title2() { return PROFESSION_CN[this.v.profession] + ' - ' + LEVEL_CN[(this.v.vlevel || 1) - 1]; }
  offer() { return this.v.offers()[this.sel]; }
  matches(st, k, n) { return st && st.id === ITEM_KEY[k] && st.count >= n; }
  update() {
    const o = this.offer();
    this.out = o && o.used < o.uses && this.matches(this.pay[0], o.a, o.an) && (!o.b || this.matches(this.pay[1], o.b, o.bn)) ? makeStack(o.r, o.rn) : null;
  }
  // choosing an offer moves its costs from the inventory into the payment slots (like vanilla)
  pick(i) {
    this.sel = i;
    const inv = this.game.player.inv, o = this.offer();
    for (let k = 0; k < 2; k++) if (this.pay[k]) { this.giveBack(this.pay[k]); this.pay[k] = null; }
    if (o) [[o.a, o.an, 0], [o.b, o.bn, 1]].forEach(([key, n, k]) => {
      if (!key) return;
      const id = ITEM_KEY[key];
      let want = maxStack(id);
      for (let s = 0; s < 36 && want > 0; s++) {
        const st = inv.slots[s];
        if (!st || st.id !== id) continue;
        const take = Math.min(st.count, want); want -= take; st.count -= take;
        if (!st.count) inv.slots[s] = null;
        if (this.pay[k]) this.pay[k].count += take; else this.pay[k] = { id, count: take, dmg: 0 };
      }
    });
    this.update();
  }
  // (add gives back what did not fit: 0 is all of it - read the other way round the payment was both put back and
  // dropped, emeralds doubling at every change of offer: players' feedback 2026-10-31)
  giveBack(st) { const left = this.game.player.inv.add(st); if (left > 0) this.game.dropFromPlayer({ ...st, count: left }); }
  trade() {
    const o = this.offer();
    if (!o) return;
    this.pay[0].count -= o.an; if (!this.pay[0].count) this.pay[0] = null;
    if (o.b) { this.pay[1].count -= o.bn; if (!this.pay[1].count) this.pay[1] = null; }
    o.used++;
    this.v.gainXp(o.xp);
    this.game.addXp && this.game.addXp(3 + Math.floor(Math.random() * 4));
    Sound.ev('entity.villager.yes', this.v.pos, 1, 1);
    // refill the payment from the inventory to keep trading
    const keep = this.sel; this.pick(keep);
  }
  close() { for (let k = 0; k < 2; k++) if (this.pay[k]) { this.giveBack(this.pay[k]); this.pay[k] = null; } this.out = null; }
  offerAt(mx, my) {
    const rx = mx - this.x - 5, ry = my - this.y - 18;
    if (rx < 0 || rx >= 88 || ry < 0) return -1;
    const i = Math.floor(ry / 20) + this.scroll;
    return ry < 140 && i < this.v.offers().length ? i : -1;
  }
  mouseDown(ui, mx, my, button, shift) {
    const i = this.offerAt(mx, my);
    if (i >= 0) { this.pick(i); Sound.click && Sound.click(); return; }
    super.mouseDown(ui, mx, my, button, shift);
  }
  wheel(ui, d) { const n = this.v.offers().length; this.scroll = clamp(this.scroll + Math.sign(d), 0, Math.max(0, n - 7)); }
  drawExtra(ui) {
    const c = ui.ctx, I = ui.img, v = this.v, offers = v.offers();
    const t = this.title2;
    Font.draw(c, t, this.x + 49 + 138 - Font.width(t) / 2, this.y + 6, '#404040', false);
    Font.draw(c, '交易', this.x + 5 - Font.width('交易') / 2 + 48, this.y + 6, '#404040', false);
    Font.draw(c, '物品栏', this.x + 107, this.y + 72, '#404040', false);
    // experience bar
    if (I.vxp_bg) {
      c.drawImage(I.vxp_bg, this.x + 136, this.y + 16);
      const lv = v.vlevel || 1;
      if (lv < 5 && I.vxp_cur) {
        const a = LEVEL_XP[lv - 1], b = LEVEL_XP[lv], w = Math.min(102, Math.floor(102 * (v.vxp - a) / (b - a)));
        if (w > 0) c.drawImage(I.vxp_cur, 0, 0, w, 5, this.x + 136, this.y + 16, w, 5);
      }
    }
    // offer buttons
    const hov = this.offerAt(ui.mouse.x, ui.mouse.y);
    for (let r = 0; r < 7; r++) {
      const i = r + this.scroll, o = offers[i];
      if (!o) break;
      const bx = this.x + 5, by = this.y + 18 + r * 20;
      ui.nine(i === hov || i === this.sel ? 'button_hl' : 'button', bx, by, 88, 20, 3);
      const iy = by + 1;
      ui.drawItem(makeStack(o.a, o.an), this.x + 10, iy);
      if (o.b) ui.drawItem(makeStack(o.b, o.bn), this.x + 40, iy);
      const arrow = o.used >= o.uses ? I.trade_arrow_out : I.trade_arrow;
      if (arrow) c.drawImage(arrow, this.x + 60, by + 5);
      ui.drawItem(makeStack(o.r, o.rn), this.x + 73, iy);
    }
    if (offers.length > 7 && I.v_scroller) c.drawImage(I.v_scroller, this.x + 94, this.y + 18 + Math.floor(this.scroll / Math.max(1, offers.length - 7) * 112));
    const o = this.offer();
    if (o && o.used >= o.uses && I.out_of_stock) c.drawImage(I.out_of_stock, this.x + 186, this.y + 35);
    if (hov >= 0 && !ui.cursor) {
      const q = offers[hov], mx = ui.mouse.x;
      const which = mx < this.x + 36 ? makeStack(q.a, q.an) : mx < this.x + 60 && q.b ? makeStack(q.b, q.bn) : mx >= this.x + 70 ? makeStack(q.r, q.rn) : null;
      if (which) this.tipLater = which;
    }
  }
  draw(ui) {
    this.tipLater = null;
    super.draw(ui);
    if (this.tipLater) ui.tooltip(ui.itemLines(this.tipLater), ui.mouse.x, ui.mouse.y);
  }
}
