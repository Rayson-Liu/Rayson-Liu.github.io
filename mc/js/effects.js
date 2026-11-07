'use strict';
// ---------------------------------------------------------------------------
// Status effects (vanilla's mob effects) on living things, potions, and what foods and drinks do.
// An effect: { amp (0 = level I), dur (ticks left, -1 = infinite), ambient }. On a server the server keeps them
// (net.js): here they only count down and change how this player moves, mines and sees.
// ---------------------------------------------------------------------------
// registry order (the protocol's effect ids), Chinese name, kind (1 good, -1 bad, 0 neutral), particle colour
const EFFECT_LIST = [
  ['speed', '速度', 1, 0x33EBFF], ['slowness', '缓慢', -1, 0x8BAFE0], ['haste', '急迫', 1, 0xD9C043], ['mining_fatigue', '挖掘疲劳', -1, 0x4A4217],
  ['strength', '力量', 1, 0xFFC700], ['instant_health', '瞬间治疗', 1, 0xF82423], ['instant_damage', '瞬间伤害', -1, 0xA9656A], ['jump_boost', '跳跃提升', 1, 0xFDFF84],
  ['nausea', '反胃', -1, 0x551D4A], ['regeneration', '生命恢复', 1, 0xCD5CAB], ['resistance', '抗性提升', 1, 0x9146F0], ['fire_resistance', '抗火', 1, 0xFF9900],
  ['water_breathing', '水下呼吸', 1, 0x98DAC0], ['invisibility', '隐身', 1, 0xF6F6F6], ['blindness', '失明', -1, 0x1F1F23], ['night_vision', '夜视', 1, 0xC2FF66],
  ['hunger', '饥饿', -1, 0x587653], ['weakness', '虚弱', -1, 0x484D48], ['poison', '中毒', -1, 0x87A363], ['wither', '凋零', -1, 0x736156],
  ['health_boost', '生命提升', 1, 0xF87D23], ['absorption', '伤害吸收', 1, 0x2552A5], ['saturation', '饱和', 1, 0xF82423], ['glowing', '发光', 0, 0x94A061],
  ['levitation', '飘浮', -1, 0xCEFFFF], ['luck', '幸运', 1, 0x59C106], ['unluck', '霉运', -1, 0xC0A44D], ['slow_falling', '缓降', 1, 0xF3CFB9],
  ['conduit_power', '潮涌能量', 1, 0x1DC2D1], ['dolphins_grace', '海豚的恩惠', 1, 0x88A3BE], ['bad_omen', '不祥之兆', 0, 0x0B6138], ['hero_of_the_village', '村庄英雄', 1, 0x44FF44],
  ['darkness', '黑暗', -1, 0x292721], ['trial_omen', '试炼之兆', 0, 0x16A6A6], ['raid_omen', '袭击之兆', 0, 0xDE4058], ['wind_charged', '蓄风', -1, 0xBDC9FF],
  ['weaving', '盘丝', -1, 0x78695A], ['oozing', '渗浆', -1, 0x99FFA3], ['infested', '寄生', -1, 0x8C9B8C], ['breath_of_the_nautilus', '鹦鹉螺之息', 1, 0x4AD7E7],
];
const EFFECTS = {};
EFFECT_LIST.forEach(([k, cn, kind, color], i) => { EFFECTS[k] = { key: k, id: i, cn, kind, color }; });
const romanLevel = (amp) => amp > 0 ? ' ' + (['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][amp] || String(amp + 1)) : '';

// potions: their effects [effect, ticks, amp]
const POTIONS = {
  water: [], mundane: [], thick: [], awkward: [],
  night_vision: [['night_vision', 3600, 0]], long_night_vision: [['night_vision', 9600, 0]],
  invisibility: [['invisibility', 3600, 0]], long_invisibility: [['invisibility', 9600, 0]],
  leaping: [['jump_boost', 3600, 0]], long_leaping: [['jump_boost', 9600, 0]], strong_leaping: [['jump_boost', 1800, 1]],
  fire_resistance: [['fire_resistance', 3600, 0]], long_fire_resistance: [['fire_resistance', 9600, 0]],
  swiftness: [['speed', 3600, 0]], long_swiftness: [['speed', 9600, 0]], strong_swiftness: [['speed', 1800, 1]],
  slowness: [['slowness', 1800, 0]], long_slowness: [['slowness', 4800, 0]], strong_slowness: [['slowness', 400, 3]],
  turtle_master: [['slowness', 400, 3], ['resistance', 400, 2]], long_turtle_master: [['slowness', 800, 3], ['resistance', 800, 2]], strong_turtle_master: [['slowness', 400, 5], ['resistance', 400, 3]],
  water_breathing: [['water_breathing', 3600, 0]], long_water_breathing: [['water_breathing', 9600, 0]],
  healing: [['instant_health', 1, 0]], strong_healing: [['instant_health', 1, 1]],
  harming: [['instant_damage', 1, 0]], strong_harming: [['instant_damage', 1, 1]],
  poison: [['poison', 900, 0]], long_poison: [['poison', 1800, 0]], strong_poison: [['poison', 432, 1]],
  regeneration: [['regeneration', 900, 0]], long_regeneration: [['regeneration', 1800, 0]], strong_regeneration: [['regeneration', 450, 1]],
  strength: [['strength', 3600, 0]], long_strength: [['strength', 9600, 0]], strong_strength: [['strength', 1800, 1]],
  weakness: [['weakness', 1800, 0]], long_weakness: [['weakness', 4800, 0]],
  luck: [['luck', 6000, 0]], slow_falling: [['slow_falling', 1800, 0]], long_slow_falling: [['slow_falling', 4800, 0]],
  wind_charged: [['wind_charged', 3600, 0]], weaving: [['weaving', 3600, 0]], oozing: [['oozing', 3600, 0]], infested: [['infested', 3600, 0]],
};
// a potion's colour: the effects' colours mixed (water's blue when it has none)
function potionColor(pot) {
  const fx = POTIONS[pot] || [];
  if (!fx.length) return pot === 'water' || !pot ? [56, 93, 198] : [0x38, 0x5D, 0xC6];
  let r = 0, g = 0, b = 0, n = 0;
  for (const [e, , amp] of fx) { const c = EFFECTS[e].color, w = amp + 1; r += ((c >> 16) & 255) * w; g += ((c >> 8) & 255) * w; b += (c & 255) * w; n += w; }
  return [r / n, g / n, b / n].map(Math.round);
}

// foods' extra effects: [effect, ticks, amp, chance]
const FOOD_EFFECTS = {
  golden_apple: [['regeneration', 100, 1, 1], ['absorption', 2400, 0, 1]],
  enchanted_golden_apple: [['regeneration', 400, 1, 1], ['absorption', 2400, 3, 1], ['resistance', 6000, 0, 1], ['fire_resistance', 6000, 0, 1]],
  pufferfish: [['hunger', 300, 2, 1], ['nausea', 300, 0, 1], ['poison', 1200, 1, 1]],
  spider_eye: [['poison', 100, 0, 1]], poisonous_potato: [['poison', 100, 0, 0.6]], rotten_flesh: [['hunger', 600, 0, 0.8]], chicken: [['hunger', 600, 0, 0.3]],
};
const FOOD_LEFTOVER = { mushroom_stew: 'bowl', beetroot_soup: 'bowl', rabbit_stew: 'bowl', suspicious_stew: 'bowl', honey_bottle: 'glass_bottle' };
const ALWAYS_EDIBLE = new Set(['golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'honey_bottle', 'suspicious_stew']);
const EAT_TICKS = { dried_kelp: 16, honey_bottle: 40 };
// the foods this game had no numbers for: vanilla's (itemdata.js)
for (const d of (self.ITEM_DATA || [])) { const it = ITEMS[ITEM_KEY[d.key]]; if (it && d.food && !it.food) it.food = d.food; }
if (ITEM_KEY.golden_apple !== undefined) delete ITEMS[ITEM_KEY.golden_apple].heal; // its regeneration does that

// ---- effects on living things ----
Object.assign(Living.prototype, {
  addEffect(key, amp, dur, ambient = false) {
    const E = EFFECTS[key]; if (!E) return;
    const fx = this.effects || (this.effects = new Map()), cur = fx.get(key);
    // instant ones act once
    if (key === 'instant_health' || key === 'instant_damage') { this.instantEffect(key, amp); return; }
    if (key === 'saturation' && this === this.game.player && !this.game.net) { this.food = Math.min(20, this.food + amp + 1); this.saturation = Math.min(this.food, this.saturation + 2 * (amp + 1)); }
    // a stronger or longer one replaces it
    if (cur && (cur.amp > amp || (cur.amp === amp && (cur.dur < 0 || (dur >= 0 && cur.dur >= dur))))) return;
    fx.set(key, { amp, dur, ambient, max: dur });
    if (key === 'health_boost') this.applyHealthBoost();
    if (key === 'absorption') this.absorption = Math.max(this.absorption || 0, 4 * (amp + 1));
  },
  removeEffect(key) {
    if (!this.effects || !this.effects.delete(key)) return;
    if (key === 'health_boost') this.applyHealthBoost();
    if (key === 'absorption') this.absorption = 0;
  },
  clearEffects() { if (this.effects) for (const k of [...this.effects.keys()]) this.removeEffect(k); },
  // the effect's amplifier, or -1 without it
  effectAmp(key) { const e = this.effects && this.effects.get(key); return e ? e.amp : -1; },
  hasEffect(key) { return !!(this.effects && this.effects.has(key)); },
  applyHealthBoost() {
    if (this.baseMaxHealth === undefined) this.baseMaxHealth = this.maxHealth;
    this.maxHealth = this.baseMaxHealth + 4 * (this.effectAmp('health_boost') + 1);
    this.health = Math.min(this.health, this.maxHealth);
  },
  instantEffect(key, amp) {
    if (this.game.net && this === this.game.player) return;
    const undead = this.T && this.T.undead;
    if ((key === 'instant_health') !== !!undead) this.health = Math.min(this.maxHealth, this.health + (4 << amp));
    else this.hurt(6 << amp, { type: 'magic' });
  },
  tickEffects() {
    const fx = this.effects; if (!fx || !fx.size) return;
    const g = this.game, server = !!g.net && this === g.player;
    for (const [k, e] of fx) {
      if (!server && this.health > 0) {
        if (k === 'regeneration') { const p = 50 >> e.amp; if (p < 1 || e.dur % p === 0) if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1); }
        else if (k === 'poison') { const p = 25 >> e.amp; if ((p < 1 || e.dur % p === 0) && this.health > 1) this.hurt(1, { type: 'magic', bypass: true }); }
        else if (k === 'wither') { const p = 40 >> e.amp; if (p < 1 || e.dur % p === 0) this.hurt(1, { type: 'wither', bypass: true }); }
        else if (k === 'hunger' && this.exhaust) this.exhaust(0.005 * (e.amp + 1));
        else if (k === 'saturation' && this === g.player && this.food !== undefined) { this.food = Math.min(20, this.food + e.amp + 1); this.saturation = Math.min(this.food, this.saturation + 2 * (e.amp + 1)); }
      }
      // particles around the entity (not the player's own in first person)
      if (!e.hidden && (this !== g.player || g.perspective) && Math.random() < (e.ambient ? 0.05 : 0.2)) {
        const c = EFFECTS[k].color;
        g.particles.spawn('effect', this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + Math.random() * this.h, this.pos[2] + (Math.random() - 0.5) * this.w, 0, 0.02, 0, { col: [(c >> 16) & 255, (c >> 8) & 255, c & 255] });
      }
      if (e.dur > 0 && --e.dur === 0) this.removeEffect(k);
    }
    this.waterBreatherFx = this.hasEffect('water_breathing') || this.hasEffect('conduit_power') || this.hasEffect('breath_of_the_nautilus');
  },
});
// damage: fire resistance, resistance, absorption hearts
{
  const hurt0 = Living.prototype.hurt;
  Living.prototype.hurt = function (amount, src) {
    const t = src && src.type;
    if ((t === 'fire' || t === 'lava') && this.hasEffect('fire_resistance')) return false;
    const res = this.effectAmp('resistance');
    if (res >= 0 && t !== 'void') { if (res >= 4) return false; amount *= 1 - 0.2 * (res + 1); }
    if (this.absorption > 0 && t !== 'void' && !(src && src.bypass && t === 'magic')) {
      const k = Math.min(this.absorption, amount); this.absorption -= k; amount -= k;
      if (amount <= 0) { this.hurtTime = 10; return true; }
    }
    return hurt0.call(this, amount, src);
  };
  const base0 = Living.prototype.baseTick;
  Living.prototype.baseTick = function () {
    this.tickEffects();
    const wb = this.waterBreather; if (this.waterBreatherFx) this.waterBreather = true;
    base0.call(this);
    this.waterBreather = wb;
  };
}

// ---- what the effects do to this player ----
// walking speed: speed +20% a level, slowness -15% a level
// how near a mob has to be to notice someone (vanilla getVisibilityPercent + TargetingConditions): its range, a fifth
// less for someone sneaking, and for someone invisible 0.7 x how much of their armour shows (at least 0.1) - never
// under 2 blocks
function seenWithin(t, range) {
  let v = 1;
  if (t.sneaking) v *= 0.8;
  if (t.invisible || (t.hasEffect && t.hasEffect('invisibility'))) {
    const arm = (t.inv ? t.inv.slots.slice(36, 40) : (t.armorItems || [])).filter(Boolean).length;
    v *= 0.7 * Math.max(0.1, arm / 4);
  }
  return Math.max(range * v, 2);
}
function effectSpeedFactor(p) { return Math.max(0, (1 + 0.2 * (p.effectAmp('speed') + 1)) * (1 - 0.15 * (p.effectAmp('slowness') + 1))); }
// mining: haste +20% a level, mining fatigue 0.3^level (the fourth level and above 0.00081)
function effectMineFactor(p) {
  let f = 1 + 0.2 * (p.effectAmp('haste') + 1) + 0.2 * (p.effectAmp('conduit_power') + 1);
  const mf = p.effectAmp('mining_fatigue');
  if (mf >= 0) f *= [0.3, 0.09, 0.0027, 0.00081][Math.min(3, mf)];
  return f;
}
// melee: strength +3 a level, weakness -4 a level
function effectAttackBonus(p) { return 3 * (p.effectAmp('strength') + 1) - 4 * (p.effectAmp('weakness') + 1); }
function effectJumpBoost(p) { return 0.1 * (p.effectAmp('jump_boost') + 1); }
// night vision: full brightness, flickering in its last 10 seconds
function nightVisionScale(p) {
  const e = p && p.effects && p.effects.get('night_vision');
  if (!e) return 0;
  return e.dur < 0 || e.dur > 200 ? 1 : 0.7 + Math.sin((e.dur - 1) * Math.PI * 0.2) * 0.3;
}

// ---- eating and drinking ----
Game.prototype.useTicks = function (def) {
  if (def.key === 'potion' || def.key === 'milk_bucket') return 32;
  return EAT_TICKS[def.key] || 32;
};
Game.prototype.canConsume = function (def) {
  const p = this.player;
  if (def.key === 'potion' || def.key === 'milk_bucket') return true;
  return !!def.food && (p.food < 20 || this.mode === 'creative' || ALWAYS_EDIBLE.has(def.key));
};
Game.prototype.finishEating = function (held) {
  const p = this.player, def = ITEMS[held.id], k = def.key;
  if (k === 'potion') {
    for (const [e, t, a] of POTIONS[held.pot] || []) p.addEffect(e, a, t);
    Sound.ev('entity.generic.drink', p.pos, 0.5, 1);
  } else if (k === 'milk_bucket') {
    p.clearEffects(); Sound.ev('entity.generic.drink', p.pos, 0.5, 1);
  } else {
    if (def.food) { p.food = Math.min(20, p.food + def.food[0]); p.saturation = Math.min(p.food, p.saturation + def.food[1]); }
    for (const [e, t, a, ch] of FOOD_EFFECTS[k] || []) if (Math.random() < ch) p.addEffect(e, a, t);
    if (k === 'honey_bottle') p.removeEffect('poison');
    if (k === 'suspicious_stew' && held.stew) for (const [e, t] of held.stew) p.addEffect(e, 0, t);
    if (k === 'chorus_fruit') this.chorusTeleport();
    Sound.burp(p.pos);
  }
  const left = k === 'potion' ? 'glass_bottle' : k === 'milk_bucket' ? 'bucket' : FOOD_LEFTOVER[k];
  if (this.mode !== 'creative') {
    held.count--;
    if (!held.count) p.inv.slots[p.inv.sel] = left ? makeStack(left) : null;
    else if (left) { const s = makeStack(left); if (p.inv.add(s)) this.dropFromPlayer(s); }
  }
  p.usingItem = null; p.useT = 0;
  this.useCd = 4;
};
// chorus fruit: to a safe place up to 8 blocks away (16 tries, like vanilla)
Game.prototype.chorusTeleport = function () {
  const p = this.player, w = this.world;
  for (let i = 0; i < 16; i++) {
    const x = p.pos[0] + (Math.random() - 0.5) * 16, z = p.pos[2] + (Math.random() - 0.5) * 16;
    let y = Math.min(HEIGHT - 2, Math.floor(p.pos[1] + (Math.floor(Math.random() * 16) - 8)));
    while (y > 1 && !BLOCKS[w.getBlock(Math.floor(x), y - 1, Math.floor(z))].solid) y--;
    const old = p.pos; p.pos = [x, y, z];
    if (y > 1 && !p.collides(p.box()) && !IS_FLUID[w.getBlock(Math.floor(x), y, Math.floor(z))]) {
      p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
      Sound.ev('item.chorus_fruit.teleport', p.pos, 1, 1);
      return;
    }
    p.pos = old;
  }
};

// ---- splash and lingering potions ----
class ThrownPotion extends Entity {
  constructor(g, x, y, z, vel, owner, stack) {
    super(g, x, y, z, 0.25, 0.25); this.vel = vel; this.owner = owner; this.stack = stack;
    this.spriteLayer = ITEMS[stack.id].tex;
  }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, v = this.vel, steps = Math.max(1, Math.ceil(Math.hypot(v[0], v[1], v[2]) / 0.3));
    for (let s = 0; s < steps; s++) {
      const nx = this.pos[0] + v[0] / steps, ny = this.pos[1] + v[1] / steps, nz = this.pos[2] + v[2] / steps;
      let hit = false;
      for (const e of g.entities) {
        if (e === this || e === this.owner && this.age < 5 || !(e instanceof Living) || e.deathTime > 0) continue;
        const b = e.box();
        if (nx > b[0] && nx < b[3] && ny > b[1] && ny < b[4] && nz > b[2] && nz < b[5]) { hit = true; break; }
      }
      const id = this.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (hit || (id && BLOCKS[id].solid) || ny < -60) { this.splash(); return; }
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    v[0] *= 0.99; v[1] = v[1] * 0.99 - 0.05; v[2] *= 0.99;
  }
  // splash: everything within 4 blocks, the closer the longer; lingering: a quarter as long, for everyone near
  splash() {
    this.dead = true;
    const g = this.game, pot = this.stack.pot, fx = POTIONS[pot] || [], lingering = ITEMS[this.stack.id].key === 'lingering_potion';
    const col = potionColor(pot);
    for (let i = 0; i < 40; i++) g.particles.spawn('effect', this.pos[0], this.pos[1], this.pos[2], (Math.random() - 0.5) * 0.5, Math.random() * 0.3, (Math.random() - 0.5) * 0.5, { col });
    Sound.ev('entity.splash_potion.break', this.pos, 1, 1);
    for (const e of g.entities.concat([g.player])) {
      if (!(e instanceof Living) || e.deathTime > 0) continue;
      const d = Math.hypot(e.pos[0] - this.pos[0], e.pos[1] + e.h / 2 - this.pos[1], e.pos[2] - this.pos[2]);
      if (d > 4) continue;
      const f = lingering ? 0.25 : 1 - d / 4;
      for (const [k, t, a] of fx) {
        if (k === 'instant_health' || k === 'instant_damage') e.addEffect(k, a, 1);
        else if (t * f > 20) e.addEffect(k, a, Math.floor(t * f));
      }
    }
  }
}
Game.prototype.throwPotion = function (held) {
  const p = this.player, d = this.lookDir();
  this.entities.push(new ThrownPotion(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], [d[0] * 0.5, d[1] * 0.5 + 0.1, d[2] * 0.5], p, { ...held, count: 1 }));
  Sound.ev('entity.splash_potion.throw', p.pos, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
  if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
  p.swing();
};

// the colour of tint layer k of an item model for this stack: the potion's colour, the leather's dye, the firework
// star's explosion colours averaged (vanilla's tint sources), else the definition's own default
function stackTint(r, info, k, st) {
  const t = info && info.tints && info.tints[k];
  if (!t) return null;
  const type = (t.type || '').replace('minecraft:', '');
  if (type === 'potion') return potionColor(st && st.pot);
  if (type === 'dye' && st && st.color != null) return [(st.color >> 16) & 255, (st.color >> 8) & 255, st.color & 255];
  const cols = type === 'firework' && st && st.fw && st.fw.colors;
  if (cols && cols.length) {
    const s = [0, 0, 0];
    for (const c of cols) { const v = DYE_RGB[c] || 0xFFFFFF; s[0] += (v >> 16) & 255; s[1] += (v >> 8) & 255; s[2] += v & 255; }
    return s.map(v => Math.round(v / cols.length));
  }
  return r.itemTint(info.tints, k);
}
// does this stack carry data that changes its icon's colours?
const stackTinted = (st) => !!(st.pot || st.color != null || (st.fw && st.fw.colors && st.fw.colors.length));
// a flat item's icon coloured for this stack (16 x 16, cached); null when the item isn't a flat layered model
Renderer.prototype.stackIcon = function (id, st) {
  const info = VM.ready && VM.data.items[ITEMS[id].key], model = info && info.m !== undefined ? VM.data.models[info.m] : null;
  if (!(model && model.layers && model.layers.length && info.tints)) return null;
  const key = id + ':' + (st.pot || '') + ':' + (st.color != null ? st.color : '') + ':' + (st.fw && st.fw.colors ? st.fw.colors.join(',') : '');
  const cache = this._stackIcons || (this._stackIcons = new Map());
  let cv = cache.get(key);
  if (cv) return cv;
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const c = cv.getContext('2d');
  model.layers.forEach((l, k) => {
    const col = stackTint(this, info, k, st);
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 16;
    const x = tmp.getContext('2d'); x.drawImage(this.stripCanvas, ...this.tileXY(T(l)), 16, 16, 0, 0, 16, 16);
    if (col) { const d = x.getImageData(0, 0, 16, 16); for (let i = 0; i < 1024; i += 4) { d.data[i] = d.data[i] * col[0] / 255; d.data[i + 1] = d.data[i + 1] * col[1] / 255; d.data[i + 2] = d.data[i + 2] * col[2] / 255; } x.putImageData(d, 0, 0); }
    c.drawImage(tmp, 0, 0);
  });
  cache.set(key, cv);
  return cv;
};
// ---- the HUD's effect icons (top right: good ones above, bad ones below), like vanilla's Gui ----
function drawEffectIcons(ui, p) {
  const fx = p && p.effects; if (!fx || !fx.size) return;
  const c = ui.ctx, I = ui.img;
  let good = 0, bad = 0;
  for (const [k, e] of fx) {
    const E = EFFECTS[k], icon = I['eff_' + k];
    if (!icon || e.hidden) continue;
    const row = E.kind < 0 ? 1 : 0, x = ui.w - 25 * (row ? ++bad : ++good), y = 1 + row * 26;
    const bg = e.ambient ? I.effect_bg_ambient : I.effect_bg;
    if (bg) c.drawImage(bg, x, y);
    // the last 10 seconds: blinking
    let a = 1;
    if (!e.ambient && e.dur >= 0 && e.dur <= 200) { const t = e.dur / 10 / 5 * 0.5; a = clamp(t + Math.cos(e.dur * Math.PI / 5) * clamp((10 - e.dur / 20) / 10 * 0.25, 0, 0.25), 0, 1); }
    c.globalAlpha = a; c.drawImage(icon, x + 3, y + 3); c.globalAlpha = 1;
  }
}
// tooltip lines of a potion stack in this game (single player; net.js does the server's)
function potionLines(stack, lines) {
  const fx = POTIONS[stack.pot] || [];
  if (!fx.length) { lines.push({ text: '无效果', color: '#AAAAAA' }); return; }
  for (const [k, t, a] of fx) {
    const s = Math.floor(t / 20), time = t > 1 ? ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})` : '';
    lines.push({ text: EFFECTS[k].cn + romanLevel(a) + time, color: EFFECTS[k].kind < 0 ? '#FF5555' : '#5555FF' });
  }
}
