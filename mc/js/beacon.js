'use strict';
// ---------------------------------------------------------------------------
// Beacons (vanilla BeaconBlockEntity, BeaconRenderer, BeaconScreen): the pyramid under one (up to 4 levels of iron,
// gold, emerald, diamond or netherite blocks), its beam (coloured by stained glass on the way up, stopped by anything
// opaque but bedrock), the powers it gives the players around it every 4 seconds, and the screen for paying and
// choosing them. On a server the server gives the powers and keeps the choice; the beam and the screen are this
// game's (the screen reads the window's properties and sends set_beacon_effect).
// ---------------------------------------------------------------------------
const BEACON_POWERS = [['speed', 'haste'], ['resistance', 'jump_boost'], ['strength'], ['regeneration']];
const BEACON_BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block'].map((k) => BID[k]).filter((v) => v !== undefined));
const BEACON_PAY = /^(iron_ingot|gold_ingot|emerald|diamond|netherite_ingot)$/;
const beaconTier = (key) => BEACON_POWERS.findIndex((t) => t.includes(key));
// the colour a block gives the beam (stained glass and panes, the beacon itself white), -1 for the others
const BEAM_COLOR = new Int32Array(MAX_BLOCKS).fill(-1);
for (let id = 0; id < MAX_BLOCKS; id++) { const b = BLOCKS[id], m = b && /^(.+)_stained_glass(_pane)?$/.exec(b.key); if (m && DYE_RGB[m[1]] !== undefined) BEAM_COLOR[id] = DYE_RGB[m[1]]; }
if (BID.beacon !== undefined) BEAM_COLOR[BID.beacon] = DYE_RGB.white;
const beamAvg = (a, b) => (((((a >> 16) & 255) + ((b >> 16) & 255)) >> 1) << 16) | (((((a >> 8) & 255) + ((b >> 8) & 255)) >> 1) << 8) | (((a & 255) + (b & 255)) >> 1);

// the beam's sections from the beacon up: the first glass sets the colour, each different one after mixes in
// (vanilla ARGB.average); empty when something opaque is in the way
function beaconBeam(w, x, y, z) {
  const segs = [];
  for (let yy = y; yy < HEIGHT; yy++) {
    const id = yy === y ? BID.beacon : w.getBlock(x, yy, z), c = BEAM_COLOR[id], last = segs[segs.length - 1];
    if (c >= 0) {
      if (segs.length <= 1) segs.push({ y: yy, h: 1, c });
      else if (c === last.c) last.h++;
      else segs.push({ y: yy, h: 1, c: beamAvg(last.c, c) });
    } else {
      if (OPACITY[id] >= 15 && id !== BID.bedrock) return [];
      last.h++;
    }
  }
  return segs;
}
// how many full layers of the pyramid are under it (vanilla updateBase)
function beaconLevels(w, x, y, z) {
  let lv = 0;
  for (let i = 1; i <= 4; i++) {
    const yy = y - i; if (yy < 0) break;
    for (let a = x - i; a <= x + i; a++) for (let b = z - i; b <= z + i; b++) if (!BEACON_BASE.has(w.getBlock(a, yy, b))) return lv;
    lv = i;
  }
  return lv;
}

// the beacons in the loaded chunks: looked for in the sections' palettes (cheap), their beams and levels worked out
// again each time (a second apart)
Game.prototype.beaconScan = function () {
  const w = this.world, B = BID.beacon, old = this.beacons || new Map(), now = new Map();
  if (!w || B === undefined) return;
  for (const ch of w.chunks.values()) for (let s = 0; s < ch.bs.length; s++) {
    const sec = ch.bs[s]; if (!sec) continue;
    let want = -1;
    if (sec.n < 0) want = B; else for (let k = 0; k < sec.n; k++) if (sec.p[k] === B) { want = k; break; }
    if (want < 0) continue;
    for (let j = sec.d.indexOf(want); j >= 0; j = sec.d.indexOf(want, j + 1)) {
      const x = ch.cx * 16 + (j & 15), y = s * 16 + (j >> 8), z = ch.cz * 16 + ((j >> 4) & 15), k = x + ',' + y + ',' + z;
      const st = old.get(k) || { pos: [x, y, z] };
      st.segs = beaconBeam(w, x, y, z); st.levels = beaconLevels(w, x, y, z);
      if (st.on === undefined) st.on = st.levels > 0 && st.segs.length > 0; // (found already lit: no sound)
      now.set(k, st);
    }
  }
  this.beacons = now;
};

// the powers, every 80 ticks (vanilla applyEffects): the range and time grow with the levels; level II of the
// first power when both choices are the same (4 levels), else the second one (regeneration) as well
const _beaconTick = Game.prototype.tickFurnaces;
Game.prototype.tickFurnaces = function () {
  _beaconTick.call(this);
  if (this.net || !this.beacons) return;
  this.beaconT = ((this.beaconT || 0) + 1) % 80; if (this.beaconT) return;
  const w = this.world, p = this.player;
  for (const [k, st] of this.beacons) {
    const [x, y, z] = st.pos; if (!w.isLoaded(x, z) || w.getBlock(x, y, z) !== BID.beacon) continue;
    st.levels = beaconLevels(w, x, y, z); st.segs = beaconBeam(w, x, y, z);
    const on = st.levels > 0 && st.segs.length > 0, c = [x + 0.5, y + 0.5, z + 0.5];
    if (on !== st.on) { Sound.ev(on ? 'block.beacon.activate' : 'block.beacon.deactivate', c, 1, 1); st.on = on; }
    if (!on) continue;
    Sound.ev('block.beacon.ambient', c, 1, 1);
    const be = this.blockEntities.get(k); if (!be || !be.primary || !p || p.deathTime) continue;
    const lv = st.levels, r = lv * 10 + 10, dur = (9 + lv * 2) * 20, amp = lv >= 4 && be.primary === be.secondary ? 1 : 0;
    const P = p.pos, near = P[0] > x - r - 0.3 && P[0] < x + 1 + r + 0.3 && P[2] > z - r - 0.3 && P[2] < z + 1 + r + 0.3 && P[1] + 1.8 > y - r;
    if (!near) continue;
    p.addEffect(be.primary, amp, dur, true);
    if (lv >= 4 && be.secondary && be.secondary !== be.primary) p.addEffect(be.secondary, 0, dur, true);
  }
};
// a beacon's own state (single player): the two choices, kept with the world
Game.prototype.beaconEntity = function (x, y, z) {
  const k = `${x},${y},${z}`;
  let be = this.blockEntities.get(k);
  if (!be || be.type !== 'beacon') { be = { type: 'beacon', pos: [x, y, z], primary: null, secondary: null }; this.blockEntities.set(k, be); }
  return be;
};

// the beams (vanilla BeaconRenderer: an inner beam and a wider faint glow, the texture running up; on past the
// top of the world)
const _beaconDraw = Game.prototype.drawChests;
Game.prototype.drawChests = function (a, env) {
  _beaconDraw.call(this, a, env);
  const now = performance.now();
  if (!this.beaconAt || now - this.beaconAt > 1000) { this.beaconAt = now; this.beaconScan(); }
  if (!this.beacons || !this.beacons.size) return;
  const r = this.renderer, t = (this.worldTime % 40) + a, cam = r.camPos;
  for (const st of this.beacons.values()) {
    if (!st.levels || !st.segs.length) continue;
    const [x, , z] = st.pos;
    if (Math.hypot(x + 0.5 - cam[0], z + 0.5 - cam[2]) > (this.settings.renderDist || 12) * 16 + 32) continue;
    st.segs.forEach((s, i) => {
      const top = i === st.segs.length - 1 ? s.y + 1024 : s.y + s.h;
      const col = [((s.c >> 16) & 255) / 255, ((s.c >> 8) & 255) / 255, (s.c & 255) / 255];
      const lo = [x + 0.5, s.y, z + 0.5], hi = [x + 0.5, top, z + 0.5], scroll = -t * 0.2 + s.y / 4;
      r.drawBeam(lo, hi, 'beacon_beam', 0.2, [col[0], col[1], col[2], 1], scroll, 'alpha');
      r.drawBeam(lo, hi, 'beacon_beam', 0.25, [col[0], col[1], col[2], 0.125], scroll * 0.5, 'alpha');
    });
  }
};

// ---- the screen (vanilla BeaconScreen: 230x219, the payment slot, the powers in rows by level) ----
class BeaconScreen extends StationScreen {
  // st: what it reads - single player: the block entity and the scan's levels; a server: the window's properties
  constructor(game, pos, view) {
    super(game, 'gui_beacon', '', pos);
    this.gw = 230; this.gh = 219; this.view = view;
    this.own(0, 136, 110, { accept: (s) => BEACON_PAY.test(ITEMS[s.id].key), max: 1 });
    this.addPlayerSlots(137, 195);
    for (const s of this.slots) if (s.group === 'main' || s.group === 'hotbar') s.x += 28;
    this.primary = view.primary; this.secondary = view.secondary;
  }
  // the buttons: [kind, effect, x, y, tier] (kind: 'p' first power, 's' second, 'up' level II, 'ok', 'no')
  buttons() {
    const out = [];
    for (let i = 0; i <= 2; i++) {
      const row = BEACON_POWERS[i], n = row.length, w = n * 22 + (n - 1) * 2;
      row.forEach((e, l) => out.push({ kind: 'p', e, x: 76 + l * 24 - Math.floor(w / 2), y: 22 + i * 25, tier: i }));
    }
    const n = BEACON_POWERS[3].length + 1, w = n * 22 + (n - 1) * 2;
    BEACON_POWERS[3].forEach((e, l) => out.push({ kind: 's', e, x: 167 + l * 24 - Math.floor(w / 2), y: 47, tier: 3 }));
    out.push({ kind: 'up', e: this.primary, x: 167 + (n - 1) * 24 - Math.floor(w / 2), y: 47, tier: 3 });
    out.push({ kind: 'ok', x: 164, y: 107 }, { kind: 'no', x: 190, y: 107 });
    return out;
  }
  levels() { return this.view.levels; }
  active(b) {
    const lv = this.levels();
    if (b.kind === 'p') return b.tier < lv;
    if (b.kind === 's' || b.kind === 'up') return lv >= 4 && !!this.primary && !!b.e;
    if (b.kind === 'ok') return !!this.S(0) && !!this.primary;
    return true;
  }
  selected(b) { return (b.kind === 'p' && b.e === this.primary) || (b.kind === 's' && b.e === this.secondary) || (b.kind === 'up' && !!b.e && b.e === this.secondary); }
  buttonIndex(mx, my) { return this.buttons().findIndex((b) => mx >= this.x + b.x && my >= this.y + b.y && mx < this.x + b.x + 22 && my < this.y + b.y + 22); }
  buttonAt(mx, my) { return this.buttons()[this.buttonIndex(mx, my)] || null; }
  press(b) {
    if (!b || !this.active(b)) return;
    Sound.click && Sound.click();
    if (b.kind === 'p') { this.primary = b.e; if (this.secondary && this.secondary !== 'regeneration' && this.secondary !== b.e) this.secondary = null; }
    else if (b.kind === 's' || b.kind === 'up') this.secondary = b.e;
    else if (b.kind === 'ok') this.confirm();
    else this.game.ui.close();
  }
  confirm() {
    const g = this.game;
    if (this.view.send) { this.view.send(this.primary, this.secondary); g.ui.close(); return; }
    const be = g.beaconEntity(...this.pos), pay = this.held[0];
    if (!pay) return;
    pay.count--; if (!pay.count) this.held[0] = null;
    be.primary = this.primary; be.secondary = this.secondary;
    Sound.ev('block.beacon.power_select', [this.pos[0] + 0.5, this.pos[1] + 0.5, this.pos[2] + 0.5], 1, 1);
    g.ui.close();
  }
  mouseDown(ui, mx, my, button, shift) { const b = this.buttonAt(mx, my); if (b) { if (button === 0) this.press(b); return; } super.mouseDown(ui, mx, my, button, shift); }
  // (on a server the window's mouse handling goes first: the buttons through offerAt / pick)
  offerAt(mx, my) { return this.buttonIndex(mx, my); }
  pick(i) { this.press(this.buttons()[i]); }
  drawExtra(ui) {
    const c = ui.ctx;
    // (no title and no "inventory" label, like vanilla)
    Font.center(c, '主效果', this.x + 62, this.y + 10, '#E0E0E0', true);
    Font.center(c, '辅助效果', this.x + 169, this.y + 10, '#E0E0E0', true);
    let tip = null;
    for (const b of this.buttons()) {
      const X = this.x + b.x, Y = this.y + b.y, on = this.active(b), hov = ui.hit({ x: X, y: Y, w: 22, h: 22 });
      ui.sprite(!on ? 'beacon_button_disabled' : this.selected(b) ? 'beacon_button_selected' : hov ? 'beacon_button_highlighted' : 'beacon_button', X, Y);
      if (b.kind === 'ok' || b.kind === 'no') { ui.sprite(b.kind === 'ok' ? 'beacon_confirm' : 'beacon_cancel', X + 2, Y + 2); if (hov) tip = [{ text: b.kind === 'ok' ? '完成' : '取消' }]; continue; }
      if (!b.e) continue;
      if (ui.img['eff_' + b.e]) { c.globalAlpha = on ? 1 : 0.5; ui.sprite('eff_' + b.e, X + 2, Y + 2, 18, 18); c.globalAlpha = 1; }
      if (hov) tip = [{ text: EFFECTS[b.e].cn + (b.kind === 'up' ? ' II' : '') }];
    }
    // what pays for it
    ['netherite_ingot', 'emerald', 'diamond', 'gold_ingot', 'iron_ingot'].forEach((k, i) => { if (ITEM_KEY[k] !== undefined) ui.drawItem({ id: ITEM_KEY[k], count: 1 }, this.x + [20, 41, 63, 86, 108][i], this.y + 109); });
    this.tip = tip;
  }
  draw(ui) { super.draw(ui); if (this.tip && !ui.cursor) ui.tooltip(this.tip, ui.mouse.x, ui.mouse.y); }
}

// opening one: single player keeps the choice in the block entity; the levels come from the scan
WORKSTATIONS.beacon = (g, pos) => {
  const be = g.beaconEntity(...pos), k = pos.join(','), view = { primary: be.primary, secondary: be.secondary, get levels() { const st = g.beacons && g.beacons.get(k); return st ? st.levels : beaconLevels(g.world, ...pos); } };
  return new BeaconScreen(g, pos, view);
};
if (BID.beacon !== undefined) BLOCKS[BID.beacon].onUse = 'beacon';
// on a server: properties 0 the levels, 1 and 2 the choices (registry number + 1, 0 none); the server's choices
// replace the screen's when they change (vanilla's data listener)
NET_STATION.beacon = (n, w) => {
  const P = w.props, eff = (v) => (v > 0 && EFFECT_LIST[v - 1] ? EFFECT_LIST[v - 1][0] : null);
  const sc = new BeaconScreen(n.g, null, { get levels() { return P[0] || 0; }, primary: eff(P[1]), secondary: eff(P[2]),
    send: (p, s) => n.send({ t: 'beacon', p: p ? EFFECTS[p].id : null, s: s ? EFFECTS[s].id : null }) });
  let seen = (P[1] | 0) + ',' + (P[2] | 0);
  const de = sc.drawExtra;
  sc.drawExtra = function (ui) { const k = (P[1] | 0) + ',' + (P[2] | 0); if (k !== seen) { seen = k; this.primary = eff(P[1]); this.secondary = eff(P[2]); } de.call(this, ui); };
  return sc;
};
